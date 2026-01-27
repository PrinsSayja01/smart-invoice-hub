import { corsHeaders } from "../_shared/cors.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("authorization");
    if (!auth) {
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

    // ✅ last 90 days, attachments pdf/images, exclude spam/trash
    const q =
      '(filename:pdf OR filename:jpg OR filename:jpeg OR filename:png) newer_than:90d -in:spam -in:trash';

    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${maxResults}`,
      { headers: { Authorization: `Bearer ${providerToken}` } },
    );

    const listTxt = await listRes.text();
    if (!listRes.ok) {
      return new Response(
        JSON.stringify({ error: "Gmail list failed", status: listRes.status, details: listTxt }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const listJson = JSON.parse(listTxt);
    const ids: string[] = (listJson.messages || []).map((m: any) => m.id);

    const messages: GmailMessage[] = [];

    const getHeader = (headersArr: any[], name: string) =>
      headersArr.find((h: any) => (h.name || "").toLowerCase() === name.toLowerCase())?.value || null;

    const walkParts = (part: any, out: GmailAttachment[]) => {
      if (!part) return;
      if (part.filename && part.body?.attachmentId) {
        out.push({
          filename: part.filename,
          mimeType: part.mimeType,
          attachmentId: part.body.attachmentId,
          size: part.body.size,
        });
      }
      (part.parts || []).forEach((p: any) => walkParts(p, out));
    };

    for (const id of ids) {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
        { headers: { Authorization: `Bearer ${providerToken}` } },
      );
      const msgTxt = await msgRes.text();
      if (!msgRes.ok) continue;

      const msg = JSON.parse(msgTxt);

      const headersArr = msg.payload?.headers || [];
      const attachments: GmailAttachment[] = [];

      // payload may itself have body/filename, but usually parts contain attachments
      walkParts(msg.payload, attachments);

      // Keep only if it actually has attachments
      if (attachments.length) {
        messages.push({
          id: msg.id,
          threadId: msg.threadId,
          subject: getHeader(headersArr, "Subject"),
          from: getHeader(headersArr, "From"),
          date: getHeader(headersArr, "Date"),
          snippet: msg.snippet,
          attachments,
        });
      }
    }

    return new Response(JSON.stringify({ messages }), {
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
