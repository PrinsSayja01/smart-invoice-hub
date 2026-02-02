import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

type Body = { invoiceId?: string };

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json",
    },
  });
}

/**
 * Minimal ESG mapping:
 * - Uses invoice.category to select a simple emission factor
 * - Writes invoices.co2e_estimate + invoices.esg_category + invoices.emissions_confidence
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", {
      headers: { ...corsHeaders, "Access-Control-Allow-Methods": "POST, OPTIONS" },
    });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json(401, { error: "Missing Authorization header" });

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes?.user) return json(401, { error: "Unauthorized" });
    const userId = userRes.user.id;

    const body = (await req.json().catch(() => ({}))) as Body;
    const invoiceId = String(body.invoiceId || "").trim();
    if (!invoiceId) return json(400, { error: "Missing invoiceId" });

    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .select("id,user_id,total_amount,currency,category")
      .eq("id", invoiceId)
      .single();
    if (invErr || !invoice) return json(404, { error: "Invoice not found" });
    if (invoice.user_id !== userId) return json(403, { error: "Forbidden" });

    const amount = Number(invoice.total_amount ?? 0);

    // Very simple factors (kgCO2e per currency unit)
    const category = String((invoice as any).category || "general").toLowerCase();
    const factor =
      category.includes("travel") ? 0.45 :
      category.includes("energy") ? 0.60 :
      category.includes("it") ? 0.20 :
      0.25;

    const co2e = amount * factor;
    const emissionsConfidence = 0.65;

    const { error: updErr } = await supabase
      .from("invoices")
      .update({
        esg_category: category,
        co2e_estimate: co2e,
        emissions_confidence: emissionsConfidence,
        updated_at: new Date().toISOString(),
      })
      .eq("id", invoiceId);

    if (updErr) return json(400, { error: updErr.message });

    return json(200, { ok: true, invoiceId, category, factor, co2e, emissionsConfidence });
  } catch (e) {
    return json(500, { error: "esg-map crashed", message: String(e) });
  }
});
