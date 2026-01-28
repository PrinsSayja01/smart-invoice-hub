import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type Tab = "file" | "drive" | "email";

type DriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
  size?: string;
};

type GmailAttachment = {
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType?: string;
  internalDate?: string;
  from?: string;
  subject?: string;
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

async function getSessionOrThrow() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error("Not logged in");
  return data.session;
}

export default function UploadInvoice() {
  const [tab, setTab] = useState<Tab>("drive");

  const [userEmail, setUserEmail] = useState<string>("");

  // Drive state
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveError, setDriveError] = useState<string>("");
  const [selectedDriveId, setSelectedDriveId] = useState<string>("");

  // Gmail state
  const [gmailItems, setGmailItems] = useState<GmailAttachment[]>([]);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [gmailError, setGmailError] = useState<string>("");
  const [selectedGmailKey, setSelectedGmailKey] = useState<string>("");

  // File upload state (optional simple)
  const [localFile, setLocalFile] = useState<File | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const session = await getSessionOrThrow();
        setUserEmail(session.user?.email ?? "");
      } catch {
        setUserEmail("");
      }
    })();
  }, []);

  const selectedGmail = useMemo(() => {
    if (!selectedGmailKey) return null;
    const [messageId, attachmentId] = selectedGmailKey.split("::");
    return gmailItems.find(
      (x) => x.messageId === messageId && x.attachmentId === attachmentId
    );
  }, [gmailItems, selectedGmailKey]);

  async function signInWithGoogle(forceChooseAccount: boolean) {
    const redirectTo = `${window.location.origin}/dashboard/upload`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        // IMPORTANT: these force the chooser + refresh tokens
        queryParams: forceChooseAccount
          ? { prompt: "consent select_account" }
          : { prompt: "consent" },
        scopes: [
          // Drive read
          "https://www.googleapis.com/auth/drive.readonly",
          // Gmail readonly (for listing attachments)
          "https://www.googleapis.com/auth/gmail.readonly",
          // OpenID profile
          "openid",
          "email",
          "profile",
        ].join(" "),
      },
    });
    if (error) throw error;
  }

  async function useAnotherAccount() {
    // Sign out Supabase session so Google doesn’t silently reuse tokens
    await supabase.auth.signOut();
    // Force chooser
    await signInWithGoogle(true);
  }

  function prettyError(e: any) {
    if (!e) return "Unknown error";
    if (typeof e === "string") return e;
    if (e?.message) return e.message;
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }

  async function listDriveFiles() {
    setDriveError("");
    setDriveLoading(true);
    setDriveFiles([]);
    setSelectedDriveId("");

    try {
      await getSessionOrThrow();

      // ✅ BEST: invoke edge function (handles auth header + URL)
      const { data, error } = await supabase.functions.invoke("drive-list", {
        body: {
          // optional: you can pass folderId if your function supports it
          // folderId: null,
          // optional: support shared drives if your function supports it
          // includeSharedDrives: true,
        },
      });

      if (error) {
        throw error;
      }

      const files: DriveFile[] =
        data?.files || data?.data?.files || data || [];

      // Filter client-side to be safe (PDF + images)
      const filtered = (files || []).filter((f) => {
        const name = (f.name || "").toLowerCase();
        const mt = (f.mimeType || "").toLowerCase();
        return (
          mt.includes("pdf") ||
          mt.includes("image/") ||
          name.endsWith(".pdf") ||
          name.endsWith(".png") ||
          name.endsWith(".jpg") ||
          name.endsWith(".jpeg") ||
          name.endsWith(".webp")
        );
      });

      setDriveFiles(filtered);
      if (filtered.length === 0) {
        setDriveError(
          "No PDF or image files found in Drive. (If your invoices are in Shared Drive, enable shared-drive support in the drive-list function.)"
        );
      }
    } catch (e: any) {
      setDriveError(prettyError(e));
    } finally {
      setDriveLoading(false);
    }
  }

  async function downloadDriveSelected() {
    setDriveError("");
    try {
      await getSessionOrThrow();
      if (!selectedDriveId) throw new Error("Select a file first.");

      const { data, error } = await supabase.functions.invoke("drive-download", {
        body: { fileId: selectedDriveId },
      });

      if (error) throw error;

      // Expecting: { filename, mimeType, base64 } or { url } or raw bytes
      const filename =
        data?.filename || data?.name || "drive-file-download.pdf";
      const mimeType = data?.mimeType || "application/octet-stream";

      if (data?.base64) {
        const byteCharacters = atob(data.base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const blob = new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }

      if (data?.url) {
        window.open(data.url, "_blank");
        return;
      }

      // If your function returns bytes as array:
      if (Array.isArray(data?.bytes)) {
        const blob = new Blob([new Uint8Array(data.bytes)], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }

      throw new Error(
        "drive-download returned unexpected response. Expected {base64} or {url}."
      );
    } catch (e: any) {
      setDriveError(prettyError(e));
    }
  }

  async function listGmailAttachments() {
    setGmailError("");
    setGmailLoading(true);
    setGmailItems([]);
    setSelectedGmailKey("");

    try {
      await getSessionOrThrow();

      const { data, error } = await supabase.functions.invoke("gmail-list", {
        body: {
          // optional: your function can use these params if implemented
          days: 90,
          // query: 'filename:pdf OR filename:jpg OR filename:png',
        },
      });

      if (error) throw error;

      const items: GmailAttachment[] =
        data?.attachments || data?.data?.attachments || data || [];

      const filtered = (items || []).filter((x) => {
        const fn = (x.filename || "").toLowerCase();
        const mt = (x.mimeType || "").toLowerCase();
        return (
          mt.includes("pdf") ||
          mt.includes("image/") ||
          fn.endsWith(".pdf") ||
          fn.endsWith(".png") ||
          fn.endsWith(".jpg") ||
          fn.endsWith(".jpeg") ||
          fn.endsWith(".webp")
        );
      });

      setGmailItems(filtered);
      if (filtered.length === 0) {
        setGmailError(
          "No invoice attachments found in Gmail (last 90 days). Try searching emails that contain PDF/JPG invoices."
        );
      }
    } catch (e: any) {
      setGmailError(prettyError(e));
    } finally {
      setGmailLoading(false);
    }
  }

  async function downloadSelectedGmailAttachment() {
    setGmailError("");
    try {
      await getSessionOrThrow();
      if (!selectedGmail)
        throw new Error("Select an attachment first.");

      const { data, error } = await supabase.functions.invoke(
        "gmail-download-attachment",
        {
          body: {
            messageId: selectedGmail.messageId,
            attachmentId: selectedGmail.attachmentId,
          },
        }
      );

      if (error) throw error;

      const filename =
        data?.filename || selectedGmail.filename || "gmail-attachment";
      const mimeType = data?.mimeType || selectedGmail.mimeType || "application/octet-stream";

      if (data?.base64) {
        const byteCharacters = atob(data.base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const blob = new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }

      if (data?.url) {
        window.open(data.url, "_blank");
        return;
      }

      throw new Error(
        "gmail-download-attachment returned unexpected response. Expected {base64} or {url}."
      );
    } catch (e: any) {
      setGmailError(prettyError(e));
    }
  }

  return (
    <div className="min-h-[calc(100vh-64px)] w-full bg-gradient-to-b from-slate-50 to-slate-100 p-6">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Upload Invoice</h1>
            <p className="text-slate-600">
              Upload invoices via file, Google Drive, or email
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-sm text-slate-600">
              Logged in as{" "}
              <span className="font-medium text-slate-900">
                {userEmail || "—"}
              </span>
            </div>
            <button
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.reload();
              }}
            >
              Logout
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex gap-2 rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-200">
          <button
            className={cn(
              "flex-1 rounded-xl px-4 py-2 text-sm font-medium",
              tab === "file" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"
            )}
            onClick={() => setTab("file")}
          >
            File Upload
          </button>

          <button
            className={cn(
              "flex-1 rounded-xl px-4 py-2 text-sm font-medium",
              tab === "drive" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"
            )}
            onClick={() => setTab("drive")}
          >
            Google Drive
          </button>

          <button
            className={cn(
              "flex-1 rounded-xl px-4 py-2 text-sm font-medium",
              tab === "email" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"
            )}
            onClick={() => setTab("email")}
          >
            Email
          </button>
        </div>

        {/* Card */}
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          {tab === "file" && (
            <div>
              <h2 className="mb-1 text-lg font-semibold text-slate-900">
                Upload from your computer
              </h2>
              <p className="mb-4 text-sm text-slate-600">
                Choose a PDF or image invoice file.
              </p>

              <input
                type="file"
                accept=".pdf,image/*"
                onChange={(e) => setLocalFile(e.target.files?.[0] ?? null)}
              />

              {localFile && (
                <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700 ring-1 ring-slate-200">
                  Selected: <span className="font-medium">{localFile.name}</span>
                </div>
              )}
            </div>
          )}

          {tab === "drive" && (
            <div>
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    Import from your Google Drive
                  </h2>
                  <p className="text-sm text-slate-600">
                    Access PDF/image invoices from your Drive account.
                  </p>
                </div>

                <button
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
                  onClick={useAnotherAccount}
                >
                  Use another account
                </button>
              </div>

              <div className="mb-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700 ring-1 ring-slate-200">
                Logged in as: <span className="font-medium">{userEmail || "—"}</span>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  className={cn(
                    "rounded-xl px-4 py-2 text-sm font-semibold text-white",
                    driveLoading ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-700"
                  )}
                  onClick={listDriveFiles}
                  disabled={driveLoading}
                >
                  {driveLoading ? "Loading..." : "Browse My Drive Files"}
                </button>

                <button
                  className={cn(
                    "rounded-xl px-4 py-2 text-sm font-semibold",
                    selectedDriveId
                      ? "bg-slate-900 text-white hover:bg-slate-800"
                      : "bg-slate-200 text-slate-500"
                  )}
                  disabled={!selectedDriveId}
                  onClick={downloadDriveSelected}
                >
                  Download Selected Drive File
                </button>
              </div>

              {driveError && (
                <div className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-200">
                  <div className="font-semibold">Drive error</div>
                  <div className="mt-1 whitespace-pre-wrap">{driveError}</div>
                </div>
              )}

              {driveFiles.length > 0 && (
                <div className="mt-6">
                  <h3 className="mb-2 text-sm font-semibold text-slate-900">
                    Select a file
                  </h3>
                  <div className="max-h-80 overflow-auto rounded-xl ring-1 ring-slate-200">
                    {driveFiles.map((f) => {
                      const selected = selectedDriveId === f.id;
                      return (
                        <button
                          key={f.id}
                          onClick={() => setSelectedDriveId(f.id)}
                          className={cn(
                            "flex w-full items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 text-left text-sm",
                            selected ? "bg-slate-900 text-white" : "bg-white hover:bg-slate-50"
                          )}
                        >
                          <span className="truncate font-medium">{f.name}</span>
                          <span className={cn("text-xs", selected ? "text-slate-200" : "text-slate-500")}>
                            {f.mimeType || ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "email" && (
            <div>
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    Gmail Integration
                  </h2>
                  <p className="text-sm text-slate-600">
                    Process invoice attachments from Gmail (last 90 days).
                  </p>
                </div>

                <button
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
                  onClick={useAnotherAccount}
                >
                  Use another account
                </button>
              </div>

              <div className="mb-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700 ring-1 ring-slate-200">
                Connected to: <span className="font-medium">{userEmail || "—"}</span>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  className={cn(
                    "rounded-xl px-4 py-2 text-sm font-semibold text-white",
                    gmailLoading ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-700"
                  )}
                  onClick={listGmailAttachments}
                  disabled={gmailLoading}
                >
                  {gmailLoading ? "Loading..." : "Browse Gmail Invoices"}
                </button>

                <button
                  className={cn(
                    "rounded-xl px-4 py-2 text-sm font-semibold",
                    selectedGmail
                      ? "bg-slate-900 text-white hover:bg-slate-800"
                      : "bg-slate-200 text-slate-500"
                  )}
                  disabled={!selectedGmail}
                  onClick={downloadSelectedGmailAttachment}
                >
                  Download Selected Gmail Attachment
                </button>
              </div>

              {gmailError && (
                <div className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-200">
                  <div className="font-semibold">Gmail error</div>
                  <div className="mt-1 whitespace-pre-wrap">{gmailError}</div>
                </div>
              )}

              {gmailItems.length > 0 && (
                <div className="mt-6">
                  <h3 className="mb-2 text-sm font-semibold text-slate-900">
                    Select an attachment
                  </h3>
                  <div className="max-h-80 overflow-auto rounded-xl ring-1 ring-slate-200">
                    {gmailItems.map((x) => {
                      const key = `${x.messageId}::${x.attachmentId}`;
                      const selected = selectedGmailKey === key;
                      return (
                        <button
                          key={key}
                          onClick={() => setSelectedGmailKey(key)}
                          className={cn(
                            "flex w-full flex-col gap-1 border-b border-slate-200 px-4 py-3 text-left text-sm",
                            selected ? "bg-slate-900 text-white" : "bg-white hover:bg-slate-50"
                          )}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate font-medium">{x.filename}</span>
                            <span className={cn("text-xs", selected ? "text-slate-200" : "text-slate-500")}>
                              {x.mimeType || ""}
                            </span>
                          </div>
                          {(x.subject || x.from) && (
                            <div className={cn("text-xs", selected ? "text-slate-200" : "text-slate-500")}>
                              {x.subject ? `Subject: ${x.subject}` : ""}
                              {x.subject && x.from ? " • " : ""}
                              {x.from ? `From: ${x.from}` : ""}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Helpful footer */}
        <div className="mt-6 text-xs text-slate-500">
          Tip: If Google keeps reusing the same account, click{" "}
          <span className="font-semibold">Use another account</span> to force the
          account chooser.
        </div>
      </div>
    </div>
  );
}
