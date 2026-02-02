import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

type Body = {
  invoiceId?: string;
  status?: "pass" | "fail" | "needs_info" | "pending";
  reasons?: string[];
};

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json(401, { error: "Missing Authorization header" });

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!supabaseUrl || !supabaseAnonKey) {
      return json(500, { error: "Missing SUPABASE_URL/SUPABASE_ANON_KEY env vars" });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes?.user) return json(401, { error: "Invalid token" });
    const userId = userRes.user.id;

    const body = (await req.json().catch(() => ({}))) as Body;
    const invoiceId = String(body.invoiceId || "").trim();
    const status = body.status || "pending";
    const reasons = Array.isArray(body.reasons) ? body.reasons : [];

    if (!invoiceId) return json(400, { error: "Missing invoiceId" });
    if (!["pass", "fail", "needs_info", "pending"].includes(status)) {
      return json(400, { error: "Invalid status" });
    }

    const { data: inv, error: invErr } = await supabase
      .from("invoices")
      .select("id,user_id")
      .eq("id", invoiceId)
      .single();
    if (invErr || !inv) return json(404, { error: "Invoice not found" });
    if (inv.user_id !== userId) return json(403, { error: "Forbidden" });

    const { error: histErr } = await supabase.from("approvals").insert({
      invoice_id: invoiceId,
      user_id: userId,
      status,
      reasons,
    });
    if (histErr) return json(400, { error: histErr.message });

    const { error: updErr } = await supabase
      .from("invoices")
      .update({ approval: status, approval_reasons: reasons, updated_at: new Date().toISOString() })
      .eq("id", invoiceId);
    if (updErr) return json(400, { error: updErr.message });

    return json(200, { ok: true, invoiceId, status, reasons });
  } catch (e) {
    return json(500, { error: "set-approval crashed", message: String(e) });
  }
});
