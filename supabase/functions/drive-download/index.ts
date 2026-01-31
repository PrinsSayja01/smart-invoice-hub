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
=======
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const { providerToken, fileId } = await req.json().catch(() => ({}));
    if (!providerToken || !fileId) {
      return new Response(JSON.stringify({ error: "Missing providerToken or fileId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    if (!resp.ok) {
      const text = await resp.text();
      return new Response(JSON.stringify({ error: "Drive download failed", status: resp.status, details: text }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const buf = new Uint8Array(await resp.arrayBuffer());
    const base64 = btoa(String.fromCharCode(...buf));

    return new Response(JSON.stringify({ base64 }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "drive-download crashed", message: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
>>>>>>> 167cf85 (Initial commit: full project setup with Vite + React + shadcn/ui)
  }
});
