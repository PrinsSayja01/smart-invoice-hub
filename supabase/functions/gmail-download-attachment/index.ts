import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Gmail attachment data is base64url. Convert to normal base64.
function base64UrlToBase64(b64url: string) {
  return b64url.replace(/-/g, "+").replace(/_/g, "/");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { providerToken, messageId, attachmentId, filename, mimeType } = await req.json();
    if (!providerToken || !messageId || !attachmentId) {
      return new Response(JSON.stringify({ error: "Missing providerToken/messageId/attachmentId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const text = await r.text();
    if (!r.ok) {
      return new Response(JSON.stringify({ error: "Gmail attachment download failed", status: r.status, details: text }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = JSON.parse(text);
    const data = json?.data;
    if (!data) {
      return new Response(JSON.stringify({ error: "Missing attachment data in Gmail response" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const base64 = base64UrlToBase64(data);

    return new Response(JSON.stringify({ base64, filename, mimeType }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
