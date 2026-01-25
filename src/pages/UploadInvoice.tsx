import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// ---------------- Types ----------------
type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
};

type ExtractedData = {
  vendor_name?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null; // yyyy-mm-dd
  total_amount?: string | number | null;
  tax_amount?: string | number | null;
  currency?: string | null;
  extracted_text?: string | null;
};

// -------------- Helpers ----------------
function safeNumber(v: any) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function base64ToFile(base64: string, fileName: string, mimeType: string) {
  const byteString = atob(base64);
  const bytes = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i);
  return new File([bytes], fileName, { type: mimeType || "application/octet-stream" });
}

async function listDriveFiles(providerToken: string) {
  const { data, error } = await supabase.functions.invoke("drive-list", {
    body: { providerToken },
  });

  if (error) throw new Error(`Drive list failed: ${error.message}`);

  // Expect: { files: [...] }
  const files: DriveFile[] = data?.files || [];
  return files;
}

async function downloadDriveFile(providerToken: string, fileId: string) {
  const { data, error } = await supabase.functions.invoke("drive-download", {
    body: { providerToken, fileId },
  });

  if (error) throw new Error(`Drive download failed: ${error.message}`);
  if (!data?.base64) throw new Error("No base64 returned from drive-download");

  return data.base64 as string;
}

async function uploadToInvoicesBucket(userId: string, file: File) {
  const bucket = "invoices"; // must exist
  const fileNameSafe = file.name.replace(/[^\w.\-]+/g, "_");
  const storagePath = `${userId}/${Date.now()}_${fileNameSafe}`;

  const { error: upErr } = await supabase.storage.from(bucket).upload(storagePath, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "application/octet-stream",
  });

  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

  // ✅ Stable URL only if bucket is PUBLIC
  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  const fileUrl = pub?.publicUrl;

  return { storagePath, fileUrl };
}

async function saveInvoiceRow(params: {
  userId: string;
  file: File;
  extractedData: ExtractedData;
  storagePath: string;
  fileUrl: string;
}) {
  const { userId, file, extractedData, storagePath, fileUrl } = params;

  const payload: any = {
    user_id: userId,
    file_name: file.name,
    file_type: file.type || "application/octet-stream", // ✅ NOT NULL safe
    file_url: fileUrl,                                 // ✅ NOT NULL safe
    storage_path: storagePath,                          // recommended
    vendor_name: extractedData.vendor_name || null,
    invoice_number: extractedData.invoice_number || null,
    invoice_date: extractedData.invoice_date || null,
    total_amount: safeNumber(extractedData.total_amount),
    tax_amount: safeNumber(extractedData.tax_amount),
    currency: extractedData.currency || null,
    extracted_text: extractedData.extracted_text || null,
  };

  const { error } = await supabase.from("invoices").insert(payload);
  if (error) throw new Error(`Insert failed: ${error.message}`);
}

// ---------------------------------------

