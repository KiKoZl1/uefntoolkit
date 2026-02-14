CREATE POLICY "Authenticated users can delete discover reports"
  ON public.discover_reports FOR DELETE
  USING (auth.uid() IS NOT NULL);