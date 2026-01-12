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

    // Get authorization header to identify user
    const authHeader = req.headers.get("authorization");
    let userId = null;
    let invoiceContext = "";

    if (authHeader && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      
      // Get user from token
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id;

      if (userId) {
        // Fetch user's invoice data for context
        const { data: invoices } = await supabase
          .from("invoices")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(100);

        if (invoices && invoices.length > 0) {
          const totalInvoices = invoices.length;
          const totalAmount = invoices.reduce((sum, inv) => sum + (Number(inv.total_amount) || 0), 0);
          const flaggedCount = invoices.filter(inv => inv.is_flagged).length;
          const compliantCount = invoices.filter(inv => inv.compliance_status === "compliant").length;
          
          // Get this month's invoices
          const now = new Date();
          const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
          const thisMonthInvoices = invoices.filter(inv => new Date(inv.created_at) >= startOfMonth);

          // Get vendor breakdown
          const vendorTotals: Record<string, number> = {};
          invoices.forEach(inv => {
            const vendor = inv.vendor_name || "Unknown";
            vendorTotals[vendor] = (vendorTotals[vendor] || 0) + (Number(inv.total_amount) || 0);
          });
          const topVendors = Object.entries(vendorTotals)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

          invoiceContext = `
USER'S INVOICE DATA CONTEXT:
- Total invoices: ${totalInvoices}
- Invoices this month: ${thisMonthInvoices.length}
- Total spend: $${totalAmount.toLocaleString()}
- Flagged/suspicious invoices: ${flaggedCount}
- Compliant invoices: ${compliantCount}
- Top vendors by spend:
${topVendors.map(([name, amount]) => `  - ${name}: $${amount.toLocaleString()}`).join("\n")}

Recent invoices (last 10):
${invoices.slice(0, 10).map(inv => 
  `- ${inv.vendor_name || "Unknown"}: $${Number(inv.total_amount || 0).toLocaleString()} (${inv.compliance_status}, ${inv.risk_score} risk)`
).join("\n")}
`;
        } else {
          invoiceContext = "USER HAS NO INVOICES YET. Encourage them to upload their first invoice.";
        }
      }
    }

    const systemPrompt = `You are Invoice AI Assistant, a helpful AI that helps users understand and analyze their invoices. You have access to the user's invoice data and can answer questions about their spending, vendors, compliance status, and more.

${invoiceContext}

Guidelines:
- Be concise and helpful
- When answering questions about data, use the context provided above
- If asked about specific invoices, refer to the data above
- For reports or summaries, calculate based on the data provided
- If asked to do something you can't do (like modify invoices), explain what the user should do instead
- Be friendly and professional

If the user has no invoice data, help them understand the upload process and what features are available.`;

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
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limits exceeded, please try again later." }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required, please add funds to continue." }),
          {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "AI gateway error" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("Chat error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
