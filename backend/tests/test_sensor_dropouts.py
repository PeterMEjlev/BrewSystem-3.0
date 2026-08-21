"""Bridging single-sweep sensor dropouts.

A DS18B20 sharing a bus with two others, in a brewery, next to 200 Hz PWM
driving SSRs, drops the odd transaction. Before this, one bad CRC put "--" on
the panel for a second and dropped a regulating element with it. These tests
pin down what is held, for how long, and what still happens when a sensor is
genuinely dead.

The clock is injected rather than slept through — the whole point of the
feature is a three-second window, and no test suite should take that long.
"""
import pytest


@pytest.fixture
def hold(app_module):
    """Call the bridge at a chosen monotonic time."""
    def _hold(temps, now=0.0):
        return app_module._hold_through_dropouts(temps, now=now)
    return _hold


def test_a_fresh_reading_passes_straight_through(hold):
    assert hold({"bk": 64.0, "mlt": 20.0, "hlt": 71.5}) == {
        "bk": 64.0, "mlt": 20.0, "hlt": 71.5,
    }


def test_one_dropped_sweep_reuses_the_last_good_reading(app_module, hold):
    hold({"bk": 64.0}, now=0.0)
    assert hold({"bk": None}, now=1.0) == {"bk": 64.0}
    assert app_module._sensor_status["bk"] == "held"


def test_a_held_reading_is_flagged_as_held_not_fresh(app_module, hold):
    """Downstream must be able to tell the two apart — the number alone can't."""
    hold({"bk": 64.0}, now=0.0)
    assert app_module._sensor_status["bk"] == "ok"
    hold({"bk": None}, now=1.0)
    assert app_module._sensor_status["bk"] == "held"


def test_the_hold_is_reported_in_the_state_snapshot(app_module, hold):
    hold({"bk": 64.0, "mlt": 20.0, "hlt": 71.5}, now=0.0)
    hold({"bk": None, "mlt": 20.0, "hlt": 71.5}, now=1.0)
    assert app_module._state_snapshot()["sensorHeld"] == {
        "bk": True, "mlt": False, "hlt": False,
    }


def test_the_hold_releases_to_no_reading_once_it_runs_out(app_module, hold):
    """Three seconds buys the bus a few retries. It is not a way to keep a
    dead probe on screen."""
    hold({"bk": 64.0}, now=0.0)
    limit = app_module._SENSOR_HOLD_SECONDS
    assert hold({"bk": None}, now=limit)["bk"] == 64.0
    assert hold({"bk": None}, now=limit + 0.1)["bk"] is None
    assert app_module._sensor_status["bk"] == "failed"


def test_the_hold_is_measured_in_wall_time_not_sweeps(app_module, hold):
    """A slow loop must not be able to stretch the window past what the
    safety rules assume — one late sweep can exhaust it on its own."""
    hold({"bk": 64.0}, now=0.0)
    assert hold({"bk": None}, now=app_module._SENSOR_HOLD_SECONDS + 5)["bk"] is None


def test_a_recovered_sensor_publishes_fresh_readings_again(app_module, hold):
    hold({"bk": 64.0}, now=0.0)
    hold({"bk": None}, now=1.0)
    assert hold({"bk": 64.5}, now=2.0) == {"bk": 64.5}
    assert app_module._sensor_status["bk"] == "ok"


def test_a_sensor_that_recovers_after_failing_outright_is_trusted_again(app_module, hold):
    """A probe reseated mid-brew. Nothing latches."""
    hold({"bk": 64.0}, now=0.0)
    hold({"bk": None}, now=60.0)
    assert app_module._sensor_status["bk"] == "failed"
    assert hold({"bk": 30.0}, now=61.0) == {"bk": 30.0}
    assert app_module._sensor_status["bk"] == "ok"


def test_a_sensor_that_has_never_read_holds_nothing(app_module, hold):
    """There is no last good value to stand in, and inventing one would be
    worse than the dash."""
    assert hold({"bk": None}, now=0.0) == {"bk": None}
    assert app_module._sensor_status["bk"] == "failed"


