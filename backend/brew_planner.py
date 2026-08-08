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

Reads never raise at their caller: the web server is a separate machine that can
be rebooting, and none of that is a reason to disturb a brew — so they answer
"nothing to show" instead. The one write, `start_brew_session`, is the exception
and raises `BrewPlannerError`. A brewer who presses "Start brew session" and is
told nothing would believe the batch is being logged when it isn't, and would
find out months later with an empty row in the logbook.
"""

import logging
import os
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 5.0

# BrewPlanner's status for a batch that is on the rig *right now*. The later
# stages ('fermenting', 'conditioning', 'packaged') are all after the brew day,
# when nobody is standing at this screen following the recipe.
_BREWING = "brewing"


class BrewPlannerError(Exception):
    """A write to BrewPlanner did not happen, with a reason worth showing."""


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
    """The brew session BrewPlanner has in progress, if any.

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
            resp = await client.get(f"{base}/api/brew-sessions", headers=headers())
        if resp.status_code >= 400:
            logger.warning("BrewPlanner answered %s for the brew-session list", resp.status_code)
            return {"active": False}
        sessions = resp.json()
    except (httpx.RequestError, ValueError) as e:
        logger.warning("Could not read brew sessions from BrewPlanner at %s: %s", base, e)
        return {"active": False}

    if not isinstance(sessions, list):
        return {"active": False}

    # The list arrives newest first, so the first match is the current one.
    for session in sessions:
        if isinstance(session, dict) and session.get("status") == _BREWING:
            recipe_id = str(session.get("recipeId") or "")
            snapshot = session.get("recipe") if isinstance(session.get("recipe"), dict) else {}
            return {
                "active": True,
                "brewSessionId": session.get("id"),
                "recipeId": recipe_id if recipe_id.isdigit() else None,
                "name": snapshot.get("name", ""),
            }

    return {"active": False}


def _slim_recipe(recipe: Dict[str, Any]) -> Dict[str, Any]:
    """The handful of fields the rig's recipe picker shows in a row."""
    return {
        "id": str(recipe.get("id") or ""),
        "name": recipe.get("name") or "",
        "style": recipe.get("style") or "",
        "abv": recipe.get("abv") or "",
        "ebc": recipe.get("ebc") or "",
    }


async def recipes() -> Dict[str, Any]:
    """BrewPlanner's recipe library, for the "start a brew session" picker.

    Deliberately not the rig's own `/api/recipes`, which reads Brewer's Friend
    directly: a brew session is filed against a recipe in BrewPlanner's library,
    and a Brewer's Friend recipe that has never been imported there has an id
    that `POST /api/brew-sessions` would refuse. Offering only what can actually
    be started is better than a picker where some rows fail.

    `available` is what the start menu gates on. It separates "BrewPlanner has no
    recipes yet" from "there is no BrewPlanner to ask", which look the same in an
    empty list but mean opposite things to a brewer standing at the rig.
    """
    base = base_url()
    if not base:
        return {
            "available": False,
            "recipes": [],
            "error": "No BrewPlanner configured (BREW_PLANNER_URL is unset).",
        }

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            resp = await client.get(f"{base}/api/recipes", headers=headers())
        if resp.status_code >= 400:
            logger.warning("BrewPlanner answered %s for the recipe list", resp.status_code)
            return {
                "available": False,
                "recipes": [],
                "error": f"BrewPlanner answered {resp.status_code} for its recipe list.",
            }
        library = resp.json()
    except (httpx.RequestError, ValueError) as e:
        logger.warning("Could not read recipes from BrewPlanner at %s: %s", base, e)
        return {
            "available": False,
            "recipes": [],
            "error": "Could not reach BrewPlanner.",
        }

    if not isinstance(library, list):
        return {"available": False, "recipes": [], "error": "BrewPlanner sent an unreadable recipe list."}

    found: List[Dict[str, Any]] = [
        _slim_recipe(r) for r in library if isinstance(r, dict) and r.get("id")
    ]
    return {"available": True, "recipes": found, "error": None}


async def start_brew_session(recipe_id: str, brewed_at: Optional[str]) -> Dict[str, Any]:
    """Open a brew session in BrewPlanner's logbook, and return the row it made.

    BrewPlanner does the rest of what starting a brew means: it snapshots the
    recipe as it reads today, puts that beer in the fermenter, and starts
    sampling this rig's pot temperatures against the session every 30 s. The rig
    holds no session id of its own — being the thing BrewPlanner polls is the
    whole of its side of the arrangement.

    `brewed_at` is an ISO instant, and only for back-dating; leave it None and
    the server stamps now, which keeps the clock time the brew actually started.

    Raises BrewPlannerError with something worth reading on a touchscreen.
    """
    base = base_url()
    if not base:
        raise BrewPlannerError(
            "No BrewPlanner configured. Set BREW_PLANNER_URL in this rig's .env "
            "and restart the backend to log brew sessions."
        )

    body: Dict[str, Any] = {"recipeId": recipe_id}
    if brewed_at:
        body["brewedAt"] = brewed_at

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            resp = await client.post(
                f"{base}/api/brew-sessions", json=body, headers=headers()
            )
    except httpx.RequestError as e:
        logger.warning("Could not start a brew session on BrewPlanner at %s: %s", base, e)
        raise BrewPlannerError(
            "Could not reach BrewPlanner. The brew session was not logged."
        ) from e

    if resp.status_code == 404:
        raise BrewPlannerError("BrewPlanner does not have that recipe any more.")
    if resp.status_code in (401, 403):
        # The rig normally passes as admin by being on the LAN (BrewPlanner's
        # isLocalRequest). Being refused means that stopped being true.
        raise BrewPlannerError(
            "BrewPlanner refused the brew session. Set BREW_PLANNER_TOKEN in "
            "this rig's .env to a full-access token."
        )
    if resp.status_code >= 400:
        logger.warning(
            "BrewPlanner answered %s starting a brew session: %s",
            resp.status_code,
            resp.text[:200],
        )
        raise BrewPlannerError(f"BrewPlanner answered {resp.status_code}.")

    try:
        return resp.json()
    except ValueError as e:
        # It was created — the row exists — so this is not a failure to report as
        # one. Say so with an empty body rather than sending the brewer back to
        # a dialog that would start a second session.
        logger.warning("BrewPlanner sent an unreadable brew session back: %s", e)
        return {}
