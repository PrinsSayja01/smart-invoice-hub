import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type GmailMessageListResp = {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

function collectAttachments(parts: any[] = []) {
  const out: { filename: string; mimeType: string; attachmentId: string; size?: number }[] = [];

  const walk = (p: any) => {
    if (!p) return;

    // Attachment if filename exists and attachmentId exists
    const filename = p.filename;
    const attachmentId = p?.body?.attachmentId;
    const mimeType = p.mimeType;

    if (filename && attachmentId) {
      out.push({
        filename,
        mimeType,
        attachmentId,
        size: p?.body?.size,
      });
    }

    if (Array.isArray(p.parts)) {
      p.parts.forEach(walk);
    }
  };

  parts.forEach(walk);
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { providerToken, pageToken, maxResults } = await req.json();

    if (!providerToken) {
      return new Response(JSON.stringify({ error: "Missing providerToken" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ✅ last 90 days + attachments likely invoice
    const q = [
      "newer_than:90d",
      "(filename:pdf OR filename:png OR filename:jpg OR filename:jpeg)",
      "(invoice OR receipt OR bill OR payment OR order)",
    ].join(" ");

    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("q", q);
    listUrl.searchParams.set("maxResults", String(maxResults ?? 20));
    if (pageToken) listUrl.searchParams.set("pageToken", pageToken);

    const listRes = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const listText = await listRes.text();
    if (!listRes.ok) {
      return new Response(
        JSON.stringify({ error: "Gmail list failed", status: listRes.status, details: listText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const listJson: GmailMessageListResp = JSON.parse(listText);
    const ids = (listJson.messages ?? []).map((m) => m.id);

    // Fetch message metadata in parallel (limited)
    const items = await Promise.all(
      ids.map(async (id) => {
        const msgUrl =
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`;
        const msgRes = await fetch(msgUrl, {
          headers: { Authorization: `Bearer ${providerToken}` },
        });

        const msgText = await msgRes.text();
        if (!msgRes.ok) {
          return { id, error: true, status: msgRes.status, details: msgText };
        }

        const msg = JSON.parse(msgText);

        const headers = msg?.payload?.headers ?? [];
        const getHeader = (name: string) =>
          headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;

        const attachments = collectAttachments(msg?.payload?.parts ?? []);

        // Only keep “invoice-like” attachments
        const filtered = attachments.filter((a) => {
          const fn = (a.filename || "").toLowerCase();
          return (
            fn.endsWith(".pdf") ||
            fn.endsWith(".png") ||
            fn.endsWith(".jpg") ||
            fn.endsWith(".jpeg")
          );
        });

        return {
          id,
          threadId: msg.threadId,
          subject: getHeader("Subject"),
          from: getHeader("From"),
          date: getHeader("Date"),
          snippet: msg.snippet,
          attachments: filtered,
        };
      }),
    );

    // Keep only messages that actually contain attachments
    const withAttachments = items.filter((x: any) => Array.isArray(x.attachments) && x.attachments.length > 0);

    return new Response(
      JSON.stringify({
        query: q,
        nextPageToken: listJson.nextPageToken ?? null,
        resultSizeEstimate: listJson.resultSizeEstimate ?? null,
        messages: withAttachments,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
