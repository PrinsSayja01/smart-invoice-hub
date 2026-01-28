import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function toBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
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

    const { providerToken, fileId } = await req.json();
    if (!providerToken || !fileId) {
      return new Response(JSON.stringify({ error: "Missing providerToken or fileId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
    url.searchParams.set("alt", "media");
    url.searchParams.set("supportsAllDrives", "true");

    const r = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    if (!r.ok) {
      const t = await r.text();
      return new Response(JSON.stringify({ error: "Google Drive download failed", status: r.status, details: t }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const buf = new Uint8Array(await r.arrayBuffer());
    const base64 = toBase64(buf);

    return new Response(JSON.stringify({ base64 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
