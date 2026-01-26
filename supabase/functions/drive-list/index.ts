import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async (req) => {
  try {
    const { providerToken } = await req.json();

    if (!providerToken) {
      return new Response(
        JSON.stringify({ error: "Missing providerToken" }),
        { status: 400 }
      );
    }

    // ✅ Drive API: list PDFs + Images
    const url =
      "https://www.googleapis.com/drive/v3/files?" +
      new URLSearchParams({
        q: "(mimeType='application/pdf' or mimeType contains 'image/') and trashed=false",
        fields: "files(id,name,mimeType,size,modifiedTime)",
        pageSize: "20",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      });

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${providerToken}`,
      },
    });

    const json = await res.json();

    if (!res.ok) {
      return new Response(
        JSON.stringify({
          error: "Google Drive API failed",
          status: res.status,
          details: json,
        }),
        { status: 500 }
      );
    }

    return new Response(JSON.stringify({ files: json.files || [] }), {
      status: 200,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "Unexpected server error",
        message: String(err),
      }),
      { status: 500 }
    );
  }
});
