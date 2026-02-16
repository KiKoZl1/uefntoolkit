-- Fix overly permissive DELETE policy on discover_reports
DROP POLICY "Authenticated users can delete discover reports" ON public.discover_reports;

CREATE POLICY "Admins can delete discover reports"
  ON public.discover_reports FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));