-- clean_migration.sql
-- Idempotent migration for Smart Invoice Hub (Supabase / Postgres)
-- Safe to re-run: uses IF NOT EXISTS / catalog checks to avoid "already exists" errors.

-- Extensions (Supabase usually has these, but keep it safe)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- --------------------
-- Enums (idempotent)
-- --------------------
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.invoice_type AS ENUM ('services','goods','medical','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.risk_level AS ENUM ('low','medium','high');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.compliance_status AS ENUM ('compliant','needs_review','non_compliant');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.doc_type AS ENUM ('invoice','receipt','offer','prescription','sick_note','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.direction_type AS ENUM ('incoming','outgoing','unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.approval_status AS ENUM ('pass','fail','needs_info','pending','needs_human');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_status AS ENUM ('draft','queued','processing','paid','failed','canceled','pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --------------------
-- Tables (base)
-- --------------------

-- Profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- If profiles already existed without FK, add FK safely (and clean orphan rows first)
DO $$
BEGIN
  -- delete orphan profiles (prevents 23503 when adding FK)
  DELETE FROM public.profiles p
  WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.user_id);

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_user_id_fkey'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Roles table
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

DO $$
BEGIN
  DELETE FROM public.user_roles r
  WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = r.user_id);

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_roles_user_id_fkey'
      AND conrelid = 'public.user_roles'::regclass
  ) THEN
    ALTER TABLE public.user_roles
      ADD CONSTRAINT user_roles_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Invoices (create minimal, then evolve with ADD COLUMN IF NOT EXISTS below)
CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  file_url text NOT NULL,
  file_name text NOT NULL,
  file_type text,
  vendor_name text,
  invoice_number text,
  invoice_date date,
  total_amount numeric,
  tax_amount numeric,
  currency text DEFAULT 'USD',
  invoice_type public.invoice_type DEFAULT 'other',
  language text DEFAULT 'en',
  risk_score public.risk_level DEFAULT 'low',
  compliance_status public.compliance_status DEFAULT 'needs_review',
  is_flagged boolean DEFAULT false,
  flag_reason text,
  is_duplicate boolean DEFAULT false,
  ocr_data jsonb,
  agent_processing jsonb DEFAULT '{"ingestion": null, "classification": null, "fraud_detection": null, "compliance": null, "reporting": null}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  DELETE FROM public.invoices i
  WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = i.user_id);

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_user_id_fkey'
      AND conrelid = 'public.invoices'::regclass
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Chat messages
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  DELETE FROM public.chat_messages m
  WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = m.user_id);

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chat_messages_user_id_fkey'
      AND conrelid = 'public.chat_messages'::regclass
  ) THEN
    ALTER TABLE public.chat_messages
      ADD CONSTRAINT chat_messages_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- --------------------
-- Advanced invoice intelligence (columns + extra tables)
-- --------------------

-- Add missing columns to invoices (safe re-run)
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS storage_path text,
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
  ADD COLUMN IF NOT EXISTS document_hash text,
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
  ADD COLUMN IF NOT EXISTS credits_used integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS citations jsonb,
  ADD COLUMN IF NOT EXISTS confidence numeric,
  ADD COLUMN IF NOT EXISTS invoice_id uuid;

-- self-reference FK if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_invoice_id_fkey'
      AND conrelid = 'public.invoices'::regclass
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_invoice_id_fkey
      FOREIGN KEY (invoice_id) REFERENCES public.invoices(id);
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS invoices_document_hash_idx ON public.invoices(document_hash);
CREATE INDEX IF NOT EXISTS invoices_doc_class_idx ON public.invoices(doc_class);
CREATE INDEX IF NOT EXISTS invoices_approval_idx ON public.invoices(approval);
CREATE INDEX IF NOT EXISTS invoices_direction_idx ON public.invoices(direction);

