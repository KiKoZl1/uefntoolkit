from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from ml.tgis.runtime import connect_db, load_runtime, load_yaml, utc_now_iso


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build TGIS visual base dataset (Pool A + Pool B)")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--min-unique-players", type=int, default=None)
    p.add_argument("--window-days", type=int, default=None)
    p.add_argument("--limit", type=int, default=0, help="0 means no limit")
    p.add_argument(
        "--statement-timeout-ms",
        type=int,
        default=900000,
        help="statement timeout for the SQL query (0 keeps DB default)",
    )
    return p.parse_args()


def main() -> None:
    args = parse_args()
    cfg = load_yaml(args.config)
    runtime = load_runtime(args.config)

    min_unique_players = int(
        args.min_unique_players
        if args.min_unique_players is not None
        else cfg.get("visual_pool", {}).get("min_unique_players", 50)
    )
    window_days = int(
        args.window_days
        if args.window_days is not None
        else cfg.get("visual_pool", {}).get("window_days", 14)
    )
    window_days = max(1, min(365, window_days))
    limit = int(args.limit if args.limit is not None else 0)
    limit = max(0, limit)

    dataset_visual_csv = Path(
        cfg.get("paths", {}).get("dataset_visual_csv", "ml/tgis/artifacts/dataset_visual_pool_ab.csv")
    )

    with connect_db(runtime) as conn:
        with conn.cursor() as cur:
            if int(args.statement_timeout_ms) > 0:
                cur.execute(f"set statement_timeout = {int(args.statement_timeout_ms)}")
            cur.execute(
                """
                with scored as (
                  select
                    s.link_code,
                    s.image_url,
                    s.tag_group,
                    s.quality_score
                  from public.compute_tgis_thumb_score(%s) s
                ),
                base as (
                  select
                    sc.link_code,
                    sc.image_url,
                    sc.tag_group,
                    sc.quality_score,
                    coalesce(ic.last_week_unique, ic.last_probe_unique) as unique_players
                  from scored sc
                  join public.discover_islands_cache ic
                    on ic.island_code = sc.link_code
                  where sc.image_url is not null
                    and sc.image_url like 'http%%'
                    and coalesce(ic.last_week_unique, ic.last_probe_unique) >= %s
                ),
                history_raw as (
                  select
                    e.link_code,
                    nullif(e.new_value ->> 'image_url', '') as image_url
                  from public.discover_link_metadata_events e
                  join base b on b.link_code = e.link_code
                  where e.event_type = 'thumb_changed'
                  union all
                  select
                    e.link_code,
                    nullif(e.old_value ->> 'image_url', '') as image_url
                  from public.discover_link_metadata_events e
                  join base b on b.link_code = e.link_code
                  where e.event_type = 'thumb_changed'
                ),
                history as (
                  select
                    h.link_code,
                    h.image_url
                  from history_raw h
                  where h.image_url is not null
                    and h.image_url like 'http%%'
                ),
                combined as (
                  select
                    b.link_code,
                    b.image_url,
                    b.tag_group,
                    b.quality_score,
                    b.unique_players,
                    'pool_a_current'::text as source_pool
                  from base b
                  union all
                  select
                    h.link_code,
                    h.image_url,
                    b.tag_group,
                    b.quality_score,
                    b.unique_players,
                    'pool_b_history'::text as source_pool
                  from history h
                  join base b on b.link_code = h.link_code
                ),
                dedup as (
                  select distinct on (c.link_code, c.image_url)
                    c.link_code,
                    c.image_url,
                    c.tag_group,
                    c.quality_score,
                    c.unique_players,
                    c.source_pool
                  from combined c
                  order by
                    c.link_code,
                    c.image_url,
                    case when c.source_pool = 'pool_a_current' then 0 else 1 end,
                    c.quality_score desc
                )
                select
                  d.link_code,
                  d.image_url,
                  d.tag_group,
                  d.quality_score,
                  d.unique_players,
                  d.source_pool
                from dedup d
                order by d.quality_score desc, d.link_code
                """,
                (window_days, min_unique_players),
            )
            rows = cur.fetchall()
            cols = [d.name for d in cur.description]

            df = pd.DataFrame(rows, columns=cols)
            if limit > 0 and len(df) > limit:
                df = df.head(limit).copy()
            if not df.empty:
                df["collected_at"] = utc_now_iso()

            dataset_visual_csv.parent.mkdir(parents=True, exist_ok=True)
            df.to_csv(dataset_visual_csv, index=False)

            pool_counts = (
                df["source_pool"].value_counts().to_dict() if not df.empty and "source_pool" in df.columns else {}
            )
            summary = {
                "rows": int(len(df)),
                "window_days": int(window_days),
                "min_unique_players": int(min_unique_players),
                "limit": int(limit),
                "pool_counts": pool_counts,
                "output": str(dataset_visual_csv),
                "collected_at": utc_now_iso(),
            }
            cur.execute(
                """
                insert into public.tgis_dataset_runs(run_type, status, summary_json, started_at, ended_at)
                values ('manual_refresh', 'success', %s::jsonb, now(), now())
                """,
                (json.dumps(summary),),
            )
        conn.commit()

    print(f"[TGIS] visual pool A+B rows={len(df)} saved={dataset_visual_csv}")


if __name__ == "__main__":
    main()
