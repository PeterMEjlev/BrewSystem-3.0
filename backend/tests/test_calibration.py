"""Sensor calibration offsets."""
import pytest


def test_offsets_are_applied_to_each_probe(app_module, write_config):
    config = write_config(lambda d: d["sensors"].update(
        {"calibration": {"bk": 0.4, "mlt": -0.3, "hlt": 0.0}}
    ))
    corrected = app_module._apply_calibration({"bk": 64.0, "mlt": 64.0, "hlt": 64.0}, config)
    assert corrected == {"bk": 64.4, "mlt": 63.7, "hlt": 64.0}


def test_a_failed_read_stays_a_failed_read(app_module, write_config):
    """An offset must not invent a temperature out of a missing one."""
    config = write_config(lambda d: d["sensors"].update({"calibration": {"bk": 0.5}}))
    assert app_module._apply_calibration({"bk": None}, config) == {"bk": None}


def test_a_config_without_calibration_changes_nothing(app_module, write_config):
    """Every config.json written before this feature existed."""
    config = write_config(lambda d: d["sensors"].pop("calibration", None))
    raw = {"bk": 64.0, "mlt": 20.0, "hlt": None}
    assert app_module._apply_calibration(raw, config) == raw


@pytest.mark.parametrize("junk", ["", None, "abc", {}])
def test_an_unusable_offset_is_ignored_rather_than_fatal(app_module, write_config, junk):
    """This value comes out of a hand-edited JSON file on an SD card."""
    config = write_config(lambda d: d["sensors"].update({"calibration": {"bk": junk}}))
    assert app_module._apply_calibration({"bk": 64.0}, config) == {"bk": 64.0}


def test_an_absurd_offset_is_clamped(app_module, write_config):
    """A probe 40 °C out is broken or in the wrong pot. Correcting for that
    would hide exactly the fault the heat-fault watcher exists to catch."""
    config = write_config(lambda d: d["sensors"].update({"calibration": {"bk": 40.0}}))
    corrected = app_module._apply_calibration({"bk": 64.0}, config)
    assert corrected["bk"] == 64.0 + app_module._MAX_CALIBRATION_OFFSET_C


def test_regulation_acts_on_the_corrected_reading(app_module, write_config, gpio):
    """The offset has to reach the control loop, not just the display — a
    calibrated number the regulator could not see would be worse than none."""
    config = write_config(lambda d: d["sensors"].update({"calibration": {"bk": 2.0}}))
    pots = app_module._control_state["pots"]
    pots["BK"].update({"sv": 65.0, "regulationEnabled": True, "heaterOn": True})

    # Raw 64.0 reads as 66.0 once corrected: past the set value, so heat off.
    app_module._temperature_cache.update(app_module._apply_calibration({"bk": 64.0}, config))
    app_module._regulation_tick(config)
    assert pots["BK"]["heaterOn"] is False


def test_the_safety_cutoff_uses_the_corrected_reading(app_module, write_config):
    config = write_config(lambda d: d["sensors"].update({"calibration": {"bk": 3.0}}))
    pots = app_module._control_state["pots"]
    pots["BK"].update({"regulationEnabled": False, "heaterOn": True, "efficiency": 100})

    raw = app_module._MAX_TEMP_CUTOFF_C - 1  # under the limit raw, over it corrected
    app_module._temperature_cache.update(app_module._apply_calibration({"bk": raw}, config))
    app_module._regulation_tick(config)
    assert pots["BK"]["heaterOn"] is False
