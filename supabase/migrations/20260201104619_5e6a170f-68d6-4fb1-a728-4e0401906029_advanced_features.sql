BEGIN;

-- Enums (idempotent)
DO $$ BEGIN
  CREATE TYPE public.doc_type AS ENUM ('invoice','receipt','offer','prescription','sick_note','other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.direction_type AS ENUM ('incoming','outgoing','unknown');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.approval_status AS ENUM ('pass','fail','needs_info','pending','human_approval');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_status AS ENUM ('draft','queued','processing','paid','failed','canceled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add columns safely
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS doc_class public.doc_type DEFAULT 'invoice',
  ADD COLUMN IF NOT EXISTS doc_class_confidence numeric DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS field_confidence jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS direction public.direction_type DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS direction_confidence numeric DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS jurisdiction text DEFAULT 'EU',
  ADD COLUMN IF NOT EXISTS vat_rate numeric DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS vat_amount_computed numeric DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS compliance_issues jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS fraud_score numeric DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS anomaly_flags jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS approval public.approval_status DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approval_confidence numeric DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS approval_reasons text[] DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS needs_info_fields text[] DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS cost_center text,
  ADD COLUMN IF NOT EXISTS project_code text,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS payment_terms text,
  ADD COLUMN IF NOT EXISTS esg_category text,
  ADD COLUMN IF NOT EXISTS co2e_estimate numeric DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS emissions_confidence numeric DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS payment_payload jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_qr_string text,
  ADD COLUMN IF NOT EXISTS citations jsonb,
  ADD COLUMN IF NOT EXISTS confidence numeric;

-- Indexes
CREATE INDEX IF NOT EXISTS invoices_document_hash_idx ON public.invoices(document_hash);
CREATE INDEX IF NOT EXISTS invoices_doc_class_idx ON public.invoices(doc_class);
CREATE INDEX IF NOT EXISTS invoices_approval_idx ON public.invoices(approval);
CREATE INDEX IF NOT EXISTS invoices_direction_idx ON public.invoices(direction);

-- Approvals workflow table
CREATE TABLE IF NOT EXISTS public.approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.approval_status NOT NULL DEFAULT 'pending',
  reasons text[] DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Payments
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.payment_status NOT NULL DEFAULT 'draft',
  amount numeric,
  currency text,
  provider text,
  provider_reference text,
  payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Card transactions
CREATE TABLE IF NOT EXISTS public.card_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  txn_date date,
  merchant text,
  amount numeric,
  currency text,
  raw jsonb,
  matched_invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Reimbursements
CREATE TABLE IF NOT EXISTS public.reimbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  status public.approval_status NOT NULL DEFAULT 'pending',
  amount numeric,
  currency text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Policies (user-scoped)
CREATE TABLE IF NOT EXISTS public.policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  jurisdiction text,
  max_amount numeric,
  require_invoice_number boolean DEFAULT true,
  require_vat_id boolean DEFAULT false,
  raw jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
