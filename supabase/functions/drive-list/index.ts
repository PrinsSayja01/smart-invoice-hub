// supabase/functions/drive-list/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

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

    const { providerToken } = await req.json();
    if (!providerToken) {
      return new Response(JSON.stringify({ error: "Missing providerToken" }), {
        status: 400,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    // ✅ Include shared drive files too
    const q =
      "(mimeType='application/pdf' or mimeType contains 'image/') and trashed=false";

    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", q);
    url.searchParams.set(
      "fields",
      "files(id,name,mimeType,size,modifiedTime),nextPageToken"
    );
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("orderBy", "modifiedTime desc");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");

    const r = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${providerToken}`,
      },
    });

    const text = await r.text();
    if (!r.ok) {
      return new Response(
        JSON.stringify({
          error: "Google Drive API failed",
          status: r.status,
          details: text,
        }),
        {
          status: 200, // keep 200 to avoid browser "failed to fetch" masking details
          headers: { ...corsHeaders, "content-type": "application/json" },
        }
      );
    }

    const json = JSON.parse(text);
    return new Response(JSON.stringify({ files: json.files ?? [] }), {
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "drive-list crashed", message: String(e) }),
      {
        status: 500,
        headers: { ...corsHeaders, "content-type": "application/json" },
      }
    );
  }
});
