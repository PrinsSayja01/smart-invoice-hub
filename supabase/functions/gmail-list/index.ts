import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing Authorization Bearer token" }), {
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

    // Gmail search query
    const q = `newer_than:90d (filename:pdf OR filename:png OR filename:jpg OR filename:jpeg)`;

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
    const messages = listJson.messages || [];

    // Fetch details for each message (headers + attachments)
    const out: any[] = [];
    for (const m of messages) {
      const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`;
      const msgRes = await fetch(msgUrl, { headers: { Authorization: `Bearer ${providerToken}` } });
      if (!msgRes.ok) continue;

      const msg = await msgRes.json();
      const headers = msg.payload?.headers || [];
      const subject = headers.find((h: any) => h.name?.toLowerCase() === "subject")?.value || null;
      const from = headers.find((h: any) => h.name?.toLowerCase() === "from")?.value || null;
      const date = headers.find((h: any) => h.name?.toLowerCase() === "date")?.value || null;

      const attachments: any[] = [];

      const walk = (part: any) => {
        if (!part) return;
        const filename = part.filename;
        const mimeType = part.mimeType;
        const body = part.body;

        if (filename && body?.attachmentId) {
          attachments.push({
            filename,
            mimeType,
            attachmentId: body.attachmentId,
            size: body.size || 0,
          });
        }

        if (Array.isArray(part.parts)) part.parts.forEach(walk);
      };

      walk(msg.payload);

      if (attachments.length) {
        out.push({
          id: msg.id,
          threadId: msg.threadId,
          subject,
          from,
          date,
          snippet: msg.snippet,
          attachments,
        });
      }
    }

    return new Response(JSON.stringify({ messages: out }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
