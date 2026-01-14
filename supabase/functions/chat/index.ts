import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Cache for invoice context to reduce DB queries
const contextCache = new Map<string, { data: string; timestamp: number }>();
const CACHE_TTL = 60000; // 1 minute cache

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
    let userId: string | null = null;
    let invoiceContext = "";

    if (authHeader && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      
      // Get user from token
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id || null;

      if (userId) {
        // Check cache first
        const cached = contextCache.get(userId);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
          invoiceContext = cached.data;
        } else {
          // Fetch user's invoice data for context - optimized query with only needed fields
          const { data: invoices } = await supabase
            .from("invoices")
            .select("vendor_name, total_amount, tax_amount, is_flagged, compliance_status, risk_score, created_at, invoice_date, currency")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(100);

          if (invoices && invoices.length > 0) {
            const totalInvoices = invoices.length;
            const totalAmount = invoices.reduce((sum, inv) => sum + (Number(inv.total_amount) || 0), 0);
            const totalTax = invoices.reduce((sum, inv) => sum + (Number(inv.tax_amount) || 0), 0);
            const flaggedCount = invoices.filter(inv => inv.is_flagged).length;
            const compliantCount = invoices.filter(inv => inv.compliance_status === "compliant").length;
            const needsReviewCount = invoices.filter(inv => inv.compliance_status === "needs_review").length;
            const nonCompliantCount = invoices.filter(inv => inv.compliance_status === "non_compliant").length;
            
            // Risk breakdown
            const lowRisk = invoices.filter(inv => inv.risk_score === "low").length;
            const mediumRisk = invoices.filter(inv => inv.risk_score === "medium").length;
            const highRisk = invoices.filter(inv => inv.risk_score === "high").length;
            
            // Get this month's invoices
            const now = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const thisMonthInvoices = invoices.filter(inv => new Date(inv.created_at) >= startOfMonth);
            const thisMonthTotal = thisMonthInvoices.reduce((sum, inv) => sum + (Number(inv.total_amount) || 0), 0);

            // Get vendor breakdown with counts
            const vendorData: Record<string, { total: number; count: number }> = {};
            invoices.forEach(inv => {
              const vendor = inv.vendor_name || "Unknown";
              if (!vendorData[vendor]) vendorData[vendor] = { total: 0, count: 0 };
              vendorData[vendor].total += Number(inv.total_amount) || 0;
              vendorData[vendor].count += 1;
            });
            const topVendors = Object.entries(vendorData)
              .sort((a, b) => b[1].total - a[1].total)
              .slice(0, 5);

            // Currency breakdown
            const currencies = [...new Set(invoices.map(inv => inv.currency || "USD"))];

            invoiceContext = `
USER'S INVOICE DATA (Real-time from database):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OVERVIEW:
• Total invoices: ${totalInvoices}
• Invoices this month: ${thisMonthInvoices.length}
• Total spend (all time): $${totalAmount.toLocaleString()}
• Spend this month: $${thisMonthTotal.toLocaleString()}
• Total tax collected: $${totalTax.toLocaleString()}
• Currencies used: ${currencies.join(", ")}

COMPLIANCE STATUS:
• Compliant: ${compliantCount} (${Math.round(compliantCount/totalInvoices*100)}%)
• Needs Review: ${needsReviewCount}
• Non-Compliant: ${nonCompliantCount}

RISK ANALYSIS:
• Flagged/Suspicious: ${flaggedCount}
• Low Risk: ${lowRisk}
• Medium Risk: ${mediumRisk}
• High Risk: ${highRisk}

TOP 5 VENDORS BY SPEND:
${topVendors.map(([name, data]) => `• ${name}: $${data.total.toLocaleString()} (${data.count} invoices)`).join("\n")}

RECENT INVOICES (last 10):
${invoices.slice(0, 10).map(inv => 
  `• ${inv.vendor_name || "Unknown"}: $${Number(inv.total_amount || 0).toLocaleString()} | ${inv.compliance_status || "pending"} | ${inv.risk_score || "unknown"} risk | ${inv.invoice_date || "no date"}`
).join("\n")}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

            // Cache the context
            contextCache.set(userId, { data: invoiceContext, timestamp: Date.now() });
          } else {
            invoiceContext = "USER HAS NO INVOICES YET. Encourage them to upload their first invoice using the Upload Invoice page.";
            contextCache.set(userId, { data: invoiceContext, timestamp: Date.now() });
          }
        }
      }
    }

    const systemPrompt = `You are Invoice AI Assistant, a smart and efficient AI that helps users analyze their invoices and financial data.

${invoiceContext}

CAPABILITIES:
• Answer questions about spending patterns, vendor analysis, and invoice details
• Generate reports and summaries based on the data
• Identify suspicious or flagged invoices
• Provide compliance status updates
• Calculate totals, averages, and trends

RESPONSE STYLE:
• Be concise and direct - no fluff
• Use numbers and data when available
• Format responses with bullet points for clarity
• If asked about data not available, clearly say so
• For reports, use structured formatting with headers

If asked to modify data (delete, edit invoices), explain that this must be done through the Invoices page.`;

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
          ...messages.slice(-10), // Only send last 10 messages for efficiency
        ],
        stream: true,
        max_tokens: 1000, // Limit response length for speed
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limits exceeded, please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required, please add funds to continue." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "AI gateway error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
