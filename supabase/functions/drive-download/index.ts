// supabase/functions/drive-download/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
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

    const { providerToken, fileId } = await req.json();
    if (!providerToken || !fileId) {
      return new Response(
        JSON.stringify({ error: "Missing providerToken or fileId" }),
        {
          status: 400,
          headers: { ...corsHeaders, "content-type": "application/json" },
        }
      );
    }

    const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
    url.searchParams.set("alt", "media");
    url.searchParams.set("supportsAllDrives", "true");

    const r = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    if (!r.ok) {
      const text = await r.text();
      return new Response(
        JSON.stringify({
          error: "Google Drive download failed",
          status: r.status,
          details: text,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "content-type": "application/json" },
        }
      );
    }

    const buf = new Uint8Array(await r.arrayBuffer());
    const base64 = bytesToBase64(buf);

    return new Response(JSON.stringify({ base64 }), {
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "drive-download crashed", message: String(e) }),
      {
        status: 500,
        headers: { ...corsHeaders, "content-type": "application/json" },
      }
    );
  }
});
