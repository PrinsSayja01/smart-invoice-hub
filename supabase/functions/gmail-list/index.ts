import { serve } from "https://deno.land/std/http/server.ts";

serve(async (req) => {
  try {
    const { providerToken } = await req.json();

    if (!providerToken) {
      return new Response(
        JSON.stringify({ error: "Missing Google token" }),
        { status: 400 }
      );
    }

    const gmailRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=has:attachment filename:pdf",
      {
        headers: {
          Authorization: `Bearer ${providerToken}`,
        },
      }
    );

    const data = await gmailRes.json();

    return new Response(
      JSON.stringify({
        files: data.messages || [],
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500 }
    );
  }
});
