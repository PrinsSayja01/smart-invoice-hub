/// <reference lib="deno.ns" />
import { corsHeaders } from "../_shared/cors.ts";

function base64UrlToBase64(b64url: string) {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  return (b64url + pad).replace(/-/g, "+").replace(/_/g, "/");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { providerToken, messageId, attachmentId, filename, mimeType } = await req.json().catch(
      () => ({}),
    );

    if (!providerToken || !messageId || !attachmentId) {
      return new Response(
        JSON.stringify({ error: "Missing providerToken/messageId/attachmentId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const url =
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${providerToken}` } });
    const text = await res.text();

    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: "Gmail attachment fetch failed", status: res.status, details: text }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const json = JSON.parse(text);
    const data = json.data as string; // base64url
    const base64 = base64UrlToBase64(data);

    return new Response(
      JSON.stringify({
        filename: filename ?? "attachment",
        mimeType: mimeType ?? "application/octet-stream",
        base64,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
