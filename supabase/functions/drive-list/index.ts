/// <reference lib="deno.ns" />

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const { user, error: authErr } = await requireUser(req);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid JWT" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const providerToken = body?.providerToken as string | undefined;

    if (!providerToken) {
      return new Response(JSON.stringify({ error: "Missing providerToken" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ✅ Drive query: PDFs + images
    const q =
      "mimeType='application/pdf' or mimeType contains 'image/'";

    const params = new URLSearchParams({
      q,
      pageSize: String(body?.pageSize ?? 50),
      fields: "files(id,name,mimeType,size,modifiedTime,driveId)",
      orderBy: "modifiedTime desc",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      corpora: "user,drive",
    });

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${providerToken}`,
        },
      }
    );

    const text = await res.text();

    if (!res.ok) {
      return new Response(
        JSON.stringify({
          error: "Google Drive API failed",
          status: res.status,
          details: text,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const json = JSON.parse(text);

    return new Response(JSON.stringify({ files: json.files ?? [] }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e?.message ?? "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
