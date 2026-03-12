BEGIN;

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

  -- Defensive fallback: evaluate anti-abuse using the effective persisted hash.
  v_fingerprint := COALESCE(v_fingerprint, NULLIF(lower(trim(COALESCE(v_row.device_fingerprint_hash, ''))), ''));
  IF v_fingerprint IS NOT NULL AND v_fingerprint !~ '^[a-f0-9]{64}$' THEN
    v_fingerprint := NULL;
  END IF;

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
      access_state = CASE
        WHEN access_state = 'blocked_abuse_review' THEN 'free_active'
        ELSE access_state
      END,
      updated_at = now()
    WHERE user_id = p_user_id
      AND (
        anti_abuse_review_required = true
        OR anti_abuse_reason IS NOT NULL
        OR free_eligible = false
        OR access_state = 'blocked_abuse_review'
      );
  END IF;

  SELECT * INTO v_row
  FROM public.commerce_accounts
  WHERE user_id = p_user_id;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_ensure_account(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_ensure_account(uuid,text) TO service_role;

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

  -- Canonical guard uses explicit anti-abuse flag; do not depend on stale persisted state.
  IF v_account.anti_abuse_review_required THEN
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

COMMIT;
