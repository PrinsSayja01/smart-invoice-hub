import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { providerToken, fileId } = await req.json().catch(() => ({}));

    if (!providerToken || !fileId) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing providerToken or fileId" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const buf = new Uint8Array(await r.arrayBuffer());

    if (!r.ok) {
      // Google might return JSON text inside the body; decode best-effort
      let details = "";
      try {
        details = new TextDecoder().decode(buf);
      } catch {
        details = "Could not decode error body";
      }

      return new Response(
        JSON.stringify({
          ok: false,
          error: "Drive download failed",
          google_status: r.status,
          google_body: details,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const base64 = encodeBase64(buf);

    return new Response(
      JSON.stringify({ ok: true, base64 }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ ok: false, error: e?.message || "Unknown error" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
