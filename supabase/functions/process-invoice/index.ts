// supabase/functions/process-invoice/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { corsHeaders } from "../_shared/cors.ts";

type Decision = "PASS" | "NEEDS_INFO" | "FAIL" | "HUMAN_APPROVAL";

type Citation = {
  field: string;
  line_index: number;
  text: string;
  match: string;
  score: number;
};

type AuditStep = {
  step: string;
  at: string;
  ok: boolean;
  detail?: unknown;
};

type InputBody = {
  fileName?: string;
  fileType?: string;
  extractedText?: string;

  vision?: {
    vendor_name?: string | null;
    invoice_number?: string | null;
    invoice_date?: string | null;
    tax_amount?: number | null;
    total_amount?: number | null;
    currency?: string | null;
    field_confidence?: Record<string, number>;
    raw_json?: unknown;
  };

  jurisdiction?: string;
  companyName?: string;
  invoiceId?: string;
};

const json = (status: number, data: unknown, extraHeaders: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });

const nowIso = () => new Date().toISOString();

// -----------------------------
// ✅ FX conversion helper (Frankfurter / ECB-based)
// Caches rates for 12 hours in Edge runtime memory
// -----------------------------
let _fxCache: { ts: number; base: string; rates: Record<string, number> } | null = null;

async function getFxRates(base = "EUR"): Promise<Record<string, number>> {
  const now = Date.now();
  if (_fxCache && _fxCache.base === base && now - _fxCache.ts < 12 * 60 * 60 * 1000) return _fxCache.rates;

  // Frankfurter API
  // If base=EUR => returns rates like { USD: 1.08, GBP: 0.85, ... }
  const url = `https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FX fetch failed: ${res.status}`);
  const data = await res.json();

  const rates = (data?.rates || {}) as Record<string, number>;
  if (!rates || typeof rates !== "object") throw new Error("FX rates missing");

  _fxCache = { ts: now, base, rates };
  return rates;
}

async function toEur(amount: number, currency: string): Promise<number | null> {
  if (!Number.isFinite(amount)) return null;
  const cur = (currency || "").toUpperCase().trim();
  if (!cur) return null;
  if (cur === "EUR") return amount;

  // Get rates from EUR -> CUR
  const rates = await getFxRates("EUR"); // 1 EUR = rates[CUR]
  const r = Number(rates[cur]);

  // If Frankfurter doesn't have currency
  if (!Number.isFinite(r) || r <= 0) return null;

  // amount CUR -> EUR
  // 1 EUR = r CUR  => 1 CUR = 1/r EUR  => amount CUR = amount/r EUR
  return amount / r;
}

// -------------------- helpers --------------------

const normKey = (k: string) =>
  k.toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

function normalizeIncomingKeys(body: Record<string, unknown>) {
  const map: Record<string, string> = {
    vendername: "vendor_name",
    vendorname: "vendor_name",
    vendor: "vendor_name",
    date: "invoice_date",
    inv_date: "invoice_date",
    currncy: "currency",
    curency: "currency",
    currencycode: "currency",
    total: "total_amount",
    grand_total: "total_amount",
    vat: "tax_amount",
    vat_amount: "tax_amount",
    tax: "tax_amount",
  };

  const out: Record<string, unknown> = { ...body };
  for (const [rawK, v] of Object.entries(body)) {
    const nk = normKey(rawK);
    if (map[nk]) out[map[nk]] = v;
  }
  return out;
}

function pickCurrency(text: string) {
  const t = text || "";
  if (t.includes("€") || /\bEUR\b/i.test(t)) return "EUR";
  if (t.includes("£") || /\bGBP\b/i.test(t)) return "GBP";
  if (t.includes("$") || /\bUSD\b/i.test(t)) return "USD";
  if (/\bAED\b/i.test(t)) return "AED";
  if (/\bSAR\b/i.test(t)) return "SAR";
  return "USD";
}

