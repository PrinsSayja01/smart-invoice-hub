import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const providerToken = body?.providerToken;

    if (!providerToken || typeof providerToken !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing providerToken. Logout & login again and accept Drive permission." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const q = encodeURIComponent(`trashed=false and (mimeType='application/pdf' or mimeType contains 'image/')`);
    const url =
      `https://www.googleapis.com/drive/v3/files?q=${q}` +
      `&fields=files(id,name,mimeType,size,modifiedTime)` +
      `&pageSize=50`;

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const txt = await r.text();

    if (!r.ok) {
      // Return Google error clearly
      return new Response(
        JSON.stringify({
          error: "Google Drive API failed",
          google_status: r.status,
          google_response: txt,
          hint:
            r.status === 401
              ? "Token expired/invalid → Logout and login again"
              : r.status === 403
              ? "Missing Drive scope → Login again and accept Drive permission"
              : "Check google_response for details",
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Google returns JSON string. Return parsed object consistently.
    const json = JSON.parse(txt);
    return new Response(JSON.stringify({ files: json.files || [] }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