export default function UploadInvoice() {
  // Session state
  const [userId, setUserId] = useState<string | null>(null);
  const [providerToken, setProviderToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  // UI state
  const [busy, setBusy] = useState(false);
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);

  // This is where your AI result should go.
  // For now it’s a placeholder — you can set it after OCR/AI.
  const [extractedData, setExtractedData] = useState<ExtractedData>({
    vendor_name: null,
    invoice_number: null,
    invoice_date: null,
    total_amount: null,
    tax_amount: null,
    currency: "EUR",
    extracted_text: null,
  });

  const isLoggedIn = useMemo(() => !!userId, [userId]);
  const hasDriveToken = useMemo(() => !!providerToken, [providerToken]);

  // ---- Load session and listen auth changes ----
  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;

      if (error) {
        console.error("getSession error:", error);
        setUserId(null);
        setProviderToken(null);
        setEmail(null);
        return;
      }

      const session = data?.session ?? null;
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      setEmail(session?.user?.email ?? null);

      // provider_token location can vary — try several places:
      const pt =
        (session as any)?.provider_token ||
        (session?.user?.identities?.[0] as any)?.identity_data?.provider_token ||
        null;

      setProviderToken(pt);
    }

    loadSession();

    const { data: sub } = supabase.auth.onAuthStateChange(() => loadSession());
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // ---- Google OAuth login (Drive scopes) ----
  async function connectGoogleDrive() {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          scopes: "openid email profile https://www.googleapis.com/auth/drive.readonly",
          queryParams: {
            access_type: "offline",
            prompt: "consent", // forces Google to show permissions again
          },
          redirectTo: `${window.location.origin}/dashboard/upload`,
        },
      });

      if (error) throw error;
      // It redirects. No code after this runs.
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  // ---- Logout ----
  async function logout() {
    await supabase.auth.signOut();
    setUserId(null);
    setProviderToken(null);
    setEmail(null);
    setDriveFiles([]);
    setLocalFile(null);
  }

  // ---- Save a file (Local or Drive) ----
  async function handleSaveFile(file: File) {
    if (!userId) throw new Error("Not logged in");

    setBusy(true);
    try {
      // Upload file to Storage
      const { storagePath, fileUrl } = await uploadToInvoicesBucket(userId, file);

      if (!fileUrl) {
        throw new Error(
          "file_url is null. Make bucket 'invoices' PUBLIC (Storage settings), OR change DB to allow file_url nullable."
        );
      }

      // Insert invoice row
      await saveInvoiceRow({
        userId,
        file,
        extractedData,
        storagePath,
        fileUrl,
      });

      alert("Invoice saved ✅");
      setLocalFile(null);
    } finally {
      setBusy(false);
    }
  }

  // ---- Local Upload Save ----
  async function saveLocal() {
    if (!localFile) return alert("Please select a file first");
    try {
      await handleSaveFile(localFile);
    } catch (e: any) {
      alert(e.message);
    }
  }

  // ---- Load Drive Files ----
  async function loadDrive() {
    // If token missing => reconnect with scopes
    if (!providerToken) {
      alert("Drive token missing. Click Connect Drive and approve permissions.");
      return;
    }

    setDriveLoading(true);
    try {
      const files = await listDriveFiles(providerToken);
      setDriveFiles(files);

      if (!files.length) {
        alert("No PDF or image files found in your Drive.");
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setDriveLoading(false);
    }
  }

  // ---- Import one Drive File ----
  async function importDriveFile(f: DriveFile) {
    if (!providerToken) return alert("provider_token missing. Connect Drive again.");
    if (!userId) return alert("Not logged in");

    setBusy(true);
    try {
      const b64 = await downloadDriveFile(providerToken, f.id);
      const file = base64ToFile(b64, f.name, f.mimeType);
      await handleSaveFile(file);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  // ---------------- UI ----------------
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 20 }}>
      <h2 style={{ fontSize: 24, fontWeight: 700 }}>Upload Invoice</h2>

      {!isLoggedIn ? (
        <div style={{ marginTop: 20, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
          <p>You are not logged in. Please login first.</p>
        </div>
      ) : (
        <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div><b>User:</b> {email || userId}</div>
            <div>
              <b>Drive token:</b>{" "}
              <span style={{ color: hasDriveToken ? "green" : "crimson" }}>
                {hasDriveToken ? "available ✅" : "missing ❌"}
              </span>
            </div>
          </div>
          <button onClick={logout} disabled={busy} style={{ padding: "8px 12px" }}>
            Logout
          </button>
        </div>
      )}

      {/* Local Upload */}
      <div style={{ marginTop: 20, padding: 16, border: "1px solid #ddd", borderRadius: 12 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700 }}>Local Upload</h3>
        <p style={{ marginTop: 6, color: "#555" }}>Upload PDF/JPG/PNG from your computer.</p>

        <input
          type="file"
          accept="application/pdf,image/*"
          onChange={(e) => setLocalFile(e.target.files?.[0] ?? null)}
          disabled={!isLoggedIn || busy}
          style={{ marginTop: 12 }}
        />

        <div style={{ marginTop: 12 }}>
          <button onClick={saveLocal} disabled={!localFile || !isLoggedIn || busy} style={{ padding: "8px 12px" }}>
            {busy ? "Saving..." : "Upload + Save"}
          </button>
        </div>
      </div>

      {/* Google Drive */}
      <div style={{ marginTop: 20, padding: 16, border: "1px solid #ddd", borderRadius: 12 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700 }}>Google Drive</h3>
        <p style={{ marginTop: 6, color: "#555" }}>
          Connect Drive → Load files → Import. Uses Supabase Edge Functions (no Vercel /api routes).
        </p>

        <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <button onClick={connectGoogleDrive} disabled={!isLoggedIn || busy} style={{ padding: "8px 12px" }}>
            Connect Drive
          </button>

          <button onClick={loadDrive} disabled={!isLoggedIn || !hasDriveToken || driveLoading || busy} style={{ padding: "8px 12px" }}>
            {driveLoading ? "Loading..." : "Load Drive Files"}
          </button>
        </div>

        {driveFiles.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <h4 style={{ fontWeight: 700 }}>Files</h4>
            <div style={{ marginTop: 8 }}>
              {driveFiles.map((f) => (
                <div
                  key={f.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: 10,
                    border: "1px solid #eee",
                    borderRadius: 10,
                    marginBottom: 8,
                  }}
                >
                  <div style={{ overflow: "hidden" }}>
                    <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {f.name}
                    </div>
                    <div style={{ fontSize: 12, color: "#666" }}>
                      {f.mimeType} {f.size ? `• ${(Number(f.size) / 1024).toFixed(0)} KB` : ""}
                    </div>
                  </div>

                  <button onClick={() => importDriveFile(f)} disabled={busy} style={{ padding: "8px 12px" }}>
                    {busy ? "Working..." : "Import + Save"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Simple extractedData editor (optional) */}
      <div style={{ marginTop: 20, padding: 16, border: "1px solid #ddd", borderRadius: 12 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700 }}>Extracted Data (optional)</h3>
        <p style={{ marginTop: 6, color: "#555" }}>
          This is just a placeholder. Replace it with your OCR/AI extraction output.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
          <input
            placeholder="vendor_name"
            value={extractedData.vendor_name ?? ""}
            onChange={(e) => setExtractedData((p) => ({ ...p, vendor_name: e.target.value }))}
          />
          <input
            placeholder="invoice_number"
            value={extractedData.invoice_number ?? ""}
            onChange={(e) => setExtractedData((p) => ({ ...p, invoice_number: e.target.value }))}
          />
          <input
            placeholder="invoice_date (YYYY-MM-DD)"
            value={extractedData.invoice_date ?? ""}
            onChange={(e) => setExtractedData((p) => ({ ...p, invoice_date: e.target.value }))}
          />
          <input
            placeholder="currency (EUR)"
            value={extractedData.currency ?? ""}
            onChange={(e) => setExtractedData((p) => ({ ...p, currency: e.target.value }))}
          />
          <input
            placeholder="total_amount"
            value={extractedData.total_amount ?? ""}
            onChange={(e) => setExtractedData((p) => ({ ...p, total_amount: e.target.value }))}
          />
          <input
            placeholder="tax_amount"
            value={extractedData.tax_amount ?? ""}
            onChange={(e) => setExtractedData((p) => ({ ...p, tax_amount: e.target.value }))}
          />
        </div>
      </div>
    </div>
  );
}
