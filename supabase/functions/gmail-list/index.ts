/// <reference lib="deno.ns" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type GmailAttachment = {
  filename: string;
  mimeType: string;
  attachmentId: string;
  size?: number;
};

function findAttachments(payload: any, out: GmailAttachment[]) {
  if (!payload) return;
  const parts = payload.parts || [];
  for (const p of parts) {
    const filename = p.filename || "";
    const mimeType = p.mimeType || "";
    const attId = p?.body?.attachmentId;

    if (
      attId &&
      filename &&
      (mimeType === "application/pdf" ||
        mimeType.startsWith("image/") ||
        filename.toLowerCase().endsWith(".pdf") ||
        filename.toLowerCase().match(/\.(png|jpg|jpeg)$/))
    ) {
      out.push({
        filename,
        mimeType,
        attachmentId: attId,
        size: p?.body?.size,
      });
    }

    if (p.parts?.length) findAttachments(p, out);
  }
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const body = await req.json().catch(() => ({}));
    const providerToken = body?.providerToken as string | undefined;
    const maxResults = Number(body?.maxResults ?? 20);

    if (!providerToken) return json({ error: "Missing providerToken" }, 400);

    // Stronger search: any PDF/IMG attachments in last 90 days
    // You can add "invoice OR receipt" later, but first make sure attachments appear.
    const q =
      "newer_than:90d has:attachment (filename:pdf OR filename:png OR filename:jpg OR filename:jpeg)";

    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("q", q);
    listUrl.searchParams.set("maxResults", String(Math.min(maxResults, 50)));

    const listRes = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const listText = await listRes.text();
    if (!listRes.ok) {
      return json(
        { error: "Gmail list failed", status: listRes.status, details: listText },
        500,
      );
    }

    const listData = JSON.parse(listText);
    const msgs = Array.isArray(listData.messages) ? listData.messages : [];

    const out: any[] = [];

    for (const m of msgs) {
      const getUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`;
      const getRes = await fetch(getUrl, {
        headers: { Authorization: `Bearer ${providerToken}` },
      });

      const getText = await getRes.text();
      if (!getRes.ok) continue;

      const msgData = JSON.parse(getText);

      const headers = msgData?.payload?.headers || [];
      const subject = headers.find((h: any) => h.name === "Subject")?.value ?? null;
      const from = headers.find((h: any) => h.name === "From")?.value ?? null;
      const date = headers.find((h: any) => h.name === "Date")?.value ?? null;

      const attachments: GmailAttachment[] = [];
      findAttachments(msgData?.payload, attachments);

      // only include emails that actually have attachments
      if (attachments.length) {
        out.push({
          id: msgData.id,
          threadId: msgData.threadId,
          subject,
          from,
          date,
          snippet: msgData.snippet,
          attachments,
        });
      }
    }

    return json({ messages: out });
  } catch (e) {
    return json({ error: "gmail-list crashed", message: String(e) }, 500);
  }
});
