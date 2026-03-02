from __future__ import annotations

import hashlib
import re


def sanitize_name(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", value.strip())[:120] or "thumb"


def infer_ext(url: str) -> str:
    lower = (url or "").lower()
    if ".png" in lower:
        return ".png"
    if ".webp" in lower:
        return ".webp"
    if ".jpeg" in lower or ".jpg" in lower:
        return ".jpg"
    return ".jpg"


def image_suffix(url: str, size: int = 10) -> str:
    digest = hashlib.sha1((url or "").encode("utf-8")).hexdigest()
    return digest[: max(6, int(size))]


def build_thumb_file_name(link_code: str, image_url: str) -> str:
    return f"{sanitize_name(link_code)}-{image_suffix(image_url)}{infer_ext(image_url)}"

