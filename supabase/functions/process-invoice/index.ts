import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type InputBody = {
  fileUrl?: string;
  fileName?: string;
  fileType?: string;
  extractedText?: string; // optional (from your OCR)
};

type ExtractedData = {
  vendor_name: string;
  invoice_number: string;
  invoice_date: string; // YYYY-MM-DD
  total_amount: number;
  tax_amount: number;
  currency: string; // USD/EUR/GBP
  invoice_type: "services" | "goods" | "medical" | "other";
  language: "en";
};

function safeJsonParse(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    // try to extract JSON inside text
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fallbackData(fileName = "invoice"): ExtractedData {
  const total = Math.floor(Math.random() * 10000) + 500;
  const tax = Math.round(total * 0.19); // ~19%
  return {
    vendor_name: "Unknown Vendor",
    invoice_number: `INV-${Date.now()}`,
    invoice_date: todayISO(),
    total_amount: total,
    tax_amount: tax,
    currency: "EUR",
    invoice_type: "services",
    language: "en",
  };
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as InputBody;
    const fileName = body.fileName || "invoice";
    const fileType = body.fileType || "application/octet-stream";
    const extractedText = (body.extractedText || "").trim();

    const HF_API_KEY = Deno.env.get("HF_API_KEY");
    if (!HF_API_KEY) {
      return new Response(
        JSON.stringify({
          error:
