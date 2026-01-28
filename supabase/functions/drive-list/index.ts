import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

serve(async (req) => {
  // ✅ PRE-FLIGHT must return instantly
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { providerToken } = await req.json().catch(() => ({}));

    if (!providerToken) {
      return new Response(
        JSON.stringify({ error: "Missing providerToken. Please login again." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const q = encodeURIComponent(
      `trashed=false and (mimeType='application/pdf' or mimeType contains 'image/')`,
    );

    const url =
      `https://www.googleapis.com/drive/v3/files` +
      `?q=${q}` +
      `&fields=files(id,name,mimeType,size,modifiedTime,driveId),nextPageToken` +
      `&pageSize=100` +
      `&supportsAllDrives=true` +
      `&includeItemsFromAllDrives=true` +
      `&corpora=allDrives`;

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const raw = await r.text();

    // ✅ If Google rejects token or scope -> RETURN THAT STATUS (401/403) to frontend
    if (!r.ok) {
      let parsed: any = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }

      const status = r.status;

      // Friendly hint for the most common case
      const hint =
        status === 401
          ? "Google access token expired. Please logout and login again."
          : status === 403
          ? "Missing Google Drive scopes. Reconnect Google with drive.readonly permission."
          : "Google Drive API error.";

      return new Response(
        JSON.stringify({
          error: "Google Drive API failed",
          status,
          hint,
          google: parsed,
        }),
        { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const json = JSON.parse(raw);
    const files = Array.isArray(json?.files) ? json.files : [];

    return new Response(
      JSON.stringify({ files }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e?.message || "Unknown server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});