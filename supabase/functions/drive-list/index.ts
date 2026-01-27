import { corsHeaders } from "../_shared/cors.ts";

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // verify_jwt=true will reject if Authorization header missing/invalid
    const auth = req.headers.get("authorization");
    if (!auth) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { providerToken } = await req.json();
    if (!providerToken) {
      return new Response(JSON.stringify({ error: "Missing providerToken" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ✅ PDF + JPG/PNG, not trashed
    const q =
      "(mimeType='application/pdf' or mimeType='image/jpeg' or mimeType='image/png') and trashed=false";

    // ✅ Support shared drives too (important)
    const params = new URLSearchParams({
      q,
      fields: "files(id,name,mimeType,size,modifiedTime)",
      pageSize: "50",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      corpora: "allDrives",
    });

    const url = `https://www.googleapis.com/drive/v3/files?${params.toString()}`;

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const txt = await r.text();
    if (!r.ok) {
      return new Response(
        JSON.stringify({ error: "Google Drive API failed", status: r.status, details: txt }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const json = JSON.parse(txt);
    const files: DriveFile[] = (json.files || []).map((f: any) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size,
      modifiedTime: f.modifiedTime,
    }));

    return new Response(JSON.stringify({ files }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
