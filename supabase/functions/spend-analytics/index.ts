import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", {
      headers: { ...corsHeaders, "Access-Control-Allow-Methods": "GET, OPTIONS" },
    });
  if (req.method !== "GET") return json(405, { error: "Method not allowed" });

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

    const { data: rows, error } = await supabase
      .from("invoices")
      .select("vendor_name,total_amount,invoice_date,currency,category,cost_center")
      .eq("user_id", userId);

    if (error) return json(400, { error: error.message });

    const byVendor: Record<string, number> = {};
    const byMonth: Record<string, number> = {};
    const byCategory: Record<string, number> = {};

    for (const r of rows ?? []) {
      const vendor = r.vendor_name || "Unknown";
      const amt = Number(r.total_amount ?? 0);
      const month = r.invoice_date ? String(r.invoice_date).slice(0, 7) : "unknown";
      const cat = (r as any).category || "uncategorized";

      byVendor[vendor] = (byVendor[vendor] || 0) + amt;
      byMonth[month] = (byMonth[month] || 0) + amt;
      byCategory[cat] = (byCategory[cat] || 0) + amt;
    }

    const months = Object.keys(byMonth).sort();
    const monthValues = months.map((m) => byMonth[m]);

    // Simple forecast: next month = moving average of last 3 months
    const last3 = monthValues.slice(-3);
    const forecastNextMonth =
      last3.reduce((s, x) => s + x, 0) / Math.max(1, last3.length);

    return json(200, {
      ok: true,
      byVendor,
      byMonth,
      byCategory,
      forecastNextMonth,
    });
  } catch (e) {
    return json(500, { error: "spend-analytics crashed", message: String(e) });
  }
});
