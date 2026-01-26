// supabase/functions/gmail-list/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

function corsHeaders(origin?: string) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
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

function decodeHeader(headers: any[], name: string) {
  const h = (headers || []).find((x: any) => (x.name || "").toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

function collectAttachments(part: any, out: GmailAttachment[]) {
  if (!part) return;
  if (part.filename && part.body?.attachmentId) {
    const mimeType = part.mimeType || "application/octet-stream";
    out.push({
      filename: part.filename,
      mimeType,
      attachmentId: part.body.attachmentId,
      size: part.body?.size,
    });
  }
  const parts = part.parts || [];
  for (const p of parts) collectAttachments(p, out);
}

serve(async (req) => {
  const origin = req.headers.get("origin") ?? "*";

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  try {
    const { providerToken, maxResults = 30 } = await req.json();

    if (!providerToken) {
      return new Response(
        JSON.stringify({ error: "Missing providerToken" }),
        { status: 400, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } },
      );
    }

    // ✅ Gmail search query: last 90 days + attachments + common invoice types
    const q =
      "newer_than:90d has:attachment (filename:pdf OR filename:png OR filename:jpg OR filename:jpeg OR invoice)";

    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("q", q);
    listUrl.searchParams.set("maxResults", String(maxResults));

    const listRes = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const listText = await listRes.text();
    if (!listRes.ok) {
      return new Response(
        JSON.stringify({ error: "Gmail list failed", status: listRes.status, details: listText }),
        { status: 200, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } },
      );
    }

    const listJson = JSON.parse(listText);
    const ids = Array.isArray(listJson.messages) ? listJson.messages : [];

    const messages: GmailMessage[] = [];

    // Fetch each message metadata + attachments
    for (const m of ids) {
      const msgUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}`);
      msgUrl.searchParams.set("format", "full");

      const msgRes = await fetch(msgUrl.toString(), {
        headers: { Authorization: `Bearer ${providerToken}` },
      });

      if (!msgRes.ok) continue;
      const msg = await msgRes.json();

      const headers = msg.payload?.headers || [];
      const attachments: GmailAttachment[] = [];
      collectAttachments(msg.payload, attachments);

      // only keep invoice-like attachments
      const filtered = attachments.filter((a) => {
        const fn = (a.filename || "").toLowerCase();
        return fn.endsWith(".pdf") || fn.endsWith(".png") || fn.endsWith(".jpg") || fn.endsWith(".jpeg");
      });

      if (filtered.length === 0) continue;

      messages.push({
        id: msg.id,
        threadId: msg.threadId,
        subject: decodeHeader(headers, "Subject"),
        from: decodeHeader(headers, "From"),
        date: decodeHeader(headers, "Date"),
        snippet: msg.snippet,
        attachments: filtered,
      });
    }

    return new Response(
      JSON.stringify({ messages }),
      { headers: { ...corsHeaders(origin), "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "gmail-list failed", message: String(e?.message ?? e) }),
      { status: 500, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } },
    );
  }
});
