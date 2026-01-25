import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function base64UrlToBase64(b64url: string) {
  return b64url.replace(/-/g, "+").replace(/_/g, "/");
}

function findAttachments(payload: any) {
  const out: any[] = [];
  const walk = (part: any) => {
    if (!part) return;
    const filename = part.filename;
    const mimeType = part.mimeType;
    const attId = part.body?.attachmentId;

    if (filename && attId && mimeType) {
      const ok =
        mimeType === "application/pdf" ||
        mimeType.startsWith("image/") ||
        filename.toLowerCase().endsWith(".pdf") ||
        filename.toLowerCase().endsWith(".png") ||
        filename.toLowerCase().endsWith(".jpg") ||
        filename.toLowerCase().endsWith(".jpeg");

      if (ok) {
        out.push({
          filename,
          mimeType,
          attachmentId: attId,
          size: part.body?.size || undefined,
        });
      }
    }

    const parts = part.parts;
    if (Array.isArray(parts)) parts.forEach(walk);
  };

  walk(payload);
  return out;
}

function header(payload: any, name: string) {
  const h = payload?.headers || [];
  const found = h.find((x: any) => (x.name || "").toLowerCase() === name.toLowerCase());
  return found?.value || null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const providerToken = body?.providerToken;
    const maxResults = body?.maxResults ?? 20;
    const days = body?.days ?? 90;

    if (!providerToken) {
      return new Response(JSON.stringify({ error: "Missing providerToken" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Gmail search query: attachments + last X days + common invoice file types
    const q = encodeURIComponent(
      `newer_than:${days}d has:attachment (filename:pdf OR filename:png OR filename:jpg OR filename:jpeg)`
    );

    const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=${maxResults}`;

    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const listTxt = await listRes.text();
    if (!listRes.ok) {
      return new Response(JSON.stringify({ error: "Gmail API list failed", status: listRes.status, details: listTxt }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const list = JSON.parse(listTxt);
    const ids = Array.isArray(list?.messages) ? list.messages.map((m: any) => m.id) : [];

    const results: any[] = [];
    for (const id of ids) {
      const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`;
      const msgRes = await fetch(msgUrl, { headers: { Authorization: `Bearer ${providerToken}` } });
      const msgTxt = await msgRes.text();
      if (!msgRes.ok) continue;

      const msg = JSON.parse(msgTxt);
      const payload = msg?.payload;
      const attachments = findAttachments(payload);

      if (!attachments.length) continue;

      results.push({
        id: msg.id,
        threadId: msg.threadId,
        subject: header(payload, "Subject"),
        from: header(payload, "From"),
        date: header(payload, "Date"),
        snippet: msg.snippet,
        attachments,
      });
    }

    return new Response(JSON.stringify({ messages: results }), {
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
