// supabase/functions/gmail-download-attachment/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

function base64UrlToBase64(b64url: string) {
  return b64url.replace(/-/g, "+").replace(/_/g, "/");
}

serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const { providerToken, messageId, attachmentId, filename, mimeType } =
      await req.json();

    if (!providerToken || !messageId || !attachmentId) {
      return new Response(
        JSON.stringify({ error: "Missing providerToken/messageId/attachmentId" }),
        {
          status: 400,
          headers: { ...corsHeaders, "content-type": "application/json" },
        }
      );
    }

    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const text = await r.text();
    if (!r.ok) {
      return new Response(
        JSON.stringify({
          error: "Gmail attachment download failed",
          status: r.status,
          details: text,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "content-type": "application/json" },
        }
      );
    }

    const json = JSON.parse(text);
    const data = json?.data;
    if (!data) {
      return new Response(JSON.stringify({ error: "No attachment data" }), {
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    // Gmail returns base64url
    const base64 = base64UrlToBase64(data);

    return new Response(
      JSON.stringify({
        base64,
        filename: filename || "attachment",
        mimeType: mimeType || "application/octet-stream",
      }),
      { status: 200, headers: { ...corsHeaders, "content-type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "gmail-download crashed", message: String(e) }),
      {
        status: 500,
        headers: { ...corsHeaders, "content-type": "application/json" },
      }
    );
  }
});
