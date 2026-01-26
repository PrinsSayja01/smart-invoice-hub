/// <reference lib="deno.ns" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function base64UrlToBase64(b64url: string) {
  // Gmail returns base64url
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  return b64url.replace(/-/g, "+").replace(/_/g, "/") + pad;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { providerToken, messageId, attachmentId, filename, mimeType } = await req.json();
    if (!providerToken) return json(400, { error: "Missing providerToken" });
    if (!messageId) return json(400, { error: "Missing messageId" });
    if (!attachmentId) return json(400, { error: "Missing attachmentId" });

    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`;

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const text = await r.text();
    if (!r.ok) {
      return json(r.status, {
        error: "Gmail attachment download failed",
        status: r.status,
        details: text,
      });
    }

    const data = JSON.parse(text);
    const base64 = base64UrlToBase64(data.data || "");

    return json(200, {
      base64,
      filename: filename || "attachment",
      mimeType: mimeType || "application/octet-stream",
    });
  } catch (e) {
    return json(500, { error: "Unhandled error", message: String(e) });
  }
});
