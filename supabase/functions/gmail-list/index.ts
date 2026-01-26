import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async (req) => {
  try {
    const { providerToken, maxResults } = await req.json();

    if (!providerToken) {
      return new Response(
        JSON.stringify({ error: "Missing providerToken" }),
        { status: 400 }
      );
    }

    // ✅ Gmail Query: ANY attachments in last 90 days
    const query = "newer_than:90d has:attachment";

    const listRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?" +
        new URLSearchParams({
          q: query,
          maxResults: String(maxResults || 15),
        }),
      {
        headers: {
          Authorization: `Bearer ${providerToken}`,
        },
      }
    );

    const listJson = await listRes.json();

    if (!listRes.ok) {
      return new Response(
        JSON.stringify({
          error: "Gmail list failed",
          status: listRes.status,
          details: listJson,
        }),
        { status: 500 }
      );
    }

    const messages = listJson.messages || [];

    // ✅ Fetch details + attachments
    const results = [];

    for (const msg of messages) {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        {
          headers: {
            Authorization: `Bearer ${providerToken}`,
          },
        }
      );

      const msgJson = await msgRes.json();

      const payload = msgJson.payload;
      const headers = payload.headers || [];

      const subject =
        headers.find((h: any) => h.name === "Subject")?.value || null;
      const from =
        headers.find((h: any) => h.name === "From")?.value || null;
      const date =
        headers.find((h: any) => h.name === "Date")?.value || null;

      // ✅ Extract attachments
      const attachments: any[] = [];

      function walkParts(parts: any[]) {
        for (const p of parts || []) {
          if (p.filename && p.body?.attachmentId) {
            attachments.push({
              filename: p.filename,
              mimeType: p.mimeType,
              attachmentId: p.body.attachmentId,
              size: p.body.size,
            });
          }
          if (p.parts) walkParts(p.parts);
        }
      }

      walkParts(payload.parts);

      if (attachments.length > 0) {
        results.push({
          id: msg.id,
          subject,
          from,
          date,
          attachments,
        });
      }
    }

    return new Response(JSON.stringify({ messages: results }), {
      status: 200,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "Unexpected server error",
        message: String(err),
      }),
      { status: 500 }
    );
  }
});
