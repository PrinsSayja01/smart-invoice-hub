// supabase/functions/gmail-list/index.ts

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

    // ✅ Gmail Search Query (last 90 days invoices)
    const query = "filename:pdf OR filename:jpg newer_than:90d";

    const gmailRes = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=10`,
      {
        headers: {
          Authorization: `Bearer ${providerToken}`,
        },
      },
    );

    const gmailData = await gmailRes.json();

    if (!gmailRes.ok) {
      return new Response(
        JSON.stringify({
          error: "Gmail API failed",
          details: gmailData,
        }),
        { status: 400, headers: corsHeaders },
      );
    }

    return new Response(
      JSON.stringify({ messages: gmailData.messages || [] }),
      {
        status: 200,
        headers: corsHeaders,
      },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Server error", message: err.message }),
      { status: 500, headers: corsHeaders },
    );
  }
});
