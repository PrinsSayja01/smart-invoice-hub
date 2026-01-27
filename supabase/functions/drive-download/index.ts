// supabase/functions/drive-download/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { providerToken, fileId } = await req.json();

    if (!providerToken || !fileId) {
      return new Response(
        JSON.stringify({ error: "Missing providerToken or fileId" }),
        { status: 401, headers: corsHeaders }
      );
    }

    const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;

    const r = await fetch(downloadUrl, {
      headers: {
        Authorization: `Bearer ${providerToken}`,
      },
    });

    if (!r.ok) {
      return new Response(
        JSON.stringify({ error: "Drive download failed" }),
        { status: 500, headers: corsHeaders }
      );
    }

    const buffer = new Uint8Array(await r.arrayBuffer());
    const base64 = btoa(String.fromCharCode(...buffer));

    return new Response(JSON.stringify({ base64 }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
});
