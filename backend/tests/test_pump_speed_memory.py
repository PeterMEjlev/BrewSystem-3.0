"""A pump comes back on where the brewer left it.

Switching a pump off drives its speed to 0, so switching it back on needs a
number from somewhere. It used to be a hardcoded 50 % in the panel, which
ignored whatever the brewer had actually settled on. The rig remembers instead
— and remembers it in shared state, because the touchscreen and BrewPlanner
both drive these pumps and should agree on where "back on" is.
"""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(app_module, gpio):
    """The API without the background loops — nothing here needs a tick, and
    these endpoints are the path both clients actually drive pumps through."""
    return TestClient(app_module.app)


@pytest.fixture
def pumps(app_module):
    return app_module._control_state["pumps"]


def test_a_pump_starts_with_a_speed_to_offer(app_module, pumps):
    """First run since the backend started: nothing has been chosen yet."""
    assert pumps["P1"]["lastSpeed"] == app_module._DEFAULT_PUMP_SPEED


def test_choosing_a_speed_is_remembered(client, pumps):
    client.post("/api/hardware/pump/P1/speed", json={"value": 70})
    assert pumps["P1"]["lastSpeed"] == 70


def test_switching_off_does_not_erase_the_memory(client, pumps):
    """The 0 written on the way off is the whole reason the memory exists."""
    client.post("/api/hardware/pump/P1/power", json={"on": True})
    client.post("/api/hardware/pump/P1/speed", json={"value": 70})
    client.post("/api/hardware/pump/P1/power", json={"on": False})
    client.post("/api/hardware/pump/P1/speed", json={"value": 0})

    assert pumps["P1"]["speed"] == 0
    assert pumps["P1"]["lastSpeed"] == 70


def test_dragging_the_slider_to_zero_leaves_something_to_come_back_to(client, pumps):
    """A pump sitting at 0 % is off in all but name, and coming back to 0 would
    make the button look broken."""
    client.post("/api/hardware/pump/P1/speed", json={"value": 70})
    client.post("/api/hardware/pump/P1/speed", json={"value": 0})
    assert pumps["P1"]["lastSpeed"] == 70


def test_a_ramp_settles_on_the_speed_that_was_asked_for(client, pumps):
    """Clients ramp rather than slamming a pump to its new speed, so the memory
    sees every step on the way. It has to end up on the destination."""
    for step in (2, 14, 26, 38, 50, 62, 70):
        client.post("/api/hardware/pump/P1/speed", json={"value": step})
    assert pumps["P1"]["lastSpeed"] == 70


def test_each_pump_remembers_its_own(client, pumps):
    client.post("/api/hardware/pump/P1/speed", json={"value": 70})
    client.post("/api/hardware/pump/P2/speed", json={"value": 35})
    assert pumps["P1"]["lastSpeed"] == 70
    assert pumps["P2"]["lastSpeed"] == 35


def test_the_memory_reaches_the_clients(client):
    """PumpCard reads this off the state push — if it isn't on the wire, the
    panel is back to guessing."""
    client.post("/api/hardware/pump/P1/speed", json={"value": 70})
    state = client.get("/api/hardware/state").json()
    assert state["controlState"]["pumps"]["P1"]["lastSpeed"] == 70


def test_initializing_the_rig_keeps_the_memory(client, pumps):
    """Initialize starts a fresh brew, not a fresh rig. How fast the brewer
    likes their pumps outlives the session."""
    client.post("/api/hardware/pump/P1/speed", json={"value": 70})
    client.post("/api/hardware/initialize")
    assert pumps["P1"]["speed"] == 0
    assert pumps["P1"]["lastSpeed"] == 70


def test_switching_on_still_starts_from_zero(client, gpio, config, pumps):
    """The memory is a number for the client to ramp toward, not a speed to
    slam the pump to — the backend must not restore it behind the ramp's back."""
    client.post("/api/hardware/pump/P1/speed", json={"value": 70})
    client.post("/api/hardware/pump/P1/power", json={"on": False})
    client.post("/api/hardware/pump/P1/speed", json={"value": 0})

    client.post("/api/hardware/pump/P1/power", json={"on": True})
    assert pumps["P1"]["speed"] == 0
    assert gpio.duty[config["gpio"]["pwm_pump"]["p1"]] == 0
