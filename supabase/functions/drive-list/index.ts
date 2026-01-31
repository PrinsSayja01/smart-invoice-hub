/// <reference lib="deno.ns" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  // ✅ CORS preflight
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization") || "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      // If you deploy with --no-verify-jwt then this is optional,
      // but still good to enforce in production.
      return json({ error: "Missing Authorization header" }, 401);
    }

    const { providerToken, pageSize = 50, includeSharedDrives = true } = await req.json();

    if (!providerToken) return json({ error: "Missing providerToken" }, 400);

    const q =
      "mimeType='application/pdf' or mimeType contains 'image/'";

    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", q);
    url.searchParams.set("pageSize", String(pageSize));
    url.searchParams.set("fields", "files(id,name,mimeType,size,modifiedTime,owners(displayName,emailAddress))");
    url.searchParams.set("orderBy", "modifiedTime desc");

    // ✅ Shared Drives support
    if (includeSharedDrives) {
      url.searchParams.set("supportsAllDrives", "true");
      url.searchParams.set("includeItemsFromAllDrives", "true");
      url.searchParams.set("corpora", "user");
    }

    const driveRes = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const text = await driveRes.text();
    if (!driveRes.ok) {
      return json(
        {
          error: "Google Drive API failed",
          status: driveRes.status,
          details: text,
        },
        502
      );
    }

    const data = JSON.parse(text);
    return json(data, 200);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
