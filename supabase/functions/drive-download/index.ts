/// <reference lib="deno.ns" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const body = await req.json().catch(() => ({}));
    const providerToken = body?.providerToken as string | undefined;
    const fileId = body?.fileId as string | undefined;

    if (!providerToken || !fileId) {
      return json({ error: "Missing providerToken or fileId" }, 400);
    }

    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    if (!res.ok) {
      const text = await res.text();
      return json(
        { error: "Google Drive download failed", status: res.status, details: text },
        500,
      );
    }

    const buf = new Uint8Array(await res.arrayBuffer());
    return json({ base64: toBase64(buf) });
  } catch (e) {
    return json({ error: "drive-download crashed", message: String(e) }, 500);
  }
});
