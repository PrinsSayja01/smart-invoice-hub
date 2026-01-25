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

    if (!providerToken || providerToken.startsWith("AIza")) {
      return json200({
        ok: false,
        error:
          "Invalid providerToken. You must send Google OAuth access token (session.provider_token). NOT an API key like AIza...",
      });
    }

    const q = encodeURIComponent(`trashed=false and (mimeType='application/pdf' or mimeType contains 'image/')`);
    const url =
      `https://www.googleapis.com/drive/v3/files?q=${q}` +
      `&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=50`;

    const r = await fetch(url, { headers: { Authorization: `Bearer ${providerToken}` } });
    const txt = await r.text();

    if (!r.ok) {
      return json200({ ok: false, error: "Google Drive API failed", status: r.status, details: txt });
    }

    let data: any;
    try {
      data = JSON.parse(txt);
    } catch {
      return json200({ ok: false, error: "Drive returned non-JSON", details: txt });
    }

    return json200({ ok: true, files: data.files || [] });
  } catch (e: any) {
    return json200({ ok: false, error: e?.message || "Unknown error" });
  }
});

function json200(obj: any) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
