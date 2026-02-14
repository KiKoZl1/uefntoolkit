
-- ============================================
-- 1.1 Alterar discover_reports: novas colunas de fase/progresso
-- ============================================
ALTER TABLE public.discover_reports
  ADD COLUMN IF NOT EXISTS phase TEXT DEFAULT 'catalog',
  ADD COLUMN IF NOT EXISTS catalog_discovered_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS catalog_done BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS catalog_cursor TEXT NULL,
  ADD COLUMN IF NOT EXISTS queue_total INT NULL,
  ADD COLUMN IF NOT EXISTS metrics_done_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reported_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS suppressed_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_total INT NULL,
  ADD COLUMN IF NOT EXISTS progress_pct INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT now();

-- ============================================
-- 1.2 Criar discover_report_queue
-- ============================================
CREATE TABLE IF NOT EXISTS public.discover_report_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.discover_reports(id) ON DELETE CASCADE,
  island_code TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  locked_at TIMESTAMPTZ NULL,
  attempts INT DEFAULT 0,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (report_id, island_code)
);

CREATE INDEX IF NOT EXISTS idx_queue_report_status ON public.discover_report_queue(report_id, status);
CREATE INDEX IF NOT EXISTS idx_queue_report_locked ON public.discover_report_queue(report_id, locked_at);

ALTER TABLE public.discover_report_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view queue"
  ON public.discover_report_queue FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role can insert queue"
  ON public.discover_report_queue FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

CREATE POLICY "Service role can update queue"
  ON public.discover_report_queue FOR UPDATE
  TO authenticated
  USING ((auth.jwt() ->> 'role') = 'service_role');

CREATE POLICY "Service role can delete queue"
  ON public.discover_report_queue FOR DELETE
  TO authenticated
  USING ((auth.jwt() ->> 'role') = 'service_role');

-- Trigger updated_at
CREATE TRIGGER update_discover_report_queue_updated_at
  BEFORE UPDATE ON public.discover_report_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 1.3 Criar discover_report_islands
-- ============================================
CREATE TABLE IF NOT EXISTS public.discover_report_islands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.discover_reports(id) ON DELETE CASCADE,
  island_code TEXT NOT NULL,
  title TEXT,
  creator_code TEXT,
  category TEXT,
  created_in TEXT,
  tags JSONB DEFAULT '[]',
  status TEXT,
  probe_unique INT NULL,
  probe_plays INT NULL,
  probe_minutes INT NULL,
  probe_peak_ccu INT NULL,
  probe_date DATE NULL,
  week_unique INT NULL,
  week_plays INT NULL,
  week_minutes INT NULL,
  week_minutes_per_player_avg FLOAT NULL,
  week_peak_ccu_max INT NULL,
  week_favorites INT NULL,
  week_recommends INT NULL,
  week_d1_avg FLOAT NULL,
  week_d7_avg FLOAT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (report_id, island_code)
);

-- Ranking indices
CREATE INDEX IF NOT EXISTS idx_ri_plays ON public.discover_report_islands(report_id, week_plays DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_ri_unique ON public.discover_report_islands(report_id, week_unique DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_ri_peak_ccu ON public.discover_report_islands(report_id, week_peak_ccu_max DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_ri_minutes ON public.discover_report_islands(report_id, week_minutes DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_ri_mpp ON public.discover_report_islands(report_id, week_minutes_per_player_avg DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_ri_d1 ON public.discover_report_islands(report_id, week_d1_avg DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_ri_d7 ON public.discover_report_islands(report_id, week_d7_avg DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_ri_status ON public.discover_report_islands(report_id, status);

ALTER TABLE public.discover_report_islands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view report islands"
  ON public.discover_report_islands FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role can insert report islands"
  ON public.discover_report_islands FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

CREATE POLICY "Service role can update report islands"
  ON public.discover_report_islands FOR UPDATE
  TO authenticated
  USING ((auth.jwt() ->> 'role') = 'service_role');

-- Trigger updated_at
CREATE TRIGGER update_discover_report_islands_updated_at
  BEFORE UPDATE ON public.discover_report_islands
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
