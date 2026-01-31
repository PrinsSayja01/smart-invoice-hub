/// <reference lib="deno.ns" />
import { corsHeaders } from "../_shared/cors.ts";

async function gmailFetch(url: string, token: string) {
  return fetch(url, { headers: { Authorization: `Bearer ${token}` } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { providerToken, maxResults = 20 } = await req.json().catch(() => ({}));

    if (!providerToken) {
      return new Response(JSON.stringify({ error: "Missing providerToken" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ✅ Query: attachments + last 90 days + common invoice file types
    const q =
      "newer_than:90d has:attachment (filename:pdf OR filename:png OR filename:jpg OR filename:jpeg)";

    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("q", q);
    listUrl.searchParams.set("maxResults", String(maxResults));

    const listRes = await gmailFetch(listUrl.toString(), providerToken);
    const listText = await listRes.text();
    if (!listRes.ok) {
      return new Response(
        JSON.stringify({ error: "Gmail list failed", status: listRes.status, details: listText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const listJson = JSON.parse(listText);
    const ids: string[] = (listJson.messages ?? []).map((m: any) => m.id);

    // No messages
    if (!ids.length) {
      return new Response(JSON.stringify({ messages: [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch metadata for each message (subject/from/date + attachments)
    const results = [];
    for (const id of ids) {
      const getUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
      getUrl.searchParams.set("format", "full");

      const msgRes = await gmailFetch(getUrl.toString(), providerToken);
      const msgText = await msgRes.text();
      if (!msgRes.ok) continue;

      const msg = JSON.parse(msgText);
      const headers = msg.payload?.headers ?? [];
      const subject = headers.find((h: any) => h.name === "Subject")?.value ?? null;
      const from = headers.find((h: any) => h.name === "From")?.value ?? null;
      const date = headers.find((h: any) => h.name === "Date")?.value ?? null;

      // Collect attachments recursively
      const attachments: any[] = [];
      const walk = (part: any) => {
        if (!part) return;
        if (part.filename && part.body?.attachmentId) {
          attachments.push({
            filename: part.filename,
            mimeType: part.mimeType,
            attachmentId: part.body.attachmentId,
            size: part.body.size,
          });
        }
        (part.parts ?? []).forEach(walk);
      };
      walk(msg.payload);

      if (attachments.length) {
        results.push({
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

    return new Response(JSON.stringify({ messages: results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
