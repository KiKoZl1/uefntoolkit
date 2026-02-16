
CREATE TABLE IF NOT EXISTS public.ralph_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL CHECK (mode IN ('dev', 'dataops', 'report', 'qa', 'custom')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'promotable', 'rolled_back')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL,
  max_iterations integer NOT NULL DEFAULT 8,
  timeout_minutes integer NOT NULL DEFAULT 45,
  budget_usd numeric(12,4) NOT NULL DEFAULT 0,
  token_budget bigint NOT NULL DEFAULT 0,
  spent_usd numeric(12,4) NOT NULL DEFAULT 0,
  spent_tokens bigint NOT NULL DEFAULT 0,
  target_scope text[] NOT NULL DEFAULT '{}',
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ralph_actions (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.ralph_runs(id) ON DELETE CASCADE,
  step_index integer NOT NULL DEFAULT 0,
  phase text NOT NULL DEFAULT 'execute',
  tool_name text NULL,
  target text NULL,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'warn', 'error', 'skipped')),
  latency_ms integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ralph_eval_results (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.ralph_runs(id) ON DELETE CASCADE,
  suite text NOT NULL,
  metric text NOT NULL,
  value numeric NULL,
  threshold numeric NULL,
  pass boolean NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ralph_incidents (
  id bigserial PRIMARY KEY,
  run_id uuid NULL REFERENCES public.ralph_runs(id) ON DELETE SET NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'warn', 'error', 'critical')),
  incident_type text NOT NULL,
  message text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  resolution_note text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS ralph_runs_status_started_idx ON public.ralph_runs (status, started_at DESC);
CREATE INDEX IF NOT EXISTS ralph_runs_mode_started_idx ON public.ralph_runs (mode, started_at DESC);
CREATE INDEX IF NOT EXISTS ralph_actions_run_step_idx ON public.ralph_actions (run_id, step_index);
CREATE INDEX IF NOT EXISTS ralph_eval_run_suite_idx ON public.ralph_eval_results (run_id, suite, created_at DESC);
CREATE INDEX IF NOT EXISTS ralph_incidents_open_idx ON public.ralph_incidents (resolved, severity, created_at DESC);

ALTER TABLE public.ralph_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ralph_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ralph_eval_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ralph_incidents ENABLE ROW LEVEL SECURITY;

-- RLS policies for admin/editor SELECT
CREATE POLICY select_ralph_runs_admin_editor ON public.ralph_runs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'editor')));

CREATE POLICY select_ralph_actions_admin_editor ON public.ralph_actions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'editor')));

CREATE POLICY select_ralph_eval_admin_editor ON public.ralph_eval_results FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'editor')));

CREATE POLICY select_ralph_incidents_admin_editor ON public.ralph_incidents FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'editor')));

-- RLS policies for service_role full access
CREATE POLICY all_ralph_runs_service_role ON public.ralph_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY all_ralph_actions_service_role ON public.ralph_actions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY all_ralph_eval_service_role ON public.ralph_eval_results FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY all_ralph_incidents_service_role ON public.ralph_incidents FOR ALL TO service_role USING (true) WITH CHECK (true);

