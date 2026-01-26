// supabase/functions/gmail-download-attachment/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

function corsHeaders(origin?: string) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function base64UrlToBase64(b64url: string) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  return pad ? b64 + "=".repeat(4 - pad) : b64;
}

serve(async (req) => {
  const origin = req.headers.get("origin") ?? "*";

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  try {
    const { providerToken, messageId, attachmentId, filename, mimeType } = await req.json();

    if (!providerToken || !messageId || !attachmentId) {
      return new Response(
        JSON.stringify({ error: "Missing providerToken/messageId/attachmentId" }),
        { status: 400, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } },
      );
    }

    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const text = await res.text();
    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: "Gmail attachment download failed", status: res.status, details: text }),
        { status: 200, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } },
      );
    }

    const json = JSON.parse(text);
    const data = json.data; // base64url
    if (!data) throw new Error("Missing attachment data");

    const base64 = base64UrlToBase64(data);

    return new Response(
      JSON.stringify({
        base64,
        filename: filename || "attachment",
        mimeType: mimeType || "application/octet-stream",
      }),
      { headers: { ...corsHeaders(origin), "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "gmail-download-attachment failed", message: String(e?.message ?? e) }),
      { status: 500, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } },
    );
  }
});
