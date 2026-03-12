BEGIN;

ALTER TABLE public.commerce_accounts
  ADD COLUMN IF NOT EXISTS free_signup_granted_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS free_signup_grant_credits int NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'commerce_accounts_free_signup_grant_credits_chk'
      AND conrelid = 'public.commerce_accounts'::regclass
  ) THEN
    ALTER TABLE public.commerce_accounts
      ADD CONSTRAINT commerce_accounts_free_signup_grant_credits_chk
      CHECK (free_signup_grant_credits >= 0);
  END IF;
END;
$$;

WITH first_free_grant AS (
  SELECT DISTINCT ON (l.user_id)
    l.user_id,
    l.created_at AS granted_at,
    GREATEST(l.delta, 0)::int AS credits
  FROM public.commerce_ledger l
  WHERE l.entry_type = 'free_monthly_grant'
    AND l.wallet_type = 'free_monthly'
    AND l.delta > 0
  ORDER BY l.user_id, l.created_at, l.id
)
UPDATE public.commerce_accounts a
SET
  free_signup_granted_at = COALESCE(a.free_signup_granted_at, f.granted_at),
  free_signup_grant_credits = GREATEST(a.free_signup_grant_credits, COALESCE(f.credits, 0)),
  updated_at = now()
FROM first_free_grant f
WHERE a.user_id = f.user_id
  AND (
    a.free_signup_granted_at IS NULL
    OR a.free_signup_grant_credits < COALESCE(f.credits, 0)
  );

UPDATE public.commerce_accounts a
SET
  free_signup_granted_at = COALESCE(a.free_signup_granted_at, a.created_at, now()),
  free_signup_grant_credits = GREATEST(a.free_signup_grant_credits, COALESCE(w.free_monthly_remaining, 0)),
  updated_at = now()
FROM public.commerce_wallets w
WHERE a.user_id = w.user_id
  AND COALESCE(w.free_monthly_remaining, 0) > 0
  AND a.free_signup_granted_at IS NULL;

INSERT INTO public.commerce_config(config_key, value_json)
VALUES (
  'free_signup_credits',
  jsonb_build_object('value', public._commerce_cfg_int('free_monthly_credits', 80))
)
ON CONFLICT (config_key) DO NOTHING;

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
  v_sub public.commerce_subscriptions;
  v_cycle_start timestamptz := COALESCE(p_now, now());
  v_cycle_end timestamptz := (COALESCE(p_now, now()) + interval '1 month');
  v_prev public.commerce_billing_cycles;
  v_base int := 0;
  v_rollover_cap int := 0;
  v_weekly_target int := 0;
  v_rollover int := 0;
  v_monthly int := 0;
  v_free_grant int := 0;
  v_operation_id uuid := gen_random_uuid();
  v_key_prefix text;
  v_cycle_created boolean := false;
BEGIN
  v_account := public.commerce_ensure_account(p_user_id, NULL);

  IF v_account.plan_type = 'pro' THEN
    SELECT *
    INTO v_sub
    FROM public.commerce_subscriptions s
    WHERE s.user_id = p_user_id
    ORDER BY s.updated_at DESC
    LIMIT 1;

    IF v_sub.current_period_start IS NOT NULL
      AND v_sub.current_period_end IS NOT NULL
      AND v_sub.current_period_end > v_sub.current_period_start THEN
      v_cycle_start := v_sub.current_period_start;
      v_cycle_end := v_sub.current_period_end;
    END IF;
  ELSE
    v_cycle_start := date_trunc('month', COALESCE(p_now, now()));
    v_cycle_end := (date_trunc('month', COALESCE(p_now, now())) + interval '1 month');
  END IF;

  SELECT *
  INTO v_cycle
  FROM public.commerce_billing_cycles c
  WHERE c.user_id = p_user_id
    AND c.cycle_start <= p_now
    AND c.cycle_end > p_now
    AND c.status = 'open'
    AND c.plan_type = v_account.plan_type
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

  IF v_account.plan_type = 'pro' THEN
    UPDATE public.commerce_billing_cycles
    SET status = 'closed',
      updated_at = now()
    WHERE user_id = p_user_id
      AND status = 'open'
      AND plan_type <> 'pro';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.commerce_billing_cycles c
    WHERE c.user_id = p_user_id
      AND c.cycle_start = v_cycle_start
      AND c.plan_type <> v_account.plan_type
  ) THEN
    v_cycle_start := COALESCE(p_now, now());
    v_cycle_end := (COALESCE(p_now, now()) + interval '1 month');
  END IF;

  SELECT *
  INTO v_cycle
  FROM public.commerce_billing_cycles c
  WHERE c.user_id = p_user_id
    AND c.cycle_start = v_cycle_start
    AND c.plan_type = v_account.plan_type
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
        AND c.plan_type = 'pro'
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
      IF v_account.free_eligible
        AND NOT v_account.anti_abuse_review_required
        AND v_account.access_state <> 'blocked_abuse_review'
        AND v_account.free_signup_granted_at IS NULL THEN
        v_free_grant := public._commerce_cfg_int(
          'free_signup_credits',
          public._commerce_cfg_int('free_monthly_credits', 80)
        );
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

    v_cycle_created := true;
  END IF;

  INSERT INTO public.commerce_wallets (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  IF v_cycle.plan_type = 'pro' THEN
    UPDATE public.commerce_wallets
    SET
      current_cycle_id = v_cycle.id,
      monthly_plan_remaining = v_cycle.monthly_plan_credits,
      weekly_wallet = LEAST(v_cycle.weekly_target, v_cycle.monthly_plan_credits),
      updated_at = now()
    WHERE user_id = p_user_id;
  ELSE
    UPDATE public.commerce_wallets
    SET
      current_cycle_id = v_cycle.id,
      monthly_plan_remaining = 0,
      weekly_wallet = 0,
      updated_at = now()
    WHERE user_id = p_user_id;
  END IF;

  v_key_prefix := format('%s:%s:%s', p_idempotency_prefix, p_user_id::text, to_char(v_cycle_start, 'YYYYMMDDHH24MISS'));

  IF v_cycle_created AND v_cycle.plan_type = 'pro' THEN
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
  END IF;

  IF v_cycle_created AND v_cycle.plan_type = 'free' AND v_cycle.free_monthly_grant > 0 THEN
    UPDATE public.commerce_wallets
    SET
      free_monthly_remaining = free_monthly_remaining + v_cycle.free_monthly_grant,
      wallet_version = wallet_version + 1,
      updated_at = now()
    WHERE user_id = p_user_id;

    UPDATE public.commerce_accounts
    SET
      free_signup_granted_at = COALESCE(free_signup_granted_at, now()),
      free_signup_grant_credits = GREATEST(free_signup_grant_credits, v_cycle.free_monthly_grant),
      updated_at = now()
    WHERE user_id = p_user_id;

    PERFORM public.commerce_insert_ledger(
      p_user_id, v_cycle.id, 'free_monthly', 'free_monthly_grant', v_cycle.free_monthly_grant, NULL,
      v_operation_id, v_cycle.id::text, v_key_prefix || ':free_signup', 'free_signup_grant', '{}'::jsonb, NULL, 'system'
    );
  END IF;

  RETURN v_cycle.id;
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_open_cycle_if_needed(uuid,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_open_cycle_if_needed(uuid,timestamptz,text) TO service_role;

COMMIT;