-- Approvals workflow
CREATE TABLE IF NOT EXISTS public.approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status public.approval_status NOT NULL DEFAULT 'pending',
  reasons text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  DELETE FROM public.approvals a
  WHERE NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = a.invoice_id)
     OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = a.user_id);

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='approvals_invoice_id_fkey' AND conrelid='public.approvals'::regclass) THEN
    ALTER TABLE public.approvals
      ADD CONSTRAINT approvals_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='approvals_user_id_fkey' AND conrelid='public.approvals'::regclass) THEN
    ALTER TABLE public.approvals
      ADD CONSTRAINT approvals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Payments
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid,
  user_id uuid NOT NULL,
  status public.payment_status NOT NULL DEFAULT 'draft',
  amount numeric,
  currency text,
  provider text,
  provider_reference text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  DELETE FROM public.payments p
  WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.user_id);

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='payments_invoice_id_fkey' AND conrelid='public.payments'::regclass) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='payments_user_id_fkey' AND conrelid='public.payments'::regclass) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Card transactions
CREATE TABLE IF NOT EXISTS public.card_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  txn_date date,
  merchant text,
  amount numeric,
  currency text,
  raw jsonb,
  matched_invoice_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  DELETE FROM public.card_transactions t
  WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t.user_id);

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='card_transactions_user_id_fkey' AND conrelid='public.card_transactions'::regclass) THEN
    ALTER TABLE public.card_transactions
      ADD CONSTRAINT card_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='card_transactions_matched_invoice_id_fkey' AND conrelid='public.card_transactions'::regclass) THEN
    ALTER TABLE public.card_transactions
      ADD CONSTRAINT card_transactions_matched_invoice_id_fkey FOREIGN KEY (matched_invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Reimbursements
CREATE TABLE IF NOT EXISTS public.reimbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  invoice_id uuid,
  status public.approval_status NOT NULL DEFAULT 'pending',
  amount numeric,
  currency text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  DELETE FROM public.reimbursements r
  WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = r.user_id);

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reimbursements_user_id_fkey' AND conrelid='public.reimbursements'::regclass) THEN
    ALTER TABLE public.reimbursements
      ADD CONSTRAINT reimbursements_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reimbursements_invoice_id_fkey' AND conrelid='public.reimbursements'::regclass) THEN
    ALTER TABLE public.reimbursements
      ADD CONSTRAINT reimbursements_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Policies (per-user placeholder)
CREATE TABLE IF NOT EXISTS public.policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  jurisdiction text,
  max_amount numeric,
  require_invoice_number boolean DEFAULT true,
  require_vat_id boolean DEFAULT false,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  DELETE FROM public.policies p
  WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.user_id);

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='policies_user_id_fkey' AND conrelid='public.policies'::regclass) THEN
    ALTER TABLE public.policies
      ADD CONSTRAINT policies_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Documents / chunks / decisions / audit logs (optional but present in your schema dump)
CREATE TABLE IF NOT EXISTS public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  file_name text NOT NULL,
  bucket text NOT NULL,
  object_key text NOT NULL,
  mime_type text,
  created_at timestamptz DEFAULT now()
);

DO $$
BEGIN
  DELETE FROM public.documents d
  WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = d.user_id);

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='documents_user_id_fkey' AND conrelid='public.documents'::regclass) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL,
  page integer DEFAULT 1,
  chunk_index integer NOT NULL,
  text text NOT NULL,
  embedding vector(1536),
  created_at timestamptz DEFAULT now()
);

DO $$
BEGIN
  DELETE FROM public.document_chunks c
  WHERE NOT EXISTS (SELECT 1 FROM public.documents d WHERE d.id = c.document_id);

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='document_chunks_document_id_fkey' AND conrelid='public.document_chunks'::regclass) THEN
    ALTER TABLE public.document_chunks
      ADD CONSTRAINT document_chunks_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL,
  confidence numeric,
  reasons jsonb,
  citations jsonb,
  created_at timestamptz DEFAULT now()
);

DO $$
BEGIN
  DELETE FROM public.decisions d
  WHERE NOT EXISTS (SELECT 1 FROM public.documents doc WHERE doc.id = d.document_id)
     OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = d.user_id);

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='decisions_document_id_fkey' AND conrelid='public.decisions'::regclass) THEN
    ALTER TABLE public.decisions
      ADD CONSTRAINT decisions_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='decisions_user_id_fkey' AND conrelid='public.decisions'::regclass) THEN
    ALTER TABLE public.decisions
      ADD CONSTRAINT decisions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  document_id uuid,
  step text NOT NULL,
  payload jsonb,
  created_at timestamptz DEFAULT now(),
  invoice_id uuid
);

DO $$
BEGIN
  DELETE FROM public.audit_logs a
  WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = a.user_id);

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='audit_logs_user_id_fkey' AND conrelid='public.audit_logs'::regclass) THEN
    ALTER TABLE public.audit_logs
      ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='audit_logs_invoice_id_fkey' AND conrelid='public.audit_logs'::regclass) THEN
    ALTER TABLE public.audit_logs
      ADD CONSTRAINT audit_logs_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;
  END IF;
END $$;

