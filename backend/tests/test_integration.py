"""End-to-end through the real app: lifespan, the read loop, and the API.

The unit tests above call the control functions directly, which leaves one
thing unproven — that the background loop actually calls them. This covers the
wiring, at the cost of waiting for a tick or two.
"""
import time

import pytest
from fastapi.testclient import TestClient

import utils_rpi

RAW = {"bk": 64.0, "mlt": 30.0, "hlt": 20.0}


@pytest.fixture
def client(app_module, write_config, monkeypatch):
    write_config(lambda d: d["sensors"].update(
        {"calibration": {"bk": 0.5, "mlt": -0.25, "hlt": 0}}
    ))
    monkeypatch.setattr(utils_rpi, "read_all_temperatures", lambda sensors: dict(RAW))
    with TestClient(app_module.app) as c:
        yield c


def wait_for_reading(client, timeout=5.0):
    """The read loop ticks about once a second; give it one."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        temps = client.get("/api/hardware/temperature").json()
        if temps.get("bk") is not None:
            return temps
        time.sleep(0.05)
    pytest.fail("the read loop never produced a temperature")


def test_the_read_loop_applies_calibration(client):
    """The offsets have to be wired into the loop, not merely implemented."""
    temps = wait_for_reading(client)
    assert temps["bk"] == RAW["bk"] + 0.5
    assert temps["mlt"] == RAW["mlt"] - 0.25
    assert temps["hlt"] == RAW["hlt"]


def test_state_endpoint_serves_calibrated_readings(client):
    """Everything downstream reads the same corrected number."""
    wait_for_reading(client)
    state = client.get("/api/hardware/state").json()
    assert state["temperatures"]["bk"] == RAW["bk"] + 0.5


def test_the_websocket_hands_out_a_full_snapshot(client):
    with client.websocket_connect("/api/ws") as ws:
        message = ws.receive_json()
    assert message["type"] == "snapshot"
    assert set(message["state"]) == {
        "temperatures", "sensorHeld", "controlState", "timer", "brewStage",
        "sessionResume", "heatFaults", "systemWarnings",
    }


def test_the_stage_endpoint_reaches_the_state_endpoint(client):
    assert client.post("/api/hardware/stage", json={"action": "next"}).status_code == 200
    state = client.get("/api/hardware/state").json()
    assert state["brewStage"]["index"] == 0
    assert len(state["brewStage"]["markers"]) == 1


def test_an_unknown_stage_action_is_refused(client):
    assert client.post("/api/hardware/stage", json={"action": "skip"}).status_code == 400


def test_a_write_reaches_the_state_endpoint(client):
    assert client.post("/api/hardware/pot/BK/power", json={"on": True}).status_code == 200
    state = client.get("/api/hardware/state").json()
    assert state["controlState"]["pots"]["BK"]["heaterOn"] is True


def test_the_efficiency_endpoint_actually_applies_it(client, gpio):
    client.post("/api/hardware/pot/BK/power", json={"on": True})
    client.post("/api/hardware/pot/BK/efficiency", json={"value": 55})
    state = client.get("/api/hardware/state").json()
    assert state["controlState"]["pots"]["BK"]["efficiency"] == 55
    assert gpio.duty[12] == 55, "the duty never reached the BK PWM pin"


def test_the_pump_endpoints_actually_apply(client, gpio):
    client.post("/api/hardware/pump/P1/power", json={"on": True})
    client.post("/api/hardware/pump/P1/speed", json={"value": 70})
    state = client.get("/api/hardware/state").json()
    assert state["controlState"]["pumps"]["P1"] == {
        "on": True, "speed": 70, "lastSpeed": 70,
    }
    assert gpio.is_on(27), "the P1 relay was never closed"
    assert gpio.duty[5] == 70


def test_the_loop_regulates_with_nobody_watching(client):
    """Control lives in the backend, not the browser. With no UI attached at
    all, the loop still has to drive the element toward the set value — this is
    what makes a mid-brew browser crash survivable.
    """
    wait_for_reading(client)
    client.post("/api/hardware/pot/BK/sv", json={"value": 80.0})
    client.post("/api/hardware/pot/BK/regulation", json={"enabled": True})

    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        pots = client.get("/api/hardware/state").json()["controlState"]["pots"]
        if pots["BK"]["heaterOn"]:
            assert pots["BK"]["efficiency"] == 100, "well below the set value, so full power"
            return
        time.sleep(0.05)
    pytest.fail("the regulation loop never switched the element on")


def test_the_loop_stops_heating_at_the_set_value(client):
    wait_for_reading(client)
    client.post("/api/hardware/pot/BK/power", json={"on": True})
    # The stub reads 64.5 once calibrated, so this set value is already met.
    client.post("/api/hardware/pot/BK/sv", json={"value": 60.0})
    client.post("/api/hardware/pot/BK/regulation", json={"enabled": True})

    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        pots = client.get("/api/hardware/state").json()["controlState"]["pots"]
        if not pots["BK"]["heaterOn"]:
            return
        time.sleep(0.05)
    pytest.fail("the loop kept heating past the set value")


def test_an_unknown_pot_is_rejected(client):
    assert client.post("/api/hardware/pot/XX/power", json={"on": True}).status_code == 400


def test_efficiency_out_of_range_is_rejected(client):
    """The validation that stops a bad caller asking for 400 % duty."""
    assert client.post("/api/hardware/pot/BK/efficiency", json={"value": 400}).status_code == 422
    assert client.post("/api/hardware/pot/BK/efficiency", json={"value": -1}).status_code == 422


def test_timer_set_requires_seconds(client):
    assert client.post("/api/hardware/timer", json={"action": "set"}).status_code == 400


def test_timer_roundtrips_through_the_api(client):
    client.post("/api/hardware/timer", json={"action": "set", "seconds": 90})
    body = client.post("/api/hardware/timer", json={"action": "start"}).json()
    assert body["timer"]["running"] is True
    assert body["timer"]["target"] == 90
    stopped = client.post("/api/hardware/timer", json={"action": "stop"}).json()
    assert stopped["timer"]["running"] is False


# ── Restarting mid-brew ───────────────────────────────────────────────────────
#
# The unit tests drive the restore directly. These go through the real thing:
# the app's own lifespan, twice, with the in-process memory of the first run
# wiped in between the way a new interpreter would have it.


def _forget_everything_but_the_disk(app_module):
    """What a fresh process starts with. The disk is deliberately left alone —
    it is the only thing a restart has to go on."""
    app_module._stage_state.update({"index": app_module.STAGE_NOT_STARTED, "markers": []})
    app_module._reset_timer()
    app_module._active_brew_session = None
    app_module._pending_resume = None
    app_module._last_saved_session_state = None
    app_module.session_logger._log_path = None
    app_module.session_logger._history = []


def test_a_brew_survives_a_restart_of_the_whole_app(app_module, gpio, monkeypatch):
    monkeypatch.setattr(utils_rpi, "read_all_temperatures", lambda sensors: dict(RAW))

    with TestClient(app_module.app) as c:
        for _ in range(3):
            c.post("/api/hardware/stage", json={"action": "next"})
        c.post("/api/hardware/timer", json={"action": "set", "seconds": 3600})
        c.post("/api/hardware/timer", json={"action": "start"})
        c.post("/api/hardware/pot/BK/sv", json={"value": 67.5})
        log_file = app_module.session_logger.current_path

    _forget_everything_but_the_disk(app_module)

    with TestClient(app_module.app) as c:
        state = c.get("/api/hardware/state").json()
        assert state["sessionResume"]["pending"] is True
        assert state["sessionResume"]["stage"] == app_module.BREW_STAGES[2]
        assert state["brewStage"]["index"] == 2
        assert state["timer"]["running"] is True
        assert state["controlState"]["pots"]["BK"]["sv"] == 67.5
        # The log it was writing, not a new one.
        assert app_module.session_logger.current_path == log_file
        # And nothing is heating on the way back in.
        assert state["controlState"]["pots"]["BK"]["heaterOn"] is False
        assert state["controlState"]["pots"]["BK"]["regulationEnabled"] is False

        resolved = c.post("/api/hardware/session/resume", json={"action": "resume"}).json()
        assert resolved["resolved"] is True
        assert c.get("/api/hardware/state").json()["sessionResume"]["pending"] is False


def test_a_restart_with_nothing_running_asks_nothing(app_module, gpio, monkeypatch):
    """The common case: the rig is rebooted between brews."""
    monkeypatch.setattr(utils_rpi, "read_all_temperatures", lambda sensors: dict(RAW))

    with TestClient(app_module.app) as c:
        first_log = app_module.session_logger.current_path

    _forget_everything_but_the_disk(app_module)

    with TestClient(app_module.app) as c:
        assert c.get("/api/hardware/state").json()["sessionResume"]["pending"] is False
        assert app_module.session_logger.current_path != first_log
