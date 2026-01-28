/// <reference lib="deno.ns" />
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  // ✅ CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { providerToken, pageSize = 50 } = await req.json();

    if (!providerToken) {
      return new Response(
        JSON.stringify({ error: "Missing providerToken" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ✅ Query: PDFs + images, exclude trashed
    const q =
      `(mimeType='application/pdf' or mimeType contains 'image/') and trashed=false`;

    // ✅ Supports Shared Drive + normal drive
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", q);
    url.searchParams.set("pageSize", String(pageSize));
    url.searchParams.set(
      "fields",
      "files(id,name,mimeType,size,modifiedTime),nextPageToken",
    );

    // VERY IMPORTANT for Shared Drive + “My Drive” mixed cases
    url.searchParams.set("includeItemsFromAllDrives", "true");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("corpora", "user"); // use "allDrives" if needed later

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${providerToken}`,
      },
    });

    const text = await res.text();

    if (!res.ok) {
      // ✅ Return Google error cleanly (NO crash => no 502)
      return new Response(
        JSON.stringify({
          error: "Google Drive API failed",
          status: res.status,
          details: text,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const json = JSON.parse(text);

    return new Response(
      JSON.stringify({ files: json.files || [], nextPageToken: json.nextPageToken || null }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    // ✅ Never crash => never 502
    return new Response(
      JSON.stringify({ error: "drive-list crashed", details: String(err?.message || err) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