-- RPCs
CREATE OR REPLACE FUNCTION public.start_ralph_run(
  p_mode text, p_created_by uuid DEFAULT NULL, p_target_scope text[] DEFAULT '{}',
  p_max_iterations integer DEFAULT 8, p_timeout_minutes integer DEFAULT 45,
  p_budget_usd numeric DEFAULT 0, p_token_budget bigint DEFAULT 0, p_summary jsonb DEFAULT '{}'::jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_run_id uuid;
BEGIN
  INSERT INTO public.ralph_runs (mode, status, max_iterations, timeout_minutes, budget_usd, token_budget, target_scope, summary, created_by)
  VALUES (
    CASE WHEN p_mode IN ('dev','dataops','report','qa','custom') THEN p_mode ELSE 'custom' END,
    'running', GREATEST(COALESCE(p_max_iterations,8),1), GREATEST(COALESCE(p_timeout_minutes,45),1),
    GREATEST(COALESCE(p_budget_usd,0),0), GREATEST(COALESCE(p_token_budget,0),0),
    COALESCE(p_target_scope,'{}'), COALESCE(p_summary,'{}'::jsonb), p_created_by
  ) RETURNING id INTO v_run_id;
  RETURN v_run_id;
END; $$;

CREATE OR REPLACE FUNCTION public.finish_ralph_run(
  p_run_id uuid, p_status text, p_summary jsonb DEFAULT NULL, p_error_message text DEFAULT NULL,
  p_spent_tokens bigint DEFAULT NULL, p_spent_usd numeric DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_updated integer := 0; v_status text;
BEGIN
  v_status := CASE WHEN p_status IN ('running','completed','failed','cancelled','promotable','rolled_back') THEN p_status ELSE 'failed' END;
  UPDATE public.ralph_runs SET status = v_status,
    ended_at = CASE WHEN v_status = 'running' THEN ended_at ELSE now() END,
    summary = CASE WHEN p_summary IS NULL THEN summary ELSE COALESCE(summary,'{}'::jsonb) || p_summary END,
    error_message = COALESCE(p_error_message, error_message),
    spent_tokens = COALESCE(p_spent_tokens, spent_tokens),
    spent_usd = COALESCE(p_spent_usd, spent_usd), updated_at = now()
  WHERE id = p_run_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN jsonb_build_object('run_id', p_run_id, 'status', v_status, 'updated', v_updated);
END; $$;

CREATE OR REPLACE FUNCTION public.record_ralph_action(
  p_run_id uuid, p_step_index integer DEFAULT 0, p_phase text DEFAULT 'execute',
  p_tool_name text DEFAULT NULL, p_target text DEFAULT NULL, p_status text DEFAULT 'ok',
  p_latency_ms integer DEFAULT 0, p_details jsonb DEFAULT '{}'::jsonb
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id bigint; v_status text;
BEGIN
  v_status := CASE WHEN p_status IN ('ok','warn','error','skipped') THEN p_status ELSE 'error' END;
  INSERT INTO public.ralph_actions (run_id, step_index, phase, tool_name, target, status, latency_ms, details)
  VALUES (p_run_id, GREATEST(COALESCE(p_step_index,0),0), COALESCE(p_phase,'execute'), p_tool_name, p_target, v_status, GREATEST(COALESCE(p_latency_ms,0),0), COALESCE(p_details,'{}'::jsonb))
  RETURNING id INTO v_id;
  UPDATE public.ralph_runs SET updated_at = now() WHERE id = p_run_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.record_ralph_eval(
  p_run_id uuid, p_suite text, p_metric text, p_value numeric, p_threshold numeric,
  p_pass boolean, p_details jsonb DEFAULT '{}'::jsonb
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO public.ralph_eval_results (run_id, suite, metric, value, threshold, pass, details)
  VALUES (p_run_id, COALESCE(NULLIF(p_suite,''),'default'), COALESCE(NULLIF(p_metric,''),'unknown_metric'),
    p_value, p_threshold, COALESCE(p_pass,false), COALESCE(p_details,'{}'::jsonb))
  RETURNING id INTO v_id;
  UPDATE public.ralph_runs SET updated_at = now() WHERE id = p_run_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.raise_ralph_incident(
  p_run_id uuid DEFAULT NULL, p_severity text DEFAULT 'warn', p_incident_type text DEFAULT 'generic',
  p_message text DEFAULT 'incident', p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id bigint; v_severity text;
BEGIN
  v_severity := CASE WHEN p_severity IN ('info','warn','error','critical') THEN p_severity ELSE 'warn' END;
  INSERT INTO public.ralph_incidents (run_id, severity, incident_type, message, metadata)
  VALUES (p_run_id, v_severity, COALESCE(NULLIF(p_incident_type,''),'generic'), COALESCE(NULLIF(p_message,''),'incident'), COALESCE(p_metadata,'{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.resolve_ralph_incident(p_incident_id bigint, p_resolution_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_updated integer := 0;
BEGIN
  UPDATE public.ralph_incidents SET resolved = true, resolved_at = now(), resolution_note = COALESCE(p_resolution_note, resolution_note) WHERE id = p_incident_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN jsonb_build_object('incident_id', p_incident_id, 'updated', v_updated);
END; $$;

CREATE OR REPLACE FUNCTION public.get_ralph_health(p_hours integer DEFAULT 24)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH w AS (
    SELECT * FROM public.ralph_runs WHERE started_at >= now() - make_interval(hours => GREATEST(COALESCE(p_hours,24),1))
  ), durations AS (
    SELECT EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000 AS ms FROM w WHERE ended_at IS NOT NULL
  )
  SELECT jsonb_build_object(
    'hours_window', GREATEST(COALESCE(p_hours,24),1),
    'runs_total', COALESCE((SELECT COUNT(*) FROM w),0),
    'runs_running', COALESCE((SELECT COUNT(*) FROM public.ralph_runs WHERE status='running'),0),
    'runs_success', COALESCE((SELECT COUNT(*) FROM w WHERE status IN ('completed','promotable')),0),
    'runs_failed', COALESCE((SELECT COUNT(*) FROM w WHERE status IN ('failed','rolled_back')),0),
    'runs_cancelled', COALESCE((SELECT COUNT(*) FROM w WHERE status='cancelled'),0),
    'success_rate_pct', (SELECT CASE WHEN COUNT(*)>0 THEN ROUND((COUNT(*) FILTER (WHERE status IN ('completed','promotable'))::numeric*100.0/COUNT(*)),2) ELSE 0 END FROM w),
    'avg_duration_ms', (SELECT ROUND(AVG(ms))::int FROM durations),
    'p95_duration_ms', (SELECT ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY ms))::int FROM durations),
    'open_incidents', (SELECT COUNT(*)::int FROM public.ralph_incidents WHERE resolved=false),
    'critical_open_incidents', (SELECT COUNT(*)::int FROM public.ralph_incidents WHERE resolved=false AND severity='critical'),
    'last_run_at', (SELECT MAX(started_at) FROM public.ralph_runs)
  );
$$;

-- Grants
GRANT EXECUTE ON FUNCTION public.start_ralph_run(text, uuid, text[], integer, integer, numeric, bigint, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finish_ralph_run(uuid, text, jsonb, text, bigint, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_ralph_action(uuid, integer, text, text, text, text, integer, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_ralph_eval(uuid, text, text, numeric, numeric, boolean, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.raise_ralph_incident(uuid, text, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_ralph_incident(bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_ralph_health(integer) TO authenticated, service_role;
