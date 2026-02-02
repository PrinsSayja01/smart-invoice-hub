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
        attachments,
      });
    }

    return new Response(JSON.stringify({ messages }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "gmail-list crashed", message: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
