import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ChatBody = {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  invoiceContext?: string; // ✅ sent from frontend now
};

function buildInvoiceContextFromDb(invoices: any[]) {
  if (!invoices?.length) {
    return "No invoices uploaded yet. Encourage uploading first invoice.";
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
      acc.vendors[vendor] = (acc.vendors[vendor] || 0) + (Number(inv.total_amount) || 0);
      return acc;
    },
    {
      total: 0,
      flagged: 0,
      compliant: 0,
      needsReview: 0,
      thisMonth: 0,
      vendors: {} as Record<string, number>,
    },
  );

  const topVendors = Object.entries(stats.vendors)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, amt]) => `${name}: $${amt.toLocaleString()}`)
    .join(", ");

  const recentList = invoices
    .slice(0, 5)
    .map((inv) => {
      const v = inv.vendor_name || "Unknown";
      const amt = Number(inv.total_amount || 0).toLocaleString();
      const cs = inv.compliance_status || "unknown";
      const rs = inv.risk_score ?? "n/a";
      return `${v} - $${amt} (${cs}, ${rs} risk)`;
    })
    .join("\n");

  return `
INVOICE DATA:
• Total: ${invoices.length} invoices, $${stats.total.toLocaleString()} total spend
• This month: ${stats.thisMonth} invoices
• Status: ${stats.compliant} compliant, ${stats.needsReview} need review, ${stats.flagged} flagged
• Top vendors: ${topVendors || "N/A"}

Recent:
${recentList}`.trim();
}

// --- small helper to safely parse JSON ---
async function safeJson(req: Request) {
  const txt = await req.text();
  if (!txt) return {};
  try {
    return JSON.parse(txt);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

// --- SSE helpers (matches your frontend parser) ---
function sseHeaders() {
  return {
    ...corsHeaders,
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  };
}

function makeDeltaChunk(text: string) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}

function makeDoneChunk() {
  return `data: [DONE]\n\n`;
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await safeJson(req)) as ChatBody;
    const messages = body?.messages || [];
    const providedInvoiceContext = body?.invoiceContext;

    const HF_API_KEY = Deno.env.get("HF_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!HF_API_KEY) throw new Error("HF_API_KEY is not configured");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured");
    }

    // ---------- Build invoice context ----------
    let invoiceContext = "";

    // ✅ Prefer context from frontend (best, fastest)
    if (providedInvoiceContext && providedInvoiceContext.trim().length > 0) {
      invoiceContext = providedInvoiceContext.trim();
    } else {
      // fallback: try DB context using auth user
      invoiceContext = "User not authenticated or no invoice context. Provide general help only.";
      const authHeader = req.headers.get("authorization") || "";

      // Authorization: Bearer <supabase_jwt>
      if (authHeader.toLowerCase().startsWith("bearer ")) {
        const token = authHeader.slice("bearer ".length).trim();
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        const { data: userData, error: userErr } = await supabase.auth.getUser(token);

        if (!userErr && userData?.user?.id) {
          const { data: invoices, error: invErr } = await supabase
            .from("invoices")
            .select("vendor_name, total_amount, compliance_status, risk_score, is_flagged, created_at, invoice_number")
            .eq("user_id", userData.user.id)
            .order("created_at", { ascending: false })
            .limit(50);

          if (!invErr) {
            invoiceContext = buildInvoiceContextFromDb(invoices || []);
          }
        }
      }
    }

    // ---------- Get last user question ----------
    const last = messages[messages.length - 1];
    const userQuestion = last?.content || "Help me analyze my invoices.";

    // ---------- Prompt ----------
    const systemPrompt = `You are Invoice AI, a concise assistant for invoice analysis.
Answer using the data below.

${invoiceContext}

Rules:
- Be brief and direct (2-4 sentences)
- If asked for totals, include $ and commas
- If data is missing, say so briefly
- No markdown, just plain text.`;

    // ✅ HF router URL (correct)
    const HF_MODEL = "google/flan-t5-base";
    const HF_URL = `https://router.huggingface.co/hf-inference/models/${HF_MODEL}`;

    // T5 prompt format
    const prompt = `${systemPrompt}

User question: ${userQuestion}

Answer:`;

    const hfRes = await fetch(HF_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          max_new_tokens: 220,
          temperature: 0.2,
          return_full_text: false,
        },
      }),
    });

    if (!hfRes.ok) {
      const errText = await hfRes.text().catch(() => "");
      // Return SSE error in a way frontend shows it nicely
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              makeDeltaChunk(`Error: Hugging Face request failed (${hfRes.status}). ${errText.slice(0, 200)}`) +
                makeDoneChunk(),
            ),
          );
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: sseHeaders() });
    }

    const hfJson = await hfRes.json();
    const answer =
      Array.isArray(hfJson) ? String(hfJson[0]?.generated_text ?? "").trim() : "";

    const finalAnswer = answer || "I couldn't generate an answer. Please try again.";

    // ---------- STREAM response (SSE) ----------
    // Your frontend expects: "data: { choices:[{delta:{content:"..."}}] }\n\n" and "[DONE]"
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        // send in small chunks to simulate streaming (works with your UI)
        const chunkSize = 30;
        for (let i = 0; i < finalAnswer.length; i += chunkSize) {
          const part = finalAnswer.slice(i, i + chunkSize);
          controller.enqueue(encoder.encode(makeDeltaChunk(part)));
        }
        controller.enqueue(encoder.encode(makeDoneChunk()));
        controller.close();
      },
    });

    return new Response(stream, { status: 200, headers: sseHeaders() });
  } catch (error: any) {
    // Send error as SSE too (so UI doesn't break expecting stream)
    const msg = error?.message || "Unknown error";
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(makeDeltaChunk(`Error: ${msg}`)));
        controller.enqueue(encoder.encode(makeDoneChunk()));
        controller.close();
      },
    });

    return new Response(stream, { status: 200, headers: sseHeaders() });
  }
});