def test_each_sensor_holds_independently(app_module, hold):
    hold({"bk": 64.0, "mlt": 20.0, "hlt": 71.5}, now=0.0)
    published = hold({"bk": None, "mlt": 20.4, "hlt": None}, now=1.0)
    assert published == {"bk": 64.0, "mlt": 20.4, "hlt": 71.5}
    assert app_module._sensor_status == {"bk": "held", "mlt": "ok", "hlt": "held"}


def test_a_held_value_keeps_its_calibration(app_module, hold, write_config):
    """The bridge sits downstream of the offset, so what is held is the
    corrected number the rest of the system agrees on."""
    config = write_config(lambda d: d["sensors"].update({"calibration": {"bk": 2.0}}))
    corrected = app_module._apply_calibration({"bk": 64.0}, config)
    hold(corrected, now=0.0)
    assert hold({"bk": None}, now=1.0)["bk"] == 66.0


def test_the_hold_stays_inside_the_stale_sensor_watchdog(app_module):
    """The watchdog is the outer bound on running blind and must remain so."""
    assert app_module._SENSOR_HOLD_SECONDS < app_module._SENSOR_STALE_SECONDS


# ─── What this actually bought: the element stops flinching ──────────────────


def test_a_regulating_heater_rides_out_a_single_dropped_read(app_module, hold, gpio, config):
    """The fault this whole thing exists to stop: one bad CRC used to cut
    8.5 kW out from under a mash.

    Asserted on the pin rather than the state dict — 10 °C below its set value
    the pot is regulating at full power, and what matters is that nothing wrote
    that pin low.
    """
    pots = app_module._control_state["pots"]
    pots["BK"].update({"sv": 70.0, "regulationEnabled": True, "heaterOn": False, "efficiency": 0})
    bk_pin = config["gpio"]["pot"]["bk"]

    # Let regulation switch it on, so the pin is genuinely driven.
    app_module._temperature_cache.update(hold({"bk": 60.0}, now=0.0))
    app_module._regulation_tick(config)
    assert pots["BK"]["heaterOn"] is True
    assert gpio.is_on(bk_pin)

    app_module._temperature_cache.update(hold({"bk": None}, now=1.0))
    app_module._regulation_tick(config)
    assert pots["BK"]["heaterOn"] is True
    assert gpio.is_on(bk_pin)


def test_a_heater_still_goes_off_when_the_sensor_is_really_gone(app_module, hold, gpio, config):
    """Regulating blind means full power into a pot nobody is watching."""
    pots = app_module._control_state["pots"]
    pots["BK"].update({"sv": 70.0, "regulationEnabled": True, "heaterOn": False, "efficiency": 0})
    bk_pin = config["gpio"]["pot"]["bk"]

    app_module._temperature_cache.update(hold({"bk": 60.0}, now=0.0))
    app_module._regulation_tick(config)
    assert gpio.is_on(bk_pin)

    app_module._temperature_cache.update(
        hold({"bk": None}, now=app_module._SENSOR_HOLD_SECONDS + 0.1)
    )
    app_module._regulation_tick(config)
    assert pots["BK"]["heaterOn"] is False
    assert not gpio.is_on(bk_pin)


def test_the_over_temp_cutoff_still_sees_a_held_reading(app_module, hold, config):
    """A dropped read used to skip the cutoff entirely; now the last known
    temperature keeps guarding for as long as it is held."""
    pots = app_module._control_state["pots"]
    pots["BK"].update({"regulationEnabled": False, "heaterOn": True, "efficiency": 100})

    hold({"bk": app_module._MAX_TEMP_CUTOFF_C + 1}, now=0.0)
    app_module._temperature_cache.update(hold({"bk": None}, now=1.0))
    app_module._regulation_tick(config)
    assert pots["BK"]["heaterOn"] is False
