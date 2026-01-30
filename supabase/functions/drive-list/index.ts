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

    const driveRes = await fetch(
      "https://www.googleapis.com/drive/v3/files?q=mimeType='application/pdf' or mimeType contains 'image/'&fields=files(id,name,mimeType)",
      {
        headers: {
          Authorization: `Bearer ${providerToken}`,
        },
      }
    );

    const data = await driveRes.json();

    return new Response(
      JSON.stringify({
        files: data.files || [],
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
