BEGIN;

-- Extensions (gen_random_uuid)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------
-- Enums (idempotent)
-- ----------------------------
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.invoice_type AS ENUM ('services', 'goods', 'medical', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.risk_level AS ENUM ('low', 'medium', 'high');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.compliance_status AS ENUM ('compliant', 'needs_review', 'non_compliant');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ----------------------------
-- Tables
-- ----------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add FK safely (NOT VALID avoids failing on existing orphan rows)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_user_id_fkey'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_roles_user_id_fkey'
      AND conrelid = 'public.user_roles'::regclass
  ) THEN
    ALTER TABLE public.user_roles
      ADD CONSTRAINT user_roles_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;

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
  source text,
  storage_path text,
  document_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_user_id_fkey'
      AND conrelid = 'public.invoices'::regclass
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chat_messages_user_id_fkey'
      AND conrelid = 'public.chat_messages'::regclass
  ) THEN
    ALTER TABLE public.chat_messages
      ADD CONSTRAINT chat_messages_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;

-- ----------------------------
-- updated_at trigger function
-- ----------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Triggers (idempotent)
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
END $$;

-- ----------------------------
-- RLS enable
-- ----------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- ----------------------------
-- Role helper (security definer)
-- ----------------------------
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

-- ----------------------------
-- Policies (create only if missing)
-- ----------------------------
DO $$
BEGIN
  -- profiles policies
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

  -- user_roles policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_roles' AND policyname='Users can view their own roles') THEN
    CREATE POLICY "Users can view their own roles"
      ON public.user_roles FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  -- invoices policies
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

  -- chat_messages policies
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

-- ----------------------------
-- New user trigger (create profile + default role)
-- ----------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='on_auth_user_created') THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END $$;

-- ----------------------------
-- Storage bucket (idempotent)
-- ----------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoices', 'invoices', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies (idempotent)
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
END $$;

COMMIT;
