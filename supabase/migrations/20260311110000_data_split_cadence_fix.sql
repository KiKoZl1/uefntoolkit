-- Ensure discovery exposure cadence policy is applied after split rollout.
-- This migration is idempotent and can be re-run safely.
--
-- Target policy:
-- - NAE Frontend  -> 10 min
-- - NAE Browse    -> 15 min
-- - Other Frontend -> 60 min
-- - Other Browse   -> 180 min
--
-- Rollback:
-- UPDATE public.discovery_exposure_targets
-- SET interval_minutes = CASE
--   WHEN surface_name = 'CreativeDiscoverySurface_Frontend' THEN 5
--   WHEN surface_name = 'CreativeDiscoverySurface_Browse' THEN 10
--   ELSE interval_minutes
-- END
-- WHERE surface_name IN ('CreativeDiscoverySurface_Frontend', 'CreativeDiscoverySurface_Browse');

UPDATE public.discovery_exposure_targets
SET interval_minutes = CASE
  WHEN region = 'NAE' AND surface_name = 'CreativeDiscoverySurface_Frontend' THEN 10
  WHEN region = 'NAE' AND surface_name = 'CreativeDiscoverySurface_Browse' THEN 15
  WHEN region <> 'NAE' AND surface_name = 'CreativeDiscoverySurface_Frontend' THEN 60
  WHEN region <> 'NAE' AND surface_name = 'CreativeDiscoverySurface_Browse' THEN 180
  ELSE interval_minutes
END
WHERE surface_name IN ('CreativeDiscoverySurface_Frontend', 'CreativeDiscoverySurface_Browse');