function toNumber(x: unknown): number | null {
  if (x === null || x === undefined) return null;
  const s = String(x).trim();
  if (!s) return null;
  const cleaned = s.replace(/[^\d,.\-]/g, "").replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeDate(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  const iso = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const ymd = s.match(/\b(20\d{2})[\/.](\d{1,2})[\/.](\d{1,2})\b/);
  if (ymd) return `${ymd[1]}-${String(ymd[2]).padStart(2, "0")}-${String(ymd[3]).padStart(2, "0")}`;

  const dmy = s.match(/\b(\d{1,2})[\/.](\d{1,2})[\/.](20\d{2})\b/);
  if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2, "0")}-${String(dmy[1]).padStart(2, "0")}`;

  return null;
}

function extractHeuristic(text: string, fileName: string) {
  const t = text || "";
  const currency = pickCurrency(t);

  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  let vendor = lines[0] || fileName.replace(/\.[^/.]+$/, "");
  if (/^invoice\b/i.test(vendor) && lines[1]) vendor = lines[1];

  const invoiceNumber =
    t.match(/invoice\s*(number|no\.?|#)\s*[:\-]?\s*([A-Z0-9\-\/]+)/i)?.[2] ||
    t.match(/\bINV[-\s]?\d{2,}[A-Z0-9\-\/]*\b/i)?.[0] ||
    null;

  const dateRaw =
    t.match(/invoice\s*date\s*[:\-]?\s*([0-9.\-\/]{8,10})/i)?.[1] ||
    t.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1] ||
    t.match(/\b(\d{1,2}[\/.]\d{1,2}[\/.](20\d{2}))\b/)?.[1] ||
    null;

  const invoiceDate = normalizeDate(dateRaw);

  const totalMatch =
    t.match(/(total|amount due|grand total)\s*[:\-]?\s*[$€£]?\s*([\d,]+(?:\.\d{1,2})?)/i) ||
    t.match(/[$€£]\s*([\d,]+(?:\.\d{1,2})?)/);

  const taxMatch = t.match(/(tax|vat)\s*[:\-]?\s*[$€£]?\s*([\d,]+(?:\.\d{1,2})?)/i) || null;

  const totalAmount = totalMatch ? toNumber(totalMatch[2] ?? totalMatch[1]) : null;
  const taxAmount = taxMatch ? toNumber(taxMatch[2]) : null;

  return {
    vendor_name: vendor || null,
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    total_amount: totalAmount,
    tax_amount: taxAmount,
    currency,
  };
}

function buildEvidence(text: string, fields: Record<string, unknown>): { citations: Citation[]; evidenceScore: number } {
  const lines = (text || "").split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const citations: Citation[] = [];

  const addBestLine = (field: string, matcher: RegExp, matchString?: string) => {
    let bestIdx = -1;
    let bestScore = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(matcher);
      if (m) {
        const score = Math.min(1, 0.4 + (m[0].length / 40));
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
    }

    if (bestIdx >= 0) {
      citations.push({
        field,
        line_index: bestIdx,
        text: lines[bestIdx],
        match: matchString || matcher.source,
        score: bestScore,
      });
    }
  };

  if (fields.vendor_name) {
    const needle = String(fields.vendor_name).slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    addBestLine("vendor_name", new RegExp(needle, "i"), String(fields.vendor_name));
  }
  addBestLine("invoice_number", /\b(invoice\s*(no|number|#)\b.*)|\bINV[-\s]?\d+[A-Z0-9\-\/]*\b/i, String(fields.invoice_number || ""));
  addBestLine("invoice_date", /\b(invoice\s*date\b.*)|\b(20\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2})\b|\b(\d{1,2}[-\/.]\d{1,2}[-\/.](20\d{2}))\b/i, String(fields.invoice_date || ""));
  addBestLine("total_amount", /\b(total|grand total|amount due)\b.*([$€£]?\s*[\d,]+(?:\.\d{1,2})?)/i, String(fields.total_amount || ""));
  addBestLine("tax_amount", /\b(vat|tax)\b.*([$€£]?\s*[\d,]+(?:\.\d{1,2})?)/i, String(fields.tax_amount || ""));
  addBestLine("currency", /\b(EUR|USD|GBP|AED|SAR)\b|[€$£]/i, String(fields.currency || ""));

  const required = ["vendor_name", "invoice_number", "invoice_date", "total_amount", "currency"];
  const foundRequired = required.filter((k) => citations.some((c) => c.field === k)).length;
  const evidenceScore = required.length ? foundRequired / required.length : 0;

  return { citations, evidenceScore };
}

function computeFieldConfidence(fields: Record<string, unknown>, citations: Citation[], visionFieldConf?: Record<string, number>) {
  const present = (v: unknown) => v !== null && v !== undefined && String(v).trim().length > 0;
  const hasCitation = (k: string) => citations.some((c) => c.field === k);

  const base = (k: string, fallback: number) => {
    const v = visionFieldConf?.[k];
    if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.min(1, v));
    return fallback;
  };

  const conf: Record<string, number> = {};
  conf.vendor_name = present(fields.vendor_name) ? (hasCitation("vendor_name") ? base("vendor_name", 0.82) : base("vendor_name", 0.55)) : 0.2;
  conf.invoice_number = present(fields.invoice_number) ? (hasCitation("invoice_number") ? base("invoice_number", 0.8) : base("invoice_number", 0.5)) : 0.2;
  conf.invoice_date = present(fields.invoice_date) ? (hasCitation("invoice_date") ? base("invoice_date", 0.78) : base("invoice_date", 0.5)) : 0.2;
  conf.total_amount = present(fields.total_amount) ? (hasCitation("total_amount") ? base("total_amount", 0.84) : base("total_amount", 0.55)) : 0.2;
  conf.currency = present(fields.currency) ? (hasCitation("currency") ? base("currency", 0.75) : base("currency", 0.55)) : 0.3;
  conf.tax_amount = present(fields.tax_amount) ? (hasCitation("tax_amount") ? base("tax_amount", 0.7) : base("tax_amount", 0.5)) : 0.25;

  const keys = Object.keys(conf);
  const avg = keys.reduce((s, k) => s + conf[k], 0) / Math.max(1, keys.length);
  return { field_confidence: conf, overall_confidence: avg };
}

function policyChecks(fields: Record<string, unknown>, jurisdiction: string, evidenceScore: number) {
  const issues: { code: string; message: string; severity: "info" | "warning" | "error" }[] = [];
  const total = toNumber(fields.total_amount);
  const tax = toNumber(fields.tax_amount);
  const currency = String(fields.currency || "").toUpperCase();
  const vendor = String(fields.vendor_name || "").toLowerCase();

  if (/(crypto|bitcoin|gift\s*card|western\s*union|moneygram)/i.test(vendor)) {
    issues.push({ code: "SUSPICIOUS_VENDOR", message: "Vendor name matches suspicious pattern.", severity: "error" });
  }
  if (total !== null && total <= 0) issues.push({ code: "TOTAL_INVALID", message: "Total amount is missing/zero/negative.", severity: "error" });
  if (total !== null && tax !== null && tax > total) issues.push({ code: "TAX_GT_TOTAL", message: "Tax amount is greater than total.", severity: "error" });

  if (evidenceScore < 1) issues.push({ code: "EVIDENCE_INSUFFICIENT", message: "Not enough evidence found for required fields.", severity: "warning" });

  const j = (jurisdiction || "").toUpperCase();
  const isEU = j === "EU" || currency === "EUR";
  if (isEU) {
    if (tax === null || tax <= 0) issues.push({ code: "VAT_MISSING", message: "VAT missing or invalid (EU).", severity: "warning" });
  }

  return {
    issues,
    hasError: issues.some((x) => x.severity === "error"),
    hasWarning: issues.some((x) => x.severity === "warning"),
  };
}

function decide(args: {
  fields: Record<string, unknown>;
  evidenceScore: number;
  overallConfidence: number;
  issues: { code: string; message: string; severity: "info" | "warning" | "error" }[];
  jurisdiction: string;
  total_eur: number | null;
}) {
  const required = ["vendor_name", "invoice_number", "invoice_date", "total_amount", "currency"];
  const missingRequired = required.filter((k) => !args.fields[k]);

  const currency = String(args.fields.currency || "").toUpperCase();
  const tax = toNumber(args.fields.tax_amount);
  const isEU = (args.jurisdiction || "").toUpperCase() === "EU" || currency === "EUR";

  if (args.issues.some((x) => x.severity === "error")) {
    return {
      decision: "FAIL" as Decision,
      confidence: Math.min(0.85, Math.max(0.6, args.overallConfidence)),
      reasons: args.issues.filter((x) => x.severity === "error").map((x) => x.message),
      needs_info_fields: [] as string[],
    };
  }

  if (missingRequired.length > 0) {
    return {
      decision: "NEEDS_INFO" as Decision,
      confidence: Math.min(0.75, Math.max(0.45, args.overallConfidence)),
      reasons: ["Missing required fields."],
      needs_info_fields: missingRequired,
    };
  }

  if (isEU && (tax === null || tax <= 0)) {
    return {
      decision: "NEEDS_INFO" as Decision,
      confidence: Math.min(0.75, Math.max(0.45, args.overallConfidence)),
      reasons: ["VAT is missing or invalid."],
      needs_info_fields: ["tax_amount"],
    };
  }

  // ✅ MAIN RULE: > 5000 EUR equivalent => HUMAN_APPROVAL
  if (args.total_eur !== null && args.total_eur > 5000) {
    return {
      decision: "HUMAN_APPROVAL" as Decision,
      confidence: Math.min(0.85, Math.max(0.55, args.overallConfidence)),
      reasons: [`Total exceeds €5000 equivalent (≈ €${args.total_eur.toFixed(2)}). Human approval required.`],
      needs_info_fields: [],
    };
  }

  const CONF_THRESHOLD = 0.65;
  if (args.overallConfidence < CONF_THRESHOLD) {
    return {
      decision: "NEEDS_INFO" as Decision,
      confidence: Math.max(0.45, args.overallConfidence),
      reasons: ["Low confidence — need clarification."],
      needs_info_fields: [],
    };
  }

  if (args.evidenceScore < 1) {
    return {
      decision: "NEEDS_INFO" as Decision,
      confidence: Math.min(0.75, Math.max(0.5, args.overallConfidence)),
      reasons: ["Evidence missing for one or more required fields."],
      needs_info_fields: [],
    };
  }

  const warningMsgs = args.issues.filter((x) => x.severity === "warning").map((x) => x.message);
  if (warningMsgs.length) {
    return {
      decision: "NEEDS_INFO" as Decision,
      confidence: Math.min(0.8, Math.max(0.55, args.overallConfidence)),
      reasons: warningMsgs,
      needs_info_fields: [],
    };
  }

  return {
    decision: "PASS" as Decision,
    confidence: Math.min(0.95, Math.max(0.7, args.overallConfidence)),
    reasons: ["All checks passed with evidence."],
    needs_info_fields: [],
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const audit: AuditStep[] = [];
  audit.push({ step: "request_received", at: nowIso(), ok: true, detail: { method: req.method, url: req.url } });

  try {
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
    if (!authHeader) {
      audit.push({ step: "auth_missing", at: nowIso(), ok: false });
      return json(401, { error: "Missing Authorization header", audit_steps: audit });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      audit.push({ step: "auth_invalid", at: nowIso(), ok: false });
      return json(401, { error: "Unauthorized", audit_steps: audit });
    }
    audit.push({ step: "auth_ok", at: nowIso(), ok: true, detail: { user_id: user.id } });

    const rawBody = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const body = normalizeIncomingKeys(rawBody) as InputBody;

    const fileName = String(body.fileName || "").trim();
    const fileType = String(body.fileType || "").trim();
    const extractedText = String(body.extractedText || "").trim();
    if (!fileName || !fileType || !extractedText) {
      audit.push({ step: "body_invalid", at: nowIso(), ok: false, detail: { fileName, fileType, text_len: extractedText.length } });
      return json(400, { error: "Missing fileName, fileType, or extractedText", audit_steps: audit });
    }

    const heuristic = extractHeuristic(extractedText, fileName);
    const vision = body.vision || {};

    const fields: Record<string, unknown> = {
      vendor_name: vision.vendor_name ?? heuristic.vendor_name,
      invoice_number: vision.invoice_number ?? heuristic.invoice_number,
      invoice_date: normalizeDate(vision.invoice_date ?? heuristic.invoice_date),
      total_amount: (vision.total_amount ?? heuristic.total_amount) as unknown,
      tax_amount: (vision.tax_amount ?? heuristic.tax_amount) as unknown,
      currency: String((vision.currency ?? heuristic.currency) || "USD").toUpperCase(),
      file_name: fileName,
      file_type: fileType,
    };

    const jurisdiction =
      String(body.jurisdiction || "").trim() ||
      (String(fields.currency) === "EUR" ? "EU" : String(fields.currency) === "AED" ? "UAE" : String(fields.currency) === "SAR" ? "KSA" : "EU");

    const { citations, evidenceScore } = buildEvidence(extractedText, fields);
    const { field_confidence, overall_confidence } = computeFieldConfidence(fields, citations, vision.field_confidence);
    const checks = policyChecks(fields, jurisdiction, evidenceScore);

    const totalNum = toNumber(fields.total_amount) ?? 0;
    let total_eur: number | null = null;
    try {
      total_eur = await toEur(totalNum, String(fields.currency || ""));
    } catch (e) {
      audit.push({ step: "fx_failed", at: nowIso(), ok: false, detail: { message: String((e as any)?.message || e) } });
      total_eur = null;
    }
    audit.push({ step: "fx_converted", at: nowIso(), ok: true, detail: { total_eur } });

    const decision = decide({
      fields,
      evidenceScore,
      overallConfidence: overall_confidence,
      issues: checks.issues,
      jurisdiction,
      total_eur,
    });

    const result = {
      vendor_name: fields.vendor_name,
      invoice_number: fields.invoice_number,
      invoice_date: fields.invoice_date,
      total_amount: toNumber(fields.total_amount),
      tax_amount: toNumber(fields.tax_amount),
      currency: fields.currency,
      jurisdiction,

      total_eur, // ✅ for UI + DB

      evidence: {
        required_evidence_score: evidenceScore,
        citations,
      },

      decision: decision.decision,
      decision_confidence: decision.confidence,
      reasons: decision.reasons,
      needs_info_fields: decision.needs_info_fields,

      approval:
        decision.decision === "PASS" ? "approved" :
        decision.decision === "FAIL" ? "rejected" :
        decision.decision === "HUMAN_APPROVAL" ? "human_approval" :
        "needs_info",

      approval_confidence: decision.confidence,
      approval_reasons: decision.reasons,
      is_flagged: decision.decision !== "PASS",
      flag_reason: decision.reasons?.join(" | ") ?? null,

      compliance_issues: checks.issues,
      field_confidence,
      overall_confidence,

      audit_steps: audit,
      ingestion: { valid: true, fileType, fileName, timestamp: nowIso() },
    };

    return json(200, result);
  } catch (e) {
    const message = String((e as any)?.message || e);
    audit.push({ step: "crash", at: nowIso(), ok: false, detail: { message } });
    return json(500, { error: "process-invoice crashed", message, audit_steps: audit });
  }
});
