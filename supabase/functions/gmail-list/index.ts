// supabase/functions/gmail-list/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

type GmailAttachment = {
  filename: string;
  mimeType: string;
  attachmentId: string;
  size?: number;
};

function findAttachments(payload: any): GmailAttachment[] {
  const out: GmailAttachment[] = [];

  function walk(part: any) {
    if (!part) return;

    if (part.filename && part.body?.attachmentId) {
      out.push({
        filename: part.filename,
        mimeType: part.mimeType || "application/octet-stream",
        attachmentId: part.body.attachmentId,
        size: part.body.size,
      });
    }

    if (Array.isArray(part.parts)) {
      for (const p of part.parts) walk(p);
    }
  }

  walk(payload);
  return out;
}

function header(headers: any[], name: string) {
  const h = (headers || []).find((x) => (x.name || "").toLowerCase() === name);
  return h?.value || null;
}

serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const { providerToken, maxResults = 20, days = 90 } = await req.json();
    if (!providerToken) {
      return new Response(JSON.stringify({ error: "Missing providerToken" }), {
        status: 400,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    // ✅ Better search: invoice keywords + attachments + pdf/images
    // Gmail supports newer_than:Xd
    const q =
      `newer_than:${days}d has:attachment ` +
      `(filename:pdf OR filename:png OR filename:jpg OR filename:jpeg OR ` +
      `subject:invoice OR subject:receipt OR invoice OR receipt)`;

    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("q", q);
    listUrl.searchParams.set("maxResults", String(maxResults));

    const listRes = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const listText = await listRes.text();
    if (!listRes.ok) {
      return new Response(
        JSON.stringify({
          error: "Gmail list failed",
          status: listRes.status,
          details: listText,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "content-type": "application/json" },
        }
      );
    }

    const listJson = JSON.parse(listText);
    const ids: string[] = (listJson.messages || []).map((m: any) => m.id);

    const messages = [];

    for (const id of ids) {
      const getUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`;
      const getRes = await fetch(getUrl, {
        headers: { Authorization: `Bearer ${providerToken}` },
      });

      const getText = await getRes.text();
      if (!getRes.ok) continue;

      const msg = JSON.parse(getText);
      const headersArr = msg?.payload?.headers || [];
      const attachments = findAttachments(msg?.payload);

      // Only keep messages that actually have attachments
      if (!attachments.length) continue;

      messages.push({
        id: msg.id,
        threadId: msg.threadId,
        subject: header(headersArr, "subject"),
        from: header(headersArr, "from"),
        date: header(headersArr, "date"),
        snippet: msg.snippet,
        attachments,
      });
    }

    return new Response(JSON.stringify({ messages }), {
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "gmail-list crashed", message: String(e) }),
      {
        status: 500,
        headers: { ...corsHeaders, "content-type": "application/json" },
      }
    );
  }
});
