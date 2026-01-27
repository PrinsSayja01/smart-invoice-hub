// supabase/functions/drive-list/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  // ✅ CORS preflight FIX
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { providerToken } = await req.json();

    if (!providerToken) {
      return new Response(
        JSON.stringify({ error: "Missing providerToken" }),
        { status: 401, headers: corsHeaders }
      );
    }

    // ✅ Drive Query (PDF + Images)
    const q =
      "(mimeType='application/pdf' or mimeType contains 'image/') and trashed=false";

    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", q);
    url.searchParams.set(
      "fields",
      "files(id,name,mimeType,size,modifiedTime),nextPageToken"
    );
    url.searchParams.set("pageSize", "50");
    url.searchParams.set("orderBy", "modifiedTime desc");

    // ✅ Shared Drives FIX
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    url.searchParams.set("corpora", "allDrives");

    const r = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${providerToken}`,
      },
    });

    const data = await r.json();

    if (!r.ok) {
      return new Response(
        JSON.stringify({
          error: "Google Drive API failed",
          status: r.status,
          details: data,
        }),
        { status: 500, headers: corsHeaders }
      );
    }

    return new Response(JSON.stringify({ files: data.files || [] }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Drive list error" }),
      { status: 500, headers: corsHeaders }
    );
  }
});
