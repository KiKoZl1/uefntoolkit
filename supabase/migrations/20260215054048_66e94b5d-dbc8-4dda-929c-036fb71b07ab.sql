-- Create cron job to orchestrate discover-collector every minute
SELECT cron.schedule(
  'discover-collector-orchestrate-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://turezrchetxoluznjtdi.supabase.co/functions/v1/discover-collector',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1cmV6cmNoZXR4b2x1em5qdGRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3Nzg1NTEsImV4cCI6MjA4NjM1NDU1MX0.iWYPD7QQk90ecGsSzoE6BIFjAoA6o9BtYqwLuo-TCiA"}'::jsonb,
    body := '{"mode":"orchestrate"}'::jsonb
  ) AS request_id;
  $$
);

-- Also update the old weekly cron (job 7) to use v2 format
SELECT cron.unschedule(7);
SELECT cron.schedule(
  'discover-collector-weekly-v2',
  '0 6 * * 1',
  $$
  SELECT net.http_post(
    url := 'https://turezrchetxoluznjtdi.supabase.co/functions/v1/discover-collector',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1cmV6cmNoZXR4b2x1em5qdGRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3Nzg1NTEsImV4cCI6MjA4NjM1NDU1MX0.iWYPD7QQk90ecGsSzoE6BIFjAoA6o9BtYqwLuo-TCiA"}'::jsonb,
    body := '{"mode":"start"}'::jsonb
  ) AS request_id;
  $$
);