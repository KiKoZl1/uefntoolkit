from __future__ import annotations

from typing import Dict, List


FIXED_CATEGORIES: List[str] = [
    "combat",
    "tycoon",
    "horror",
    "prop_hunt",
    "deathrun",
    "driving",
    "party_games",
    "roleplay",
    "fashion",
    "misc",
]

CATEGORY_TO_CLUSTER_ID: Dict[str, int] = {cat: i + 1 for i, cat in enumerate(FIXED_CATEGORIES)}


def normalize_tag_group(tag_group: str | None) -> str:
    t = (tag_group or "").strip().lower()
    if t in {"combat", "zonewars", "build_fighting", "gun_game", "team_deathmatch", "box_fights"}:
        return "combat"
    if t == "tycoon":
        return "tycoon"
    if t == "horror":
        return "horror"
    if t == "prop_hunt":
        return "prop_hunt"
    if t == "deathrun":
        return "deathrun"
    if t == "driving":
        return "driving"
    if t == "party_games":
        return "party_games"
    if t == "roleplay":
        return "roleplay"
    if t == "fashion":
        return "fashion"
    return "misc"

