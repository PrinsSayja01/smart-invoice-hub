import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

serve(async (req) => {
  // ✅ MUST return immediately for OPTIONS (preflight)
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { providerToken } = await req.json().catch(() => ({}));

    if (!providerToken) {
      return new Response(
        JSON.stringify({ error: "Missing providerToken" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ✅ Includes Shared Drives support
    const q = encodeURIComponent(
      `trashed=false and (mimeType='application/pdf' or mimeType contains 'image/')`,
    );

    const url =
      `https://www.googleapis.com/drive/v3/files` +
      `?q=${q}` +
      `&fields=files(id,name,mimeType,size,modifiedTime,driveId),nextPageToken` +
      `&pageSize=100` +
      `&supportsAllDrives=true` +
      `&includeItemsFromAllDrives=true` +
      `&corpora=allDrives`;

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const txt = await r.text();

    if (!r.ok) {
      return new Response(
        JSON.stringify({ error: "Google Drive API failed", status: r.status, details: txt }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const json = JSON.parse(txt);
    const files = Array.isArray(json?.files) ? json.files : [];

    return new Response(
      JSON.stringify({ files }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e?.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
