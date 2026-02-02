import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

type Body = { invoiceId?: string; method?: "sepa" | "zakat" | "custom" };

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
 * Minimal QR/payment payload generator:
 * - Creates/updates a payment record (public.payments)
 * - Saves invoices.payment_payload + invoices.payment_qr_string
 * Note: This returns a *string payload*; front-end can render a QR image.
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
    const method = body.method || "sepa";
    if (!invoiceId) return json(400, { error: "Missing invoiceId" });

    const { data: inv, error: invErr } = await supabase
      .from("invoices")
      .select("id,user_id,total_amount,currency,vendor_name,invoice_number,due_date")
      .eq("id", invoiceId)
      .single();

    if (invErr || !inv) return json(404, { error: "Invoice not found" });
    if (inv.user_id !== userId) return json(403, { error: "Forbidden" });

    const amount = Number(inv.total_amount ?? 0);
    const currency = inv.currency ?? "EUR";

    // Build a simple payload string (front-end renders QR)
    const payload = {
      method,
      invoiceId,
      invoiceNumber: inv.invoice_number,
      vendor: inv.vendor_name,
      amount,
      currency,
      dueDate: inv.due_date,
      createdAt: new Date().toISOString(),
    };

    const qrString = `PAYMENT|${method.toUpperCase()}|${invoiceId}|${amount.toFixed(2)}|${currency}`;

    // Create or update payment record
    const { data: existing } = await supabase
      .from("payments")
      .select("id")
      .eq("user_id", userId)
      .eq("invoice_id", invoiceId)
      .maybeSingle();

    if (existing?.id) {
      const { error: upPayErr } = await supabase
        .from("payments")
        .update({ amount, currency, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (upPayErr) return json(400, { error: upPayErr.message });
    } else {
      const { error: insPayErr } = await supabase.from("payments").insert({
        user_id: userId,
        invoice_id: invoiceId,
        amount,
        currency,
        status: "draft",
      });
      if (insPayErr) return json(400, { error: insPayErr.message });
    }

    const { error: updInvErr } = await supabase
      .from("invoices")
      .update({
        payment_payload: payload,
        payment_qr_string: qrString,
        updated_at: new Date().toISOString(),
      })
      .eq("id", invoiceId);
    if (updInvErr) return json(400, { error: updInvErr.message });

    return json(200, { ok: true, invoiceId, payload, qrString });
  } catch (e) {
    return json(500, { error: "generate-qr crashed", message: String(e) });
  }
});
