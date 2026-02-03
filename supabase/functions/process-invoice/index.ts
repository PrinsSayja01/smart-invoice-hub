import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Citation = { chunk_id: string; quote: string; start?: number; end?: number };
type Decision = {
  status: "PASS" | "FAIL" | "NEEDS_INFO" | "HUMAN_REVIEW";
  confidence: number;
  reasons: string[];
  needs_info_fields: string[];
  citations: Record<string, Citation[]>;
};

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeInput(body: any) {
  const b = body || {};
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = b?.[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
    return undefined;
  };

  return {
    fileName: String(pick("fileName", "filename", "file_name") || ""),
    fileType: String(pick("fileType", "mimeType", "file_type") || ""),
    extractedText: String(pick("extractedText", "text", "ocr_text") || ""),
    vendor_name: pick("vendor_name", "vendorName", "vrndername", "vendername"),
    invoice_number: pick("invoice_number", "invoiceNo", "invoiceNumber"),
    invoice_date: pick("invoice_date", "date", "datte", "invoiceDate"),
    total_amount: pick("total_amount", "total", "amount", "grand_total"),
    tax_amount: pick("tax_amount", "vat", "vat_amount", "tax", "taxAmount"),
    currency: pick("currency", "currncy", "curenvt", "curr", "ccy"),
    file_id: pick("file_id", "document_id"),
  };
}

function chunkText(text: string, chunkSize = 800, overlap = 120) {
  const t = text || "";
  const chunks: { idx: number; text: string; start: number; end: number }[] = [];
  let start = 0;
  let idx = 0;
  while (start < t.length) {
    const end = Math.min(t.length, start + chunkSize);
    chunks.push({ idx, text: t.slice(start, end), start, end });
    idx += 1;
    start = Math.max(0, end - overlap);
    if (start >= t.length) break;
  }
  return chunks;
}

function toNumberLoose(v: any): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[^\d.,-]/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function detectCurrency(text: string) {
  const t = (text || "").toLowerCase();
  if (t.includes("€") || t.includes(" eur")) return "EUR";
  if (t.includes("$") || t.includes(" usd")) return "USD";
  if (t.includes("£") || t.includes(" gbp")) return "GBP";
  return "USD";
}

