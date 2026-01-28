// supabase/functions/drive-list/index.ts

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  // ✅ CORS Preflight Fix
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { providerToken } = await req.json();

    if (!providerToken) {
      return new Response(
        JSON.stringify({ error: "Missing Google Token" }),
        { status: 401, headers: corsHeaders },
      );
    }

    // ✅ Google Drive API Request
    const driveRes = await fetch(
      "https://www.googleapis.com/drive/v3/files?q=mimeType='application/pdf' or mimeType contains 'image/'&fields=files(id,name,mimeType,modifiedTime,size)",
      {
        headers: {
          Authorization: `Bearer ${providerToken}`,
        },
      },
    );

    const data = await driveRes.json();

    if (!driveRes.ok) {
      return new Response(
        JSON.stringify({
          error: "Google Drive API failed",
          details: data,
        }),
        { status: 400, headers: corsHeaders },
      );
    }

    return new Response(JSON.stringify({ files: data.files }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Server error", message: err.message }),
      { status: 500, headers: corsHeaders },
    );
  }
});
