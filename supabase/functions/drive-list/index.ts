<<<<<<< HEAD
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
=======
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
>>>>>>> 167cf85 (Initial commit: full project setup with Vite + React + shadcn/ui)
  }
});
