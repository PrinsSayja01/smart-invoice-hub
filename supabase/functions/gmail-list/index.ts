/// <reference lib="deno.ns" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// last 90 days query (gmail search)
const defaultQuery =
  "newer_than:90d has:attachment (filename:pdf OR filename:png OR filename:jpg OR filename:jpeg)";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization") || "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    const { providerToken, maxResults = 20, q = defaultQuery } = await req.json();

    if (!providerToken) return json({ error: "Missing providerToken" }, 400);

    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("q", q);
    listUrl.searchParams.set("maxResults", String(maxResults));

    const listRes = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const listText = await listRes.text();
    if (!listRes.ok) {
      return json(
        { error: "Gmail list failed", status: listRes.status, details: listText },
        502
      );
    }

    const listData = JSON.parse(listText);
    const messages = Array.isArray(listData?.messages) ? listData.messages : [];

    // Fetch minimal details for each message
    const detailed: any[] = [];
    for (const m of messages) {
      const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`;
      const msgRes = await fetch(msgUrl, {
        headers: { Authorization: `Bearer ${providerToken}` },
      });

      const msgText = await msgRes.text();
      if (!msgRes.ok) continue;

      const msg = JSON.parse(msgText);
      const headers = msg?.payload?.headers || [];
      const getH = (name: string) =>
        headers.find((h: any) => (h.name || "").toLowerCase() === name.toLowerCase())?.value || null;

      // Collect attachments (payload parts)
      const attachments: any[] = [];
      const walk = (part: any) => {
        if (!part) return;
        const filename = part.filename || "";
        const body = part.body || {};
        if (filename && body.attachmentId) {
          attachments.push({
            filename,
            mimeType: part.mimeType,
            attachmentId: body.attachmentId,
            size: body.size,
          });
        }
        const parts = part.parts || [];
        for (const p of parts) walk(p);
      };
      walk(msg.payload);

      detailed.push({
        id: msg.id,
        threadId: msg.threadId,
        subject: getH("Subject"),
        from: getH("From"),
        date: getH("Date"),
        snippet: msg.snippet,
        attachments,
      });
    }

    return json({ messages: detailed }, 200);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
