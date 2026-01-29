import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { providerToken } = await req.json();
    if (!providerToken) {
      return new Response(JSON.stringify({ error: "Missing providerToken" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const q = `trashed=false and (mimeType='application/pdf' or mimeType contains 'image/')`;
    const url =
      "https://www.googleapis.com/drive/v3/files" +
      `?q=${encodeURIComponent(q)}` +
      "&fields=files(id,name,mimeType,size,modifiedTime),nextPageToken" +
      "&pageSize=100" +
      "&supportsAllDrives=true" +
      "&includeItemsFromAllDrives=true" +
      "&corpora=allDrives";

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const txt = await r.text();
    if (!r.ok) {
      return new Response(JSON.stringify({ error: "Google Drive API failed", status: r.status, details: txt }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = JSON.parse(txt);
    return new Response(JSON.stringify({ files: json.files || [] }), {
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
