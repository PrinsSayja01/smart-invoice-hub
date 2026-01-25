// supabase/functions/drive-list/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return json(400, { error: "Content-Type must be application/json" });
    }

    const body = await req.json().catch(() => null);
    const providerToken = body?.providerToken;

    if (!providerToken || typeof providerToken !== "string") {
      return json(401, { error: "Missing providerToken (Google access token)" });
    }

    // ✅ List PDF + image files (including shared drives)
    const q =
      "(mimeType='application/pdf' or mimeType contains 'image/') and trashed=false";

    const params = new URLSearchParams({
      q,
      pageSize: "50",
      fields: "files(id,name,mimeType,size,modifiedTime,driveId),nextPageToken",
      orderBy: "modifiedTime desc",
      includeItemsFromAllDrives: "true",
      supportsAllDrives: "true",
      corpora: "user",
    });

    const url = `https://www.googleapis.com/drive/v3/files?${params.toString()}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const text = await res.text();
    if (!res.ok) {
      return json(res.status, {
        error: "Google Drive API failed",
        status: res.status,
        details: text,
      });
    }

    const parsed = JSON.parse(text);
    return json(200, { files: parsed.files ?? [], raw: parsed });
  } catch (e) {
    return json(500, {
      error: "drive-list crashed",
      message: String(e?.message || e),
    });
  }
});
