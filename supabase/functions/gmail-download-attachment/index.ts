import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

function base64UrlToBase64(b64url: string) {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  return (b64url || "").replace(/-/g, "+").replace(/_/g, "/") + pad;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { providerToken, messageId, attachmentId, filename, mimeType } =
      await req.json().catch(() => ({}));

    if (!providerToken || !messageId || !attachmentId) {
      return new Response(
        JSON.stringify({ error: "Missing providerToken, messageId, or attachmentId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const url =
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`;

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const txt = await r.text();
    if (!r.ok) {
      return new Response(
        JSON.stringify({ error: "Gmail attachment download failed", status: r.status, details: txt }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const json = JSON.parse(txt);
    const dataB64Url = json?.data || "";
    if (!dataB64Url) {
      return new Response(
        JSON.stringify({ error: "Attachment payload missing data" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const base64 = base64UrlToBase64(dataB64Url);

    return new Response(
      JSON.stringify({ base64, filename: filename || "attachment", mimeType: mimeType || "application/octet-stream" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e?.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
