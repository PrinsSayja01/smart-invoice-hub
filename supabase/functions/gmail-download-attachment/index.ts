import { corsHeaders } from "../_shared/cors.ts";

function base64urlToBase64(input: string) {
  return (input || "").replace(/-/g, "+").replace(/_/g, "/");
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const { providerToken, messageId, attachmentId, filename, mimeType } =
      await req.json().catch(() => ({}));

    if (!providerToken || !messageId || !attachmentId) {
      return new Response(JSON.stringify({ error: "Missing providerToken/messageId/attachmentId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url =
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(
        messageId,
      )}/attachments/${encodeURIComponent(attachmentId)}`;

    const resp = await fetch(url, { headers: { Authorization: `Bearer ${providerToken}` } });

    const text = await resp.text();
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: "Attachment download failed", status: resp.status, details: text }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = JSON.parse(text);
    const base64 = base64urlToBase64(json.data ?? "");

    return new Response(
      JSON.stringify({
        base64,
        filename: filename ?? "attachment",
        mimeType: mimeType ?? "application/octet-stream",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: "gmail-download-attachment crashed", message: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
