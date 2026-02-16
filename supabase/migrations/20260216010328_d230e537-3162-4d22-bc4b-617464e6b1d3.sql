
-- Create the missing normalize_island_title_for_dup helper function
CREATE OR REPLACE FUNCTION public.normalize_island_title_for_dup(p_title TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT lower(regexp_replace(
    regexp_replace(COALESCE(p_title, ''), '[^a-zA-Z0-9 ]', '', 'g'),
    '\s+', ' ', 'g'
  ));
$$;
