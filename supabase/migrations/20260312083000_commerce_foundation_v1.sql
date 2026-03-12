-- Commerce foundation v1 (plans, credits, billing, entitlements)

-- Source of truth: transactional App domain.
-- Safe rollout: additive tables/functions, feature flags in commerce_config.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._commerce_require_service_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := COALESCE(auth.jwt() ->> 'role', current_setting('request.jwt.claim.role', true));
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' AND current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._commerce_require_service_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._commerce_require_service_role() TO service_role;

CREATE OR REPLACE FUNCTION public._commerce_cfg_int(p_key text, p_default int)
RETURNS int
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw text;
BEGIN
  BEGIN
    EXECUTE 'SELECT value_json ->> ''value'' FROM public.commerce_config WHERE config_key = $1'
      INTO v_raw
      USING p_key;
  EXCEPTION WHEN undefined_table THEN
    RETURN p_default;
  END;

  IF v_raw IS NULL OR trim(v_raw) = '' THEN
    RETURN p_default;
  END IF;
  RETURN v_raw::int;
EXCEPTION WHEN others THEN
  RETURN p_default;
END;
$$;

CREATE OR REPLACE FUNCTION public._commerce_cfg_bool(p_key text, p_default boolean)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw text;
BEGIN
  BEGIN
    EXECUTE 'SELECT value_json ->> ''value'' FROM public.commerce_config WHERE config_key = $1'
      INTO v_raw
      USING p_key;
  EXCEPTION WHEN undefined_table THEN
    RETURN p_default;
  END;

  IF v_raw IS NULL OR trim(v_raw) = '' THEN
    RETURN p_default;
  END IF;
  RETURN v_raw::boolean;
EXCEPTION WHEN others THEN
  RETURN p_default;
END;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.commerce_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_type text NOT NULL DEFAULT 'free' CHECK (plan_type IN ('free', 'pro')),
  access_state text NOT NULL DEFAULT 'free_active' CHECK (
    access_state IN (
      'free_active',
      'pro_active',
      'pro_past_due',
      'pro_cancel_at_period_end',
      'pro_expired',
      'suspended',
      'blocked_abuse_review',
      'blocked_insufficient_credits',
      'allowed'
    )
  ),
  free_eligible boolean NOT NULL DEFAULT true,
  anti_abuse_review_required boolean NOT NULL DEFAULT false,
  anti_abuse_reason text NULL,
  device_fingerprint_hash text NULL,
  last_computed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.commerce_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'stripe',
  provider_customer_id text NULL,
  provider_subscription_id text NULL UNIQUE,
  status text NOT NULL DEFAULT 'inactive' CHECK (
    status IN ('inactive', 'active', 'past_due', 'cancel_at_period_end', 'expired', 'canceled')
  ),
  current_period_start timestamptz NULL,
  current_period_end timestamptz NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  canceled_at timestamptz NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.commerce_billing_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id uuid NULL REFERENCES public.commerce_subscriptions(id) ON DELETE SET NULL,
  cycle_start timestamptz NOT NULL,
  cycle_end timestamptz NOT NULL,
  plan_type text NOT NULL CHECK (plan_type IN ('free', 'pro')),
  base_credits int NOT NULL DEFAULT 0 CHECK (base_credits >= 0),
  rollover_credits int NOT NULL DEFAULT 0 CHECK (rollover_credits >= 0),
  monthly_plan_credits int NOT NULL DEFAULT 0 CHECK (monthly_plan_credits >= 0),
  weekly_target int NOT NULL DEFAULT 0 CHECK (weekly_target >= 0),
  rollover_cap int NOT NULL DEFAULT 0 CHECK (rollover_cap >= 0),
  free_monthly_grant int NOT NULL DEFAULT 0 CHECK (free_monthly_grant >= 0),
  consumed_plan_credits int NOT NULL DEFAULT 0 CHECK (consumed_plan_credits >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, cycle_start)
);

CREATE TABLE IF NOT EXISTS public.commerce_wallets (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  current_cycle_id uuid NULL REFERENCES public.commerce_billing_cycles(id) ON DELETE SET NULL,
  weekly_wallet int NOT NULL DEFAULT 0 CHECK (weekly_wallet >= 0),
  monthly_plan_remaining int NOT NULL DEFAULT 0 CHECK (monthly_plan_remaining >= 0),
  extra_wallet int NOT NULL DEFAULT 0 CHECK (extra_wallet >= 0),
  free_monthly_remaining int NOT NULL DEFAULT 0 CHECK (free_monthly_remaining >= 0),
  wallet_version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commerce_weekly_le_monthly CHECK (weekly_wallet <= monthly_plan_remaining)
);

CREATE TABLE IF NOT EXISTS public.commerce_ledger (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cycle_id uuid NULL REFERENCES public.commerce_billing_cycles(id) ON DELETE SET NULL,
  wallet_type text NOT NULL CHECK (
    wallet_type IN ('weekly_wallet', 'monthly_plan', 'extra_wallet', 'free_monthly')
  ),
  entry_type text NOT NULL CHECK (
    entry_type IN (
      'cycle_base_grant',
      'cycle_rollover_grant',
      'weekly_release_grant',
      'tool_usage_debit',
      'pack_purchase_grant',
      'admin_manual_grant',
      'admin_manual_debit',
      'refund_credit',
      'reversal_credit',
      'expiration_debit',
      'free_monthly_grant'
    )
  ),
  tool_code text NULL CHECK (
    tool_code IS NULL OR tool_code IN (
      'surprise_gen',
      'edit_studio',
      'camera_control',
      'layer_decomposition',
      'psd_to_umg',
      'umg_to_verse'
    )
  ),
  delta int NOT NULL,
  operation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  reference_id text NULL,
  idempotency_key text NULL,
  reason text NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid NULL,
  actor_role text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.commerce_tool_usage_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  idempotency_key text NOT NULL,
  tool_code text NOT NULL CHECK (
    tool_code IN (
      'surprise_gen',
      'edit_studio',
      'camera_control',
      'layer_decomposition',
      'psd_to_umg',
      'umg_to_verse'
    )
  ),
  status text NOT NULL CHECK (status IN ('blocked', 'debited', 'dispatched', 'success', 'failed', 'reversed')),
  credits_required int NOT NULL DEFAULT 0 CHECK (credits_required >= 0),
  debit_source text NULL CHECK (debit_source IN ('weekly_wallet', 'free_monthly', 'extra_wallet', 'mixed')),
  operation_id uuid NULL,
  upstream_function text NULL,
  upstream_status int NULL,
  error_code text NULL,
  error_message text NULL,
  payload_hash text NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id),
  UNIQUE (idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.commerce_pack_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pack_code text NOT NULL,
  credits int NOT NULL CHECK (credits > 0),
  provider text NOT NULL DEFAULT 'stripe',
  provider_checkout_session_id text NULL UNIQUE,
  provider_payment_intent_id text NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  granted_operation_id uuid NULL,
  expires_at timestamptz NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.commerce_abuse_signals (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signal_type text NOT NULL,
  signal_value text NULL,
  risk_score numeric(6,4) NULL,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'reviewed', 'ignored', 'confirmed')),
  note text NULL,
  reviewed_by uuid NULL,
  reviewed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.commerce_config (
  config_key text PRIMARY KEY,
  value_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.commerce_webhook_events (
  id bigserial PRIMARY KEY,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'failed', 'ignored')),
  error_text text NULL,
  processed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_event_id)
);

