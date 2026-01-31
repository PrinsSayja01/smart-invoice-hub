<<<<<<< HEAD
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
=======
import { corsHeaders } from "../_shared/cors.ts";

function getHeader(headers: any[], name: string) {
  return headers?.find((h) => String(h.name).toLowerCase() === name.toLowerCase())?.value ?? null;
}

type GmailAttachment = {
  filename: string;
  mimeType: string;
  attachmentId: string;
  size?: number;
};

type GmailMessage = {
  id: string;
  threadId?: string;
  subject?: string | null;
  from?: string | null;
  date?: string | null;
  snippet?: string;
  attachments: GmailAttachment[];
};

function collectAttachments(payload: any, out: GmailAttachment[] = []) {
  if (!payload) return out;
  const parts = payload.parts ?? [];
  for (const p of parts) {
    if (p.parts) collectAttachments(p, out);
    if (p.filename && p.body?.attachmentId) {
      out.push({
        filename: p.filename,
        mimeType: p.mimeType ?? "application/octet-stream",
        attachmentId: p.body.attachmentId,
        size: p.body.size,
      });
    }
  }
  return out;
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const { providerToken, maxResults = 20 } = await req.json().catch(() => ({}));
    if (!providerToken) {
      return new Response(JSON.stringify({ error: "Missing providerToken" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const q = "newer_than:90d has:attachment (filename:pdf OR filename:png OR filename:jpg OR filename:jpeg)";

    const listUrl =
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${encodeURIComponent(
        String(maxResults),
      )}&q=${encodeURIComponent(q)}`;

    const listResp = await fetch(listUrl, { headers: { Authorization: `Bearer ${providerToken}` } });

    const listText = await listResp.text();
    if (!listResp.ok) {
      return new Response(JSON.stringify({ error: "Gmail list failed", status: listResp.status, details: listText }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const listJson = JSON.parse(listText);
    const ids: string[] = (listJson.messages ?? []).map((m: any) => m.id);

    const messages: GmailMessage[] = [];

    for (const id of ids) {
      const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`;
      const msgResp = await fetch(msgUrl, { headers: { Authorization: `Bearer ${providerToken}` } });
      if (!msgResp.ok) continue;

      const msgJson = await msgResp.json();
      const headers = msgJson.payload?.headers ?? [];

      const attachments = collectAttachments(msgJson.payload, []);
      if (!attachments.length) continue;

      messages.push({
        id: msgJson.id,
        threadId: msgJson.threadId,
        subject: getHeader(headers, "Subject"),
        from: getHeader(headers, "From"),
        date: getHeader(headers, "Date"),
        snippet: msgJson.snippet,
>>>>>>> 167cf85 (Initial commit: full project setup with Vite + React + shadcn/ui)
        attachments,
      });
    }

<<<<<<< HEAD
    return json({ messages: detailed }, 200);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
=======
    return new Response(JSON.stringify({ messages }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "gmail-list crashed", message: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
>>>>>>> 167cf85 (Initial commit: full project setup with Vite + React + shadcn/ui)
  }
});
