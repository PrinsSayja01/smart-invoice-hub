// supabase/functions/drive-download/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "POST") return json(405, { error: "Method not allowed" });

    const body = await req.json().catch(() => null);
    const providerToken = body?.providerToken;
    const fileId = body?.fileId;

    if (!providerToken || typeof providerToken !== "string") {
      return json(401, { error: "Missing providerToken" });
    }
    if (!fileId || typeof fileId !== "string") {
      return json(400, { error: "Missing fileId" });
    }

    // 1) Get file metadata (mimeType/name)
    const metaUrl =
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size&supportsAllDrives=true`;

    const metaRes = await fetch(metaUrl, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const metaText = await metaRes.text();
    if (!metaRes.ok) {
      return json(metaRes.status, {
        error: "Drive metadata failed",
        status: metaRes.status,
        details: metaText,
      });
    }

    const meta = JSON.parse(metaText);
    const mimeType: string = meta.mimeType || "application/octet-stream";
    const name: string = meta.name || "file";

    // 2) Download file bytes
    // For normal files (pdf/image): alt=media works
    // For Google Docs types: must export (not needed for your invoices usually)
    let downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;

    const fileRes = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    if (!fileRes.ok) {
      const errText = await fileRes.text();
      return json(fileRes.status, {
        error: "Drive download failed",
        status: fileRes.status,
        details: errText,
      });
    }

    const buf = await fileRes.arrayBuffer();
    const base64 = arrayBufferToBase64(buf);

    return json(200, { base64, filename: name, mimeType });
  } catch (e) {
    return json(500, { error: "drive-download crashed", message: String(e?.message || e) });
  }
});
