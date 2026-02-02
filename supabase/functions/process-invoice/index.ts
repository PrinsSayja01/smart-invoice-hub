import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};


function classifyDoc(text: string): { doc_class: string; confidence: number; signals: string[] } {
  const t = (text || "").toLowerCase();
  const signals: string[] = [];

  const has = (re: RegExp, label: string) => {
    if (re.test(t)) signals.push(label);
    return re.test(t);
  };

  const invoiceSig = [
    has(/\binvoice\b/, "invoice_keyword"),
    has(/\bvat\b|\btax\b/, "tax_terms"),
    has(/\bamount due\b|\bgrand total\b/, "total_terms"),
  ].filter(Boolean).length;

  const receiptSig = [
    has(/\breceipt\b/, "receipt_keyword"),
    has(/\bthank you\b/, "thanks"),
    has(/\bcashier\b|\bregister\b/, "pos_terms"),
  ].filter(Boolean).length;

  const offerSig = [
    has(/\boffer\b|\bquotation\b|\bquote\b/, "offer_terms"),
    has(/\bvalid until\b|\bquotation no\b/, "offer_validity"),
  ].filter(Boolean).length;

  const prescriptionSig = [
    has(/\bprescription\b/, "prescription_keyword"),
    has(/\bdoctor\b|\bclinic\b|\bpatient\b/, "medical_terms"),
  ].filter(Boolean).length;

  const sickSig = [
    has(/\bsick note\b|\bmedical certificate\b/, "sicknote_terms"),
    has(/\bfit for work\b|\bunfit\b/, "work_fitness"),
  ].filter(Boolean).length;

  const scores = [
    { k: "invoice", v: invoiceSig },
    { k: "receipt", v: receiptSig },
    { k: "offer", v: offerSig },
    { k: "prescription", v: prescriptionSig },
    { k: "sick_note", v: sickSig },
  ].sort((a, b) => b.v - a.v);

  const top = scores[0];
  if (!top || top.v === 0) return { doc_class: "other", confidence: 0.3, signals };

  // Simple confidence: 0.55 + 0.15 per signal, capped
  const confidence = Math.min(0.95, 0.55 + 0.15 * top.v);
  return { doc_class: top.k, confidence, signals };
}

function directionFromText(text: string): { direction: string; confidence: number; signals: string[] } {
  const t = (text || "").toLowerCase();
  const signals: string[] = [];
  const has = (re: RegExp, label: string) => {
    if (re.test(t)) signals.push(label);
    return re.test(t);
  };

  const incoming = [
    has(/\bbill to\b|\bbilled to\b/, "bill_to"),
    has(/\bship to\b/, "ship_to"),
    has(/\bamount due\b|\bpayable\b/, "payable_terms"),
  ].filter(Boolean).length;

  const outgoing = [
    has(/\bfrom:\b|\bseller\b|\bsupplier\b/, "supplier_terms"),
    has(/\byour invoice\b/, "your_invoice"),
    has(/\bwe have provided\b|\bservices rendered\b/, "rendered_terms"),
  ].filter(Boolean).length;

  if (incoming === 0 && outgoing === 0) return { direction: "unknown", confidence: 0.4, signals };

  if (incoming >= outgoing) return { direction: "incoming", confidence: Math.min(0.9, 0.6 + 0.1 * incoming), signals };
  return { direction: "outgoing", confidence: Math.min(0.9, 0.6 + 0.1 * outgoing), signals };
}

function fieldConfidence(extracted: any) {
  // Confidence heuristic: present => higher; looks structured => higher
  const conf: Record<string, number> = {};
  const present = (v: any) => (v !== null && v !== undefined && String(v).trim().length > 0);

  conf.vendor_name = present(extracted.vendor_name) ? 0.85 : 0.3;
  conf.invoice_number = present(extracted.invoice_number) ? (String(extracted.invoice_number).length >= 5 ? 0.8 : 0.6) : 0.25;
  conf.invoice_date = present(extracted.invoice_date) ? 0.8 : 0.25;
  conf.total_amount = present(extracted.total_amount) ? 0.85 : 0.2;
  conf.tax_amount = present(extracted.tax_amount) ? 0.7 : 0.35;
  conf.currency = present(extracted.currency) ? 0.7 : 0.4;

  return conf;
}

function taxCompliance(extracted: any, jurisdiction: string) {
  const issues: any[] = [];
  const j = (jurisdiction || "").toUpperCase();
  const total = Number(extracted.total_amount || 0);
  const tax = Number(extracted.tax_amount || 0);

  // Rough VAT expectations
  let expectedRange: [number, number] | null = null;
  if (j === "EU") expectedRange = [0.15, 0.27];
  if (j === "UAE") expectedRange = [0.05, 0.05];
  if (j === "KSA") expectedRange = [0.15, 0.15];

  let computedRate: number | null = null;
  if (total > 0 && tax >= 0) computedRate = tax / total;

  if (expectedRange && computedRate !== null) {
    const [lo, hi] = expectedRange;
    if (computedRate < lo - 0.02 || computedRate > hi + 0.02) {
      issues.push({
        code: "VAT_RATE_OUT_OF_RANGE",
        message: `VAT rate ${(computedRate * 100).toFixed(2)}% is outside expected range for ${j}`,
        severity: "warning",
      });
    }
  }

  if (j === "EU") {
    // Basic VAT ID check hint
    if (!/\bvat\s*(id|no)\b/i.test(String(extracted._raw_text || ""))) {
      issues.push({ code: "VAT_ID_MISSING", message: "VAT ID not detected (EU).", severity: "info" });
    }
  }

  const status =
    issues.some((x) => x.severity === "error") ? "fail" : issues.some((x) => x.severity === "warning") ? "needs_review" : "pass";

  return { issues, computedRate, status };
}

