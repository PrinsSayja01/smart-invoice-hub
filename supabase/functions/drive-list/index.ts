// supabase/functions/drive-list/index.ts
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const { providerToken, pageSize = 50 } = await req.json().catch(() => ({}));
    if (!providerToken) {
      return new Response(JSON.stringify({ error: "Missing providerToken" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const q = encodeURIComponent(
      "trashed=false and (mimeType='application/pdf' or mimeType='image/png' or mimeType='image/jpeg')"
    );

    const url =
      `https://www.googleapis.com/drive/v3/files?` +
      `q=${q}&pageSize=${encodeURIComponent(String(pageSize))}` +
      `&fields=files(id,name,mimeType,size,modifiedTime)` +
      `&orderBy=modifiedTime desc` +
      `&supportsAllDrives=true&includeItemsFromAllDrives=true`;

    const resp = await fetch(url, { headers: { Authorization: `Bearer ${providerToken}` } });

    const text = await resp.text().catch(() => "");
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: "Drive list failed", status: resp.status, details: text }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = JSON.parse(text);
    return new Response(JSON.stringify({ files: data.files ?? [] }), {
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
