"""What the rig asks BrewPlanner for, and what it does with the answer.

Two features cross the LAN: starting a brew session, and the keg-content palette
the Keg Info page draws with. The rig owns neither — BrewPlanner has the logbook
and the palette editor — so most of the code here is one call and the handling
either side of it. What's worth pinning down is the handling, because none of it
is visible by reading the route and all of it is silent when it breaks:

  * the temperature log is rolled only *after* BrewPlanner accepts. Rolling it
    first would throw away a brew's chart every time the web server was down;
  * a session started today sends no timestamp at all, so BrewPlanner stamps
    the clock time the brew actually started rather than midnight;
  * every way of not getting an answer leaves the rig usable — the picker greys
    out, the keg board keeps its own colours — because a web server that is
    rebooting is not a reason to stop brewing.

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

# A palette the brewer has customised — IPA moved off the shipped copper, so a
# rig still drawing its own copy is obvious rather than coincidentally right.
KEG_COLORS = {"IPA": "#ff00ff", "Stout": "#3A2A1A"}

# A brew sheet carrying the fields that exist only because BrewPlanner computed
# them: a costed line, a colour it calculated itself, a hop stage, and a dry hop
# measured in days rather than minutes.
BREW_SHEET = {
    "id": "123456",
    "name": "Wedding NEIPA",
    "style": "New England IPA",
    "og": "1.062",
    "fg": "1.012",
    "abv": "6.4",
    "ibu": "45",
    "ebc": "12",
    "ebcEstimated": True,
    "batchSizeL": 55,
    "fermentables": [
        {"name": "Pale Ale Malt", "amount": "10", "unit": "kg", "percent": "80",
         "ebc": 6, "lateAddition": False, "fermentable": None, "grams": 10000,
         "price": {"usedDkk": 220.0, "pricePerKgDkk": 22.0}},
        {"name": "Lactose", "amount": "500", "unit": "g", "percent": "4",
         "ebc": 2, "lateAddition": True, "fermentable": False, "grams": 500, "price": None},
    ],
    "hops": [
        {"name": "Magnum", "amount": "30", "unit": "g", "use": "Boil", "stage": "Boil",
         "time": "60", "timeUnit": "min", "aa": "12", "ibu": "35", "temp": "",
         "grams": 30, "price": None},
        {"name": "Citra", "amount": "200", "unit": "g", "use": "Dry Hop (High Krausen)",
         "stage": "Dry Hop", "time": "5", "timeUnit": "day", "aa": "12", "ibu": "",
         "temp": "", "grams": 200, "price": {"usedDkk": 90.0, "pricePerKgDkk": 450.0}},
    ],
    "yeast": [{"name": "Verdant IPA", "lab": "LalBrew", "attenuation": "80",
               "amount": "2", "amountUnit": "pkg", "type": "Ale", "form": "Dry",
               "flocculation": "Medium", "minTempC": 18, "maxTempC": 23,
               "starter": False, "grams": None, "units": 2, "price": None}],
    "otherIngredients": [],
    "mashGuidelines": None,
    "waterProfile": None,
    "mashTemp": "67°C",
    "fermentationTemp": "20°C",
    "pricing": {"currency": "DKK", "lastChecked": "2026-07-26", "source": "shop", "available": True},
    "cost": {"usedDkk": 310.0, "buyDkk": 340.0, "priced": 2, "unpriced": 2, "purchase": []},
}


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
            if request.url.path == "/api/keg-content-colors":
                return httpx.Response(200, json=KEG_COLORS)
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


def test_the_library_is_brewplanners(client, brewplanner):
    """One list, read by the Recipe tab and both recipe pickers."""
    response = client.get("/api/recipes")

    assert response.status_code == 200
    assert response.json() == {
        "available": True,
        "recipes": [{"id": "123456", "name": "Wedding NEIPA", "style": "New England IPA",
                     "abv": "6.4", "ibu": "45", "ebc": "12"}],
        "error": None,
    }


def test_a_brew_sheet_is_passed_through_whole(client, brewplanner):
    """Not reshaped: the cost, the hop stages and the day/minute time units on
    it are all things BrewPlanner worked out and this rig only displays. A
    translation layer here would be one more thing to update every time the
    brew sheet gains a field."""
    brewplanner.handler = lambda request: httpx.Response(200, json=BREW_SHEET)

    response = client.get("/api/recipes/123456")

    assert response.status_code == 200
    assert response.json()["available"] is True
    assert response.json()["recipe"] == BREW_SHEET


def test_a_recipe_brewplanner_has_never_heard_of(client, brewplanner):
    brewplanner.handler = lambda request: httpx.Response(404, json={"error": "Recipe not found"})

    body = client.get("/api/recipes/nope").json()

    assert body["available"] is False
    assert body["recipe"] is None


def test_brew_counts_are_keyed_by_recipe(client, brewplanner):
    """The list badges want a lookup; BrewPlanner serves a list."""
    brewplanner.handler = lambda request: httpx.Response(
        200, json=[{"recipeId": "123456", "count": 3, "lastBrewedAt": "2026-07-14T10:00:00.000Z"}]
    )

    counts = client.get("/api/recipes/brew-counts").json()["counts"]

    assert counts["123456"]["count"] == 3


def test_brew_counts_is_not_read_as_a_recipe_id(client, brewplanner):
    """It only stays its own route because it is declared before
    `/api/recipes/{recipe_id}` — FastAPI matches in declaration order."""
    brewplanner.handler = lambda request: httpx.Response(200, json=[])

    body = client.get("/api/recipes/brew-counts").json()

    assert "counts" in body
    assert "recipe" not in body


def test_brew_history_is_empty_rather_than_missing(client, brewplanner):
    """A sheet is worth reading whether or not its history can be reached."""
    def refuse(request):
        raise httpx.ConnectError("no route to host", request=request)

    brewplanner.handler = refuse

    assert client.get("/api/recipes/123456/brew-sessions").json() == {"brewSessions": []}


def test_the_keg_palette_comes_from_brewplanner(client, brewplanner):
    """It owns the palette; both machines read the same sheet of kegs."""
    response = client.get("/api/brew-planner/keg-colors")

    assert response.status_code == 200
    assert response.json()["colors"] == KEG_COLORS


def test_a_malformed_colour_costs_only_itself(client, brewplanner):
    """One bad entry shouldn't send the whole board back to the defaults."""
    brewplanner.handler = lambda request: httpx.Response(
        200, json={"IPA": "#ff00ff", "Stout": 12345, "Clean": None}
    )

    response = client.get("/api/brew-planner/keg-colors")

    assert response.json()["colors"] == {"IPA": "#ff00ff"}


