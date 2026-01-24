import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const providerToken = body?.providerToken;
    const fileId = body?.fileId;

    if (!providerToken || !fileId) {
      return new Response(JSON.stringify({ error: "Missing providerToken or fileId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    if (!r.ok) {
      const txt = await r.text();
      return new Response(
        JSON.stringify({
          error: "Drive download failed",
          google_status: r.status,
          google_response: txt,
          hint:
            r.status === 401
              ? "Token expired/invalid → Logout and login again"
              : r.status === 403
              ? "Missing Drive scope → Login again and accept Drive permission"
              : "Check google_response for details",
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Convert bytes to base64 (safe for browser reconstruction)
    const buf = new Uint8Array(await r.arrayBuffer());
    let binary = "";
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    const base64 = btoa(binary);

    return new Response(JSON.stringify({ base64 }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
