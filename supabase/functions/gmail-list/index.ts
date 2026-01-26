/// <reference lib="deno.ns" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getHeader(headers: any[], name: string) {
  const h = (headers || []).find((x) => (x.name || "").toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

function collectAttachments(payload: any, out: any[]) {
  if (!payload) return;

  if (payload.filename && payload.body?.attachmentId) {
    out.push({
      filename: payload.filename,
      mimeType: payload.mimeType,
      attachmentId: payload.body.attachmentId,
      size: payload.body.size,
    });
  }

  const parts = payload.parts || [];
  for (const p of parts) collectAttachments(p, out);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { providerToken, maxResults } = await req.json();
    if (!providerToken) return json(400, { error: "Missing providerToken" });

    // last 90 days + attachments likely invoices
    const q = `newer_than:90d has:attachment (filename:pdf OR filename:png OR filename:jpg OR filename:jpeg)`;

    const listUrl =
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?" +
      new URLSearchParams({
        q,
        maxResults: String(maxResults ?? 20),
      }).toString();

    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const listText = await listRes.text();
    if (!listRes.ok) {
      return json(listRes.status, {
        error: "Gmail API list failed",
        status: listRes.status,
        details: listText,
      });
    }

    const list = JSON.parse(listText);
    const ids: string[] = (list.messages || []).map((m: any) => m.id);

    const messages = [];
    for (const id of ids) {
      const msgUrl =
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?` +
        new URLSearchParams({
          format: "metadata",
          metadataHeaders: "Subject",
          metadataHeaders: "From",
          metadataHeaders: "Date",
        }).toString();

      const msgRes = await fetch(msgUrl, {
        headers: { Authorization: `Bearer ${providerToken}` },
      });

      const msgText = await msgRes.text();
      if (!msgRes.ok) continue;

      const msg = JSON.parse(msgText);

      const attachments: any[] = [];
      collectAttachments(msg.payload, attachments);

      if (attachments.length === 0) continue;

      messages.push({
        id: msg.id,
        threadId: msg.threadId,
        subject: getHeader(msg.payload?.headers, "Subject"),
        from: getHeader(msg.payload?.headers, "From"),
        date: getHeader(msg.payload?.headers, "Date"),
        snippet: msg.snippet,
        attachments,
      });
    }

    return json(200, { messages });
  } catch (e) {
    return json(500, { error: "Unhandled error", message: String(e) });
  }
});
