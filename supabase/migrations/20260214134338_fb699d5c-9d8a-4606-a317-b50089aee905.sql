
-- Create discover_islands_cache table
CREATE TABLE public.discover_islands_cache (
  island_code TEXT PRIMARY KEY,
  title TEXT,
  creator_code TEXT,
  category TEXT,
  created_in TEXT,
  tags JSONB DEFAULT '[]',
  first_seen_at TIMESTAMPTZ DEFAULT now(),
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  last_status TEXT,
  suppressed_streak INT DEFAULT 0,
  reported_streak INT DEFAULT 0,
  last_report_id UUID NULL,
  last_reported_at TIMESTAMPTZ NULL,
  last_suppressed_at TIMESTAMPTZ NULL,
  last_probe_unique INT NULL,
  last_probe_plays INT NULL,
  last_week_unique INT NULL,
  last_week_plays INT NULL,
  last_week_minutes INT NULL,
  last_week_peak_ccu INT NULL,
  last_week_favorites INT NULL,
  last_week_recommends INT NULL,
  last_week_d1_avg DOUBLE PRECISION NULL,
  last_week_d7_avg DOUBLE PRECISION NULL,
  last_week_minutes_per_player_avg DOUBLE PRECISION NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_cache_creator_code ON public.discover_islands_cache (creator_code);
CREATE INDEX idx_cache_last_status ON public.discover_islands_cache (last_status);
CREATE INDEX idx_cache_suppressed_streak ON public.discover_islands_cache (suppressed_streak);
CREATE INDEX idx_cache_last_reported_at ON public.discover_islands_cache (last_reported_at);

-- Enable RLS
ALTER TABLE public.discover_islands_cache ENABLE ROW LEVEL SECURITY;

-- RLS: service_role for write, authenticated for read
CREATE POLICY "Authenticated users can view cache"
  ON public.discover_islands_cache FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role can insert cache"
  ON public.discover_islands_cache FOR INSERT
  WITH CHECK ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

CREATE POLICY "Service role can update cache"
  ON public.discover_islands_cache FOR UPDATE
  USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

CREATE POLICY "Service role can delete cache"
  ON public.discover_islands_cache FOR DELETE
  USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

-- Add priority column to discover_report_queue
ALTER TABLE public.discover_report_queue ADD COLUMN priority INT DEFAULT 50;
CREATE INDEX idx_queue_priority ON public.discover_report_queue (priority);
