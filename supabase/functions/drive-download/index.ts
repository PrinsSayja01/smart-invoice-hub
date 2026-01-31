/// <reference lib="deno.ns" />
import { corsHeaders } from "../_shared/cors.ts";

function toBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { providerToken, fileId } = await req.json().catch(() => ({}));

    if (!providerToken || !fileId) {
      return new Response(JSON.stringify({ error: "Missing providerToken or fileId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const metaUrl = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
    metaUrl.searchParams.set("fields", "id,name,mimeType,size");
    metaUrl.searchParams.set("supportsAllDrives", "true");

    const metaRes = await fetch(metaUrl.toString(), {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const metaText = await metaRes.text();
    if (!metaRes.ok) {
      return new Response(JSON.stringify({ error: "Drive metadata failed", status: metaRes.status, details: metaText }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const meta = JSON.parse(metaText);

    const dlUrl = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
    dlUrl.searchParams.set("alt", "media");
    dlUrl.searchParams.set("supportsAllDrives", "true");

    const dlRes = await fetch(dlUrl.toString(), {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    if (!dlRes.ok) {
      const errText = await dlRes.text();
      return new Response(JSON.stringify({ error: "Drive download failed", status: dlRes.status, details: errText }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const bytes = new Uint8Array(await dlRes.arrayBuffer());
    const base64 = toBase64(bytes);

    return new Response(JSON.stringify({ fileId: meta.id, filename: meta.name, mimeType: meta.mimeType, base64 }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
