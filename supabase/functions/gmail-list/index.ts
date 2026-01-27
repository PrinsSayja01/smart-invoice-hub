// supabase/functions/gmail-list/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { providerToken, maxResults } = await req.json();

    if (!providerToken) {
      return new Response(
        JSON.stringify({ error: "Missing providerToken" }),
        { status: 401, headers: corsHeaders }
      );
    }

    // ✅ BROAD QUERY FIX
    const query =
      "newer_than:90d has:attachment (filename:pdf OR filename:png OR filename:jpg OR filename:jpeg)";

    const url = new URL(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages"
    );
    url.searchParams.set("q", query);
    url.searchParams.set("maxResults", String(maxResults || 15));

    const r = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${providerToken}`,
      },
    });

    const data = await r.json();

    if (!r.ok) {
      return new Response(
        JSON.stringify({ error: "Gmail API failed", details: data }),
        { status: 500, headers: corsHeaders }
      );
    }

    return new Response(JSON.stringify({ messages: data.messages || [] }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
});
