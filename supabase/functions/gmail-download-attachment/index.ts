<<<<<<< HEAD
/// <reference lib="deno.ns" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization") || "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    const { providerToken, messageId, attachmentId, filename, mimeType } =
      await req.json();

    if (!providerToken) return json({ error: "Missing providerToken" }, 400);
    if (!messageId) return json({ error: "Missing messageId" }, 400);
    if (!attachmentId) return json({ error: "Missing attachmentId" }, 400);

    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(
      messageId
    )}/attachments/${encodeURIComponent(attachmentId)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const text = await res.text();
    if (!res.ok) {
      return json(
        { error: "Gmail attachment download failed", status: res.status, details: text },
        502
      );
    }

    const data = JSON.parse(text);
    // Gmail returns base64url -> convert to base64
    const base64url = data?.data || "";
    const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");

    return json(
      { base64, filename: filename || "attachment", mimeType: mimeType || "application/octet-stream" },
      200
    );
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
=======
import { corsHeaders } from "../_shared/cors.ts";

function base64urlToBase64(input: string) {
  return (input || "").replace(/-/g, "+").replace(/_/g, "/");
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const { providerToken, messageId, attachmentId, filename, mimeType } =
      await req.json().catch(() => ({}));

    if (!providerToken || !messageId || !attachmentId) {
      return new Response(JSON.stringify({ error: "Missing providerToken/messageId/attachmentId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url =
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(
        messageId,
      )}/attachments/${encodeURIComponent(attachmentId)}`;

    const resp = await fetch(url, { headers: { Authorization: `Bearer ${providerToken}` } });

    const text = await resp.text();
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: "Attachment download failed", status: resp.status, details: text }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = JSON.parse(text);
    const base64 = base64urlToBase64(json.data ?? "");

    return new Response(
      JSON.stringify({
        base64,
        filename: filename ?? "attachment",
        mimeType: mimeType ?? "application/octet-stream",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: "gmail-download-attachment crashed", message: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
>>>>>>> 167cf85 (Initial commit: full project setup with Vite + React + shadcn/ui)
  }
});
