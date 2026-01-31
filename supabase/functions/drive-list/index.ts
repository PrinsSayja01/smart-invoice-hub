import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const { providerToken } = await req.json().catch(() => ({}));
    if (!providerToken) {
      return new Response(JSON.stringify({ error: "Missing providerToken" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const params = new URLSearchParams({
      q: "(mimeType='application/pdf' or mimeType contains 'image/') and trashed=false",
      fields: "files(id,name,mimeType,size,modifiedTime)",
      pageSize: "50",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      corpora: "allDrives",
    });

    const url = `https://www.googleapis.com/drive/v3/files?${params.toString()}`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const text = await resp.text();
    if (!resp.ok) {
      return new Response(
        JSON.stringify({ error: "Google Drive API failed", status: resp.status, details: text }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const json = JSON.parse(text);
    return new Response(JSON.stringify({ files: json.files ?? [] }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "drive-list crashed", message: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
