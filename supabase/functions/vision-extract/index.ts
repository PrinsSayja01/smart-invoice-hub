// supabase/functions/vision-extract/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getUserId(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  const sb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data } = await sb.auth.getUser();
  return data.user?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const userId = await getUserId(req);
    if (!userId) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const imageDataUrl: string = body?.imageDataUrl || "";
    const ocrText: string = body?.ocrText || "";
    const fileName: string = body?.fileName || "invoice";
    const mimeType: string = body?.mimeType || "application/octet-stream";

    if (!imageDataUrl || typeof imageDataUrl !== "string") {
      return json({ error: "imageDataUrl is required" }, 400);
    }

    const hfToken = Deno.env.get("HF_TOKEN");
    if (!hfToken) return json({ error: "Missing HF_TOKEN env" }, 500);

    const model = Deno.env.get("HF_VISION_MODEL") || "Qwen/Qwen2.5-VL-7B-Instruct";

    const instruction = `You are extracting invoice fields. Return ONLY valid JSON (no markdown).
Fields:
{
  "vendor_name": string|null,
  "invoice_number": string|null,
  "invoice_date": string|null,  // YYYY-MM-DD if possible
  "currency": string|null,       // ISO 4217 (EUR, USD...)
  "subtotal_amount": number|null,
  "tax_amount": number|null,
  "total_amount": number|null,
  "field_confidence": { "vendor_name": number, "invoice_number": number, "invoice_date": number, "currency": number, "subtotal_amount": number, "tax_amount": number, "total_amount": number },
  "evidence": [
    { "field": string, "page": number, "quote": string, "source": "image"|"ocr", "note": string|null }
  ]
}
Rules:
- Confidence must be 0..1
- Evidence: include at least one evidence item per extracted field when possible.
- If you cannot find evidence, set the field to null and confidence low.
OCR text (may contain errors) is below:\n\n${ocrText.slice(0, 12000)}`;

    const payload = {
      model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: instruction },
            { type: "input_image", image_url: imageDataUrl },
          ],
        },
      ],
      temperature: 0.0,
      max_output_tokens: 1200,
    };

    const resp = await fetch("https://router.huggingface.co/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hfToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return json({ error: "HF Router error", status: resp.status, details: errText }, 502);
    }

    const data = await resp.json();

    const outText =
      data?.output_text ||
      data?.output?.[0]?.content?.find?.((c: any) => c?.type === "output_text")?.text ||
      "";

    let parsed: any = null;
    try {
      parsed = JSON.parse(outText);
    } catch {
      if (typeof data === "object" && data !== null && data.vendor_name) parsed = data;
    }

    if (!parsed) {
      return json({
        error: "Model did not return valid JSON",
        raw: outText?.slice?.(0, 4000) || "",
        meta: { fileName, mimeType },
      });
    }

    return json(parsed);
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
