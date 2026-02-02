-- Advanced invoice intelligence features

-- Enums
DO $$ BEGIN
  CREATE TYPE public.doc_type AS ENUM ('invoice','receipt','offer','prescription','sick_note','other');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.direction_type AS ENUM ('incoming','outgoing','unknown');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.approval_status AS ENUM ('pass','fail','needs_info','pending');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_status AS ENUM ('draft','queued','processing','paid','failed','canceled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Columns on invoices
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS doc_class public.doc_type DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS doc_class_confidence numeric,
  ADD COLUMN IF NOT EXISTS field_confidence jsonb,
  ADD COLUMN IF NOT EXISTS direction public.direction_type DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS direction_confidence numeric,
  ADD COLUMN IF NOT EXISTS jurisdiction text,
  ADD COLUMN IF NOT EXISTS vat_rate numeric,
  ADD COLUMN IF NOT EXISTS vat_amount_computed numeric,
  ADD COLUMN IF NOT EXISTS compliance_issues jsonb,
  ADD COLUMN IF NOT EXISTS fraud_score numeric,
  ADD COLUMN IF NOT EXISTS anomaly_flags jsonb,
  ADD COLUMN IF NOT EXISTS document_hash text,
  ADD COLUMN IF NOT EXISTS approval public.approval_status DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approval_confidence numeric,
  ADD COLUMN IF NOT EXISTS approval_reasons text[],
  ADD COLUMN IF NOT EXISTS needs_info_fields text[],
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS cost_center text,
  ADD COLUMN IF NOT EXISTS project_code text,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS payment_terms text,
  ADD COLUMN IF NOT EXISTS esg_category text,
  ADD COLUMN IF NOT EXISTS co2e_estimate numeric,
  ADD COLUMN IF NOT EXISTS emissions_confidence numeric,
  ADD COLUMN IF NOT EXISTS payment_payload jsonb,
  ADD COLUMN IF NOT EXISTS payment_qr_string text;

-- Indexes
CREATE INDEX IF NOT EXISTS invoices_document_hash_idx ON public.invoices(document_hash);
CREATE INDEX IF NOT EXISTS invoices_doc_class_idx ON public.invoices(doc_class);
CREATE INDEX IF NOT EXISTS invoices_approval_idx ON public.invoices(approval);
CREATE INDEX IF NOT EXISTS invoices_direction_idx ON public.invoices(direction);

-- Approval workflow table
CREATE TABLE IF NOT EXISTS public.approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  status public.approval_status DEFAULT 'pending' NOT NULL,
  reasons text[],
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Payments table (placeholder for QR/open banking/cards)
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  status public.payment_status DEFAULT 'draft' NOT NULL,
  amount numeric,
  currency text,
  provider text,
  provider_reference text,
  payload jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Card transactions table (placeholder)
CREATE TABLE IF NOT EXISTS public.card_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  txn_date date,
  merchant text,
  amount numeric,
  currency text,
  raw jsonb,
  matched_invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Reimbursements table (placeholder)
CREATE TABLE IF NOT EXISTS public.reimbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  status public.approval_status DEFAULT 'pending' NOT NULL,
  amount numeric,
  currency text,
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Simple policies table (placeholder for compliance/approval rules)
CREATE TABLE IF NOT EXISTS public.policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  jurisdiction text,
  max_amount numeric,
  require_invoice_number boolean DEFAULT true,
  require_vat_id boolean DEFAULT false,
  raw jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
