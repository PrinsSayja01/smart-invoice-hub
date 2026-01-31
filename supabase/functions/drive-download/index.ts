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

function toBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunk));
  }
  return btoa(binary);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization") || "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    const { providerToken, fileId } = await req.json();
    if (!providerToken) return json({ error: "Missing providerToken" }, 400);
    if (!fileId) return json({ error: "Missing fileId" }, 400);

    // Download file content
    const downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      fileId
    )}?alt=media`;

    const res = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const buf = new Uint8Array(await res.arrayBuffer());
    const b64 = toBase64(buf);

    if (!res.ok) {
      return json(
        {
          error: "Google Drive download failed",
          status: res.status,
          details: new TextDecoder().decode(buf),
        },
        502
      );
    }

    return json({ base64: b64 }, 200);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
