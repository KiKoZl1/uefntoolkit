BEGIN;

INSERT INTO public.commerce_config(config_key, value_json)
VALUES
  ('free_fingerprint_max_accounts', '{"value": 1}'::jsonb),
  ('free_disposable_domains', '{"value": ["mailinator.com", "10minutemail.com", "guerrillamail.com", "tempmail.com", "trashmail.com", "yopmail.com", "sharklasers.com", "getnada.com", "maildrop.cc", "dispostable.com"]}'::jsonb)
ON CONFLICT (config_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS commerce_accounts_fingerprint_idx
  ON public.commerce_accounts(device_fingerprint_hash)
  WHERE device_fingerprint_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public._commerce_cfg_text_array(p_key text, p_default text[])
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_json jsonb;
  v_values text[];
BEGIN
  BEGIN
    EXECUTE 'SELECT value_json -> ''value'' FROM public.commerce_config WHERE config_key = $1'
      INTO v_json
      USING p_key;
  EXCEPTION WHEN undefined_table THEN
    RETURN p_default;
  END;

  IF v_json IS NULL OR jsonb_typeof(v_json) <> 'array' THEN
    RETURN p_default;
  END IF;

  SELECT COALESCE(array_agg(lower(trim(v))), ARRAY[]::text[])
  INTO v_values
  FROM jsonb_array_elements_text(v_json) AS j(v)
  WHERE trim(v) <> '';

  IF COALESCE(array_length(v_values, 1), 0) = 0 THEN
    RETURN p_default;
  END IF;

  RETURN v_values;
EXCEPTION WHEN others THEN
  RETURN p_default;
END;
$$;

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
  v_email text;
  v_email_confirmed_at timestamptz;
  v_email_domain text := '';
  v_is_email_verified boolean := false;
  v_is_disposable_email boolean := false;
  v_fingerprint text;
  v_free_fingerprint_max int := GREATEST(public._commerce_cfg_int('free_fingerprint_max_accounts', 1), 1);
  v_disposable_domains text[] := public._commerce_cfg_text_array(
    'free_disposable_domains',
    ARRAY[
      'mailinator.com',
      '10minutemail.com',
      'guerrillamail.com',
      'tempmail.com',
      'trashmail.com',
      'yopmail.com',
      'sharklasers.com',
      'getnada.com',
      'maildrop.cc',
      'dispostable.com'
    ]::text[]
  );
  v_fingerprint_free_count int := 0;
  v_auto_block_reason text := NULL;
  v_prev_reason text := '';
  v_is_manual_hold boolean := false;
BEGIN
  v_fingerprint := NULLIF(lower(trim(COALESCE(p_device_fingerprint_hash, ''))), '');
  IF v_fingerprint IS NOT NULL AND v_fingerprint !~ '^[a-f0-9]{64}$' THEN
    v_fingerprint := NULL;
  END IF;

  INSERT INTO public.commerce_accounts (user_id, device_fingerprint_hash)
  VALUES (p_user_id, v_fingerprint)
  ON CONFLICT (user_id) DO UPDATE
    SET device_fingerprint_hash = COALESCE(v_fingerprint, public.commerce_accounts.device_fingerprint_hash),
      updated_at = now()
  RETURNING * INTO v_row;

  INSERT INTO public.commerce_wallets (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT u.email, u.email_confirmed_at
  INTO v_email, v_email_confirmed_at
  FROM auth.users u
  WHERE u.id = p_user_id;

  v_is_email_verified := v_email_confirmed_at IS NOT NULL;
  v_email_domain := split_part(lower(COALESCE(v_email, '')), '@', 2);
  IF v_email_domain <> '' THEN
    v_is_disposable_email := v_email_domain = ANY(v_disposable_domains);
  END IF;

  IF v_fingerprint IS NOT NULL THEN
    SELECT COUNT(*)
    INTO v_fingerprint_free_count
    FROM public.commerce_accounts a
    WHERE a.device_fingerprint_hash = v_fingerprint
      AND a.user_id <> p_user_id
      AND a.plan_type = 'free';
  END IF;

  v_prev_reason := COALESCE(v_row.anti_abuse_reason, '');
  v_is_manual_hold := v_row.anti_abuse_review_required
    AND v_prev_reason <> ''
    AND v_prev_reason NOT LIKE 'auto:%';

  IF v_row.plan_type = 'free' AND NOT v_is_manual_hold THEN
    IF NOT v_is_email_verified THEN
      v_auto_block_reason := 'auto:email_not_verified';
    ELSIF v_is_disposable_email THEN
      v_auto_block_reason := 'auto:disposable_email_domain';
    ELSIF v_fingerprint IS NULL THEN
      v_auto_block_reason := 'auto:fingerprint_missing';
    ELSIF v_fingerprint_free_count >= v_free_fingerprint_max THEN
      v_auto_block_reason := 'auto:fingerprint_reused';
    END IF;
  END IF;

  IF v_is_manual_hold THEN
    UPDATE public.commerce_accounts
    SET free_eligible = false,
      updated_at = now()
    WHERE user_id = p_user_id;
  ELSIF v_auto_block_reason IS NOT NULL THEN
    UPDATE public.commerce_accounts
    SET free_eligible = false,
      anti_abuse_review_required = true,
      anti_abuse_reason = v_auto_block_reason,
      access_state = 'blocked_abuse_review',
      updated_at = now()
    WHERE user_id = p_user_id;

    IF (NOT v_row.anti_abuse_review_required) OR v_prev_reason IS DISTINCT FROM v_auto_block_reason THEN
      INSERT INTO public.commerce_abuse_signals(
        user_id, signal_type, signal_value, risk_score, state, note
      )
      VALUES (
        p_user_id,
        'free_auto_block',
        v_auto_block_reason,
        0.95,
        'open',
        COALESCE(v_email_domain, '')
      );

      IF v_auto_block_reason = 'auto:disposable_email_domain' THEN
        INSERT INTO public.commerce_events(user_id, event_name, payload_json)
        VALUES (
          p_user_id,
          'disposable_email_blocked',
          jsonb_build_object('email_domain', v_email_domain)
        );
      END IF;

      INSERT INTO public.commerce_events(user_id, event_name, payload_json)
      VALUES (
        p_user_id,
        'abuse_review_started',
        jsonb_build_object('reason', v_auto_block_reason)
      );
    END IF;
  ELSE
    IF v_row.anti_abuse_review_required AND v_prev_reason LIKE 'auto:%' THEN
      INSERT INTO public.commerce_events(user_id, event_name, payload_json)
      VALUES (
        p_user_id,
        'abuse_review_resolved',
        jsonb_build_object('reason', v_prev_reason)
      );
    END IF;

    UPDATE public.commerce_accounts
    SET free_eligible = true,
      anti_abuse_review_required = false,
      anti_abuse_reason = NULL,
      updated_at = now()
    WHERE user_id = p_user_id
      AND (anti_abuse_review_required = true OR anti_abuse_reason IS NOT NULL OR free_eligible = false);
  END IF;

  SELECT * INTO v_row
  FROM public.commerce_accounts
  WHERE user_id = p_user_id;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_ensure_account(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_ensure_account(uuid,text) TO service_role;

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
  v_account public.commerce_accounts;
  v_operation_id uuid := gen_random_uuid();
  v_weekly int := 0;
  v_free int := 0;
  v_extra int := 0;
  v_left int;
  v_source text := 'mixed';
  v_now timestamptz := now();
BEGIN
  v_account := public.commerce_ensure_account(p_user_id, NULL);
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

  IF v_account.access_state = 'suspended' THEN
    INSERT INTO public.commerce_tool_usage_attempts(
      user_id, request_id, idempotency_key, tool_code, status, credits_required,
      error_code, error_message, payload_hash
    )
    VALUES (
      p_user_id, p_request_id, p_idempotency_key, p_tool_code, 'blocked', v_cost,
      'ACCOUNT_SUSPENDED', 'Account is suspended', p_payload_hash
    );

    RETURN jsonb_build_object(
      'success', false,
      'status', 'blocked',
      'error_code', 'ACCOUNT_SUSPENDED',
      'credits_required', v_cost,
      'weekly_wallet_available', 0,
      'free_monthly_available', 0,
      'extra_wallet_available', 0
    );
  END IF;

  IF v_account.anti_abuse_review_required OR v_account.access_state = 'blocked_abuse_review' THEN
    INSERT INTO public.commerce_tool_usage_attempts(
      user_id, request_id, idempotency_key, tool_code, status, credits_required,
      error_code, error_message, payload_hash
    )
    VALUES (
      p_user_id, p_request_id, p_idempotency_key, p_tool_code, 'blocked', v_cost,
      'ABUSE_REVIEW_REQUIRED', 'Account is under abuse review', p_payload_hash
    );

    RETURN jsonb_build_object(
      'success', false,
      'status', 'blocked',
      'error_code', 'ABUSE_REVIEW_REQUIRED',
      'credits_required', v_cost,
      'weekly_wallet_available', 0,
      'free_monthly_available', 0,
      'extra_wallet_available', 0
    );
  END IF;

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

COMMIT;

