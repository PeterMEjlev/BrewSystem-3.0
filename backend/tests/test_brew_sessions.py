"""Starting a brew session from the rig.

The rig doesn't own the logbook — BrewPlanner does — so the whole of this
feature is one call across the LAN and what the rig does either side of it.
Two things there are worth pinning down, because neither is visible by reading
the route and both are silent when they break:

  * the temperature log is rolled only *after* BrewPlanner accepts. Rolling it
    first would throw away a brew's chart every time the web server was down;
  * a session started today sends no timestamp at all, so BrewPlanner stamps
    the clock time the brew actually started rather than midnight.

BrewPlanner is stood in for with an httpx transport, so these run on a bench
with no web server anywhere near them.
"""
import json

import httpx
import pytest
from fastapi.testclient import TestClient

import brew_planner
from session_logger import session_logger

RECIPES = [
    {"id": "123456", "name": "Wedding NEIPA", "style": "New England IPA",
     "abv": "6.4", "ibu": "45", "ebc": "12", "url": ""},
]


@pytest.fixture
def brewplanner(monkeypatch):
    """A stand-in BrewPlanner, recording what the rig sent it.

    `handler` is swappable per test; `sent` is every request that reached it.
    """
    class Stub:
        def __init__(self):
            self.sent = []
            self.handler = self._default

        def _default(self, request):
            if request.url.path == "/api/recipes":
                return httpx.Response(200, json=RECIPES)
            if request.url.path == "/api/brew-sessions":
                return httpx.Response(201, json={"id": 1, "status": "brewing"})
            return httpx.Response(404, json={"error": "not found"})

        def __call__(self, request):
            self.sent.append(request)
            return self.handler(request)

        @property
        def last_body(self):
            return json.loads(self.sent[-1].content)

    stub = Stub()
    # Bound before the patch: the replacement must build a real client, not
    # call itself.
    real_client = httpx.AsyncClient
    monkeypatch.setenv("BREW_PLANNER_URL", "http://brewplanner.test:3000")
    monkeypatch.setattr(
        brew_planner.httpx,
        "AsyncClient",
        lambda **kwargs: real_client(transport=httpx.MockTransport(stub), **kwargs),
    )
    return stub


@pytest.fixture
def client(app_module):
    # No lifespan: these tests are about one request each, not the read loop.
    return TestClient(app_module.app)


@pytest.fixture
def logged_reading():
    """One reading in the session log, standing in for a brew already underway."""
    session_logger.start_new_session()
    session_logger.log_reading(bk=64.0, mlt=30.0, hlt=20.0)
    assert len(session_logger.get_history()) == 1
    return session_logger


def test_starting_a_session_rolls_the_temperature_log(client, brewplanner, logged_reading):
    """A new brew starts its chart at the beginning of the brew.

    Otherwise the day opens with however many hours of idle bench readings the
    rig had taken since it was last switched on.
    """
    response = client.post("/api/brew-planner/brew-sessions", json={"recipeId": "123456"})

    assert response.status_code == 200
    assert response.json()["brewSession"] == {"id": 1, "status": "brewing"}
    assert logged_reading.get_history() == []


def test_a_refused_session_leaves_the_log_alone(client, brewplanner, logged_reading):
    """The web server being down is not a reason to wipe a brew in progress.

    BrewPlanner is asked first precisely so that this ordering holds: no row
    there, nothing thrown away here.
    """
    brewplanner.handler = lambda request: httpx.Response(404, json={"error": "Recipe not found"})

    response = client.post("/api/brew-planner/brew-sessions", json={"recipeId": "gone"})

    assert response.status_code == 502
    assert "recipe" in response.json()["detail"].lower()
    assert len(logged_reading.get_history()) == 1


def test_an_unreachable_brewplanner_says_so(client, brewplanner, logged_reading):
    """A rebooting web server is a message on a touchscreen, not a traceback."""
    def refuse(request):
        raise httpx.ConnectError("no route to host", request=request)

    brewplanner.handler = refuse

    response = client.post("/api/brew-planner/brew-sessions", json={"recipeId": "123456"})

    assert response.status_code == 502
    assert "not logged" in response.json()["detail"]
    assert len(logged_reading.get_history()) == 1


def test_a_session_started_today_sends_no_timestamp(client, brewplanner):
    """So BrewPlanner stamps now, keeping the clock time the brew started."""
    client.post("/api/brew-planner/brew-sessions", json={"recipeId": "123456", "brewedAt": None})

    assert brewplanner.last_body == {"recipeId": "123456"}


def test_a_back_dated_session_carries_its_date(client, brewplanner):
    """The one case the date field exists for: logging last Saturday's brew."""
    client.post(
        "/api/brew-planner/brew-sessions",
        json={"recipeId": "123456", "brewedAt": "2026-08-01T12:00:00.000Z"},
    )

    assert brewplanner.last_body["brewedAt"] == "2026-08-01T12:00:00.000Z"


def test_the_picker_offers_brewplanners_library(client, brewplanner):
    response = client.get("/api/brew-planner/recipes")

    assert response.status_code == 200
    assert response.json() == {
        "available": True,
        "recipes": [{"id": "123456", "name": "Wedding NEIPA", "style": "New England IPA",
                     "abv": "6.4", "ebc": "12"}],
        "error": None,
    }


def test_no_brewplanner_greys_the_choice_out_rather_than_erroring(client, monkeypatch):
    """A rig on the bench with no web server must still be able to brew.

    200 with `available: false` — the start menu disables its first choice and
    says why, and the second one still takes the brewer to the hardware.
    """
    monkeypatch.delenv("BREW_PLANNER_URL", raising=False)

    response = client.get("/api/brew-planner/recipes")

    assert response.status_code == 200
    assert response.json()["available"] is False
    assert response.json()["recipes"] == []
    assert "BREW_PLANNER_URL" in response.json()["error"]
