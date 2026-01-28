import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function headerValue(headers: any[], name: string) {
  const h = headers?.find((x: any) => (x.name || "").toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

function extractAttachments(payload: any): any[] {
  const out: any[] = [];
  const walk = (part: any) => {
    if (!part) return;
    if (part.filename && part.body?.attachmentId) {
      out.push({
        filename: part.filename,
        mimeType: part.mimeType,
        attachmentId: part.body.attachmentId,
        size: part.body.size,
      });
    }
    if (Array.isArray(part.parts)) {
      for (const p of part.parts) walk(p);
    }
  };
  walk(payload);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { providerToken, maxResults = 20 } = await req.json();
    if (!providerToken) {
      return new Response(JSON.stringify({ error: "Missing providerToken" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Query: attachments with pdf/jpg/png + last 90 days
    const q =
      "newer_than:90d has:attachment (filename:pdf OR filename:png OR filename:jpg OR filename:jpeg)";

    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("q", q);
    listUrl.searchParams.set("maxResults", String(maxResults));

    const listRes = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const listText = await listRes.text();
    if (!listRes.ok) {
      return new Response(JSON.stringify({ error: "Gmail list failed", status: listRes.status, details: listText }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const listJson = JSON.parse(listText);
    const ids = Array.isArray(listJson?.messages) ? listJson.messages.map((m: any) => m.id) : [];

    const messages: any[] = [];

    // fetch each message metadata + attachments
    for (const id of ids) {
      const msgUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
      msgUrl.searchParams.set("format", "full");

      const msgRes = await fetch(msgUrl.toString(), {
        headers: { Authorization: `Bearer ${providerToken}` },
      });

      if (!msgRes.ok) continue;

      const msgJson = await msgRes.json();
      const headers = msgJson?.payload?.headers || [];

      const attachments = extractAttachments(msgJson?.payload);
      if (!attachments.length) continue;

      messages.push({
        id: msgJson.id,
        threadId: msgJson.threadId,
        subject: headerValue(headers, "Subject"),
        from: headerValue(headers, "From"),
        date: headerValue(headers, "Date"),
        snippet: msgJson.snippet,
        attachments,
      });
    }

    return new Response(JSON.stringify({ messages }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
