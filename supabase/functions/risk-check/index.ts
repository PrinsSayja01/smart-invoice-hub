import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

type Body = { invoiceId?: string };

function json(status: number, data: unknown, allowMethods = "POST, OPTIONS") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Access-Control-Allow-Methods": allowMethods,
      "Content-Type": "application/json",
    },
  });
}

/**
 * Minimal risk-check:
 * - Duplicate detection via document_hash
 * - Heuristic fraud score (0-1)
 * - anomaly_flags array
 * Updates invoices.fraud_score + invoices.anomaly_flags
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
      .select("id,user_id,document_hash,total_amount,vendor_name,currency,invoice_date")
      .eq("id", invoiceId)
      .single();
    if (invErr || !invoice) return json(404, { error: "Invoice not found" });
    if (invoice.user_id !== userId) return json(403, { error: "Forbidden" });

    const anomalyFlags: string[] = [];
    let fraudScore = 0.05;

    // Duplicate detection
    if (invoice.document_hash) {
      const { data: dups } = await supabase
        .from("invoices")
        .select("id")
        .eq("user_id", userId)
        .eq("document_hash", invoice.document_hash)
        .neq("id", invoiceId)
        .limit(1);
      if ((dups?.length ?? 0) > 0) {
        anomalyFlags.push("duplicate_document_hash");
        fraudScore += 0.7;
      }
    }

    // Heuristics
    const amt = Number(invoice.total_amount ?? 0);
    if (amt <= 0) {
      anomalyFlags.push("non_positive_amount");
      fraudScore += 0.2;
    }
    if (amt >= 10000) {
      anomalyFlags.push("high_amount");
      fraudScore += 0.2;
    }
    const vendor = String(invoice.vendor_name ?? "").toLowerCase();
    if (!vendor || vendor === "unknown" || vendor.includes("test")) {
      anomalyFlags.push("suspicious_vendor");
      fraudScore += 0.15;
    }

    fraudScore = Math.min(1, Math.max(0, fraudScore));

    const { error: updErr } = await supabase
      .from("invoices")
      .update({
        fraud_score: fraudScore,
        anomaly_flags: anomalyFlags,
        is_flagged: fraudScore >= 0.5 || anomalyFlags.includes("duplicate_document_hash"),
        flag_reason: anomalyFlags.length ? anomalyFlags.join(", ") : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", invoiceId);

    if (updErr) return json(400, { error: updErr.message });

    return json(200, { ok: true, invoiceId, fraudScore, anomalyFlags });
  } catch (e) {
    return json(500, { error: "risk-check crashed", message: String(e) });
  }
});
