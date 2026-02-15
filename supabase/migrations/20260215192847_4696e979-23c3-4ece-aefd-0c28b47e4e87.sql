
-- Add cover_image_url to weekly_reports
ALTER TABLE public.weekly_reports ADD COLUMN cover_image_url TEXT;

-- Create report-assets storage bucket (public)
INSERT INTO storage.buckets (id, name, public) VALUES ('report-assets', 'report-assets', true);

-- Public read for report-assets
CREATE POLICY "Anyone can view report assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'report-assets');

-- Admin/editor can upload report assets
CREATE POLICY "Admins can upload report assets"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'report-assets' AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'editor')));

-- Admin/editor can update report assets
CREATE POLICY "Admins can update report assets"
ON storage.objects FOR UPDATE
USING (bucket_id = 'report-assets' AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'editor')));

-- Admin/editor can delete report assets
CREATE POLICY "Admins can delete report assets"
ON storage.objects FOR DELETE
USING (bucket_id = 'report-assets' AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'editor')));
