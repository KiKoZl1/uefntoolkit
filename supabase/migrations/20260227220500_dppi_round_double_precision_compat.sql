-- Compatibility overload for round(double precision, integer)
-- Postgres only provides round(numeric, integer), while DPPI functions
-- pass double precision expressions with scale.
CREATE OR REPLACE FUNCTION public.round(
  p_value double precision,
  p_scale integer
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT pg_catalog.round(p_value::numeric, p_scale)::double precision;
$$;
