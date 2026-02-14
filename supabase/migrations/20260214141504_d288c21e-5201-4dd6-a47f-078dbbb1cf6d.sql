
-- 1. Create app_role enum and user_roles table (secure role management)
CREATE TYPE public.app_role AS ENUM ('admin', 'editor', 'client');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles (avoids recursive RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- RLS: users can see their own roles
CREATE POLICY "Users can view own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS: only admins can manage roles
CREATE POLICY "Admins can manage roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2. Create weekly_reports CMS table
CREATE TABLE public.weekly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discover_report_id UUID REFERENCES public.discover_reports(id) ON DELETE SET NULL,
  week_key TEXT NOT NULL,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  public_slug TEXT UNIQUE,
  title_public TEXT,
  subtitle_public TEXT,
  editor_note TEXT,
  kpis_json JSONB DEFAULT '{}',
  rankings_json JSONB DEFAULT '{}',
  sections_json JSONB DEFAULT '[]',
  ai_sections_json JSONB DEFAULT '{}',
  editor_sections_json JSONB DEFAULT '{}',
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.weekly_reports ENABLE ROW LEVEL SECURITY;

-- Public can view published reports (no auth needed)
CREATE POLICY "Anyone can view published reports"
  ON public.weekly_reports FOR SELECT
  TO anon, authenticated
  USING (status = 'published');

-- Admins/editors can view all reports
CREATE POLICY "Admins can view all reports"
  ON public.weekly_reports FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

-- Admins can insert/update/delete
CREATE POLICY "Admins can manage reports"
  ON public.weekly_reports FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Service role can manage (for edge functions)
CREATE POLICY "Service role can manage weekly reports"
  ON public.weekly_reports FOR ALL
  USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text)
  WITH CHECK ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

-- Trigger for updated_at
CREATE TRIGGER update_weekly_reports_updated_at
  BEFORE UPDATE ON public.weekly_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
