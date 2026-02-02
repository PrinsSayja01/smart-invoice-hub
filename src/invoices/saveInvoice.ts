import { supabase } from "../lib/supabaseClient";

type ExtractedData = {
  vendor_name?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null; // yyyy-mm-dd preferred
  total_amount?: string | number | null;
  tax_amount?: string | number | null;
  currency?: string | null;
  extracted_text?: string | null;
};

function safeNumber(v: any) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function uploadToInvoicesBucket(userId: string, file: File) {
  const bucket = "invoices";
  const ext = file.name.split(".").pop() || "bin";
  const fileNameSafe = file.name.replace(/[^\w.\-]+/g, "_");
  const storagePath = `${userId}/${Date.now()}_${fileNameSafe}.${ext}`.replace(/\.${ext}\.${ext}$/, `.${ext}`);

  const { error: upErr } = await supabase.storage.from(bucket).upload(storagePath, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "application/octet-stream",
  });

  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

  // ✅ stable URL only if bucket is PUBLIC
  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  const fileUrl = pub?.publicUrl;

  return { storagePath, fileUrl };
}

export async function saveInvoiceRow(params: {
  userId: string;
  file: File;
  extractedData: ExtractedData;
  storagePath: string;
  fileUrl: string; // must not be null (db constraint)
}) {
  const { userId, file, extractedData, storagePath, fileUrl } = params;

  const fileType = file.type || "application/octet-stream"; // ✅ fixes file_type NOT NULL

  const payload: any = {
    user_id: userId,
    file_name: file.name,
    file_type: fileType,        // ✅ REQUIRED
    file_url: fileUrl,          // ✅ REQUIRED (bucket should be public)
    storage_path: storagePath,  // keep for later use
    vendor_name: extractedData.vendor_name || null,
    invoice_number: extractedData.invoice_number || null,
    invoice_date: extractedData.invoice_date || null,
    total_amount: safeNumber(extractedData.total_amount),
    tax_amount: safeNumber(extractedData.tax_amount),
    currency: extractedData.currency || null,
    extracted_text: extractedData.extracted_text || null,
  };

  const { error: insErr } = await supabase.from("invoices").insert(payload);
  if (insErr) throw new Error(`Insert failed: ${insErr.message}`);
}
