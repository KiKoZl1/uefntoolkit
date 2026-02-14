
-- Enable realtime for exposure tables so admin UI auto-refreshes
ALTER PUBLICATION supabase_realtime ADD TABLE public.discovery_exposure_targets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.discovery_exposure_ticks;
