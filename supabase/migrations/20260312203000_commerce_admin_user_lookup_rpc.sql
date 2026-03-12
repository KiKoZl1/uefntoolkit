-- Admin-safe lookup by email for commerce support tooling.
-- Uses SECURITY DEFINER because auth.users is not available via regular public schema queries.
CREATE OR REPLACE FUNCTION public.commerce_admin_lookup_user_by_email(p_email text)
RETURNS TABLE (
  user_id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  role text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_email text;
BEGIN
  v_email := lower(trim(COALESCE(p_email, '')));
  IF v_email = '' OR position('@' in v_email) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    u.id AS user_id,
    u.email,
    u.created_at,
    u.last_sign_in_at,
    u.email_confirmed_at,
    ur.role::text AS role
  FROM auth.users u
  LEFT JOIN public.user_roles ur ON ur.user_id = u.id
  WHERE lower(u.email) = v_email
  ORDER BY u.created_at DESC
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_admin_lookup_user_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_admin_lookup_user_by_email(text) TO service_role;
