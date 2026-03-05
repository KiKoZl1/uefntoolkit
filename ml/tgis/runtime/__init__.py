from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlsplit, urlunsplit

import psycopg
import yaml


ROOT = Path(__file__).resolve().parent


@dataclass
class RuntimeConfig:
    supabase_db_url: str
    supabase_url: str
    service_role_key: str
    artifacts_dir: Path
    default_k: int
    min_cluster_size: int
    score_threshold: float


def _normalize_db_url(url: str) -> str:
    """
    Normalize DB URL for common local .env mistakes:
    - wrapped quotes around value
    - raw '@' in password (needs percent-encoding)
    - unescaped username/password characters
    """
    try:
        s = str(url or "").strip()
        if not s:
            return s
        if len(s) >= 2 and s[0] == s[-1] and s[0] in {'"', "'"}:
            s = s[1:-1].strip()
        if "://" not in s:
            return s

        parts = urlsplit(s)
        if not parts.netloc:
            return s

        netloc = parts.netloc
        if "@" not in netloc:
            return s

        userinfo, hostinfo = netloc.rsplit("@", 1)
        if ":" in userinfo:
            user, password = userinfo.split(":", 1)
        else:
            user, password = userinfo, ""

        user_enc = quote(unquote(user), safe="")
        pass_enc = quote(unquote(password), safe="")
        userinfo_enc = f"{user_enc}:{pass_enc}" if password != "" else user_enc

        return urlunsplit((parts.scheme, f"{userinfo_enc}@{hostinfo}", parts.path, parts.query, parts.fragment))
    except Exception:
        return str(url or "").strip().strip('"').strip("'")


def load_yaml(path: str | Path) -> dict[str, Any]:
    p = Path(path)
    with p.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_runtime(config_path: str | Path) -> RuntimeConfig:
    cfg = load_yaml(config_path)
    db_url = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL") or cfg.get("database", {}).get("url")
    if not db_url:
        raise RuntimeError("SUPABASE_DB_URL or DATABASE_URL is required")
    db_url = _normalize_db_url(str(db_url))

    supabase_url = os.getenv("SUPABASE_URL") or cfg.get("supabase", {}).get("url") or ""
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or cfg.get("supabase", {}).get("service_role_key") or ""

    artifacts = Path(cfg.get("paths", {}).get("artifacts", "ml/tgis/artifacts")).resolve()
    artifacts.mkdir(parents=True, exist_ok=True)

    clustering = cfg.get("clustering", {})
    scoring = cfg.get("scoring", {})

    return RuntimeConfig(
        supabase_db_url=db_url,
        supabase_url=supabase_url,
        service_role_key=service_role_key,
        artifacts_dir=artifacts,
        default_k=int(clustering.get("k", 10)),
        min_cluster_size=int(clustering.get("min_cluster_size", 1)),
        score_threshold=float(scoring.get("min_score", 0.45)),
    )


def connect_db(runtime: RuntimeConfig) -> psycopg.Connection:
    return psycopg.connect(_normalize_db_url(runtime.supabase_db_url))


def write_json(path: str | Path, payload: Any) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def read_json(path: str | Path, default: Any = None) -> Any:
    p = Path(path)
    if not p.exists():
        return default
    with p.open("r", encoding="utf-8") as f:
        return json.load(f)


def utc_now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()
