-- Additive indexes for shared lookup cache paths (cross-user reuse).
-- Pre-beta table sizes are expected to be small enough for non-concurrent creation.

CREATE INDEX IF NOT EXISTS discover_lookup_recent_shared_recent_idx
  ON public.discover_lookup_recent (primary_code, compare_code, last_accessed_at DESC);

CREATE INDEX IF NOT EXISTS discover_lookup_ai_recent_shared_fp_idx
  ON public.discover_lookup_ai_recent (primary_code, compare_code, locale, window_days, payload_fingerprint, created_at DESC);
