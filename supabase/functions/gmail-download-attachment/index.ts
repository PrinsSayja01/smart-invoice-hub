import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { requireSupabaseUser } from "../_shared/auth.ts";

function base64UrlToBase64(b64url: string) {
  return b64url.replace(/-/g, "+").replace(/_/g, "/");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireSupabaseUser(req);
  if (!auth.ok) return auth.res;

  try {
    const { providerToken, messageId, attachmentId, filename, mimeType } = await req.json();
    if (!providerToken || !messageId || !attachmentId) {
      return new Response(JSON.stringify({ error: "Missing providerToken/messageId/attachmentId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${providerToken}` } });

    const text = await r.text();
    if (!r.ok) {
      return new Response(JSON.stringify({ error: "Gmail attachment download failed", status: r.status, details: text }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = JSON.parse(text);
    if (!json?.data) {
      return new Response(JSON.stringify({ error: "Missing attachment data" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      base64: base64UrlToBase64(json.data),
      filename,
      mimeType,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
