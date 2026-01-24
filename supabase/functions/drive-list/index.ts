import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { providerToken } = await req.json();

    if (!providerToken || typeof providerToken !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing providerToken (Google OAuth access token)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // NOTE: providerToken MUST look like "ya29...." (NOT "AIza...")
    if (providerToken.startsWith("AIza")) {
      return new Response(
        JSON.stringify({ error: "You passed an API key (AIza...). Drive needs OAuth access token (ya29...)." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Query: only PDF + Images
    const q = encodeURIComponent(`trashed=false and (mimeType='application/pdf' or mimeType contains 'image/')`);
    const url =
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=50`;

    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${providerToken}`,
      },
    });

    const txt = await r.text();

    if (!r.ok) {
      // return real Google error so you can see it in your UI/logs
      return new Response(
        JSON.stringify({
          error: "Google Drive API failed",
          status: r.status,
          details: txt,
          hint:
            "Most common: token expired (re-login), missing scope (drive.readonly), or wrong token (must be ya29...).",
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(txt, {
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
