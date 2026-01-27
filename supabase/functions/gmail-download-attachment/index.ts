// supabase/functions/gmail-download-attachment/index.ts

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
    const { providerToken, messageId, attachmentId } = await req.json();

    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`;

    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${providerToken}`,
      },
    });

    const data = await r.json();

    if (!r.ok) {
      return new Response(
        JSON.stringify({ error: "Attachment download failed", details: data }),
        { status: 500, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({
        base64: data.data.replace(/-/g, "+").replace(/_/g, "/"),
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
});