CREATE TABLE IF NOT EXISTS public.commerce_events (
  id bigserial PRIMARY KEY,
  user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  event_name text NOT NULL,
  operation_id uuid NULL,
  reference_id text NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Operational guardrails for index creation in shared environments.
-- Fail fast on lock contention instead of stalling DDL for long periods.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE INDEX IF NOT EXISTS commerce_accounts_state_idx
  ON public.commerce_accounts(access_state, plan_type);
CREATE INDEX IF NOT EXISTS commerce_subscriptions_status_idx
  ON public.commerce_subscriptions(status, current_period_end DESC);
CREATE INDEX IF NOT EXISTS commerce_billing_cycles_user_time_idx
  ON public.commerce_billing_cycles(user_id, cycle_start DESC);
CREATE INDEX IF NOT EXISTS commerce_ledger_user_created_idx
  ON public.commerce_ledger(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS commerce_ledger_operation_idx
  ON public.commerce_ledger(operation_id);
CREATE UNIQUE INDEX IF NOT EXISTS commerce_ledger_idempotency_uidx
  ON public.commerce_ledger(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS commerce_usage_attempts_user_created_idx
  ON public.commerce_tool_usage_attempts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS commerce_pack_purchases_user_created_idx
  ON public.commerce_pack_purchases(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS commerce_abuse_signals_user_created_idx
  ON public.commerce_abuse_signals(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS commerce_webhook_events_created_idx
  ON public.commerce_webhook_events(created_at DESC);
CREATE INDEX IF NOT EXISTS commerce_events_user_created_idx
  ON public.commerce_events(user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Updated_at triggers
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS commerce_accounts_updated_at_trg ON public.commerce_accounts;
CREATE TRIGGER commerce_accounts_updated_at_trg
  BEFORE UPDATE ON public.commerce_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS commerce_subscriptions_updated_at_trg ON public.commerce_subscriptions;
CREATE TRIGGER commerce_subscriptions_updated_at_trg
  BEFORE UPDATE ON public.commerce_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS commerce_billing_cycles_updated_at_trg ON public.commerce_billing_cycles;
CREATE TRIGGER commerce_billing_cycles_updated_at_trg
  BEFORE UPDATE ON public.commerce_billing_cycles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS commerce_tool_usage_attempts_updated_at_trg ON public.commerce_tool_usage_attempts;
CREATE TRIGGER commerce_tool_usage_attempts_updated_at_trg
  BEFORE UPDATE ON public.commerce_tool_usage_attempts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS commerce_pack_purchases_updated_at_trg ON public.commerce_pack_purchases;
CREATE TRIGGER commerce_pack_purchases_updated_at_trg
  BEFORE UPDATE ON public.commerce_pack_purchases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS commerce_config_updated_at_trg ON public.commerce_config;
CREATE TRIGGER commerce_config_updated_at_trg
  BEFORE UPDATE ON public.commerce_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Default config
-- ---------------------------------------------------------------------------

INSERT INTO public.commerce_config(config_key, value_json)
VALUES
  ('enable_weekly_wallet', '{"value": true}'::jsonb),
  ('enable_rollover', '{"value": true}'::jsonb),
  ('enable_credit_packs', '{"value": true}'::jsonb),
  ('enable_pack_expiration', '{"value": false}'::jsonb),
  ('grace_period_days', '{"value": 7}'::jsonb),
  ('free_monthly_credits', '{"value": 80}'::jsonb),
  ('pro_monthly_credits', '{"value": 800}'::jsonb),
  ('pro_weekly_target', '{"value": 200}'::jsonb),
  ('pro_rollover_cap', '{"value": 1200}'::jsonb),
  ('pack_small_credits', '{"value": 250}'::jsonb),
  ('pack_medium_credits', '{"value": 650}'::jsonb),
  ('pack_large_credits', '{"value": 1400}'::jsonb),
  ('tool_cost_surprise_gen', '{"value": 15}'::jsonb),
  ('tool_cost_edit_studio', '{"value": 4}'::jsonb),
  ('tool_cost_camera_control', '{"value": 3}'::jsonb),
  ('tool_cost_layer_decomposition', '{"value": 8}'::jsonb),
  ('tool_cost_psd_to_umg', '{"value": 2}'::jsonb),
  ('tool_cost_umg_to_verse', '{"value": 2}'::jsonb)
ON CONFLICT (config_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.commerce_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_billing_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_tool_usage_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_pack_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_abuse_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_events ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  user_visible text[] := ARRAY[
    'commerce_accounts',
    'commerce_subscriptions',
    'commerce_billing_cycles',
    'commerce_wallets',
    'commerce_ledger',
    'commerce_tool_usage_attempts',
    'commerce_pack_purchases'
  ];
  admin_only text[] := ARRAY[
    'commerce_abuse_signals',
    'commerce_config',
    'commerce_webhook_events',
    'commerce_events'
  ];
BEGIN
  FOREACH t IN ARRAY user_visible LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_service_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO public USING ((auth.jwt() ->> ''role'') = ''service_role'') WITH CHECK ((auth.jwt() ->> ''role'') = ''service_role'')',
      t || '_service_all', t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_user_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (user_id = auth.uid())',
      t || '_user_select', t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_admin_or_editor())',
      t || '_admin_select', t
    );
  END LOOP;

  FOREACH t IN ARRAY admin_only LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_service_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO public USING ((auth.jwt() ->> ''role'') = ''service_role'') WITH CHECK ((auth.jwt() ->> ''role'') = ''service_role'')',
      t || '_service_all', t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_admin_or_editor())',
      t || '_admin_select', t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Core functions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.commerce_insert_ledger(
  p_user_id uuid,
  p_cycle_id uuid,
  p_wallet_type text,
  p_entry_type text,
  p_delta int,
  p_tool_code text DEFAULT NULL,
  p_operation_id uuid DEFAULT gen_random_uuid(),
  p_reference_id text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_metadata_json jsonb DEFAULT '{}'::jsonb,
  p_actor_user_id uuid DEFAULT NULL,
  p_actor_role text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT l.id INTO v_id
    FROM public.commerce_ledger l
    WHERE l.idempotency_key = p_idempotency_key
    LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
  END IF;

  INSERT INTO public.commerce_ledger(
    user_id, cycle_id, wallet_type, entry_type, delta, tool_code, operation_id,
    reference_id, idempotency_key, reason, metadata_json, actor_user_id, actor_role
  )
  VALUES (
    p_user_id, p_cycle_id, p_wallet_type, p_entry_type, p_delta, p_tool_code, p_operation_id,
    p_reference_id, p_idempotency_key, p_reason, COALESCE(p_metadata_json, '{}'::jsonb), p_actor_user_id, p_actor_role
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_insert_ledger(uuid,uuid,text,text,int,text,uuid,text,text,text,jsonb,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_insert_ledger(uuid,uuid,text,text,int,text,uuid,text,text,text,jsonb,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.commerce_ensure_account(
  p_user_id uuid,
  p_device_fingerprint_hash text DEFAULT NULL
)
RETURNS public.commerce_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.commerce_accounts;
BEGIN
  INSERT INTO public.commerce_accounts (user_id, device_fingerprint_hash)
  VALUES (p_user_id, NULLIF(trim(COALESCE(p_device_fingerprint_hash, '')), ''))
  ON CONFLICT (user_id) DO UPDATE
    SET device_fingerprint_hash = COALESCE(
      NULLIF(trim(EXCLUDED.device_fingerprint_hash), ''),
      public.commerce_accounts.device_fingerprint_hash
    ),
    updated_at = now()
  RETURNING * INTO v_row;

  INSERT INTO public.commerce_wallets (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_ensure_account(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_ensure_account(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.commerce_get_tool_cost(p_tool_code text)
RETURNS int
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  v_key := CASE p_tool_code
    WHEN 'surprise_gen' THEN 'tool_cost_surprise_gen'
    WHEN 'edit_studio' THEN 'tool_cost_edit_studio'
    WHEN 'camera_control' THEN 'tool_cost_camera_control'
    WHEN 'layer_decomposition' THEN 'tool_cost_layer_decomposition'
    WHEN 'psd_to_umg' THEN 'tool_cost_psd_to_umg'
    WHEN 'umg_to_verse' THEN 'tool_cost_umg_to_verse'
    ELSE NULL
  END;

  IF v_key IS NULL THEN
    RAISE EXCEPTION 'unknown_tool_code';
  END IF;

  RETURN public._commerce_cfg_int(v_key, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_get_tool_cost(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_get_tool_cost(text) TO service_role;

CREATE OR REPLACE FUNCTION public.commerce_open_cycle_if_needed(
  p_user_id uuid,
  p_now timestamptz DEFAULT now(),
  p_idempotency_prefix text DEFAULT 'cycle_open'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account public.commerce_accounts;
  v_cycle public.commerce_billing_cycles;
  v_cycle_start timestamptz := date_trunc('month', COALESCE(p_now, now()));
  v_cycle_end timestamptz := (date_trunc('month', COALESCE(p_now, now())) + interval '1 month');
  v_prev public.commerce_billing_cycles;
  v_base int := 0;
  v_rollover_cap int := 0;
  v_weekly_target int := 0;
  v_rollover int := 0;
  v_monthly int := 0;
  v_free_grant int := 0;
  v_operation_id uuid := gen_random_uuid();
  v_key_prefix text;
BEGIN
  v_account := public.commerce_ensure_account(p_user_id, NULL);

  SELECT *
  INTO v_cycle
  FROM public.commerce_billing_cycles c
  WHERE c.user_id = p_user_id
    AND c.cycle_start <= p_now
    AND c.cycle_end > p_now
    AND c.status = 'open'
  ORDER BY c.cycle_start DESC
  LIMIT 1;

  IF v_cycle.id IS NOT NULL THEN
    UPDATE public.commerce_wallets
    SET current_cycle_id = v_cycle.id,
      updated_at = now()
    WHERE user_id = p_user_id
      AND (current_cycle_id IS DISTINCT FROM v_cycle.id);
    RETURN v_cycle.id;
  END IF;

  SELECT *
  INTO v_cycle
  FROM public.commerce_billing_cycles c
  WHERE c.user_id = p_user_id
    AND c.cycle_start = v_cycle_start
  LIMIT 1;

  IF v_cycle.id IS NULL THEN
    IF v_account.plan_type = 'pro' THEN
      v_base := public._commerce_cfg_int('pro_monthly_credits', 800);
      v_rollover_cap := public._commerce_cfg_int('pro_rollover_cap', 1200);
      v_weekly_target := public._commerce_cfg_int('pro_weekly_target', 200);

      SELECT *
      INTO v_prev
      FROM public.commerce_billing_cycles c
      WHERE c.user_id = p_user_id
        AND c.cycle_end <= v_cycle_start
      ORDER BY c.cycle_end DESC
      LIMIT 1;

      IF public._commerce_cfg_bool('enable_rollover', true) AND v_prev.id IS NOT NULL THEN
        v_rollover := GREATEST(v_prev.monthly_plan_credits - v_prev.consumed_plan_credits, 0);
      ELSE
        v_rollover := 0;
      END IF;
      v_monthly := LEAST(v_rollover_cap, v_base + v_rollover);
    ELSE
      v_base := 0;
      v_rollover := 0;
      v_monthly := 0;
      v_weekly_target := 0;
      v_rollover_cap := 0;
      IF v_account.free_eligible AND NOT v_account.anti_abuse_review_required AND v_account.access_state <> 'blocked_abuse_review' THEN
        v_free_grant := public._commerce_cfg_int('free_monthly_credits', 80);
      ELSE
        v_free_grant := 0;
      END IF;
    END IF;

    INSERT INTO public.commerce_billing_cycles(
      user_id, subscription_id, cycle_start, cycle_end, plan_type, base_credits,
      rollover_credits, monthly_plan_credits, weekly_target, rollover_cap, free_monthly_grant, status
    )
    VALUES (
      p_user_id, NULL, v_cycle_start, v_cycle_end, v_account.plan_type, v_base,
      v_rollover, v_monthly, v_weekly_target, v_rollover_cap, v_free_grant, 'open'
    )
    RETURNING * INTO v_cycle;
  END IF;

  IF v_cycle.plan_type = 'pro' THEN
    UPDATE public.commerce_wallets
    SET
      current_cycle_id = v_cycle.id,
      monthly_plan_remaining = v_cycle.monthly_plan_credits,
      weekly_wallet = LEAST(v_cycle.weekly_target, v_cycle.monthly_plan_credits),
      free_monthly_remaining = 0,
      updated_at = now()
    WHERE user_id = p_user_id;
  ELSE
    UPDATE public.commerce_wallets
    SET
      current_cycle_id = v_cycle.id,
      monthly_plan_remaining = 0,
      weekly_wallet = 0,
      free_monthly_remaining = v_cycle.free_monthly_grant,
      updated_at = now()
    WHERE user_id = p_user_id;
  END IF;

  v_key_prefix := format('%s:%s:%s', p_idempotency_prefix, p_user_id::text, to_char(v_cycle_start, 'YYYYMMDD'));

  IF v_cycle.plan_type = 'pro' THEN
    PERFORM public.commerce_insert_ledger(
      p_user_id, v_cycle.id, 'monthly_plan', 'cycle_base_grant', v_cycle.base_credits, NULL,
      v_operation_id, v_cycle.id::text, v_key_prefix || ':base', 'cycle_base_grant', '{}'::jsonb, NULL, 'system'
    );

    IF v_cycle.rollover_credits > 0 THEN
      PERFORM public.commerce_insert_ledger(
        p_user_id, v_cycle.id, 'monthly_plan', 'cycle_rollover_grant', v_cycle.rollover_credits, NULL,
        v_operation_id, v_cycle.id::text, v_key_prefix || ':rollover', 'cycle_rollover_grant', '{}'::jsonb, NULL, 'system'
      );
    END IF;

    IF LEAST(v_cycle.weekly_target, v_cycle.monthly_plan_credits) > 0 THEN
      PERFORM public.commerce_insert_ledger(
        p_user_id, v_cycle.id, 'weekly_wallet', 'weekly_release_grant', LEAST(v_cycle.weekly_target, v_cycle.monthly_plan_credits), NULL,
        v_operation_id, v_cycle.id::text, v_key_prefix || ':weekly0', 'initial_weekly_release', '{}'::jsonb, NULL, 'system'
      );
    END IF;
  ELSE
    IF v_cycle.free_monthly_grant > 0 THEN
      PERFORM public.commerce_insert_ledger(
        p_user_id, v_cycle.id, 'free_monthly', 'free_monthly_grant', v_cycle.free_monthly_grant, NULL,
        v_operation_id, v_cycle.id::text, v_key_prefix || ':free', 'free_monthly_grant', '{}'::jsonb, NULL, 'system'
      );
    END IF;
  END IF;

  RETURN v_cycle.id;
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_open_cycle_if_needed(uuid,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_open_cycle_if_needed(uuid,timestamptz,text) TO service_role;

CREATE OR REPLACE FUNCTION public.commerce_compute_access_state(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account public.commerce_accounts;
  v_sub public.commerce_subscriptions;
  v_wallet public.commerce_wallets;
  v_now timestamptz := now();
  v_state text;
  v_available int := 0;
BEGIN
  SELECT * INTO v_account FROM public.commerce_accounts WHERE user_id = p_user_id;
  IF v_account.user_id IS NULL THEN
    RETURN 'free_active';
  END IF;

  IF v_account.anti_abuse_review_required OR v_account.access_state = 'blocked_abuse_review' THEN
    RETURN 'blocked_abuse_review';
  END IF;
  IF v_account.access_state = 'suspended' THEN
    RETURN 'suspended';
  END IF;

  SELECT * INTO v_wallet FROM public.commerce_wallets WHERE user_id = p_user_id;
  v_available := COALESCE(v_wallet.weekly_wallet, 0) + COALESCE(v_wallet.free_monthly_remaining, 0) + COALESCE(v_wallet.extra_wallet, 0);

  SELECT *
  INTO v_sub
  FROM public.commerce_subscriptions s
  WHERE s.user_id = p_user_id
  LIMIT 1;

  IF v_account.plan_type = 'pro' THEN
    IF v_sub.id IS NOT NULL THEN
      IF v_sub.status = 'past_due' THEN
        v_state := 'pro_past_due';
      ELSIF v_sub.status = 'cancel_at_period_end' OR v_sub.cancel_at_period_end THEN
        v_state := 'pro_cancel_at_period_end';
      ELSIF v_sub.status IN ('expired', 'canceled') OR (v_sub.current_period_end IS NOT NULL AND v_sub.current_period_end <= v_now) THEN
        v_state := 'pro_expired';
      ELSE
        v_state := 'pro_active';
      END IF;
    ELSE
      v_state := 'pro_active';
    END IF;
  ELSE
    v_state := 'free_active';
  END IF;

  IF v_available <= 0 THEN
    RETURN 'blocked_insufficient_credits';
  END IF;
  RETURN v_state;
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_compute_access_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_compute_access_state(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.commerce_sync_access_state(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state text;
BEGIN
  v_state := public.commerce_compute_access_state(p_user_id);
  UPDATE public.commerce_accounts
  SET access_state = v_state,
    last_computed_at = now(),
    updated_at = now()
  WHERE user_id = p_user_id;
  RETURN v_state;
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_sync_access_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_sync_access_state(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.commerce_debit_tool_credits(
  p_user_id uuid,
  p_tool_code text,
  p_request_id text,
  p_idempotency_key text,
  p_payload_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cost int;
  v_cycle_id uuid;
  v_wallet public.commerce_wallets;
  v_attempt public.commerce_tool_usage_attempts;
  v_operation_id uuid := gen_random_uuid();
  v_weekly int := 0;
  v_free int := 0;
  v_extra int := 0;
  v_left int;
  v_source text := 'mixed';
  v_now timestamptz := now();
BEGIN
  PERFORM public.commerce_ensure_account(p_user_id, NULL);
  v_cycle_id := public.commerce_open_cycle_if_needed(p_user_id, v_now, 'cycle_open');

  SELECT *
  INTO v_attempt
  FROM public.commerce_tool_usage_attempts
  WHERE idempotency_key = p_idempotency_key
  LIMIT 1;

  IF v_attempt.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', v_attempt.status <> 'blocked',
      'status', v_attempt.status,
      'operation_id', v_attempt.operation_id,
      'error_code', v_attempt.error_code,
      'error_message', v_attempt.error_message
    );
  END IF;

  v_cost := public.commerce_get_tool_cost(p_tool_code);

  SELECT *
  INTO v_wallet
  FROM public.commerce_wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_wallet.user_id IS NULL THEN
    INSERT INTO public.commerce_wallets(user_id) VALUES (p_user_id) RETURNING * INTO v_wallet;
  END IF;

  IF (COALESCE(v_wallet.weekly_wallet, 0) + COALESCE(v_wallet.free_monthly_remaining, 0) + COALESCE(v_wallet.extra_wallet, 0)) < v_cost THEN
    INSERT INTO public.commerce_tool_usage_attempts(
      user_id, request_id, idempotency_key, tool_code, status, credits_required,
      error_code, error_message, payload_hash
    )
    VALUES (
      p_user_id, p_request_id, p_idempotency_key, p_tool_code, 'blocked', v_cost,
      'INSUFFICIENT_CREDITS', 'Not enough credits', p_payload_hash
    );

    INSERT INTO public.commerce_events(user_id, event_name, reference_id, payload_json)
    VALUES (
      p_user_id,
      'insufficient_credits_blocked',
      p_request_id,
      jsonb_build_object(
        'tool_code', p_tool_code,
        'credits_required', v_cost,
        'weekly_wallet_available', v_wallet.weekly_wallet,
        'free_monthly_available', v_wallet.free_monthly_remaining,
        'extra_wallet_available', v_wallet.extra_wallet
      )
    );

    PERFORM public.commerce_sync_access_state(p_user_id);

    RETURN jsonb_build_object(
      'success', false,
      'status', 'blocked',
      'error_code', 'INSUFFICIENT_CREDITS',
      'credits_required', v_cost,
      'weekly_wallet_available', v_wallet.weekly_wallet,
      'free_monthly_available', v_wallet.free_monthly_remaining,
      'extra_wallet_available', v_wallet.extra_wallet
    );
  END IF;

  v_left := v_cost;
  v_weekly := LEAST(v_wallet.weekly_wallet, v_left);
  v_left := v_left - v_weekly;
  v_free := LEAST(v_wallet.free_monthly_remaining, v_left);
  v_left := v_left - v_free;
  v_extra := LEAST(v_wallet.extra_wallet, v_left);

  IF v_weekly > 0 AND v_free = 0 AND v_extra = 0 THEN
    v_source := 'weekly_wallet';
  ELSIF v_weekly = 0 AND v_free > 0 AND v_extra = 0 THEN
    v_source := 'free_monthly';
  ELSIF v_weekly = 0 AND v_free = 0 AND v_extra > 0 THEN
    v_source := 'extra_wallet';
  ELSE
    v_source := 'mixed';
  END IF;

  UPDATE public.commerce_wallets
  SET
    weekly_wallet = weekly_wallet - v_weekly,
    free_monthly_remaining = free_monthly_remaining - v_free,
    extra_wallet = extra_wallet - v_extra,
    monthly_plan_remaining = monthly_plan_remaining - v_weekly,
    wallet_version = wallet_version + 1,
    updated_at = now()
  WHERE user_id = p_user_id;

  UPDATE public.commerce_billing_cycles
  SET consumed_plan_credits = consumed_plan_credits + v_weekly,
    updated_at = now()
  WHERE id = v_cycle_id;

  IF v_weekly > 0 THEN
    PERFORM public.commerce_insert_ledger(
      p_user_id, v_cycle_id, 'weekly_wallet', 'tool_usage_debit', -v_weekly, p_tool_code,
      v_operation_id, p_request_id, p_idempotency_key || ':weekly', 'tool_usage_debit', '{}'::jsonb, p_user_id, 'user'
    );
    PERFORM public.commerce_insert_ledger(
      p_user_id, v_cycle_id, 'monthly_plan', 'tool_usage_debit', -v_weekly, p_tool_code,
      v_operation_id, p_request_id, p_idempotency_key || ':monthly', 'tool_usage_debit', '{}'::jsonb, p_user_id, 'user'
    );
  END IF;

  IF v_free > 0 THEN
    PERFORM public.commerce_insert_ledger(
      p_user_id, v_cycle_id, 'free_monthly', 'tool_usage_debit', -v_free, p_tool_code,
      v_operation_id, p_request_id, p_idempotency_key || ':free', 'tool_usage_debit', '{}'::jsonb, p_user_id, 'user'
    );
  END IF;

  IF v_extra > 0 THEN
    PERFORM public.commerce_insert_ledger(
      p_user_id, v_cycle_id, 'extra_wallet', 'tool_usage_debit', -v_extra, p_tool_code,
      v_operation_id, p_request_id, p_idempotency_key || ':extra', 'tool_usage_debit', '{}'::jsonb, p_user_id, 'user'
    );
  END IF;

  INSERT INTO public.commerce_tool_usage_attempts(
    user_id, request_id, idempotency_key, tool_code, status, credits_required,
    debit_source, operation_id, payload_hash
  )
  VALUES (
    p_user_id, p_request_id, p_idempotency_key, p_tool_code, 'debited', v_cost,
    v_source, v_operation_id, p_payload_hash
  );

  INSERT INTO public.commerce_events(user_id, event_name, operation_id, reference_id, payload_json)
  VALUES (
    p_user_id,
    'credits_debited',
    v_operation_id,
    p_request_id,
    jsonb_build_object(
      'tool_code', p_tool_code,
      'credits', v_cost,
      'debit_source', v_source,
      'weekly_debited', v_weekly,
      'free_monthly_debited', v_free,
      'extra_debited', v_extra
    )
  );

  PERFORM public.commerce_sync_access_state(p_user_id);

  SELECT * INTO v_wallet FROM public.commerce_wallets WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'debited',
    'operation_id', v_operation_id,
    'credit_cost', v_cost,
    'debit_source', v_source,
    'remaining_weekly_available', v_wallet.weekly_wallet,
    'remaining_free_monthly_available', v_wallet.free_monthly_remaining,
    'remaining_extra_wallet', v_wallet.extra_wallet
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_debit_tool_credits(uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_debit_tool_credits(uuid,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.commerce_mark_usage_attempt_result(
  p_idempotency_key text,
  p_status text,
  p_upstream_function text DEFAULT NULL,
  p_upstream_status int DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_error_message text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.commerce_tool_usage_attempts
  SET status = p_status,
    upstream_function = COALESCE(p_upstream_function, upstream_function),
    upstream_status = COALESCE(p_upstream_status, upstream_status),
    error_code = COALESCE(p_error_code, error_code),
    error_message = COALESCE(p_error_message, error_message),
    updated_at = now()
  WHERE idempotency_key = p_idempotency_key;
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_mark_usage_attempt_result(text,text,text,int,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_mark_usage_attempt_result(text,text,text,int,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.commerce_reverse_operation(
  p_user_id uuid,
  p_operation_id uuid,
  p_idempotency_key text,
  p_reason text DEFAULT 'automatic_reversal',
  p_actor_user_id uuid DEFAULT NULL,
  p_actor_role text DEFAULT 'system'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing bigint;
  v_row record;
  v_wallet public.commerce_wallets;
BEGIN
  SELECT id INTO v_existing
  FROM public.commerce_ledger
  WHERE idempotency_key = p_idempotency_key
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    SELECT * INTO v_wallet FROM public.commerce_wallets WHERE user_id = p_user_id;
    RETURN jsonb_build_object(
      'success', true,
      'status', 'already_reversed',
      'remaining_weekly_available', v_wallet.weekly_wallet,
      'remaining_free_monthly_available', v_wallet.free_monthly_remaining,
      'remaining_extra_wallet', v_wallet.extra_wallet
    );
  END IF;

  FOR v_row IN
    SELECT l.id, l.cycle_id, l.wallet_type, l.delta
    FROM public.commerce_ledger l
    WHERE l.user_id = p_user_id
      AND l.operation_id = p_operation_id
      AND l.entry_type = 'tool_usage_debit'
      AND l.delta < 0
    ORDER BY l.id
  LOOP
    IF v_row.wallet_type = 'weekly_wallet' THEN
      UPDATE public.commerce_wallets
      SET weekly_wallet = weekly_wallet + ABS(v_row.delta),
        wallet_version = wallet_version + 1,
        updated_at = now()
      WHERE user_id = p_user_id;
    ELSIF v_row.wallet_type = 'free_monthly' THEN
      UPDATE public.commerce_wallets
      SET free_monthly_remaining = free_monthly_remaining + ABS(v_row.delta),
        wallet_version = wallet_version + 1,
        updated_at = now()
      WHERE user_id = p_user_id;
    ELSIF v_row.wallet_type = 'extra_wallet' THEN
      UPDATE public.commerce_wallets
      SET extra_wallet = extra_wallet + ABS(v_row.delta),
        wallet_version = wallet_version + 1,
        updated_at = now()
      WHERE user_id = p_user_id;
    ELSIF v_row.wallet_type = 'monthly_plan' THEN
      UPDATE public.commerce_wallets
      SET monthly_plan_remaining = monthly_plan_remaining + ABS(v_row.delta),
        wallet_version = wallet_version + 1,
        updated_at = now()
      WHERE user_id = p_user_id;

      UPDATE public.commerce_billing_cycles
      SET consumed_plan_credits = GREATEST(consumed_plan_credits - ABS(v_row.delta), 0),
        updated_at = now()
      WHERE id = v_row.cycle_id;
    END IF;

    PERFORM public.commerce_insert_ledger(
      p_user_id,
      v_row.cycle_id,
      v_row.wallet_type,
      'reversal_credit',
      ABS(v_row.delta),
      NULL,
      p_operation_id,
      p_operation_id::text,
      p_idempotency_key || ':' || v_row.id::text,
      p_reason,
      '{}'::jsonb,
      p_actor_user_id,
      p_actor_role
    );
  END LOOP;

  UPDATE public.commerce_tool_usage_attempts
  SET status = 'reversed',
    updated_at = now()
  WHERE operation_id = p_operation_id
    AND user_id = p_user_id;

  INSERT INTO public.commerce_events(user_id, event_name, operation_id, payload_json)
  VALUES (
    p_user_id,
    'reversal_credit',
    p_operation_id,
    jsonb_build_object('reason', p_reason)
  );

  PERFORM public.commerce_sync_access_state(p_user_id);

  SELECT * INTO v_wallet FROM public.commerce_wallets WHERE user_id = p_user_id;
  RETURN jsonb_build_object(
    'success', true,
    'status', 'reversed',
    'remaining_weekly_available', v_wallet.weekly_wallet,
    'remaining_free_monthly_available', v_wallet.free_monthly_remaining,
    'remaining_extra_wallet', v_wallet.extra_wallet
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_reverse_operation(uuid,uuid,text,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_reverse_operation(uuid,uuid,text,text,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.commerce_admin_adjust_credits(
  p_user_id uuid,
  p_wallet_type text,
  p_delta int,
  p_idempotency_key text,
  p_reason text,
  p_actor_user_id uuid DEFAULT NULL,
  p_actor_role text DEFAULT 'admin',
  p_reference_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.commerce_wallets;
  v_cycle_id uuid;
  v_entry_type text;
  v_operation_id uuid := gen_random_uuid();
BEGIN
  IF p_delta = 0 THEN
    RETURN jsonb_build_object('success', true, 'status', 'noop');
  END IF;

  PERFORM public.commerce_ensure_account(p_user_id, NULL);
  v_cycle_id := public.commerce_open_cycle_if_needed(p_user_id, now(), 'cycle_open');

  SELECT * INTO v_wallet FROM public.commerce_wallets WHERE user_id = p_user_id FOR UPDATE;

  IF p_wallet_type = 'weekly_wallet' THEN
    IF v_wallet.weekly_wallet + p_delta < 0 OR v_wallet.monthly_plan_remaining + p_delta < 0 THEN
      RAISE EXCEPTION 'insufficient_weekly_or_monthly_for_admin_adjust';
    END IF;
    UPDATE public.commerce_wallets
    SET weekly_wallet = weekly_wallet + p_delta,
      monthly_plan_remaining = monthly_plan_remaining + p_delta,
      wallet_version = wallet_version + 1,
      updated_at = now()
    WHERE user_id = p_user_id;
  ELSIF p_wallet_type = 'free_monthly' THEN
    IF v_wallet.free_monthly_remaining + p_delta < 0 THEN
      RAISE EXCEPTION 'insufficient_free_monthly_for_admin_adjust';
    END IF;
    UPDATE public.commerce_wallets
    SET free_monthly_remaining = free_monthly_remaining + p_delta,
      wallet_version = wallet_version + 1,
      updated_at = now()
    WHERE user_id = p_user_id;
  ELSIF p_wallet_type = 'extra_wallet' THEN
    IF v_wallet.extra_wallet + p_delta < 0 THEN
      RAISE EXCEPTION 'insufficient_extra_wallet_for_admin_adjust';
    END IF;
    UPDATE public.commerce_wallets
    SET extra_wallet = extra_wallet + p_delta,
      wallet_version = wallet_version + 1,
      updated_at = now()
    WHERE user_id = p_user_id;
  ELSE
    RAISE EXCEPTION 'invalid_wallet_type';
  END IF;

  v_entry_type := CASE WHEN p_delta > 0 THEN 'admin_manual_grant' ELSE 'admin_manual_debit' END;
  PERFORM public.commerce_insert_ledger(
    p_user_id, v_cycle_id, p_wallet_type, v_entry_type, p_delta, NULL,
    v_operation_id, p_reference_id, p_idempotency_key, p_reason, '{}'::jsonb, p_actor_user_id, p_actor_role
  );

  INSERT INTO public.commerce_events(user_id, event_name, operation_id, reference_id, payload_json)
  VALUES (
    p_user_id,
    CASE WHEN p_delta > 0 THEN 'credits_granted' ELSE 'credits_debited' END,
    v_operation_id,
    p_reference_id,
    jsonb_build_object(
      'wallet_type', p_wallet_type,
      'delta', p_delta,
      'reason', p_reason,
      'actor_role', p_actor_role
    )
  );

  PERFORM public.commerce_sync_access_state(p_user_id);

  SELECT * INTO v_wallet FROM public.commerce_wallets WHERE user_id = p_user_id;
  RETURN jsonb_build_object(
    'success', true,
    'status', 'ok',
    'operation_id', v_operation_id,
    'remaining_weekly_available', v_wallet.weekly_wallet,
    'remaining_free_monthly_available', v_wallet.free_monthly_remaining,
    'remaining_extra_wallet', v_wallet.extra_wallet
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_admin_adjust_credits(uuid,text,int,text,text,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_admin_adjust_credits(uuid,text,int,text,text,uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.commerce_grant_pack_credits(
  p_user_id uuid,
  p_pack_code text,
  p_credits int,
  p_idempotency_key text,
  p_reference_id text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.commerce_wallets;
  v_cycle_id uuid;
  v_operation_id uuid := gen_random_uuid();
BEGIN
  IF p_credits <= 0 THEN
    RAISE EXCEPTION 'invalid_pack_credits';
  END IF;

  PERFORM public.commerce_ensure_account(p_user_id, NULL);
  v_cycle_id := public.commerce_open_cycle_if_needed(p_user_id, now(), 'cycle_open');

  UPDATE public.commerce_wallets
  SET extra_wallet = extra_wallet + p_credits,
    wallet_version = wallet_version + 1,
    updated_at = now()
  WHERE user_id = p_user_id;

  PERFORM public.commerce_insert_ledger(
    p_user_id, v_cycle_id, 'extra_wallet', 'pack_purchase_grant', p_credits, NULL,
    v_operation_id, p_reference_id, p_idempotency_key, 'pack_purchase_grant',
    jsonb_build_object('pack_code', p_pack_code, 'expires_at', p_expires_at), NULL, 'system'
  );

  INSERT INTO public.commerce_events(user_id, event_name, operation_id, reference_id, payload_json)
  VALUES (
    p_user_id,
    'credits_granted',
    v_operation_id,
    p_reference_id,
    jsonb_build_object(
      'source', 'pack_purchase',
      'pack_code', p_pack_code,
      'credits', p_credits
    )
  );

  PERFORM public.commerce_sync_access_state(p_user_id);

  SELECT * INTO v_wallet FROM public.commerce_wallets WHERE user_id = p_user_id;
  RETURN jsonb_build_object(
    'success', true,
    'operation_id', v_operation_id,
    'remaining_extra_wallet', v_wallet.extra_wallet
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_grant_pack_credits(uuid,text,int,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_grant_pack_credits(uuid,text,int,text,text,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.commerce_weekly_release_job(
  p_now timestamptz DEFAULT now(),
  p_limit int DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_processed int := 0;
  v_granted int := 0;
  v_add int;
  v_week_key text := to_char(date_trunc('week', COALESCE(p_now, now())), 'IYYY-IW');
  v_key text;
BEGIN
  PERFORM public._commerce_require_service_role();

  FOR v_row IN
    SELECT
      a.user_id,
      w.current_cycle_id,
      w.weekly_wallet,
      w.monthly_plan_remaining,
      c.weekly_target
    FROM public.commerce_accounts a
    JOIN public.commerce_wallets w ON w.user_id = a.user_id
    JOIN public.commerce_billing_cycles c ON c.id = w.current_cycle_id
    WHERE a.plan_type = 'pro'
      AND c.status = 'open'
      AND c.cycle_start <= p_now
      AND c.cycle_end > p_now
    ORDER BY c.cycle_start DESC
    LIMIT GREATEST(1, COALESCE(p_limit, 500))
  LOOP
    v_processed := v_processed + 1;
    v_key := format('weekly_release:%s:%s', v_row.user_id::text, v_week_key);

    IF EXISTS (SELECT 1 FROM public.commerce_ledger WHERE idempotency_key = v_key) THEN
      CONTINUE;
    END IF;

    v_add := LEAST(
      GREATEST(v_row.weekly_target - v_row.weekly_wallet, 0),
      GREATEST(v_row.monthly_plan_remaining - v_row.weekly_wallet, 0)
    );

    IF v_add <= 0 THEN
      CONTINUE;
    END IF;

    UPDATE public.commerce_wallets
    SET weekly_wallet = weekly_wallet + v_add,
      wallet_version = wallet_version + 1,
      updated_at = now()
    WHERE user_id = v_row.user_id;

    PERFORM public.commerce_insert_ledger(
      v_row.user_id,
      v_row.current_cycle_id,
      'weekly_wallet',
      'weekly_release_grant',
      v_add,
      NULL,
      gen_random_uuid(),
      v_row.current_cycle_id::text,
      v_key,
      'weekly_release_job',
      jsonb_build_object('week_key', v_week_key),
      NULL,
      'system'
    );

    INSERT INTO public.commerce_events(user_id, event_name, reference_id, payload_json)
    VALUES (
      v_row.user_id,
      'weekly_wallet_released',
      v_row.current_cycle_id::text,
      jsonb_build_object('released', v_add, 'week_key', v_week_key)
    );

    v_granted := v_granted + 1;
    PERFORM public.commerce_sync_access_state(v_row.user_id);
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed, 'granted', v_granted);
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_weekly_release_job(timestamptz,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_weekly_release_job(timestamptz,int) TO service_role;

CREATE OR REPLACE FUNCTION public.commerce_reconcile_user_wallet(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.commerce_wallets;
  v_weekly int := 0;
  v_monthly int := 0;
  v_free int := 0;
  v_extra int := 0;
BEGIN
  SELECT * INTO v_wallet FROM public.commerce_wallets WHERE user_id = p_user_id FOR UPDATE;
  IF v_wallet.user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'wallet_not_found');
  END IF;

  SELECT COALESCE(SUM(delta), 0) INTO v_weekly
  FROM public.commerce_ledger
  WHERE user_id = p_user_id
    AND wallet_type = 'weekly_wallet'
    AND cycle_id = v_wallet.current_cycle_id;

  SELECT COALESCE(SUM(delta), 0) INTO v_monthly
  FROM public.commerce_ledger
  WHERE user_id = p_user_id
    AND wallet_type = 'monthly_plan'
    AND cycle_id = v_wallet.current_cycle_id;

  SELECT COALESCE(SUM(delta), 0) INTO v_free
  FROM public.commerce_ledger
  WHERE user_id = p_user_id
    AND wallet_type = 'free_monthly'
    AND cycle_id = v_wallet.current_cycle_id;

  SELECT COALESCE(SUM(delta), 0) INTO v_extra
  FROM public.commerce_ledger
  WHERE user_id = p_user_id
    AND wallet_type = 'extra_wallet';

  UPDATE public.commerce_wallets
  SET
    weekly_wallet = GREATEST(v_weekly, 0),
    monthly_plan_remaining = GREATEST(v_monthly, 0),
    free_monthly_remaining = GREATEST(v_free, 0),
    extra_wallet = GREATEST(v_extra, 0),
    wallet_version = wallet_version + 1,
    updated_at = now()
  WHERE user_id = p_user_id;

  PERFORM public.commerce_sync_access_state(p_user_id);

  RETURN jsonb_build_object(
    'success', true,
    'weekly_wallet', GREATEST(v_weekly, 0),
    'monthly_plan_remaining', GREATEST(v_monthly, 0),
    'free_monthly_remaining', GREATEST(v_free, 0),
    'extra_wallet', GREATEST(v_extra, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_reconcile_user_wallet(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_reconcile_user_wallet(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.commerce_reconcile_job(p_limit int DEFAULT 1000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_count int := 0;
BEGIN
  PERFORM public._commerce_require_service_role();

  FOR v_row IN
    SELECT user_id
    FROM public.commerce_wallets
    ORDER BY updated_at ASC
    LIMIT GREATEST(1, COALESCE(p_limit, 1000))
  LOOP
    PERFORM public.commerce_reconcile_user_wallet(v_row.user_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('reconciled', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_reconcile_job(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_reconcile_job(int) TO service_role;