function heuristicExtract(text: string) {
  const t = text || "";
  const vendor = (t.split("\n").map((l) => l.trim()).find((l) => l.length > 3) || "").slice(0, 80) || null;

  const invoice_number =
    t.match(/invoice\s*(number|no\.?|#)\s*[:\-]?\s*([A-Z0-9\-\/]+)/i)?.[2] ||
    t.match(/\bINV[-\s]?\d+[A-Z0-9\-]*\b/i)?.[0] ||
    null;

  const dateRaw =
    t.match(/invoice\s*date\s*[:\-]?\s*([0-9.\-\/]{8,10})/i)?.[1] ||
    t.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1] ||
    t.match(/\b(\d{1,2}[\/.]\d{1,2}[\/.](20\d{2}))\b/)?.[1] ||
    null;

  let invoice_date: string | null = null;
  if (dateRaw) {
    const s = String(dateRaw).trim();
    const iso = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (iso) invoice_date = `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dot = s.match(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/);
    if (!invoice_date && dot) {
      const dd = String(dot[1]).padStart(2, "0");
      const mm = String(dot[2]).padStart(2, "0");
      invoice_date = `${dot[3]}-${mm}-${dd}`;
    }
  }

  const totalMatch =
    t.match(/\b(total\s*(amount)?|grand\s*total|amount\s*due)\s*[:\-]?\s*([$€£]?\s*[0-9][0-9.,]+)/i)?.[3] || null;
  const taxMatch = t.match(/\b(vat|tax)\s*(amount)?\s*[:\-]?\s*([$€£]?\s*[0-9][0-9.,]+)/i)?.[3] || null;

  return {
    vendor_name: vendor,
    invoice_number,
    invoice_date,
    total_amount: totalMatch ? toNumberLoose(totalMatch) : null,
    tax_amount: taxMatch ? toNumberLoose(taxMatch) : null,
    currency: detectCurrency(t),
  };
}

async function hfEmbed(texts: string[]) {
  const token = Deno.env.get("HF_API_TOKEN") || "";
  const model = Deno.env.get("HF_EMBEDDING_MODEL") || "sentence-transformers/all-MiniLM-L6-v2";
  if (!token) throw new Error("HF_API_TOKEN missing");

  const url = `https://api-inference.huggingface.co/pipeline/feature-extraction/${model}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ inputs: texts, options: { wait_for_model: true } }),
  });

  if (!res.ok) throw new Error(`HF embeddings failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const out: number[][] = Array.isArray(data) ? data : [];
  return out.map((v) => (Array.isArray(v) ? v.map((x) => Number(x)) : []));
}

async function logAudit(supabase: any, user_id: string, document_id: string, step: string, payload: any) {
  await supabase.from("audit_logs").insert({ user_id, document_id, step, payload, created_at: nowIso() });
}

async function debit(supabase: any, user_id: string, document_id: string, action: string, credits: number) {
  await supabase.from("ai_ledger").insert({ user_id, document_id, action, credits, created_at: nowIso() });
  await supabase.rpc("debit_ai_wallet", { p_user_id: user_id, p_credits: credits });
}

function requireEvidence(citations: Record<string, Citation[]>, field: string) {
  return Array.isArray(citations[field]) && citations[field].length > 0;
}

function confidenceFromEvidence(citations: Record<string, Citation[]>, requiredFields: string[]) {
  const have = requiredFields.filter((f) => requireEvidence(citations, f)).length;
  return requiredFields.length ? have / requiredFields.length : 0;
}

function policyChecks(extracted: any) {
  const reasons: string[] = [];
  const vendor = String(extracted.vendor_name || "").toLowerCase();
  const suspicious = ["scam", "fraud", "test vendor", "unknown vendor inc"];
  if (suspicious.some((x) => vendor.includes(x))) reasons.push("Suspicious vendor detected.");

  const total = Number(extracted.total_amount ?? 0);
  const tax = Number(extracted.tax_amount ?? 0);
  if (total > 0 && tax > total) reasons.push("VAT/Tax is greater than Total (invalid).");

  return reasons;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json(401, { error: "Missing Authorization header" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes?.user) return json(401, { error: "Unauthorized" });
    const user_id = userRes.user.id;

    const body = normalizeInput(await req.json().catch(() => ({})));
    if (!body.extractedText) return json(400, { error: "Missing extractedText" });

    // Create doc row
    let document_id = String(body.file_id || "").trim();
    if (!document_id) {
      const ins = await supabase
        .from("documents")
        .insert({
          user_id,
          file_name: body.fileName || "unknown",
          file_type: body.fileType || "text/plain",
          created_at: nowIso(),
        })
        .select("id")
        .single();

      if (ins.error || !ins.data?.id) return json(500, { error: ins.error?.message || "Failed to create document" });
      document_id = ins.data.id;
    }

    await logAudit(supabase, user_id, document_id, "ingest", { fileName: body.fileName, fileType: body.fileType });

    // Chunk + embed + store
    const chunks = chunkText(body.extractedText);
    await debit(supabase, user_id, document_id, "chunk", 1);

    const embeddings: number[][] = [];
    const batchSize = 10;

    for (let i = 0; i < chunks.length; i += batchSize) {
      await debit(supabase, user_id, document_id, "embed", 2);
      const batch = chunks.slice(i, i + batchSize);
      const embs = await hfEmbed(batch.map((c) => c.text));
      embeddings.push(...embs);
    }

    const rows = chunks.map((c, i) => ({
      document_id,
      chunk_index: c.idx,
      content: c.text,
      start_offset: c.start,
      end_offset: c.end,
      embedding: embeddings[i],
      created_at: nowIso(),
    }));

    const up = await supabase.from("document_chunks").upsert(rows, { onConflict: "document_id,chunk_index" });
    if (up.error) return json(500, { error: up.error.message });

    await logAudit(supabase, user_id, document_id, "chunk_store", { chunks: rows.length });

    // Retrieval + citations
    const queries = {
      vendor_name: "vendor name supplier seller from",
      invoice_number: "invoice number invoice no inv #",
      invoice_date: "invoice date date issued",
      total_amount: "total amount grand total amount due",
      tax_amount: "vat tax amount mwst",
      currency: "currency eur usd gbp € $ £",
    };

    const citations: Record<string, Citation[]> = {};
    const extracted = heuristicExtract(body.extractedText);

    // Override with provided values (but still require evidence!)
    if (body.vendor_name) extracted.vendor_name = String(body.vendor_name);
    if (body.invoice_number) extracted.invoice_number = String(body.invoice_number);
    if (body.invoice_date) extracted.invoice_date = String(body.invoice_date);
    if (body.total_amount !== undefined) extracted.total_amount = toNumberLoose(body.total_amount);
    if (body.tax_amount !== undefined) extracted.tax_amount = toNumberLoose(body.tax_amount);
    if (body.currency) extracted.currency = String(body.currency);

    for (const [field, q] of Object.entries(queries)) {
      await debit(supabase, user_id, document_id, "retrieve", 1);
      const qEmb = (await hfEmbed([q]))[0];

      const { data, error } = await supabase.rpc("match_document_chunks", {
        p_document_id: document_id,
        p_query_embedding: qEmb,
        p_match_count: 4,
      });

      if (error) return json(500, { error: error.message });

      const matches: any[] = Array.isArray(data) ? data : [];
      citations[field] = matches.map((m) => ({
        chunk_id: String(m.id),
        quote: String(m.content).slice(0, 240),
        start: m.start_offset,
        end: m.end_offset,
      }));
    }

    await logAudit(supabase, user_id, document_id, "retrieval", {
      citations_count: Object.fromEntries(Object.entries(citations).map(([k, v]) => [k, v.length])),
    });

    // Decision rules
    const requiredForPass = ["vendor_name", "invoice_number", "invoice_date", "total_amount"];
    const reasons: string[] = [];
    const needs_info_fields: string[] = [];

    // 1) No evidence -> cannot PASS
    for (const f of requiredForPass) {
      if (!requireEvidence(citations, f)) needs_info_fields.push(f);
    }

    // 10) Missing VAT -> NEEDS_INFO
    const vatVal = Number(extracted.tax_amount ?? 0);
    if (!requireEvidence(citations, "tax_amount") || !vatVal || vatVal <= 0) {
      if (!needs_info_fields.includes("tax_amount")) needs_info_fields.push("tax_amount");
      reasons.push("VAT information missing or invalid.");
    }

    // 8) > €5000 -> human approval required
    const total = Number(extracted.total_amount ?? 0);
    const currency = String(extracted.currency || "USD");
    if (currency === "EUR" && total > 5000) reasons.push("Invoice > €5000 requires mandatory human approval.");

    // 3) Policy violation -> FAIL
    const policyViolations = policyChecks(extracted);
    if (policyViolations.length) reasons.push(...policyViolations);

    // 2) Low confidence -> NEEDS_INFO
    const evidenceCoverage = confidenceFromEvidence(citations, requiredForPass);
    const confidence = Math.round((0.4 + 0.6 * evidenceCoverage) * 100) / 100;
    const LOW_CONF_THRESHOLD = Number(Deno.env.get("LOW_CONF_THRESHOLD") || "0.75");

    let status: Decision["status"] = "NEEDS_INFO";

    if (policyViolations.length) {
      status = "FAIL";
    } else if (currency === "EUR" && total > 5000) {
      status = "HUMAN_REVIEW";
    } else if (confidence < LOW_CONF_THRESHOLD) {
      status = "NEEDS_INFO";
      reasons.push("Low confidence: need more information.");
    } else if (needs_info_fields.length) {
      status = "NEEDS_INFO";
      reasons.push("Missing document evidence for required fields.");
    } else {
      status = "PASS";
      reasons.push("All required fields supported by document evidence.");
    }

    const decision: Decision = { status, confidence, reasons, needs_info_fields, citations };

    // 5) audit_logs + decisions table
    const decIns = await supabase.from("decisions").insert({
      user_id,
      document_id,
      status: decision.status,
      confidence: decision.confidence,
      reasons: decision.reasons,
      needs_info_fields: decision.needs_info_fields,
      citations: decision.citations,
      extracted,
      created_at: nowIso(),
    });
    if (decIns.error) return json(500, { error: decIns.error.message });

    await logAudit(supabase, user_id, document_id, "decision", decision);

    return json(200, { document_id, ...extracted, decision, citations });
  } catch (e: any) {
    return json(500, { error: e?.message || "Unknown error" });
  }
});
