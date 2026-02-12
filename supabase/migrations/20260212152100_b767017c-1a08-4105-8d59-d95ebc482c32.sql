
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Table: discover_reports (weekly ecosystem snapshots)
CREATE TABLE public.discover_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  week_number INTEGER NOT NULL,
  year INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'collecting',
  raw_metrics JSONB DEFAULT '{}'::jsonb,
  computed_rankings JSONB DEFAULT '{}'::jsonb,
  platform_kpis JSONB DEFAULT '{}'::jsonb,
  ai_narratives JSONB DEFAULT '{}'::jsonb,
  island_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: discover_islands (metadata cache)
CREATE TABLE public.discover_islands (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  island_code TEXT NOT NULL UNIQUE,
  title TEXT,
  creator_code TEXT,
  category TEXT,
  tags JSONB DEFAULT '[]'::jsonb,
  created_in TEXT,
  last_metrics JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_discover_reports_week ON public.discover_reports (year DESC, week_number DESC);
CREATE INDEX idx_discover_reports_status ON public.discover_reports (status);
CREATE INDEX idx_discover_islands_code ON public.discover_islands (island_code);
CREATE INDEX idx_discover_islands_creator ON public.discover_islands (creator_code);

-- Enable RLS
ALTER TABLE public.discover_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discover_islands ENABLE ROW LEVEL SECURITY;

-- RLS: Anyone authenticated can read (data is public ecosystem data)
CREATE POLICY "Authenticated users can view discover reports"
  ON public.discover_reports FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can view discover islands"
  ON public.discover_islands FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- RLS: Only service_role can write (edge functions)
CREATE POLICY "Service role can insert discover reports"
  ON public.discover_reports FOR INSERT
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can update discover reports"
  ON public.discover_reports FOR UPDATE
  USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can insert discover islands"
  ON public.discover_islands FOR INSERT
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can update discover islands"
  ON public.discover_islands FOR UPDATE
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Trigger for updated_at
CREATE TRIGGER update_discover_reports_updated_at
  BEFORE UPDATE ON public.discover_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_discover_islands_updated_at
  BEFORE UPDATE ON public.discover_islands
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
