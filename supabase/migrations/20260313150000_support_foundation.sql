BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '3min';

CREATE TABLE IF NOT EXISTS public.support_ai_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key text NOT NULL UNIQUE DEFAULT 'default',
  openrouter_model text NOT NULL DEFAULT 'openai/gpt-4o',
  temperature numeric NOT NULL DEFAULT 0.4,
  max_tokens int NOT NULL DEFAULT 1024,
  confidence_threshold numeric NOT NULL DEFAULT 0.6,
  system_prompt_base text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_faqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  question text NOT NULL,
  answer_md text NOT NULL,
  published boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_faqs_category_chk CHECK (category IN ('bug', 'usage', 'billing', 'other'))
);

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  anon_email text,
  category text NOT NULL DEFAULT 'other',
  status text NOT NULL DEFAULT 'open',
  title text NOT NULL DEFAULT '',
  page_url text,
  assigned_to uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT support_tickets_category_chk CHECK (category IN ('bug', 'usage', 'billing', 'other')),
  CONSTRAINT support_tickets_status_chk CHECK (status IN ('open', 'ai_resolved', 'pending_human', 'resolved')),
  CONSTRAINT support_tickets_anon_email_chk CHECK (
    user_id IS NOT NULL
    OR (
      anon_email IS NOT NULL
      AND btrim(anon_email) <> ''
      AND anon_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    )
  )
);

CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_id uuid REFERENCES auth.users(id),
  body text NOT NULL,
  is_ai boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_faqs_category_published
  ON public.support_faqs (category, published, sort_order);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id
  ON public.support_tickets (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status
  ON public.support_tickets (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_id
  ON public.support_messages (ticket_id, created_at ASC);

INSERT INTO public.support_ai_config (config_key, system_prompt_base)
VALUES (
  'default',
  'You are the support assistant for UEFNToolkit, a platform for Fortnite UEFN creators.
UEFNToolkit provides: Discovery analytics, Island Lookup, Weekly Reports, Thumb Tools, WidgetKit, DPPI, and a Credits/Billing system.
Always respond in the same language as the user message.
Be concise and direct. If you cannot resolve with confidence, ask for escalation to human support.
Current page context: {page_url}
Relevant FAQs: {faq_context}
Knowledge base: {rag_context}'
)
ON CONFLICT (config_key) DO NOTHING;

ALTER TABLE public.support_ai_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_ai_config_service_all ON public.support_ai_config;
CREATE POLICY support_ai_config_service_all
ON public.support_ai_config
FOR ALL
TO public
USING ((auth.jwt() ->> 'role') = 'service_role')
WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP POLICY IF EXISTS support_ai_config_admin_read ON public.support_ai_config;
CREATE POLICY support_ai_config_admin_read
ON public.support_ai_config
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

DROP POLICY IF EXISTS support_ai_config_admin_update ON public.support_ai_config;
CREATE POLICY support_ai_config_admin_update
ON public.support_ai_config
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

DROP POLICY IF EXISTS support_faqs_public_read ON public.support_faqs;
CREATE POLICY support_faqs_public_read
ON public.support_faqs
FOR SELECT
TO public
USING (published = true);

DROP POLICY IF EXISTS support_faqs_admin_all ON public.support_faqs;
CREATE POLICY support_faqs_admin_all
ON public.support_faqs
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

DROP POLICY IF EXISTS support_faqs_service_all ON public.support_faqs;
CREATE POLICY support_faqs_service_all
ON public.support_faqs
FOR ALL
TO public
USING ((auth.jwt() ->> 'role') = 'service_role')
WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP POLICY IF EXISTS support_tickets_owner_select ON public.support_tickets;
CREATE POLICY support_tickets_owner_select
ON public.support_tickets
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS support_tickets_owner_update ON public.support_tickets;
CREATE POLICY support_tickets_owner_update
ON public.support_tickets
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS support_tickets_admin_all ON public.support_tickets;
CREATE POLICY support_tickets_admin_all
ON public.support_tickets
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

DROP POLICY IF EXISTS support_tickets_service_all ON public.support_tickets;
CREATE POLICY support_tickets_service_all
ON public.support_tickets
FOR ALL
TO public
USING ((auth.jwt() ->> 'role') = 'service_role')
WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP POLICY IF EXISTS support_messages_owner_select ON public.support_messages;
CREATE POLICY support_messages_owner_select
ON public.support_messages
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.support_tickets t
    WHERE t.id = ticket_id
      AND t.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS support_messages_owner_insert ON public.support_messages;
CREATE POLICY support_messages_owner_insert
ON public.support_messages
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.support_tickets t
    WHERE t.id = ticket_id
      AND t.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS support_messages_admin_all ON public.support_messages;
CREATE POLICY support_messages_admin_all
ON public.support_messages
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

DROP POLICY IF EXISTS support_messages_service_all ON public.support_messages;
CREATE POLICY support_messages_service_all
ON public.support_messages
FOR ALL
TO public
USING ((auth.jwt() ->> 'role') = 'service_role')
WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

CREATE OR REPLACE FUNCTION public.support_enforce_ticket_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
    AND auth.uid() = OLD.user_id
    AND NOT public.is_admin_or_editor()
  THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.anon_email IS DISTINCT FROM OLD.anon_email
      OR NEW.category IS DISTINCT FROM OLD.category
      OR NEW.title IS DISTINCT FROM OLD.title
      OR NEW.page_url IS DISTINCT FROM OLD.page_url
      OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'owner_ticket_update_not_allowed';
    END IF;

    IF NEW.status IS DISTINCT FROM 'open' THEN
      RAISE EXCEPTION 'owner_can_only_reopen_to_open';
    END IF;

    NEW.resolved_at := NULL;
  ELSIF NEW.status = 'resolved' AND NEW.resolved_at IS NULL THEN
    NEW.resolved_at := now();
  ELSIF NEW.status <> 'resolved' THEN
    NEW.resolved_at := NULL;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_tickets_enforce_update ON public.support_tickets;
CREATE TRIGGER support_tickets_enforce_update
BEFORE UPDATE ON public.support_tickets
FOR EACH ROW
EXECUTE FUNCTION public.support_enforce_ticket_update();

DROP TRIGGER IF EXISTS update_support_ai_config_updated_at ON public.support_ai_config;
CREATE TRIGGER update_support_ai_config_updated_at
BEFORE UPDATE ON public.support_ai_config
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_support_faqs_updated_at ON public.support_faqs;
CREATE TRIGGER update_support_faqs_updated_at
BEFORE UPDATE ON public.support_faqs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMIT;
