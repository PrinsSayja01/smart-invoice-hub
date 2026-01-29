import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { providerToken, maxResults = 20 } = await req.json();
    if (!providerToken) {
      return new Response(JSON.stringify({ error: "Missing providerToken" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const q = `newer_than:90d has:attachment (filename:pdf OR filename:png OR filename:jpg OR filename:jpeg)`;
    const listUrl =
      "https://gmail.googleapis.com/gmail/v1/users/me/messages" +
      `?q=${encodeURIComponent(q)}` +
      `&maxResults=${encodeURIComponent(String(maxResults))}`;

    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const listTxt = await listRes.text();
    if (!listRes.ok) {
      return new Response(JSON.stringify({ error: "Gmail list failed", status: listRes.status, details: listTxt }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const listJson = JSON.parse(listTxt);
    const ids: string[] = (listJson.messages || []).map((m: any) => m.id);
    if (!ids.length) {
      return new Response(JSON.stringify({ messages: [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const messages: any[] = [];

    for (const id of ids) {
      const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`;
      const msgRes = await fetch(msgUrl, { headers: { Authorization: `Bearer ${providerToken}` } });
      const msgTxt = await msgRes.text();
      if (!msgRes.ok) continue;

      const msg = JSON.parse(msgTxt);

      const headers = msg.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h: any) => (h.name || "").toLowerCase() === name.toLowerCase())?.value || null;

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
        (part.parts || []).forEach(walk);
      };
      walk(msg.payload);

      // Only keep messages that actually have attachments
      if (attachments.length) {
        messages.push({
          id: msg.id,
          threadId: msg.threadId,
          subject: getHeader("Subject"),
          from: getHeader("From"),
          date: getHeader("Date"),
          snippet: msg.snippet,
          attachments,
        });
      }
    }

    return new Response(JSON.stringify({ messages }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
