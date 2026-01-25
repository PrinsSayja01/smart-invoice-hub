import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const providerToken = body?.providerToken as string | undefined;

    // IMPORTANT: providerToken must be OAuth access token (NOT AIza... api key)
    if (!providerToken || providerToken.startsWith("AIza")) {
      return json200({
        ok: false,
        error:
          "Invalid providerToken. You must send Google OAuth access token (session.provider_token). NOT an API key like AIza...",
      });
    }

    // Gmail query: last 90 days, has attachment, common invoice types
    const q = encodeURIComponent(
      `newer_than:90d has:attachment (filename:pdf OR filename:png OR filename:jpg OR filename:jpeg)`
    );

    const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=25`;

    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const listTxt = await listRes.text();

    if (!listRes.ok) {
      return json200({
        ok: false,
        error: "Gmail API list failed",
        status: listRes.status,
        details: listTxt,
      });
    }

    let listData: any;
    try {
      listData = JSON.parse(listTxt);
    } catch {
      return json200({
        ok: false,
        error: "Gmail list returned non-JSON",
        details: listTxt,
      });
    }

    const msgs = (listData.messages || []) as { id: string; threadId?: string }[];

    const results: any[] = [];

    for (const m of msgs.slice(0, 15)) {
      const getUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`;

      const getRes = await fetch(getUrl, {
        headers: { Authorization: `Bearer ${providerToken}` },
      });

      const getTxt = await getRes.text();

      if (!getRes.ok) {
        // don’t crash the function; just skip this email
        continue;
      }

      let msg: any;
      try {
        msg = JSON.parse(getTxt);
      } catch {
        continue;
      }

      const headers = msg?.payload?.headers || [];
      const subject = headers.find((h: any) => h.name === "Subject")?.value || "";
      const from = headers.find((h: any) => h.name === "From")?.value || "";

      const attachments = extractAttachments(msg?.payload);

      if (attachments.length > 0) {
        results.push({
          id: msg.id,
          threadId: msg.threadId,
          internalDate: msg.internalDate,
          subject,
          from,
          attachments,
        });
      }
    }

    return json200({ ok: true, messages: results });
  } catch (e: any) {
    return json200({ ok: false, error: e?.message || "Unknown error" });
  }
});

function extractAttachments(payload: any) {
  const out: { filename: string; mimeType: string; size: number; attachmentId: string }[] = [];

  function walk(part: any) {
    if (!part) return;

    const filename = part.filename;
    const mimeType = part.mimeType;
    const body = part.body;

    if (filename && body?.attachmentId) {
      out.push({
        filename,
        mimeType: mimeType || "application/octet-stream",
        size: body.size || 0,
        attachmentId: body.attachmentId,
      });
    }

    const parts = part.parts || [];
    for (const p of parts) walk(p);
  }

  walk(payload);
  return out;
}

function json200(obj: any) {
  return new Response(JSON.stringify(obj), {
    status: 200, // ✅ ALWAYS 200 => invoke() will not hide errors
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
