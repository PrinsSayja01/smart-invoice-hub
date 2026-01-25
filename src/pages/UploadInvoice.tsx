import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient"; // <-- CHANGE if your path differs

type ExtractedData = {
  vendor_name?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null; // yyyy-mm-dd
  total_amount?: number | string | null;
  tax_amount?: number | string | null;
  currency?: string | null;
};

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
};

type GmailAttachment = {
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  size?: number;
  subject?: string;
  from?: string;
  date?: string;
};

const BUCKET = "invoices";

const corsHint =
  "If provider token missing → Logout & login again (must accept Drive/Gmail permission).";

function toNumberOrNull(v: any) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function safeJsonParse(txt: string) {
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

/**
 * OPTIONAL: Attach supabase to window so you can run:
 *   window.supabase.auth.getSession()
 * in DevTools console without "supabase is not defined".
 */
(function attachDebugSupabase() {
  // @ts-ignore
  if (typeof window !== "undefined" && !window.supabase) {
    // @ts-ignore
    window.supabase = supabase;
  }
})();

export default function UploadInvoice() {
  const [tab, setTab] = useState<"file" | "drive" | "gmail">("file");

  // Auth/session
  const [userId, setUserId] = useState<string | null>(null);
  const [providerToken, setProviderToken] = useState<string | null>(null); // google token (drive/gmail)

  // File upload
  const [file, setFile] = useState<File | null>(null);

  // Extracted text/data
  const [extractedText, setExtractedText] = useState<string>("");
  const [extractedData, setExtractedData] = useState<ExtractedData>({
    vendor_name: "Unknown Vendor",
    invoice_number: "",
    invoice_date: "",
    total_amount: null,
    tax_amount: null,
    currency: "EUR",
  });

  // UI status
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Drive
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [selectedDriveFileId, setSelectedDriveFileId] = useState<string>("");

  // Gmail
  const [gmailLoading, setGmailLoading] = useState(false);
  const [gmailItems, setGmailItems] = useState<GmailAttachment[]>([]);
  const [gmailError, setGmailError] = useState<string | null>(null);
  const [selectedGmailKey, setSelectedGmailKey] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ---------------------------
  // 1) Fetch session + provider_token
  // ---------------------------
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id ?? null;
      setUserId(uid);

      // Supabase may store Google token here when you login via Supabase Google provider
      const pt = (data.session as any)?.provider_token ?? null;
      setProviderToken(pt);
    })();
  }, []);

  // ---------------------------
  // 2) Google Login with scopes (Drive + Gmail) and select_account
  // ---------------------------
  async function loginWithGoogleScopes() {
    // This is the MOST IMPORTANT FIX for 403 "insufficient scopes"
    const redirectTo = `${window.location.origin}/dashboard/upload`;

    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        scopes: [
          "openid",
          "email",
          "profile",
          "https://www.googleapis.com/auth/drive.readonly",
          "https://www.googleapis.com/auth/gmail.readonly",
        ].join(" "),
        queryParams: {
          prompt: "consent select_account",
          access_type: "offline",
        },
      },
    });
  }

  async function logout() {
    await supabase.auth.signOut();
    setUserId(null);
    setProviderToken(null);
    setDriveFiles([]);
    setGmailItems([]);
    setFile(null);
    setExtractedText("");
    setDriveError(null);
    setGmailError(null);
    setSelectedDriveFileId("");
    setSelectedGmailKey("");
  }

  // ---------------------------
  // 3) Process invoice (calls your Edge Function process-invoice)
  // ---------------------------
  async function processInvoiceWithText(fileName: string, fileType: string, text: string) {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("process-invoice", {
        body: { fileName, fileType, extractedText: text },
      });
      if (error) throw error;

      // Expecting: { extractedData: {...}, extractedText?: "..." } or just object
      const out = data?.extractedData ?? data ?? {};
      setExtractedData((prev) => ({
        ...prev,
        vendor_name: out.vendor_name ?? prev.vendor_name,
        invoice_number: out.invoice_number ?? prev.invoice_number,
        invoice_date: out.invoice_date ?? prev.invoice_date,
        total_amount: out.total_amount ?? prev.total_amount,
        tax_amount: out.tax_amount ?? prev.tax_amount,
        currency: out.currency ?? prev.currency,
      }));

      if (typeof data?.extractedText === "string") {
        setExtractedText(data.extractedText);
      }
    } catch (e: any) {
      alert(`Processing failed: ${e?.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  // ---------------------------
  // 4) Upload file to Supabase Storage and save DB row
  // ---------------------------
  async function uploadToStorageAndSave(finalFile: File) {
    if (!userId) throw new Error("Not logged in");
    setSaving(true);

    try {
      // Upload to storage
      const safeName = finalFile.name.replace(/[^\w.\-() ]+/g, "_");
      const storagePath = `${userId}/${Date.now()}-${safeName}`;

      const up = await supabase.storage.from(BUCKET).upload(storagePath, finalFile, {
        upsert: false,
        contentType: finalFile.type || "application/octet-stream",
      });
      if (up.error) throw up.error;

      // Public URL
      const pub = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
      const fileUrl = pub.data.publicUrl;

      // IMPORTANT: your table requires NOT NULL file_url & file_type
      const payload: any = {
        user_id: userId,
        file_name: finalFile.name,
        file_url: fileUrl,                          // ✅ FIX (not null)
        file_type: finalFile.type || "application/pdf", // ✅ FIX (not null)
        vendor_name: extractedData.vendor_name || null,
        invoice_number: extractedData.invoice_number || null,
        invoice_date: extractedData.invoice_date || null,
        total_amount: toNumberOrNull(extractedData.total_amount),
        tax_amount: toNumberOrNull(extractedData.tax_amount),
        currency: extractedData.currency || null,
        extracted_text: extractedText || null, // remove if your table doesn't have it
        storage_path: storagePath,              // remove if your table doesn't have it
      };

      const { error: insErr } = await supabase.from("invoices").insert(payload);
      if (insErr) throw insErr;

      alert("✅ Saved successfully!");
      // reset
      setFile(null);
      setSelectedDriveFileId("");
      setSelectedGmailKey("");
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------
  // 5) Drive: list files via Edge Function drive-list
  // ---------------------------
  async function loadDriveFiles() {
    setDriveLoading(true);
    setDriveError(null);

    try {
      const { data: s } = await supabase.auth.getSession();
      const pt = (s.session as any)?.provider_token ?? providerToken;

      if (!pt) {
        throw new Error(`Google token missing. ${corsHint}`);
      }

      const { data, error } = await supabase.functions.invoke("drive-list", {
        body: { providerToken: pt },
      });

      if (error) throw error;

      // drive-list may return raw google response { files: [...] }
      const files = (data?.files ?? data?.data?.files ?? data) as any;
      const list: DriveFile[] = Array.isArray(files?.files) ? files.files : Array.isArray(files) ? files : [];

      setDriveFiles(list);
      if (list.length === 0) alert("No PDF or image files found in your Drive.");
    } catch (e: any) {
      setDriveError(e?.message || String(e));
      alert(`Drive error: ${e?.message || String(e)}`);
    } finally {
      setDriveLoading(false);
    }
  }

  // ---------------------------
  // 6) Drive: download selected file via Edge Function drive-download
  // ---------------------------
  async function downloadDriveSelectedAndPrepare() {
    if (!selectedDriveFileId) return alert("Select a file from Drive first.");

    setLoading(true);
    try {
      const { data: s } = await supabase.auth.getSession();
      const pt = (s.session as any)?.provider_token ?? providerToken;

      if (!pt) throw new Error(`Google token missing. ${corsHint}`);

      const picked = driveFiles.find((f) => f.id === selectedDriveFileId);
      if (!picked) throw new Error("Drive file not found in list");

      const { data, error } = await supabase.functions.invoke("drive-download", {
        body: { providerToken: pt, fileId: picked.id },
      });
      if (error) throw error;

      const b64 = data?.base64;
      const mime = data?.mimeType || picked.mimeType || "application/pdf";
      const name = data?.name || picked.name || "drive-file";

      if (!b64) throw new Error("drive-download did not return base64");

      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: mime });
      const f = new File([blob], name, { type: mime });

      setFile(f);

      // If you already extract text in your old code, keep it.
      // Here we just set a placeholder text so process-invoice can run.
      const text = extractedText || `File: ${name}`;
      setExtractedText(text);

      // Call AI extractor
      await processInvoiceWithText(f.name, f.type, text);
    } catch (e: any) {
      alert(`Drive download failed: ${e?.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  // ---------------------------
  // 7) Gmail: list attachments last 90 days via Edge Function gmail-list
  // ---------------------------
  async function loadGmailAttachments90d() {
    setGmailLoading(true);
    setGmailError(null);

    try {
      const { data: s } = await supabase.auth.getSession();
      const pt = (s.session as any)?.provider_token ?? providerToken;

      if (!pt) throw new Error(`Google token missing. ${corsHint}`);

      const { data, error } = await supabase.functions.invoke("gmail-list", {
        body: { providerToken: pt, days: 90 },
      });
      if (error) throw error;

      const items: GmailAttachment[] = Array.isArray(data?.items) ? data.items : [];
      setGmailItems(items);

      if (items.length === 0) alert("No PDF/image attachments found in last 90 days.");
    } catch (e: any) {
      setGmailError(e?.message || String(e));
      alert(`Gmail error: ${e?.message || String(e)}`);
    } finally {
      setGmailLoading(false);
    }
  }

  // ---------------------------
  // 8) Gmail: download attachment via Edge Function gmail-download
  // ---------------------------
  async function downloadGmailAttachmentAndPrepare() {
    if (!selectedGmailKey) return alert("Select a Gmail attachment first.");
    const [messageId, attachmentId] = selectedGmailKey.split("::");
    if (!messageId || !attachmentId) return alert("Invalid selection.");

    setLoading(true);
    try {
      const { data: s } = await supabase.auth.getSession();
      const pt = (s.session as any)?.provider_token ?? providerToken;

      if (!pt) throw new Error(`Google token missing. ${corsHint}`);

      const meta = gmailItems.find((x) => x.messageId === messageId && x.attachmentId === attachmentId);
      if (!meta) throw new Error("Attachment meta not found");

      const { data, error } = await supabase.functions.invoke("gmail-download", {
        body: { providerToken: pt, messageId, attachmentId },
      });
      if (error) throw error;

      const b64url = data?.data; // base64url from Gmail API
      if (!b64url) throw new Error("gmail-download did not return data");

      // Gmail returns base64url; convert to base64
      const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: meta.mimeType || "application/pdf" });
      const f = new File([blob], meta.filename || "attachment", { type: meta.mimeType || "application/pdf" });

      setFile(f);
      const text = extractedText || `File: ${f.name}`;
      setExtractedText(text);

      await processInvoiceWithText(f.name, f.type, text);
    } catch (e: any) {
      alert(`Gmail download failed: ${e?.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  // ---------------------------
  // 9) File upload handlers
  // ---------------------------
  function onPickLocalFile(f: File | null) {
    if (!f) return;
    setFile(f);
    setExtractedText(`File: ${f.name}`); // keep your old extractor if you had one
  }

  async function runProcessForCurrentFile() {
    if (!file) return alert("Select a file first.");
    const text = extractedText || `File: ${file.name}`;
    await processInvoiceWithText(file.name, file.type || "application/pdf", text);
  }

  async function saveCurrentInvoice() {
    if (!file) return alert("Select a file first.");
    await uploadToStorageAndSave(file);
  }

  const loggedInLabel = useMemo(() => (userId ? "✅ Logged in" : "❌ Not logged in"), [userId]);

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 32, margin: 0 }}>Upload Invoice</h1>
          <p style={{ marginTop: 6, opacity: 0.8 }}>Upload invoices via file, Google Drive, or email</p>
          <div style={{ fontSize: 13, opacity: 0.8 }}>{loggedInLabel}</div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={loginWithGoogleScopes}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #ccc",
              background: "white",
              cursor: "pointer",
            }}
          >
            Login Google (Drive+Gmail)
          </button>
          <button
            onClick={logout}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #ccc",
              background: "white",
              cursor: "pointer",
            }}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
        <button onClick={() => setTab("file")} style={tabBtn(tab === "file")}>File Upload</button>
        <button onClick={() => setTab("drive")} style={tabBtn(tab === "drive")}>Google Drive</button>
        <button onClick={() => setTab("gmail")} style={tabBtn(tab === "gmail")}>Email</button>
      </div>

      {/* Content */}
      <div style={{ marginTop: 18 }}>
        {tab === "file" && (
          <Card title="File Upload">
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/*"
                onChange={(e) => onPickLocalFile(e.target.files?.[0] ?? null)}
              />
              <button onClick={runProcessForCurrentFile} style={primaryBtn()}>
                {loading ? "Processing..." : "Process"}
              </button>
            </div>

            {file && (
              <div style={{ marginTop: 10, opacity: 0.8 }}>
                Selected: <b>{file.name}</b> ({Math.round(file.size / 1024)} KB)
              </div>
            )}
          </Card>
        )}

        {tab === "drive" && (
          <Card title="Import from Your Google Drive">
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ opacity: 0.8 }}>
                Provider token: {providerToken ? "✅ available" : "❌ missing"}
              </div>

              <button onClick={loadDriveFiles} style={primaryBtn()}>
                {driveLoading ? "Loading..." : "Load Drive Files"}
              </button>

              <button onClick={loginWithGoogleScopes} style={secondaryBtn()}>
                Login another account
              </button>
            </div>

            {driveError && (
              <div style={{ marginTop: 12, color: "#b00020", whiteSpace: "pre-wrap" }}>
                {driveError}
              </div>
            )}

            <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={selectedDriveFileId}
                onChange={(e) => setSelectedDriveFileId(e.target.value)}
                style={{ padding: 10, borderRadius: 10, minWidth: 320 }}
              >
                <option value="">Select a Drive file (PDF / image)</option>
                {driveFiles.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.mimeType})
                  </option>
                ))}
              </select>

              <button onClick={downloadDriveSelectedAndPrepare} style={primaryBtn()}>
                {loading ? "Working..." : "Use Selected File"}
              </button>
            </div>
          </Card>
        )}

        {tab === "gmail" && (
          <Card title="Import from Gmail (last 90 days)">
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ opacity: 0.8 }}>
                Provider token: {providerToken ? "✅ available" : "❌ missing"}
              </div>

              <button onClick={loadGmailAttachments90d} style={primaryBtn()}>
                {gmailLoading ? "Loading..." : "Load Gmail Attachments (90d)"}
              </button>

              <button onClick={loginWithGoogleScopes} style={secondaryBtn()}>
                Login another account
              </button>
            </div>

            {gmailError && (
              <div style={{ marginTop: 12, color: "#b00020", whiteSpace: "pre-wrap" }}>
                {gmailError}
              </div>
            )}

            <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={selectedGmailKey}
                onChange={(e) => setSelectedGmailKey(e.target.value)}
                style={{ padding: 10, borderRadius: 10, minWidth: 520 }}
              >
                <option value="">Select a Gmail attachment (PDF / image)</option>
                {gmailItems.map((x) => (
                  <option key={`${x.messageId}::${x.attachmentId}`} value={`${x.messageId}::${x.attachmentId}`}>
                    {x.filename} ({x.mimeType}) — {x.subject ?? "No subject"}
                  </option>
                ))}
              </select>

              <button onClick={downloadGmailAttachmentAndPrepare} style={primaryBtn()}>
                {loading ? "Working..." : "Use Selected Attachment"}
              </button>
            </div>
          </Card>
        )}
      </div>

      {/* Review + Save */}
      <div style={{ marginTop: 18 }}>
        <Card title="Review Extracted Data">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Vendor Name">
              <input
                value={extractedData.vendor_name ?? ""}
                onChange={(e) => setExtractedData((p) => ({ ...p, vendor_name: e.target.value }))}
                style={inputStyle()}
              />
            </Field>
            <Field label="Invoice Number">
              <input
                value={extractedData.invoice_number ?? ""}
                onChange={(e) => setExtractedData((p) => ({ ...p, invoice_number: e.target.value }))}
                style={inputStyle()}
              />
            </Field>

            <Field label="Invoice Date (YYYY-MM-DD)">
              <input
                value={extractedData.invoice_date ?? ""}
                onChange={(e) => setExtractedData((p) => ({ ...p, invoice_date: e.target.value }))}
                style={inputStyle()}
              />
            </Field>
            <Field label="Currency">
              <input
                value={extractedData.currency ?? ""}
                onChange={(e) => setExtractedData((p) => ({ ...p, currency: e.target.value }))}
                style={inputStyle()}
              />
            </Field>

            <Field label="Total Amount">
              <input
                value={extractedData.total_amount ?? ""}
                onChange={(e) => setExtractedData((p) => ({ ...p, total_amount: e.target.value }))}
                style={inputStyle()}
              />
            </Field>
            <Field label="Tax/VAT Amount">
              <input
                value={extractedData.tax_amount ?? ""}
                onChange={(e) => setExtractedData((p) => ({ ...p, tax_amount: e.target.value }))}
                style={inputStyle()}
              />
            </Field>
          </div>

          <div style={{ marginTop: 12 }}>
            <details>
              <summary style={{ cursor: "pointer" }}>
                View extracted text ({extractedText?.length ?? 0} characters)
              </summary>
              <textarea
                value={extractedText}
                onChange={(e) => setExtractedText(e.target.value)}
                style={{ width: "100%", minHeight: 120, marginTop: 10, padding: 10, borderRadius: 10 }}
              />
            </details>
          </div>

          <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
            <button onClick={saveCurrentInvoice} style={primaryBtn()} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => {
                setFile(null);
                setExtractedText("");
              }}
              style={secondaryBtn()}
            >
              Cancel
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ---------- small UI helpers ----------
function tabBtn(active: boolean): React.CSSProperties {
  return {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid #ccc",
    background: active ? "#111" : "white",
    color: active ? "white" : "#111",
    cursor: "pointer",
  };
}
function primaryBtn(): React.CSSProperties {
  return {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid #111",
    background: "#111",
    color: "white",
    cursor: "pointer",
  };
}
function secondaryBtn(): React.CSSProperties {
  return {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid #ccc",
    background: "white",
    cursor: "pointer",
  };
}
function inputStyle(): React.CSSProperties {
  return { width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" };
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 16, padding: 16, background: "white" }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}
