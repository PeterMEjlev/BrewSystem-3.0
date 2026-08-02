"""Speaking through Bruce, the voice assistant on the BrewPlanner Pi.

Bruce used to live on this rig, and partly still does — electron/bruce.js starts
a local copy for the wake word and the microphone. The assistant wired to the
brewery speaker now runs on the *other* Pi (the BrewPlanner web server), behind a
loopback-only API. This module is the rig's way to reach it, so something the
backend notices on its own — a heater that isn't heating, at an hour when nobody
is watching the screen — gets said out loud instead of only reaching a log file.

The hop is:

    this module  →  BrewPlanner  /api/bruce/speak
                 →  Bruce        127.0.0.1:3555/speak
                 →  the brewery speaker

BrewPlanner guards that route with `requireAdmin`, which lets through any request
arriving from a private LAN address (its auth/index.ts `isLocalRequest`). Both
Pis sit on 192.168.3.x, so no credential is needed; BREW_PLANNER_TOKEN exists for
the day that assumption stops holding (TRUST_LOCAL=false, or a move to separate
subnets).

Nothing here raises at its caller. The web server is a separate machine that can
be rebooting, Bruce is a service that can be stopped, and the speaker can be
unplugged — none of which is a reason to disturb a brew. Every failure logs once
and answers False.
"""

import asyncio
import logging
import time
from typing import Dict, Optional, Set

import httpx

import brew_planner
from brew_planner import base_url

logger = logging.getLogger(__name__)

# BrewPlanner's Zod schema caps a spoken message at 500 characters
# (bruceSpeakSchema). Longer text is truncated here rather than rejected there —
# a warning that arrives slightly clipped beats one that never gets spoken.
MAX_MESSAGE_CHARS = 500

# The full path is two hops: BrewPlanner allows itself 2 s to reach Bruce's
# loopback API, so this has to be comfortably longer to tell "Bruce is down"
# (a fast, clean 502) apart from "the web server is down" (a timeout).
_TIMEOUT_SECONDS = 5.0

# Tasks spawned by speak_soon(). asyncio only holds weak references to running
# tasks, so a fire-and-forget task can be garbage-collected mid-flight; keeping
# them here until they finish is the documented way to avoid that.
_pending: Set["asyncio.Task"] = set()

# Last attempt per cooldown key, for the callers that repeat themselves.
_last_attempt: Dict[str, float] = {}


def is_configured() -> bool:
    """Whether a BrewPlanner address is set. Says nothing about reachability."""
    return base_url() is not None


_headers = brew_planner.headers


async def speak(
    message: str,
    *,
    key: Optional[str] = None,
    cooldown_seconds: float = 0.0,
) -> bool:
    """Say `message` out loud in the brewery. Answers True if Bruce accepted it.

    `key` + `cooldown_seconds` throttle a caller that repeats itself — a fault
    watcher ticking once a second must not queue a sentence a second. The
    cooldown is stamped on the *attempt*, not the success, so a web server that
    is down gets one call per cooldown rather than one per tick.
    """
    text = " ".join(message.split())
    if not text:
        return False

    base = base_url()
    if not base:
        logger.debug("Not speaking (BREW_PLANNER_URL is unset): %s", text)
        return False

    if key and cooldown_seconds > 0:
        now = time.monotonic()
        previous = _last_attempt.get(key)
        if previous is not None and now - previous < cooldown_seconds:
            return False
        _last_attempt[key] = now

    if len(text) > MAX_MESSAGE_CHARS:
        text = text[: MAX_MESSAGE_CHARS - 1].rstrip() + "…"

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            resp = await client.post(
                f"{base}/api/bruce/speak",
                json={"message": text},
                headers=_headers(),
            )
    except httpx.TimeoutException:
        logger.warning("Bruce did not answer within %ss — is the BrewPlanner Pi up?", _TIMEOUT_SECONDS)
        return False
    except httpx.RequestError as e:
        logger.warning("Could not reach BrewPlanner at %s: %s", base, e)
        return False

    if resp.status_code in (401, 403):
        logger.warning(
            "BrewPlanner refused the speak request (%s). This rig is only allowed "
            "through because it is on the LAN — check TRUST_LOCAL on the web "
            "server, or set BREW_PLANNER_TOKEN here.",
            resp.status_code,
        )
        return False
    if resp.status_code >= 400:
        detail = ""
        try:
            body = resp.json()
            if isinstance(body, dict) and isinstance(body.get("error"), str):
                detail = f" — {body['error']}"
        except ValueError:
            pass
        logger.warning("Bruce rejected the message (%s)%s", resp.status_code, detail)
        return False

    logger.info("Bruce said: %s", text)
    return True


def speak_soon(message: str, *, key: Optional[str] = None, cooldown_seconds: float = 0.0) -> None:
    """Fire-and-forget {@link speak} from synchronous code on the event loop.

    The regulation tick is sync and runs inside the 1 s sensor loop; it must not
    block for the round trip to another Pi while heaters wait on it.
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.debug("speak_soon called with no running event loop; dropping: %s", message)
        return
    task = loop.create_task(speak(message, key=key, cooldown_seconds=cooldown_seconds))
    _pending.add(task)
    task.add_done_callback(_pending.discard)


async def status() -> Dict[str, object]:
    """Whether Bruce can be reached right now, for the Settings panel.

    Three distinct answers, because they need three different fixes: no address
    configured, an address that doesn't answer (web server off), and a web
    server that answers but says Bruce's own service is down.
    """
    base = base_url()
    if not base:
        return {"configured": False, "online": False}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            resp = await client.get(f"{base}/api/bruce/status", headers=_headers())
        if resp.status_code >= 400:
            return {"configured": True, "online": False, "error": f"BrewPlanner answered {resp.status_code}"}
        body = resp.json()
    except (httpx.RequestError, ValueError) as e:
        return {"configured": True, "online": False, "error": f"Could not reach {base}: {e}"}
    return {
        "configured": True,
        "online": bool(body.get("online")),
        "url": base,
        **({"state": body["state"]} if isinstance(body, dict) and "state" in body else {}),
    }


def reset_cooldown(key: str) -> None:
    """Forget a cooldown, so the next {@link speak} with that key goes through.

    Called when the condition behind a repeating message clears, so a fault that
    comes back is announced immediately instead of waiting out the old timer.
    """
    _last_attempt.pop(key, None)
