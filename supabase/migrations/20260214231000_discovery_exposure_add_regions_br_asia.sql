-- Add Discovery Exposure targets for BR and ASIA (Frontend + Browse).
-- Safe to run multiple times due to UNIQUE(region, surface_name, platform, locale).

INSERT INTO public.discovery_exposure_targets (region, surface_name, platform, locale, interval_minutes, next_due_at, last_status)
VALUES
  ('BR',   'CreativeDiscoverySurface_Frontend', 'Windows', 'en', 10, now(), 'idle'),
  ('BR',   'CreativeDiscoverySurface_Browse',   'Windows', 'en', 10, now(), 'idle'),
  ('ASIA', 'CreativeDiscoverySurface_Frontend', 'Windows', 'en', 10, now(), 'idle'),
  ('ASIA', 'CreativeDiscoverySurface_Browse',   'Windows', 'en', 10, now(), 'idle')
ON CONFLICT (region, surface_name, platform, locale)
DO UPDATE SET interval_minutes = EXCLUDED.interval_minutes;

