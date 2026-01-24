import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function pickCurrency(text: string) {
  if (text.includes("€")) return "EUR";
  if (text.includes("£")) return "GBP";
  if (text.includes("$")) return "USD";
  return "USD";
}

function toNumber(s: string) {
  return Number(String(s).replace(/,/g, "").trim());
}

function extractInvoice(text: string) {
  const currency = pickCurrency(text);

  const invoiceNumber =
    text.match(/(invoice\s*(number|no\.|#)\s*[:\-]?\s*([A-Z0-9\-\/]+))/i)?.[3] ||
    text.match(/\bINV[-\s]?\d{2,}\b/i)?.[0] ||
    null;

  // date patterns
  let invoiceDate: string | null = null;
  const ymd = text.match(/\b(20\d{2})[-\/\.](\d{1,2})[-\/\.](\d{1,2})\b/);
  if (ymd) {
    const yyyy = ymd[1];
    const mm = String(ymd[2]).padStart(2, "0");
    const dd = String(ymd[3]).padStart(2, "0");
    invoiceDate = `${yyyy}-${mm}-${dd}`;
  } else {
    const dmy = text.match(/\b(\d{1,2})[-\/\.](\d{1,2})[-\/\.](20\d{2})\b/);
    if (dmy) {
      const dd = String(dmy[1]).padStart(2, "0");
      const mm = String(dmy[2]).padStart(2, "0");
      const yyyy = dmy[3];
      invoiceDate = `${yyyy}-${mm}-${dd}`;
    }
  }

  const totalMatch =
    text.match(/(total|amount due|grand total)\s*[:\-]?\s*[$€£]?\s*([\d,]+(?:\.\d{1,2})?)/i) ||
    text.match(/[$€£]\s*([\d,]+(?:\.\d{1,2})?)/);

  const taxMatch =
    text.match(/(tax|vat)\s*[:\-]?\s*[$€£]?\s*([\d,]+(?:\.\d{1,2})?)/i) || null;

  const totalAmount = totalMatch ? toNumber(totalMatch[2] ?? totalMatch[1]) : null;
  const taxAmount = taxMatch ? toNumber(taxMatch[2]) : null;

  // vendor guess: first non-empty line
  const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l.length > 3) ?? "";
  const vendorName =
    text.match(/vendor\s*[:\-]\s*(.+)/i)?.[1]?.trim() ||
    text.match(/from\s*[:\-]\s*(.+)/i)?.[1]?.trim() ||
    (firstLine.length < 60 ? firstLine : null);

  let invoiceType: string = "other";
  const lower = text.toLowerCase();
  if (lower.includes("service") || lower.includes("consulting")) invoiceType = "services";
  else if (lower.includes("product") || lower.includes("item") || lower.includes("qty")) invoiceType = "goods";

  return {
    vendor_name: vendorName || null,
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    total_amount: totalAmount,
    tax_amount: taxAmount,
    currency,
    invoice_type: invoiceType,
    language: "en",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { fileName, fileType, extractedText } = await req.json();

    if (!fileName || !fileType || !extractedText) {
      return new Response(JSON.stringify({ error: "Missing fileName, fileType, or extractedText" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const extracted = extractInvoice(String(extractedText));

    // Fraud checks
    const anomalies: string[] = [];
    let risk_score: "low" | "medium" | "high" = "low";
    if ((extracted.total_amount ?? 0) > 25000) risk_score = "medium";
    if ((extracted.total_amount ?? 0) > 40000) {
      risk_score = "high";
      anomalies.push("Unusually high amount");
    }

    // Compliance
    let compliance_status: "compliant" | "needs_review" = "compliant";
    if (!extracted.tax_amount || extracted.tax_amount <= 0) compliance_status = "needs_review";

    const result = {
      ...extracted,
      ingestion: { valid: true, fileType, fileName, timestamp: new Date().toISOString() },
      fraud_detection: { risk_score, is_duplicate: false, anomalies, checked_at: new Date().toISOString() },
      compliance: {
        compliance_status,
        vat_valid: compliance_status === "compliant",
        tax_classification: extracted.invoice_type === "services" ? "Service Tax" : "Goods Tax",
        checked_at: new Date().toISOString(),
      },
      risk_score,
      compliance_status,
      is_flagged: risk_score === "high",
      flag_reason: anomalies.length ? anomalies.join(", ") : null,
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
