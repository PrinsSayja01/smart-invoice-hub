import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

type Attachment = {
  filename: string;
  mimeType: string;
  attachmentId: string;
  size?: number;
};

function findAttachments(payload: any): Attachment[] {
  const out: Attachment[] = [];
  const walk = (p: any) => {
    if (!p) return;

    if (p.filename && p.body?.attachmentId) {
      out.push({
        filename: p.filename,
        mimeType: p.mimeType || "application/octet-stream",
        attachmentId: p.body.attachmentId,
        size: p.body.size,
      });
    }

    if (Array.isArray(p.parts)) {
      for (const part of p.parts) walk(part);
    }
  };

  walk(payload);
  return out;
}

function headerValue(headers: any[] | undefined, name: string) {
  if (!Array.isArray(headers)) return null;
  const h = headers.find((x) => String(x?.name || "").toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { providerToken, maxResults } = await req.json().catch(() => ({}));

    if (!providerToken) {
      return new Response(
        JSON.stringify({ error: "Missing providerToken" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const limit = Math.min(Number(maxResults || 20), 50);

    // ✅ Gmail query: last 90 days + attachments likely invoices
    const q = encodeURIComponent(
      `newer_than:90d has:attachment (filename:pdf OR filename:png OR filename:jpg OR filename:jpeg)`,
    );

    const listUrl =
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=${limit}`;

    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const listTxt = await listRes.text();
    if (!listRes.ok) {
      return new Response(
        JSON.stringify({ error: "Gmail list failed", status: listRes.status, details: listTxt }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const listJson = JSON.parse(listTxt);
    const msgs = Array.isArray(listJson?.messages) ? listJson.messages : [];

    const results: any[] = [];

    // Fetch details for each message (limited)
    for (const m of msgs) {
      const msgUrl =
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`;

      const msgRes = await fetch(msgUrl, {
        headers: { Authorization: `Bearer ${providerToken}` },
      });

      const msgTxt = await msgRes.text();
      if (!msgRes.ok) continue;

      const msgJson = JSON.parse(msgTxt);
      const headers = msgJson?.payload?.headers || [];
      const attachments = findAttachments(msgJson?.payload);

      // keep only pdf/images
      const filtered = attachments.filter((a) =>
        (a.mimeType || "").includes("pdf") || (a.mimeType || "").startsWith("image/")
      );

      if (filtered.length === 0) continue;

      results.push({
        id: msgJson.id,
        threadId: msgJson.threadId,
        subject: headerValue(headers, "Subject"),
        from: headerValue(headers, "From"),
        date: headerValue(headers, "Date"),
        snippet: msgJson.snippet,
        attachments: filtered,
      });
    }

    return new Response(
      JSON.stringify({ messages: results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e?.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
