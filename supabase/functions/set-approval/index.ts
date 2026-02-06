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

    const body = (await req.json().catch(() => ({}))) as Body;
    const invoiceId = String(body.invoiceId || "").trim();
    const status = body.status;

    if (!invoiceId) return json(400, { error: "Missing invoiceId" });
    if (!status) return json(400, { error: "Missing status" });

    const allowed = new Set(["pass", "fail", "needs_info", "pending"]);
    if (!allowed.has(status)) return json(400, { error: "Invalid status" });

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // 1) Verify user (RLS-safe)
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u } = await supabaseUser.auth.getUser();
    if (!u?.user) return json(401, { error: "Unauthorized" });
    const userId = u.user.id;

    // 2) Use service role for DB writes (avoids RLS update errors)
    const db = createClient(supabaseUrl, serviceKey || anonKey);

    // Check invoice ownership
    const { data: inv, error: invErr } = await db
      .from("invoices")
      .select("id,user_id,approval,is_duplicate")
      .eq("id", invoiceId)
      .single();

    if (invErr || !inv) return json(404, { error: "Invoice not found" });
    if (inv.user_id !== userId) return json(403, { error: "Forbidden" });

    // ✅ Update correct column: approval
    const { error: updErr } = await db
      .from("invoices")
      .update({
        approval: status,
        updated_at: new Date().toISOString(),
        is_flagged: status === "fail" ? true : undefined,
      })
      .eq("id", invoiceId);

    if (updErr) return json(400, { error: updErr.message });

    // Optional: save action log if you have table (ignore if missing)
    try {
      await db.from("audit_logs").insert({
        user_id: userId,
        invoice_id: invoiceId,
        event_type: "approval_action",
        payload: { status, reasons: body.reasons ?? [] },
        created_at: new Date().toISOString(),
      });
    } catch (_e) {}

    return json(200, { ok: true, invoiceId, status, reasons: body.reasons ?? [] });
  } catch (e) {
    return json(500, { error: "set-approval crashed", message: String(e) });
  }
});