function approvalAgent(args: {
  doc_class: string;
  field_conf: Record<string, number>;
  risk_score: string;
  compliance_status: string;
}) {
  const reasons: string[] = [];
  const needs: string[] = [];

  const mustFields = ["vendor_name", "invoice_number", "invoice_date", "total_amount"];
  for (const k of mustFields) {
    if ((args.field_conf[k] ?? 0) < 0.5) needs.push(k);
  }

  if (args.risk_score === "high") reasons.push("High fraud/anomaly risk detected.");
  if (args.compliance_status === "fail") reasons.push("Tax/compliance checks failed.");
  if (args.doc_class !== "invoice" && args.doc_class !== "receipt") reasons.push(`Document classified as ${args.doc_class}.`);

  if (needs.length) {
    reasons.push("Missing or low-confidence required fields.");
    return { decision: "needs_info", confidence: 0.65, reasons, needs_info_fields: needs };
  }

  if (args.risk_score === "high" || args.compliance_status === "fail") {
    return { decision: "fail", confidence: 0.75, reasons, needs_info_fields: [] };
  }

  return { decision: "pass", confidence: 0.8, reasons: reasons.length ? reasons : ["All checks passed."], needs_info_fields: [] };
}

function esgMap(extracted: any) {
  const vendor = String(extracted.vendor_name || "").toLowerCase();
  const total = Number(extracted.total_amount || 0);

  let category = "general";
  let factor = 0.4; // kg CO2e per currency unit (placeholder)

  if (/air|flight|lufthansa|ryanair|wizz|emirates|qatar/.test(vendor)) {
    category = "travel";
    factor = 1.2;
  } else if (/uber|bolt|taxi/.test(vendor)) {
    category = "transport";
    factor = 0.8;
  } else if (/amazon|office|stationery|supplies/.test(vendor)) {
    category = "office_supplies";
    factor = 0.3;
  } else if (/electric|energy|utility/.test(vendor)) {
    category = "utilities";
    factor = 0.6;
  }

  const co2e = total > 0 ? total * factor : null;
  const confidence = total > 0 ? 0.6 : 0.4;

  return { esg_category: category, co2e_estimate: co2e, emissions_confidence: confidence };
}

function paymentQR(extracted: any) {
  // Placeholder QR payload for payment apps. Real EPC/EMV formats can be added later.
  const payload = {
    payee: extracted.vendor_name || null,
    reference: extracted.invoice_number || null,
    amount: extracted.total_amount ? Number(extracted.total_amount) : null,
    currency: extracted.currency || null,
  };
  const qrString = JSON.stringify(payload);
  return { payment_payload: payload, payment_qr_string: qrString };
}

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
    const body = await req.json();
    const { fileName, fileType, extractedText, jurisdiction, companyName } = body;

    if (!fileName || !fileType || !extractedText) {
      return new Response(JSON.stringify({ error: "Missing fileName, fileType, or extractedText" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const extracted = extractInvoice(String(extractedText));

    // Advanced classification & scoring
    const rawText = String(extractedText);
    (extracted as any)._raw_text = rawText;

    const doc = classifyDoc(rawText);
    const dir = directionFromText(rawText);
    const field_conf = fieldConfidence(extracted);

    const inferredJurisdiction =
      (jurisdiction && String(jurisdiction).trim()) ||
      (extracted.currency === "EUR" ? "EU" : extracted.currency === "AED" ? "UAE" : extracted.currency === "SAR" ? "KSA" : "EU");

    const compliance2 = taxCompliance({ ...extracted, _raw_text: rawText }, String(inferredJurisdiction));

    const esg = esgMap(extracted);
    const pay = paymentQR(extracted);

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


    const approval = approvalAgent({
      doc_class: doc.doc_class,
      field_conf,
      risk_score,
      compliance_status: compliance2.status === "pass" ? "compliant" : compliance2.status === "fail" ? "fail" : "needs_review",
    });

    const result = {
      ...extracted,
      doc_class: doc.doc_class,
      doc_class_confidence: doc.confidence,
      doc_class_signals: doc.signals,
      direction: dir.direction,
      direction_confidence: dir.confidence,
      direction_signals: dir.signals,
      field_confidence: field_conf,
      jurisdiction: inferredJurisdiction,
      compliance_issues: compliance2.issues,
      vat_rate: compliance2.computedRate,
      vat_amount_computed: extracted.total_amount && compliance2.computedRate ? Number(extracted.total_amount) * compliance2.computedRate : null,
      fraud_score: risk_score === "high" ? 0.9 : risk_score === "medium" ? 0.6 : 0.2,
      anomaly_flags: anomalies,
      approval: approval.decision,
      approval_confidence: approval.confidence,
      approval_reasons: approval.reasons,
      needs_info_fields: approval.needs_info_fields,
      category: esg.esg_category,
      esg_category: esg.esg_category,
      co2e_estimate: esg.co2e_estimate,
      emissions_confidence: esg.emissions_confidence,
      payment_payload: pay.payment_payload,
      payment_qr_string: pay.payment_qr_string,
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