-- --------------------
-- Wallet / credits (optional)
-- --------------------
CREATE TABLE IF NOT EXISTS public.ai_wallet (
  user_id uuid PRIMARY KEY,
  credits numeric NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

DO $$
BEGIN
  DELETE FROM public.ai_wallet w
  WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = w.user_id);

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_wallet_user_id_fkey' AND conrelid='public.ai_wallet'::regclass) THEN
    ALTER TABLE public.ai_wallet
      ADD CONSTRAINT ai_wallet_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.ai_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  action text NOT NULL,
  credits_delta integer NOT NULL,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  DELETE FROM public.ai_credit_ledger l
  WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = l.user_id);

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_credit_ledger_user_id_fkey' AND conrelid='public.ai_credit_ledger'::regclass) THEN
    ALTER TABLE public.ai_credit_ledger
      ADD CONSTRAINT ai_credit_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- --------------------
-- RLS + helper functions + triggers
-- --------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Role check helper
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  );
$$;

-- updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- create trigger only if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_profiles_updated_at') THEN
    CREATE TRIGGER update_profiles_updated_at
      BEFORE UPDATE ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_invoices_updated_at') THEN
    CREATE TRIGGER update_invoices_updated_at
      BEFORE UPDATE ON public.invoices
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_payments_updated_at') THEN
    CREATE TRIGGER update_payments_updated_at
      BEFORE UPDATE ON public.payments
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

-- Create function to handle new user registration (profile + default role)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'))
  ON CONFLICT (user_id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
        updated_at = now();

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.ai_wallet (user_id, credits)
  VALUES (NEW.id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Trigger on auth.users (create only if missing)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created') THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END $$;

-- --------------------
-- RLS Policies (idempotent using catalog checks)
-- --------------------
DO $$
BEGIN
  -- profiles
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='Users can view their own profile') THEN
    CREATE POLICY "Users can view their own profile"
      ON public.profiles FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='Users can update their own profile') THEN
    CREATE POLICY "Users can update their own profile"
      ON public.profiles FOR UPDATE
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='Users can insert their own profile') THEN
    CREATE POLICY "Users can insert their own profile"
      ON public.profiles FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='Admins can view all profiles') THEN
    CREATE POLICY "Admins can view all profiles"
      ON public.profiles FOR SELECT
      USING (public.has_role(auth.uid(), 'admin'));
  END IF;

  -- user_roles
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_roles' AND policyname='Users can view their own roles') THEN
    CREATE POLICY "Users can view their own roles"
      ON public.user_roles FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_roles' AND policyname='Admins can view all roles') THEN
    CREATE POLICY "Admins can view all roles"
      ON public.user_roles FOR SELECT
      USING (public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_roles' AND policyname='Admins can insert roles') THEN
    CREATE POLICY "Admins can insert roles"
      ON public.user_roles FOR INSERT
      WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;

  -- invoices
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoices' AND policyname='Users can view their own invoices') THEN
    CREATE POLICY "Users can view their own invoices"
      ON public.invoices FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoices' AND policyname='Users can insert their own invoices') THEN
    CREATE POLICY "Users can insert their own invoices"
      ON public.invoices FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoices' AND policyname='Users can update their own invoices') THEN
    CREATE POLICY "Users can update their own invoices"
      ON public.invoices FOR UPDATE
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoices' AND policyname='Users can delete their own invoices') THEN
    CREATE POLICY "Users can delete their own invoices"
      ON public.invoices FOR DELETE
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoices' AND policyname='Admins can view all invoices') THEN
    CREATE POLICY "Admins can view all invoices"
      ON public.invoices FOR SELECT
      USING (public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoices' AND policyname='Admins can update all invoices') THEN
    CREATE POLICY "Admins can update all invoices"
      ON public.invoices FOR UPDATE
      USING (public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoices' AND policyname='Admins can delete all invoices') THEN
    CREATE POLICY "Admins can delete all invoices"
      ON public.invoices FOR DELETE
      USING (public.has_role(auth.uid(), 'admin'));
  END IF;

  -- chat_messages
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='chat_messages' AND policyname='Users can view their own messages') THEN
    CREATE POLICY "Users can view their own messages"
      ON public.chat_messages FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='chat_messages' AND policyname='Users can insert their own messages') THEN
    CREATE POLICY "Users can insert their own messages"
      ON public.chat_messages FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- --------------------
-- Storage bucket + policies (safe)
-- --------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoices', 'invoices', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Users can upload their own invoices') THEN
    CREATE POLICY "Users can upload their own invoices"
      ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'invoices' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Users can view their own invoices') THEN
    CREATE POLICY "Users can view their own invoices"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'invoices' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Users can delete their own invoices') THEN
    CREATE POLICY "Users can delete their own invoices"
      ON storage.objects FOR DELETE
      USING (bucket_id = 'invoices' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Admins can view all invoices in storage') THEN
    CREATE POLICY "Admins can view all invoices in storage"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'invoices' AND public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;
