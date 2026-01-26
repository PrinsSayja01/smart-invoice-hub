/// <reference lib="deno.ns" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { providerToken, pageSize } = await req.json();

    if (!providerToken || typeof providerToken !== "string") {
      return json(400, { error: "Missing providerToken" });
    }

    const q =
      "(mimeType='application/pdf' or mimeType contains 'image/') and trashed=false";

    const url =
      `https://www.googleapis.com/drive/v3/files?` +
      new URLSearchParams({
        q,
        pageSize: String(pageSize ?? 50),
        fields: "files(id,name,mimeType,size,modifiedTime)",
        orderBy: "modifiedTime desc",
      }).toString();

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const text = await r.text();
    if (!r.ok) {
      return json(r.status, {
        error: "Google Drive API failed",
        status: r.status,
        details: text,
      });
    }

    const data = JSON.parse(text);
    return json(200, { files: data.files ?? [] });
  } catch (e) {
    return json(500, { error: "Unhandled error", message: String(e) });
  }
});
