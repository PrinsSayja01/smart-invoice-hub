import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const { providerToken, fileId } = await req.json().catch(() => ({}));
    if (!providerToken || !fileId) {
      return new Response(JSON.stringify({ error: "Missing providerToken or fileId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    if (!resp.ok) {
      const text = await resp.text();
      return new Response(JSON.stringify({ error: "Drive download failed", status: resp.status, details: text }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const buf = new Uint8Array(await resp.arrayBuffer());
    const base64 = btoa(String.fromCharCode(...buf));

    return new Response(JSON.stringify({ base64 }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "drive-download crashed", message: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
