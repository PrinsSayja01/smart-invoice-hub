/// <reference lib="deno.ns" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toBase64(bytes: Uint8Array) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { providerToken, fileId } = await req.json();
    if (!providerToken) return json(400, { error: "Missing providerToken" });
    if (!fileId) return json(400, { error: "Missing fileId" });

    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    if (!r.ok) {
      const text = await r.text();
      return json(r.status, {
        error: "Google Drive download failed",
        status: r.status,
        details: text,
      });
    }

    const buf = new Uint8Array(await r.arrayBuffer());
    const base64 = toBase64(buf);

    return json(200, { base64 });
  } catch (e) {
    return json(500, { error: "Unhandled error", message: String(e) });
  }
});
