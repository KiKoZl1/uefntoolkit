#!/usr/bin/env python3
"""Assign DPPI panel families from recent panel intelligence snapshots."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import sys
from typing import Any

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from runtime import open_db, parse_args_with_common, query_df


@dataclass
class FamilyRow:
    panel_name: str
    family_name: str
    weight: float


def _extra_args(parser) -> None:
    parser.add_argument("--window-days", type=int, default=14)
    parser.add_argument("--clusters", type=int, default=4, help="Max family clusters")
    parser.add_argument("--method", choices=["kmeans", "quantile"], default="kmeans")
    parser.add_argument("--dry-run", action="store_true")


def _safe_float(v: Any) -> float:
    try:
        n = float(v)
    except Exception:
        return 0.0
    if not np.isfinite(n):
        return 0.0
    return n


def _load_panel_metrics(conn, region: str, surface_name: str, window_days: int) -> pd.DataFrame:
    return query_df(
        conn,
        """
        with latest as (
          select
            s.panel_name,
            s.updated_at,
            coalesce((s.payload_json ->> 'entries_24h')::double precision, 0) as entries_24h,
            coalesce((s.payload_json ->> 'replacements_24h')::double precision, 0) as replacements_24h,
            coalesce((s.payload_json ->> 'avg_exposure_minutes_per_stint')::double precision, 0) as avg_exposure_minutes,
            coalesce((s.payload_json #>> '{keep_alive_targets,ccu_min}')::double precision, 0) as keep_alive_ccu_min
          from public.discovery_panel_intel_snapshot s
          join public.discovery_exposure_targets t on t.id = s.target_id
          where t.region = %s
            and t.surface_name = %s
            and s.window_days = %s
        )
        select
          panel_name,
          avg(entries_24h)::double precision as entries_24h,
          avg(replacements_24h)::double precision as replacements_24h,
          avg(avg_exposure_minutes)::double precision as avg_exposure_minutes,
          avg(keep_alive_ccu_min)::double precision as keep_alive_ccu_min,
          max(updated_at) as updated_at
        from latest
        group by panel_name
        order by panel_name
        """,
        [region, surface_name, int(window_days)],
    )


def _build_weights(df: pd.DataFrame) -> np.ndarray:
    keep_alive = df["keep_alive_ccu_min"].astype(float).to_numpy()
    median = float(np.median(keep_alive)) if keep_alive.size else 0.0
    if median <= 0:
        return np.ones_like(keep_alive)
    ratio = keep_alive / median
    return np.clip(ratio, 0.5, 2.0)


def _rank_family_names(centers: np.ndarray) -> dict[int, str]:
    pressure = centers[:, 0] + centers[:, 1]
    exposure = centers[:, 2]
    order = np.argsort(-(pressure + 0.25 * exposure))
    out: dict[int, str] = {}
    for rank, cluster_idx in enumerate(order, start=1):
        out[int(cluster_idx)] = f"family_{rank}"
    return out


def _assign_kmeans(df: pd.DataFrame, max_clusters: int) -> list[FamilyRow]:
    features = df[["entries_24h", "replacements_24h", "avg_exposure_minutes", "keep_alive_ccu_min"]].astype(float).to_numpy()
    n_rows = features.shape[0]
    if n_rows == 0:
        return []
    if n_rows == 1:
        row = df.iloc[0]
        return [FamilyRow(panel_name=str(row["panel_name"]), family_name="family_1", weight=float(row["weight"]))]

    k = max(2, min(int(max_clusters), n_rows))
    model = KMeans(n_clusters=k, n_init=20, random_state=42)
    labels = model.fit_predict(features)
    names = _rank_family_names(model.cluster_centers_)

    rows: list[FamilyRow] = []
    for idx, panel_name in enumerate(df["panel_name"].tolist()):
        cluster = int(labels[idx])
        rows.append(
            FamilyRow(
                panel_name=str(panel_name),
                family_name=names.get(cluster, "family_1"),
                weight=float(df.iloc[idx]["weight"]),
            )
        )
    return rows


def _assign_quantile(df: pd.DataFrame, max_clusters: int) -> list[FamilyRow]:
    if df.empty:
        return []
    scored = df.copy()
    scored["score"] = (
        scored["entries_24h"].astype(float)
        + scored["replacements_24h"].astype(float)
        + 0.25 * scored["avg_exposure_minutes"].astype(float)
    )
    n_bins = max(2, min(int(max_clusters), len(scored)))
    scored["bin"] = pd.qcut(scored["score"], q=n_bins, labels=False, duplicates="drop")
    max_bin = int(scored["bin"].max()) if len(scored) else 0
    rows: list[FamilyRow] = []
    for _, r in scored.iterrows():
        b = int(r["bin"])
        rank = max_bin - b + 1
        rows.append(
            FamilyRow(
                panel_name=str(r["panel_name"]),
                family_name=f"family_{rank}",
                weight=float(r["weight"]),
            )
        )
    return rows


def _upsert_rows(conn, rows: list[FamilyRow]) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """
            insert into public.dppi_panel_families (
              panel_name, family_name, weight, updated_at
            ) values (%s, %s, %s, now())
            on conflict (panel_name)
            do update set
              family_name = excluded.family_name,
              weight = excluded.weight,
              updated_at = now()
            """,
            [[r.panel_name, r.family_name, r.weight] for r in rows],
        )
    conn.commit()
    return len(rows)


def main() -> None:
    args = parse_args_with_common("Assign DPPI panel families", extra_args=_extra_args)
    with open_db() as conn:
        metrics = _load_panel_metrics(
            conn,
            region=str(args.region or "NAE").upper(),
            surface_name=str(args.surface_name or "CreativeDiscoverySurface_Frontend"),
            window_days=max(1, int(args.window_days)),
        )
        if metrics.empty:
            raise RuntimeError("No panel snapshot metrics found for selected scope")

        for col in ["entries_24h", "replacements_24h", "avg_exposure_minutes", "keep_alive_ccu_min"]:
            metrics[col] = metrics[col].apply(_safe_float)
        metrics["weight"] = _build_weights(metrics)

        if args.method == "quantile":
            rows = _assign_quantile(metrics, max_clusters=max(2, int(args.clusters)))
        else:
            rows = _assign_kmeans(metrics, max_clusters=max(2, int(args.clusters)))

        if args.dry_run:
            print("[DPPI] dry-run panel families")
            for r in sorted(rows, key=lambda x: (x.family_name, x.panel_name)):
                print(f"- {r.panel_name}: {r.family_name} (weight={r.weight:.3f})")
            print("rows:", len(rows))
            return

        changed = _upsert_rows(conn, rows)
        print("[DPPI] panel families assigned")
        print("scope:", str(args.region or "NAE").upper(), str(args.surface_name or "CreativeDiscoverySurface_Frontend"))
        print("method:", args.method)
        print("rows_upserted:", changed)


if __name__ == "__main__":
    main()
