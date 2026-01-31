/// <reference lib="deno.ns" />

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

function daysAgoToUnixSeconds(days: number) {
  const ms = Date.now() - days * 24 * 60 * 60 * 1000;
  return Math.floor(ms / 1000);
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

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const { user, error: authErr } = await requireUser(req);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid JWT" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const providerToken = body?.providerToken as string | undefined;
    const maxResults = Number(body?.maxResults ?? 20);

    if (!providerToken) {
      return new Response(JSON.stringify({ error: "Missing providerToken" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const after = daysAgoToUnixSeconds(90);
    // Gmail search query: attachments + common invoice types
    const q =
      `after:${after} has:attachment (filename:pdf OR filename:png OR filename:jpg OR filename:jpeg)`;

    // 1) list message ids
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(q)}`,
      { headers: { Authorization: `Bearer ${providerToken}` } }
    );

    const listText = await listRes.text();
    if (!listRes.ok) {
      return new Response(
        JSON.stringify({ error: "Gmail list failed", status: listRes.status, details: listText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const listJson = JSON.parse(listText);
    const ids: { id: string; threadId?: string }[] = listJson.messages ?? [];
    if (!ids.length) {
      return new Response(JSON.stringify({ messages: [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) fetch each message metadata to get attachments
    const messages: GmailMessage[] = [];

    for (const m of ids) {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`,
        { headers: { Authorization: `Bearer ${providerToken}` } }
      );

      const msgText = await msgRes.text();
      if (!msgRes.ok) continue;

      const msg = JSON.parse(msgText);

      const headers = msg?.payload?.headers ?? [];
      const getHeader = (name: string) =>
        headers.find((h: any) => (h?.name ?? "").toLowerCase() === name.toLowerCase())?.value ?? null;

      // walk parts recursively to collect attachments
      const attachments: GmailAttachment[] = [];
      const walk = (part: any) => {
        if (!part) return;
        if (part?.filename && part?.body?.attachmentId) {
          attachments.push({
            filename: part.filename,
            mimeType: part.mimeType,
            attachmentId: part.body.attachmentId,
            size: part.body.size,
          });
        }
        if (Array.isArray(part?.parts)) part.parts.forEach(walk);
      };
      walk(msg.payload);

      // Keep only pdf/images
      const filtered = attachments.filter((a) =>
        a.mimeType === "application/pdf" || a.mimeType?.startsWith("image/")
      );

      if (!filtered.length) continue;

      messages.push({
        id: msg.id,
        threadId: msg.threadId,
        subject: getHeader("Subject"),
        from: getHeader("From"),
        date: getHeader("Date"),
        snippet: msg.snippet,
        attachments: filtered,
      });
    }

    return new Response(JSON.stringify({ messages }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
