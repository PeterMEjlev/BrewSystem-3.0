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
    """Something didn't reach BrewPlanner, with a reason worth showing."""


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


async def _read(path: str, what: str) -> Any:
    """GET a JSON body from BrewPlanner, or raise with a reason worth reading.

    Every read goes through here so the six of them can't drift on how they
    handle a web server that is off, rebooting, or answering with something that
    isn't JSON. The public functions below each catch this and turn it into
    whatever "nothing to show" means for their caller.
    """
    base = base_url()
    if not base:
        raise BrewPlannerError("No BrewPlanner configured (BREW_PLANNER_URL is unset).")

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            resp = await client.get(f"{base}{path}", headers=headers())
    except httpx.RequestError as e:
        logger.warning("Could not read %s from BrewPlanner at %s: %s", what, base, e)
        raise BrewPlannerError("Could not reach BrewPlanner.") from e

    if resp.status_code == 404:
        raise BrewPlannerError(f"BrewPlanner has no such {what}.")
    if resp.status_code >= 400:
        logger.warning("BrewPlanner answered %s for %s", resp.status_code, what)
        raise BrewPlannerError(f"BrewPlanner answered {resp.status_code} for its {what}.")

    try:
        return resp.json()
    except ValueError as e:
        logger.warning("BrewPlanner sent an unreadable %s: %s", what, e)
        raise BrewPlannerError(f"BrewPlanner sent an unreadable {what}.") from e


async def active_brew() -> Dict[str, Any]:
    """The brew session BrewPlanner has in progress, if any.

    Answers `active: False` for every way there might not be one — no web
    server configured, unreachable, nothing being brewed — because the routing
    callers (the start menu, the Recipe tab) do the same thing in all of them.

    `reachable` separates the two kinds of "no": BrewPlanner said there is no
    brew, versus BrewPlanner could not be asked. Only the first is a fact about
    the brewery. It exists for the caller that gates a control on the answer
    (main's brew-session flag), which must not switch the stage buttons off
    mid-brew just because the other Pi is rebooting.
    """
    try:
        sessions = await _read("/api/brew-sessions", "brew-session list")
    except BrewPlannerError:
        return {"active": False, "reachable": False}

    if not isinstance(sessions, list):
        # It answered, but with something that is not a session list. Not a
        # trustworthy "no", so it counts as not having been asked.
        return {"active": False, "reachable": False}

    # The list arrives newest first, so the first match is the current one.
    for session in sessions:
        if isinstance(session, dict) and session.get("status") == _BREWING:
            snapshot = session.get("recipe") if isinstance(session.get("recipe"), dict) else {}
            # Every id here opens on the Recipe tab, which reads the same library
            # this session was filed against. It used to be digits-only, back
            # when the tab read Brewer's Friend and a recipe written in
            # BrewPlanner had a UUID that meant nothing to it.
            return {
                "active": True,
                "reachable": True,
                "brewSessionId": session.get("id"),
                "recipeId": str(session.get("recipeId") or "") or None,
                "name": snapshot.get("name", ""),
            }

    return {"active": False, "reachable": True}


def _slim_recipe(recipe: Dict[str, Any]) -> Dict[str, Any]:
    """The fields a recipe row shows, on the Recipe tab and in the pickers."""
    return {
        "id": str(recipe.get("id") or ""),
        "name": recipe.get("name") or "",
        "style": recipe.get("style") or "",
        "abv": recipe.get("abv") or "",
        "ibu": recipe.get("ibu") or "",
        "ebc": recipe.get("ebc") or "",
    }


async def recipes() -> Dict[str, Any]:
    """BrewPlanner's recipe library — the rig's only recipe list.

    The Recipe tab, the start menu's session picker and the keg editor's recipe
    link all read this. It used to be the picker alone, because the Recipe tab
    went to Brewer's Friend directly; that meant two libraries with different
    contents on one screen, and a recipe written in BrewPlanner was invisible
    here while still being the one a brew session had to be filed against.

    `available` separates "BrewPlanner has no recipes yet" from "there is no
    BrewPlanner to ask", which look the same in an empty list but mean opposite
    things to a brewer standing at the rig.
    """
    try:
        library = await _read("/api/recipes", "recipe list")
    except BrewPlannerError as e:
        return {"available": False, "recipes": [], "error": str(e)}

    if not isinstance(library, list):
        return {"available": False, "recipes": [], "error": "BrewPlanner sent an unreadable recipe list."}

    found: List[Dict[str, Any]] = [
        _slim_recipe(r) for r in library if isinstance(r, dict) and r.get("id")
    ]
    return {"available": True, "recipes": found, "error": None}


async def recipe(recipe_id: str) -> Dict[str, Any]:
    """One recipe's full brew sheet, exactly as BrewPlanner states it.

    Passed through rather than reshaped. BrewPlanner has already done the work
    this rig can't — costing every line against its price catalogue, calculating
    a colour for the grain bill when Brewer's Friend reports none, sorting hop
    additions into brew-session stages, recording which time figures are in days
    rather than minutes — and a translation layer here would only be one more
    thing to update whenever the brew sheet gains a field.
    """
    try:
        sheet = await _read(f"/api/recipes/{recipe_id}", "recipe")
    except BrewPlannerError as e:
        return {"available": False, "recipe": None, "error": str(e)}

    if not isinstance(sheet, dict):
        return {"available": False, "recipe": None, "error": "BrewPlanner sent an unreadable recipe."}
    return {"available": True, "recipe": sheet, "error": None}


async def recipe_brew_sessions(recipe_id: str) -> List[Dict[str, Any]]:
    """Every batch brewed from one recipe, for the brew history on its sheet.

    An empty list when there is no web server to ask: a recipe with no history
    and a recipe whose history can't be reached both show nothing, and the sheet
    is worth reading either way.
    """
    try:
        history = await _read(f"/api/recipes/{recipe_id}/brew-sessions", "brew history")
    except BrewPlannerError:
        return []
    return history if isinstance(history, list) else []


async def brew_counts() -> Dict[str, Any]:
    """How often each recipe has been brewed, keyed by recipe id.

    Its own read rather than a field on the list, because that is how BrewPlanner
    serves it — one pass over the logbook for the whole grid instead of a count
    per row.
    """
    try:
        counts = await _read("/api/brew-sessions/counts", "brew counts")
    except BrewPlannerError:
        return {}
    if not isinstance(counts, list):
        return {}
    return {
        str(c["recipeId"]): c
        for c in counts
        if isinstance(c, dict) and c.get("recipeId")
    }


async def keg_content_colors() -> Optional[Dict[str, str]]:
    """BrewPlanner's keg-content palette, or None to keep the rig's own.

    Both machines read the same Google Sheet of kegs, but only BrewPlanner has
    an editor for what colour each content pours — so it owns the palette and
    this rig follows. Without this the rig kept its copy of the shipped defaults
    and quietly disagreed with the web server from the first edit onwards.

    None for every way there might not be an answer, because the caller falls
    back to the built-in palette in all of them and a keg board in slightly
    wrong colours beats no keg board.
    """
    try:
        colors = await _read("/api/keg-content-colors", "keg palette")
    except BrewPlannerError:
        return None

    if not isinstance(colors, dict):
        return None
    # Only the string entries: a malformed value should cost that one content
    # type its colour, not the whole palette.
    return {k: v for k, v in colors.items() if isinstance(k, str) and isinstance(v, str)}


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
