import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const formData = await request.formData();
  const file = formData.get('file') as File;

  if (!file) {
    return NextResponse.json({ error: 'No file' }, { status: 400 });
  }

  // 1. Upload to Supabase Storage
  const fileExt = file.name.split('.').pop();
  const filePath = `invoices/${Date.now()}-${Math.random().toString(36)}.${fileExt}`;
  
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('invoices')  // create this bucket first
    .upload(filePath, await file.arrayBuffer() as any, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: { publicUrl } } = supabase.storage
    .from('invoices')
    .getPublicUrl(uploadData!.path);

  // 2. TODO: Call invoice AI (EdenAI, etc.) - replace with real API
  const extractedInvoice = {
    vendor_name: 'Demo Vendor',
    invoice_number: 'INV-123',
    invoice_date: '2026-01-20',
    total_amount: 1500,
    tax_amount: 150,
    currency: 'EUR',
    risk_score: 'low',
    compliance_status: 'compliant',
  };

  // 3. Insert into invoices table
  const { data: { user } } = await supabase.auth.getUser();

  const { error: insertError } = await supabase
    .from('invoices')
    .insert({
      user_id: user?.id,
      file_name: file.name,
      file_url: publicUrl,
      source: 'device',
      ...extractedInvoice,
      is_flagged: false,
    });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ 
    id: uploadData!.path,
    extractedInvoice 
  });
}
