from __future__ import annotations

import argparse

from ml.tgis.runtime import connect_db, load_runtime


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Sync and normalize TGIS cost usage rows")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    runtime = load_runtime(args.config)

    with connect_db(runtime) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                with agg as (
                  select
                    date_trunc('day', created_at)::date as day,
                    coalesce(nullif(trim(provider), ''), 'fal.ai') as provider,
                    coalesce(nullif(trim(model_name), ''), 'fal-ai/z-image/turbo/lora') as model_name,
                    count(*) filter (where status = 'success')::int as generations,
                    coalesce(sum(case when status = 'success' then variants else 0 end), 0)::int as images_generated,
                    coalesce(sum(case when status = 'success' then cost_usd else 0 end), 0)::numeric(14,6) as total_cost_usd
                  from public.tgis_generation_log
                  where created_at >= now() - interval '14 days'
                  group by 1,2,3
                )
                insert into public.tgis_cost_usage_daily(
                  day, provider, model_name, generations, images_generated, total_cost_usd, updated_at
                )
                select day, provider, model_name, generations, images_generated, total_cost_usd, now()
                from agg
                on conflict (day, provider, model_name) do update
                  set generations = excluded.generations,
                      images_generated = excluded.images_generated,
                      total_cost_usd = excluded.total_cost_usd,
                      updated_at = now()
                """
            )
        conn.commit()

    print("[TGIS] cost sync completed")


if __name__ == "__main__":
    main()
