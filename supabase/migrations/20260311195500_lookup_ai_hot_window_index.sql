-- Hot-window shared AI cache lookup optimization.
-- Supports queries by (primary, compare, locale, window) ordered by created_at desc
-- when payload_fingerprint differs across users/sessions.

CREATE INDEX IF NOT EXISTS discover_lookup_ai_recent_hot_window_idx
  ON public.discover_lookup_ai_recent (primary_code, compare_code, locale, window_days, created_at DESC);

