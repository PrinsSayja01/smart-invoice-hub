/// <reference lib="deno.ns" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function base64UrlToBase64(b64url: string) {
  // Gmail returns base64url
  return b64url.replace(/-/g, "+").replace(/_/g, "/");
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const body = await req.json().catch(() => ({}));
    const providerToken = body?.providerToken as string | undefined;
    const messageId = body?.messageId as string | undefined;
    const attachmentId = body?.attachmentId as string | undefined;
    const filename = body?.filename as string | undefined;
    const mimeType = body?.mimeType as string | undefined;

    if (!providerToken || !messageId || !attachmentId) {
      return json({ error: "Missing providerToken/messageId/attachmentId" }, 400);
    }

    const url =
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const text = await res.text();
    if (!res.ok) {
      return json(
        { error: "Gmail attachment download failed", status: res.status, details: text },
        500,
      );
    }

    const data = JSON.parse(text);
    const raw = data?.data;
    if (!raw) return json({ error: "Attachment missing data field" }, 500);

    const base64 = base64UrlToBase64(raw);
    return json({ base64, filename: filename ?? "attachment", mimeType: mimeType ?? "application/octet-stream" });
  } catch (e) {
    return json({ error: "gmail-download-attachment crashed", message: String(e) }, 500);
  }
});
