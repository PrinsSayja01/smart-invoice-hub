import { corsHeaders } from "../_shared/cors.ts";

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing Authorization Bearer token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { providerToken, fileId } = await req.json();
    if (!providerToken || !fileId) {
      return new Response(JSON.stringify({ error: "Missing providerToken or fileId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // metadata
    const metaUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType&supportsAllDrives=true`;
    const metaRes = await fetch(metaUrl, { headers: { Authorization: `Bearer ${providerToken}` } });
    const metaText = await metaRes.text();
    if (!metaRes.ok) {
      return new Response(JSON.stringify({ error: "Drive meta failed", status: metaRes.status, details: metaText }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const meta = JSON.parse(metaText);

    // download
    const dlUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
    const dlRes = await fetch(dlUrl, { headers: { Authorization: `Bearer ${providerToken}` } });
    if (!dlRes.ok) {
      const t = await dlRes.text();
      return new Response(JSON.stringify({ error: "Drive download failed", status: dlRes.status, details: t }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const buf = new Uint8Array(await dlRes.arrayBuffer());
    return new Response(
      JSON.stringify({
        base64: toBase64(buf),
        filename: meta.name,
        mimeType: meta.mimeType,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
