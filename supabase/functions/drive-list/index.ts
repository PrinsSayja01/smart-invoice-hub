import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ReqBody = {
  providerToken?: string;
  folderId?: string;      // optional
  showAll?: boolean;      // debug: list anything, not just pdf/images
  pageSize?: number;      // optional
  queryText?: string;     // optional search in name
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as ReqBody;
    const providerToken = body.providerToken;
    const folderId = body.folderId;
    const showAll = !!body.showAll;
    const pageSize = Math.min(Math.max(body.pageSize ?? 50, 1), 200);
    const queryText = (body.queryText ?? "").trim();

    if (!providerToken) {
      return new Response(JSON.stringify({ ok: false, error: "Missing providerToken" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Base query
    const parts: string[] = [`trashed=false`];

    // Optional folder filter
    if (folderId) parts.push(`'${folderId}' in parents`);

    // Optional filename search
    if (queryText) parts.push(`name contains '${queryText.replaceAll("'", "\\'")}'`);

    // Default filter = pdf + images
    if (!showAll) {
      parts.push(`(mimeType='application/pdf' or mimeType contains 'image/')`);
    }

    const q = encodeURIComponent(parts.join(" and "));
    const fields = encodeURIComponent("files(id,name,mimeType,size,modifiedTime,parents),nextPageToken");

    // ✅ IMPORTANT: include shared drives
    const url =
      `https://www.googleapis.com/drive/v3/files` +
      `?q=${q}` +
      `&fields=${fields}` +
      `&pageSize=${pageSize}` +
      `&includeItemsFromAllDrives=true` +
      `&supportsAllDrives=true`;

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const txt = await r.text();

    if (!r.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Google Drive API failed",
          google_status: r.status,
          google_body: txt,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const json = JSON.parse(txt);
    const files = json.files ?? [];

    return new Response(
      JSON.stringify({
        ok: true,
        files,
        count: files.length,
        used_query: decodeURIComponent(q),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
