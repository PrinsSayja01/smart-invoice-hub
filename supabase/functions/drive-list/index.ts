/// <reference lib="deno.ns" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const body = await req.json().catch(() => ({}));
    const providerToken = body?.providerToken as string | undefined;

    if (!providerToken) {
      return json({ error: "Missing providerToken" }, 400);
    }

    // PDFs + Images (Drive)
    const q =
      "(mimeType='application/pdf' or mimeType contains 'image/') and trashed=false";

    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", q);
    url.searchParams.set(
      "fields",
      "files(id,name,mimeType,size,modifiedTime),nextPageToken",
    );
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("orderBy", "modifiedTime desc");

    // IMPORTANT: Shared Drives support
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    url.searchParams.set("corpora", "allDrives");

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const text = await res.text();

    if (!res.ok) {
      return json(
        {
          error: "Google Drive API failed",
          status: res.status,
          details: text,
        },
        500,
      );
    }

    const data = JSON.parse(text);
    return json({ files: data.files ?? [] });
  } catch (e) {
    return json({ error: "drive-list crashed", message: String(e) }, 500);
  }
});
