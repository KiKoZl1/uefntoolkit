BEGIN;

CREATE TABLE IF NOT EXISTS public.widgetkit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  tool text NOT NULL CHECK (tool IN ('psd-umg', 'umg-verse')),
  name text NOT NULL,
  data_json jsonb NOT NULL,
  meta_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_widgetkit_history_user_tool_created
  ON public.widgetkit_history (user_id, tool, created_at DESC);

CREATE OR REPLACE FUNCTION public.widgetkit_history_trim_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.widgetkit_history
  WHERE id IN (
    SELECT id
    FROM public.widgetkit_history
    WHERE user_id = NEW.user_id
      AND tool = NEW.tool
    ORDER BY created_at DESC, id DESC
    OFFSET 10
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS widgetkit_history_trim_limit_trg ON public.widgetkit_history;
CREATE TRIGGER widgetkit_history_trim_limit_trg
  AFTER INSERT ON public.widgetkit_history
  FOR EACH ROW
  EXECUTE FUNCTION public.widgetkit_history_trim_limit();

ALTER TABLE public.widgetkit_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS widgetkit_history_user_select ON public.widgetkit_history;
CREATE POLICY widgetkit_history_user_select
  ON public.widgetkit_history FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS widgetkit_history_user_insert ON public.widgetkit_history;
CREATE POLICY widgetkit_history_user_insert
  ON public.widgetkit_history FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS widgetkit_history_user_delete ON public.widgetkit_history;
CREATE POLICY widgetkit_history_user_delete
  ON public.widgetkit_history FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS widgetkit_history_admin_editor_select ON public.widgetkit_history;
CREATE POLICY widgetkit_history_admin_editor_select
  ON public.widgetkit_history FOR SELECT
  TO authenticated
  USING (public.is_admin_or_editor());

COMMIT;