def test_no_brewplanner_leaves_the_keg_board_its_own_colours(client, monkeypatch):
    """`colors: null` — the Keg Info page then draws its built-in palette.

    Those defaults are BrewPlanner's own shipped values, so a rig on the bench
    looks exactly as it always did rather than like something is broken.
    """
    monkeypatch.delenv("BREW_PLANNER_URL", raising=False)

    response = client.get("/api/brew-planner/keg-colors")

    assert response.status_code == 200
    assert response.json() == {"colors": None}


def test_an_unreachable_brewplanner_leaves_the_keg_board_alone(client, brewplanner):
    def refuse(request):
        raise httpx.ConnectError("no route to host", request=request)

    brewplanner.handler = refuse

    assert client.get("/api/brew-planner/keg-colors").json() == {"colors": None}


def test_no_brewplanner_greys_the_choice_out_rather_than_erroring(client, monkeypatch):
    """A rig on the bench with no web server must still be able to brew.

    200 with `available: false` — the start menu disables its first choice and
    says why, and the second one still takes the brewer to the hardware.
    """
    monkeypatch.delenv("BREW_PLANNER_URL", raising=False)

    response = client.get("/api/recipes")

    assert response.status_code == 200
    assert response.json()["available"] is False
    assert response.json()["recipes"] == []
    assert "BREW_PLANNER_URL" in response.json()["error"]
