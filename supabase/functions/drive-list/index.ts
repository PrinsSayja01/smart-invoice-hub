// supabase/functions/drive-list/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

function corsHeaders(origin?: string) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

serve(async (req) => {
  const origin = req.headers.get("origin") ?? "*";

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  try {
    const { providerToken, pageSize = 100 } = await req.json();

    if (!providerToken) {
      return new Response(
        JSON.stringify({ error: "Missing providerToken" }),
        { status: 400, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } },
      );
    }

    const q =
      "(mimeType='application/pdf' or mimeType contains 'image/') and trashed=false";

    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", q);
    url.searchParams.set("pageSize", String(pageSize));
    url.searchParams.set(
      "fields",
      "files(id,name,mimeType,size,modifiedTime),nextPageToken",
    );

    // ✅ Shared drives + Shared with me support
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const text = await res.text();

    if (!res.ok) {
      return new Response(
        JSON.stringify({
          error: "Google Drive API failed",
          status: res.status,
          details: text,
        }),
        { status: 200, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } },
      );
    }

    const json = JSON.parse(text);
    const files = Array.isArray(json.files) ? json.files : [];

    return new Response(
      JSON.stringify({ files }),
      { headers: { ...corsHeaders(origin), "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "drive-list failed", message: String(e?.message ?? e) }),
      { status: 500, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } },
    );
  }
});
