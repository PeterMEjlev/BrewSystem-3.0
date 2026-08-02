"""Asking the BrewPlanner web server what it knows.

BrewPlanner runs on the other Pi and owns the brewery's logbook: which recipe is
being brewed today, how the last batch turned out, what is in the fermenter. This
rig owns the hardware. Where the two overlap, BrewPlanner is the record and this
module is how the rig reads it.

Reaching it from the browser is not an option — BrewPlanner's CORS allowlist is
localhost-only, and this UI is served from a different origin — so every lookup
hops through this backend.

Connection details (address, token) live here rather than in bruce_client because
Bruce is one feature of that server, not the server itself.

Nothing here raises at its caller: the web server is a separate machine that can
be rebooting, and none of that is a reason to disturb a brew.
"""

import logging
import os
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 5.0

# BrewPlanner's status for a batch that is on the rig *right now*. The later
# stages ('fermenting', 'conditioning', 'packaged') are all after the brew day,
# when nobody is standing at this screen following the recipe.
_BREWING = "brewing"


def base_url() -> Optional[str]:
    """Where BrewPlanner lives on the LAN, e.g. `http://192.168.3.3:3000`.

    Unset means the feature is off: a rig on the bench with no web server is a
    normal way to run this backend, not a misconfiguration to complain about.
    """
    url = os.getenv("BREW_PLANNER_URL", "").strip().rstrip("/")
    return url or None


def headers() -> Dict[str, str]:
    token = os.getenv("BREW_PLANNER_TOKEN", "").strip()
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


async def active_brew() -> Dict[str, Any]:
    """The brew day BrewPlanner has in progress, if any.

    Answers `{"active": False}` for every way there might not be one — no web
    server configured, unreachable, nothing being brewed — because the caller
    does the same thing in all of them.

    `recipeId` is filled only when the recipe can actually be opened here: this
    rig reads recipes from Brewer's Friend, and BrewPlanner keeps an imported
    recipe's Brewer's Friend id as its own id. A recipe written in BrewPlanner
    itself has a UUID that means nothing to Brewer's Friend, so it comes back
    named but not linked.
    """
    base = base_url()
    if not base:
        return {"active": False}

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            resp = await client.get(f"{base}/api/brew-days", headers=headers())
        if resp.status_code >= 400:
            logger.warning("BrewPlanner answered %s for the brew-day list", resp.status_code)
            return {"active": False}
        brew_days = resp.json()
    except (httpx.RequestError, ValueError) as e:
        logger.warning("Could not read brew days from BrewPlanner at %s: %s", base, e)
        return {"active": False}

    if not isinstance(brew_days, list):
        return {"active": False}

    # The list arrives newest first, so the first match is the current one.
    for day in brew_days:
        if isinstance(day, dict) and day.get("status") == _BREWING:
            recipe_id = str(day.get("recipeId") or "")
            snapshot = day.get("recipe") if isinstance(day.get("recipe"), dict) else {}
            return {
                "active": True,
                "brewDayId": day.get("id"),
                "recipeId": recipe_id if recipe_id.isdigit() else None,
                "name": snapshot.get("name", ""),
            }

    return {"active": False}
