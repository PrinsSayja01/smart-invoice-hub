import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ChatBody = {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
};

function buildInvoiceContext(invoices: any[]) {
  if (!invoices?.length) {
    return "No invoices uploaded yet. Ask the user to upload invoices first.";
  }

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const stats = invoices.reduce(
    (acc, inv) => {
      acc.total += Number(inv.total_amount) || 0;
      if (inv.is_flagged) acc.flagged++;
      if (inv.compliance_status === "compliant") acc.compliant++;
      if (inv.compliance_status === "needs_review") acc.needsReview++;
      if (new Date(inv.created_at) >= startOfMonth) acc.thisMonth++;

      const vendor = inv.vendor_name || "Unknown";
      acc.vendors[vendor] =
        (acc.vendors[vendor] || 0) + (Number(inv.total_amount) || 0);
      return acc;
    },
    {
      total: 0,
      flagged: 0,
      compliant: 0,
      needsReview: 0,
      thisMonth: 0,
      vendors: {} as Record<string, number>,
    }
  );

  const topVendors = Object.entries(stats.vendors)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, amt]) => `${name}: $${amt.toLocaleString()}`)
    .join(", ");

  const recentList = invoices
    .slice(0, 5)
    .map(
      (inv) =>
        `${inv.vendor_name || "Unknown"} - $${Number(inv.total_amount || 0).toLocaleString()} (${inv.compliance_status}, ${inv.risk_score} risk)`
    )
    .join("\n");

  return `
INVOICE DATA:
• Total: ${invoices.length} invoices, $${stats.total.toLocaleString()} total spend
• This month: ${stats.thisMonth} invoices
• Status: ${stats.compliant} compliant, ${stats.needsReview} need review, ${stats.flagged} flagged
• Top vendors: ${topVendors}

Recent:
${recentList}`.trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages } = (await req.json()) as ChatBody;

    const HF_API_KEY = Deno.env.get("HF_API_KEY");
    const HF_CHAT_MODEL = Deno.env.get("HF_CHAT_MODEL") || "google/gemma-2-2b-it";
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!HF_API_KEY) throw new Error("HF_API_KEY is not configured in Supabase secrets");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured");
    }

    // --- Build invoice context if user is authenticated ---
    let invoiceContext = "User not authenticated. Provide general help only.";
    const authHeader = req.headers.get("authorization");

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice("Bearer ".length);
      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);

      if (!userErr && userData?.user?.id) {
        const { data: invoices } = await supabaseAdmin
          .from("invoices")
          .select("vendor_name, total_amount, compliance_status, risk_score, is_flagged, created_at, invoice_number")
          .eq("user_id", userData.user.id)
          .order("created_at", { ascending: false })
          .limit(50);

        invoiceContext = buildInvoiceContext(invoices || []);
      }
    }

    const userQuestion = messages?.slice(-1)?.[0]?.content || "Help me analyze my invoices.";

    const systemPrompt = `You are Invoice AI, a concise assistant for invoice analysis.
Answer using the data below.

${invoiceContext}

Rules:
- Be brief and direct (2-6 sentences)
- If asked for totals, include $ and commas
- If data is missing, say so briefly
- No markdown, plain text.`;

    // --- Hugging Face Router (OpenAI compatible) ---
    const HF_URL = "https://router.huggingface.co/v1/chat/completions";

    const upstream = await fetch(HF_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: HF_CHAT_MODEL,
        stream: true,
        temperature: 0.2,
        max_tokens: 250,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userQuestion },
        ],
      }),
    });

    // If HF fails, return JSON (your frontend will show error)
    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => "");
      return new Response(
        JSON.stringify({
          error: "Hugging Face request failed",
          status: upstream.status,
          details: errText,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Pass-through SSE stream to client
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
