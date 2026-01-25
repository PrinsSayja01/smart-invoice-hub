import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function toBase64UrlSafeToBase64(b64url: string) {
  return b64url.replace(/-/g, "+").replace(/_/g, "/");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { providerToken, messageId, attachmentId, filename, mimeType } = body || {};

    if (!providerToken || !messageId || !attachmentId) {
      return new Response(JSON.stringify({ error: "Missing providerToken/messageId/attachmentId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${providerToken}` } });

    const txt = await r.text();
    if (!r.ok) {
      return new Response(JSON.stringify({ error: "Gmail attachment download failed", status: r.status, details: txt }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = JSON.parse(txt);
    const data = json?.data;
    if (!data) throw new Error("No attachment data returned");

    const base64 = toBase64UrlSafeToBase64(data);

    return new Response(JSON.stringify({ base64, filename: filename || "attachment", mimeType: mimeType || "application/octet-stream" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
