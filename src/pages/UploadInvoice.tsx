import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/**
 * UploadInvoice Page
 * Tabs: File Upload / Google Drive / Email
 * Uses Supabase Auth (Google) + Supabase Edge Functions:
 * - drive-list
 * - drive-download
 * - gmail-list
 * - gmail-download-attachment
 */

type TabKey = "file" | "drive" | "gmail";

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
  internalDate?: string;
  from?: string;
  subject?: string;
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function bytesToHuman(n?: number) {
  if (!n || n <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let val = n;
  while (val >= 1024 && i < units.length - 1) {
    val = val / 1024;
    i++;
  }
  return `${val.toFixed(val >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function base64ToBlob(base64: string, contentType: string) {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: contentType || "application/octet-stream" });
}

async function downloadBase64File(base64: string, mimeType: string, filename: string) {
  const blob = base64ToBlob(base64, mimeType);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function UploadInvoice() {
  const [tab, setTab] = useState<TabKey>("file");

  const [sessionEmail, setSessionEmail] = useState<string>("");
  const [providerToken, setProviderToken] = useState<string>("");

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ type: "error" | "success"; text: string } | null>(null);

  // Drive state
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [selectedDriveId, setSelectedDriveId] = useState<string>("");

  // Gmail state
  const [gmailAttachments, setGmailAttachments] = useState<GmailAttachment[]>([]);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [selectedGmailKey, setSelectedGmailKey] = useState<string>(""); // messageId::attachmentId

  // Local upload
  const [localFiles, setLocalFiles] = useState<File[]>([]);

  const isLoggedIn = useMemo(() => !!sessionEmail, [sessionEmail]);

  // Pull session + keep updated
  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;

      const s = data.session;
      setSessionEmail(s?.user?.email ?? "");
      setProviderToken((s as any)?.provider_token ?? "");
    };

    load();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSessionEmail(newSession?.user?.email ?? "");
      setProviderToken((newSession as any)?.provider_token ?? "");
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Auto-clear toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const showError = (text: string) => setToast({ type: "error", text });
  const showSuccess = (text: string) => setToast({ type: "success", text });

  /**
   * IMPORTANT: force account chooser + re-consent so user can pick different Google account.
   * Also requests Drive + Gmail read-only scopes.
   */
  const connectGoogle = async () => {
    try {
      setBusy(true);
      setToast(null);

      const redirectTo = `${window.location.origin}/dashboard/upload`;

      const scopes = [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/gmail.readonly",
      ].join(" ");

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          scopes,
          queryParams: {
            access_type: "offline",
            prompt: "consent select_account", // <-- THIS forces account picker + consent screen
            include_granted_scopes: "true",
          },
        },
      });

      if (error) throw error;
    } catch (e: any) {
      showError(e?.message || "Google login failed");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    try {
      setBusy(true);
      setToast(null);
      await supabase.auth.signOut();
      setDriveFiles([]);
      setGmailAttachments([]);
      setSelectedDriveId("");
      setSelectedGmailKey("");
      showSuccess("Logged out");
    } catch (e: any) {
      showError(e?.message || "Logout failed");
    } finally {
      setBusy(false);
    }
  };

  const useAnotherAccount = async () => {
    // safest pattern: sign out (clears cached session) then OAuth login with account chooser
    await logout();
    await connectGoogle();
  };

  /**
   * DRIVE: list files via Edge Function
   * Uses supabase.functions.invoke so Authorization header is correct (fixes Invalid JWT most of the time)
   */
  const fetchDriveFiles = async () => {
    try {
      setDriveLoading(true);
      setToast(null);
      setSelectedDriveId("");
      setDriveFiles([]);

      if (!isLoggedIn) {
        showError("Please login with Google first.");
        return;
      }
      if (!providerToken) {
        showError("Google provider token missing. Click 'Use another account' and login again with consent.");
        return;
      }

      const { data, error } = await supabase.functions.invoke("drive-list", {
        body: {
          provider_token: providerToken,
          // you can pass folderId here if you want to limit search
          // folderId: "xxx"
        },
      });

      if (error) throw error;

      const files: DriveFile[] = data?.files ?? [];
      setDriveFiles(files);

      if (!files.length) {
        showError("No PDF or image files found in your Google Drive.");
      } else {
        showSuccess(`Found ${files.length} files in Drive`);
      }
    } catch (e: any) {
      // supabase-js edge errors may be in e.context or e.message
      showError(e?.message || "Drive fetch error");
    } finally {
      setDriveLoading(false);
    }
  };

  const downloadDriveFile = async () => {
    try {
      if (!selectedDriveId) {
        showError("Select a Drive file first.");
        return;
      }
      if (!providerToken) {
        showError("Google provider token missing. Login again with consent.");
        return;
      }

      setBusy(true);
      setToast(null);

      const selected = driveFiles.find((f) => f.id === selectedDriveId);

      const { data, error } = await supabase.functions.invoke("drive-download", {
        body: {
          provider_token: providerToken,
          fileId: selectedDriveId,
        },
      });

      if (error) throw error;

      // expected response: { name, mimeType, contentBase64 }
      const name = data?.name || selected?.name || "drive-file";
      const mimeType = data?.mimeType || selected?.mimeType || "application/octet-stream";
      const contentBase64 = data?.contentBase64;

      if (!contentBase64) {
        showError("Download failed: no file content received.");
        return;
      }

      await downloadBase64File(contentBase64, mimeType, name);
      showSuccess("Drive file downloaded");
    } catch (e: any) {
      showError(e?.message || "Drive download error");
    } finally {
      setBusy(false);
    }
  };

  /**
   * GMAIL: list invoice-like attachments
   */
  const fetchGmailAttachments = async () => {
    try {
      setGmailLoading(true);
      setToast(null);
      setSelectedGmailKey("");
      setGmailAttachments([]);

      if (!isLoggedIn) {
        showError("Please login with Google first.");
        return;
      }
      if (!providerToken) {
        showError("Google provider token missing. Click 'Use another account' and login again with consent.");
        return;
      }

      const { data, error } = await supabase.functions.invoke("gmail-list", {
        body: {
          provider_token: providerToken,
          days: 90,
        },
      });

      if (error) throw error;

      const items: GmailAttachment[] = data?.attachments ?? [];
      setGmailAttachments(items);

      if (!items.length) {
        showError("No invoice attachments found in Gmail (last 90 days).");
      } else {
        showSuccess(`Found ${items.length} Gmail attachments`);
      }
    } catch (e: any) {
      showError(e?.message || "Gmail fetch error");
    } finally {
      setGmailLoading(false);
    }
  };

  const downloadGmailAttachment = async () => {
    try {
      if (!selectedGmailKey) {
        showError("Select a Gmail attachment first.");
        return;
      }
      if (!providerToken) {
        showError("Google provider token missing. Login again with consent.");
        return;
      }

      const [messageId, attachmentId] = selectedGmailKey.split("::");
      const selected = gmailAttachments.find(
        (a) => a.messageId === messageId && a.attachmentId === attachmentId
      );

      setBusy(true);
      setToast(null);

      const { data, error } = await supabase.functions.invoke("gmail-download-attachment", {
        body: {
          provider_token: providerToken,
          messageId,
          attachmentId,
        },
      });

      if (error) throw error;

      // expected response: { filename, mimeType, contentBase64 }
      const filename = data?.filename || selected?.filename || "gmail-attachment";
      const mimeType = data?.mimeType || selected?.mimeType || "application/octet-stream";
      const contentBase64 = data?.contentBase64;

      if (!contentBase64) {
        showError("Download failed: no attachment content received.");
        return;
      }

      await downloadBase64File(contentBase64, mimeType, filename);
      showSuccess("Gmail attachment downloaded");
    } catch (e: any) {
      showError(e?.message || "Gmail download error");
    } finally {
      setBusy(false);
    }
  };

  // UI helpers
  const TabButton = ({
    k,
    label,
  }: {
    k: TabKey;
    label: string;
  }) => (
    <button
      onClick={() => setTab(k)}
      className={cx(
        "px-4 py-2 rounded-lg text-sm font-medium transition",
        tab === k
          ? "bg-white shadow text-gray-900"
          : "text-gray-600 hover:bg-white/60"
      )}
      type="button"
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      <div className="max-w-4xl mx-auto px-4 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-gray-900">Upload Invoice</h1>
            <p className="text-gray-600 mt-1">Upload invoices via file, Google Drive, or email</p>
          </div>

          <div className="flex items-center gap-3">
            {isLoggedIn ? (
              <>
                <div className="text-sm text-gray-700">
                  <div className="text-xs text-gray-500">Logged in as</div>
                  <div className="font-medium">{sessionEmail}</div>
                </div>
                <button
                  type="button"
                  onClick={logout}
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm hover:bg-gray-800 disabled:opacity-60"
                >
                  Logout
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={connectGoogle}
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm hover:bg-gray-800 disabled:opacity-60"
              >
                Login with Google
              </button>
            )}
          </div>
        </div>

        <div className="mt-6 bg-white/70 backdrop-blur rounded-2xl p-3 flex gap-2">
          <TabButton k="file" label="File Upload" />
          <TabButton k="drive" label="Google Drive" />
          <TabButton k="gmail" label="Email" />
        </div>

        {/* CONTENT */}
        <div className="mt-6 bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          {tab === "file" && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900">File Upload</h2>
              <p className="text-sm text-gray-600 mt-1">Upload PDF or image invoices from your computer.</p>

              <div className="mt-5">
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  multiple
                  onChange={(e) => setLocalFiles(Array.from(e.target.files || []))}
                  className="block w-full text-sm text-gray-700"
                />

                {localFiles.length > 0 && (
                  <div className="mt-4">
                    <div className="text-sm font-medium text-gray-900">Selected files</div>
                    <ul className="mt-2 space-y-2">
                      {localFiles.map((f) => (
                        <li key={f.name} className="flex items-center justify-between text-sm">
                          <span className="text-gray-800">{f.name}</span>
                          <span className="text-gray-500">{bytesToHuman(f.size)}</span>
                        </li>
                      ))}
                    </ul>

                    <div className="mt-4 text-xs text-gray-500">
                      (This tab just selects files. If you already have a processing/upload endpoint,
                      connect it here.)
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "drive" && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Import from Google Drive</h2>
              <p className="text-sm text-gray-600 mt-1">Access PDF and image invoices from your Google Drive.</p>

              <div className="mt-4 p-4 rounded-xl border bg-gray-50">
                <div className="text-sm text-gray-800">
                  Logged in as: <span className="font-medium">{sessionEmail || "-"}</span>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Provider token:{" "}
                  {providerToken ? <span className="text-green-600 font-medium">available</span> : <span className="text-red-600 font-medium">missing</span>}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {!isLoggedIn ? (
                    <button
                      type="button"
                      onClick={connectGoogle}
                      disabled={busy}
                      className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm hover:bg-gray-800 disabled:opacity-60"
                    >
                      Connect Google
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={fetchDriveFiles}
                        disabled={driveLoading || busy}
                        className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-60"
                      >
                        {driveLoading ? "Loading..." : "Browse My Drive Files"}
                      </button>

                      <button
                        type="button"
                        onClick={useAnotherAccount}
                        disabled={busy}
                        className="px-4 py-2 rounded-lg bg-white border text-gray-800 text-sm hover:bg-gray-50 disabled:opacity-60"
                      >
                        Use another account
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Drive list */}
              <div className="mt-6">
                <div className="text-sm font-medium text-gray-900">Drive Files</div>

                {driveFiles.length === 0 ? (
                  <div className="mt-3 text-sm text-gray-500">
                    Click “Browse My Drive Files” to load your PDF and image files.
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {driveFiles.map((f) => (
                      <label
                        key={f.id}
                        className={cx(
                          "flex items-center justify-between gap-3 p-3 rounded-xl border cursor-pointer",
                          selectedDriveId === f.id ? "border-blue-500 bg-blue-50" : "bg-white hover:bg-gray-50"
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <input
                            type="radio"
                            name="driveFile"
                            checked={selectedDriveId === f.id}
                            onChange={() => setSelectedDriveId(f.id)}
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-gray-900 truncate">{f.name}</div>
                            <div className="text-xs text-gray-500 truncate">{f.mimeType}</div>
                          </div>
                        </div>
                        <div className="text-xs text-gray-500 whitespace-nowrap">
                          {f.size ? bytesToHuman(Number(f.size)) : ""}
                        </div>
                      </label>
                    ))}
                  </div>
                )}

                <div className="mt-4">
                  <button
                    type="button"
                    onClick={downloadDriveFile}
                    disabled={!selectedDriveId || busy}
                    className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm hover:bg-gray-800 disabled:opacity-60"
                  >
                    Download Selected Drive File
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === "gmail" && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Gmail Integration</h2>
              <p className="text-sm text-gray-600 mt-1">
                Process invoice attachments from your Gmail (last 90 days).
              </p>

              <div className="mt-4 p-4 rounded-xl border bg-gray-50">
                <div className="text-sm text-gray-800">
                  Connected to: <span className="font-medium">{sessionEmail || "-"}</span>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Provider token:{" "}
                  {providerToken ? <span className="text-green-600 font-medium">available</span> : <span className="text-red-600 font-medium">missing</span>}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {!isLoggedIn ? (
                    <button
                      type="button"
                      onClick={connectGoogle}
                      disabled={busy}
                      className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm hover:bg-gray-800 disabled:opacity-60"
                    >
                      Connect Google
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={fetchGmailAttachments}
                        disabled={gmailLoading || busy}
                        className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-60"
                      >
                        {gmailLoading ? "Loading..." : "Browse Gmail Invoices"}
                      </button>

                      <button
                        type="button"
                        onClick={useAnotherAccount}
                        disabled={busy}
                        className="px-4 py-2 rounded-lg bg-white border text-gray-800 text-sm hover:bg-gray-50 disabled:opacity-60"
                      >
                        Use another account
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Gmail list */}
              <div className="mt-6">
                <div className="text-sm font-medium text-gray-900">Attachments</div>

                {gmailAttachments.length === 0 ? (
                  <div className="mt-3 text-sm text-gray-500">
                    Click “Browse Gmail Invoices” to load invoice-like attachments (pdf/jpg/png).
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {gmailAttachments.map((a) => {
                      const key = `${a.messageId}::${a.attachmentId}`;
                      return (
                        <label
                          key={key}
                          className={cx(
                            "flex items-center justify-between gap-3 p-3 rounded-xl border cursor-pointer",
                            selectedGmailKey === key ? "border-blue-500 bg-blue-50" : "bg-white hover:bg-gray-50"
                          )}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <input
                              type="radio"
                              name="gmailAttach"
                              checked={selectedGmailKey === key}
                              onChange={() => setSelectedGmailKey(key)}
                            />
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-gray-900 truncate">{a.filename}</div>
                              <div className="text-xs text-gray-500 truncate">
                                {a.mimeType}
                                {a.subject ? ` • ${a.subject}` : ""}
                              </div>
                            </div>
                          </div>
                          <div className="text-xs text-gray-500 whitespace-nowrap">
                            {a.size ? bytesToHuman(a.size) : ""}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}

                <div className="mt-4">
                  <button
                    type="button"
                    onClick={downloadGmailAttachment}
                    disabled={!selectedGmailKey || busy}
                    className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm hover:bg-gray-800 disabled:opacity-60"
                  >
                    Download Selected Gmail Attachment
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Toast */}
        {toast && (
          <div
            className={cx(
              "fixed right-6 bottom-6 max-w-md rounded-xl px-4 py-3 shadow-lg border",
              toast.type === "error" ? "bg-red-600 text-white border-red-500" : "bg-green-600 text-white border-green-500"
            )}
          >
            <div className="text-sm font-medium">{toast.type === "error" ? "Error" : "Success"}</div>
            <div className="text-sm opacity-95 mt-1">{toast.text}</div>
          </div>
        )}
      </div>
    </div>
  );
}
