import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    let invoiceContext = "";
    const authHeader = req.headers.get("authorization");

    if (authHeader && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);

      if (user?.id) {
        // Optimized query - only fetch needed columns
        const { data: invoices } = await supabase
          .from("invoices")
          .select("vendor_name, total_amount, compliance_status, risk_score, is_flagged, created_at, invoice_number")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(50);

        if (invoices?.length) {
          const now = new Date();
          const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
          
          const stats = invoices.reduce((acc, inv) => {
            acc.total += Number(inv.total_amount) || 0;
            if (inv.is_flagged) acc.flagged++;
            if (inv.compliance_status === "compliant") acc.compliant++;
            if (inv.compliance_status === "needs_review") acc.needsReview++;
            if (new Date(inv.created_at) >= startOfMonth) acc.thisMonth++;
            
            const vendor = inv.vendor_name || "Unknown";
            acc.vendors[vendor] = (acc.vendors[vendor] || 0) + (Number(inv.total_amount) || 0);
            return acc;
          }, { total: 0, flagged: 0, compliant: 0, needsReview: 0, thisMonth: 0, vendors: {} as Record<string, number> });

          const topVendors = Object.entries(stats.vendors)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, amt]) => `${name}: $${amt.toLocaleString()}`)
            .join(", ");

          const recentList = invoices.slice(0, 5)
            .map(inv => `${inv.vendor_name || "Unknown"} - $${Number(inv.total_amount || 0).toLocaleString()} (${inv.compliance_status}, ${inv.risk_score} risk)`)
            .join("\n");

          invoiceContext = `
INVOICE DATA:
• Total: ${invoices.length} invoices, $${stats.total.toLocaleString()} total spend
• This month: ${stats.thisMonth} invoices
• Status: ${stats.compliant} compliant, ${stats.needsReview} need review, ${stats.flagged} flagged
• Top vendors: ${topVendors}

Recent:
${recentList}`;
        } else {
          invoiceContext = "No invoices uploaded yet. Encourage uploading first invoice.";
        }
      }
    }

    const systemPrompt = `You are Invoice AI, a concise assistant for invoice analysis. Answer based on the data provided.
${invoiceContext}

Rules:
- Be brief and direct (2-3 sentences max for simple questions)
- Use the data above for all answers
- Format numbers with $ and commas
- If data is missing, say so briefly`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.slice(-10), // Limit context window
        ],
        stream: true,
        max_tokens: 500, // Keep responses concise
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Too many requests. Please wait a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "Usage limit reached. Please add credits." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("AI error:", status, await response.text());
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("Chat error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});