/// <reference lib="deno.ns" />

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { fromBase64UrlSafe } from "../_shared/base64.ts";

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
    const messageId = body?.messageId as string | undefined;
    const attachmentId = body?.attachmentId as string | undefined;
    const filename = body?.filename as string | undefined;
    const mimeType = body?.mimeType as string | undefined;

    if (!providerToken || !messageId || !attachmentId) {
      return new Response(JSON.stringify({ error: "Missing providerToken/messageId/attachmentId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url =
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}` +
      `/attachments/${encodeURIComponent(attachmentId)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const text = await res.text();
    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: "Gmail attachment download failed", status: res.status, details: text }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const json = JSON.parse(text);
    const dataUrlSafe = json?.data as string | undefined;
    if (!dataUrlSafe) {
      return new Response(JSON.stringify({ error: "Attachment missing data" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Gmail returns base64url => convert to standard base64 for browser atob()
    const base64 = fromBase64UrlSafe(dataUrlSafe);

    return new Response(
      JSON.stringify({
        base64,
        filename: filename ?? "attachment",
        mimeType: mimeType ?? "application/octet-stream",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
