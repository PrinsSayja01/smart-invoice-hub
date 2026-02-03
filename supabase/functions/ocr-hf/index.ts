import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const { imageBase64 } = await req.json();
    if (!imageBase64) {
      return new Response(JSON.stringify({ error: "Missing imageBase64" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pick an OCR model (example: TrOCR). You can change later.
    const model = "microsoft/trocr-base-printed";
    const hfToken = Deno.env.get("HF_API_TOKEN");
    if (!hfToken) throw new Error("HF_API_TOKEN not set in Supabase secrets");

    // Convert dataURL -> raw base64 if needed
    const b64 = String(imageBase64).includes(",") ? String(imageBase64).split(",")[1] : String(imageBase64);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

    const r = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hfToken}`,
        "Content-Type": "application/octet-stream",
      },
      body: bytes,
    });

    const json = await r.json();
    if (!r.ok) {
      return new Response(JSON.stringify({ error: "HF OCR failed", details: json }), {
        status: r.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // TrOCR often returns: [{ generated_text: "..." }]
    const text = Array.isArray(json) ? (json?.[0]?.generated_text ?? "") : (json?.generated_text ?? "");
    return new Response(JSON.stringify({ text }), {
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
