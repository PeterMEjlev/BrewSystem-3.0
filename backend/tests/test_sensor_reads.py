"""Reading a DS18B20, and telling the failures apart.

A sensor that stops answering, a sensor whose data arrives corrupt, and a sensor
the kernel has dropped from the bus are three different faults with three
different repairs. The code these tests cover used to report all of them as one
`Error reading DS18B20 ...: list index out of range`, once a second, for as long
as the fault lasted — which on the BK probe meant thousands of identical lines
that said nothing about which fault it was.

The bus is faked with a directory of files, so none of this needs a Pi.
"""
import asyncio
import logging

import pytest

import utils_rpi


GOOD = ["3b 01 4b 46 7f ff 0c 10 17 : crc=17 YES\n",
        "3b 01 4b 46 7f ff 0c 10 17 t=19750\n"]
BAD_CRC = ["3b 01 4b 46 7f ff 0c 10 17 : crc=17 NO\n",
           "3b 01 4b 46 7f ff 0c 10 17 t=19750\n"]

SERIAL = "28-00000b80089a"


@pytest.fixture
def bus(tmp_path, monkeypatch):
    """A fake /sys/bus/w1/devices that tests can add and remove sensors from."""
    monkeypatch.setattr(utils_rpi, "W1_DEVICES_DIR", str(tmp_path))
    monkeypatch.setattr(utils_rpi, "IS_RPI", True)
    # The retry delay is real time; nothing here is testing that it elapses.
    monkeypatch.setattr(utils_rpi, "_READ_RETRY_DELAY", 0)
    utils_rpi._last_failure.clear()

    class Bus:
        root = tmp_path

        def attach(self, serial=SERIAL, lines=GOOD):
            d = tmp_path / serial
            d.mkdir(exist_ok=True)
            (d / "w1_slave").write_text("".join(lines))
            (d / "resolution").write_text("12")
            return d

        def detach(self, serial=SERIAL):
            """What the kernel does after a slave misses enough bus scans."""
            for f in (tmp_path / serial).iterdir():
                f.unlink()
            (tmp_path / serial).rmdir()

    return Bus()


# ─── Parsing ──────────────────────────────────────────────────────────────────

def test_a_good_read_yields_celsius():
    assert utils_rpi.parse_w1_slave(GOOD) == (19.75, None)


def test_an_empty_read_is_a_missing_presence_pulse_not_a_crc_error():
    """The BK probe's actual failure mode, and the whole point of this split.

    Zero bytes back means nothing answered the bus — an open connection or a
    dead chip. Reporting it as a CRC failure would send someone looking for
    interference that isn't there.
    """
    assert utils_rpi.parse_w1_slave([]) == (None, utils_rpi.FAILURE_NO_PRESENCE)


def test_a_failed_crc_is_reported_as_a_failed_crc():
    assert utils_rpi.parse_w1_slave(BAD_CRC) == (None, utils_rpi.FAILURE_CRC)


@pytest.mark.parametrize("lines", [
    [GOOD[0]],                                  # header only, no reading line
    [GOOD[0], "3b 01 4b 46 7f ff 0c 10 17\n"],  # reading line with no t=
    [GOOD[0], "3b 01 4b 46 7f ff 0c 10 17 t=nonsense\n"],
])
def test_contents_that_make_no_sense_are_reported_as_malformed(lines):
    assert utils_rpi.parse_w1_slave(lines) == (None, utils_rpi.FAILURE_MALFORMED)


# ─── Reading ──────────────────────────────────────────────────────────────────

def test_a_sensor_on_the_bus_reads(bus):
    bus.attach()
    assert utils_rpi.read_ds18b20(SERIAL) == 19.75
    assert utils_rpi.last_failure_reason(SERIAL) is None


def test_one_bad_transaction_is_retried_rather_than_failing_the_sweep(bus, monkeypatch):
    """A single dropped transaction should not cost the caller a reading.

    The sensor answers with nothing on the first attempt and properly on the
    second — driven from the retry delay, so this exercises the real loop.
    """
    device = bus.attach(lines=[])
    attempts = []

    def answer_on_retry(_delay):
        attempts.append(1)
        (device / "w1_slave").write_text("".join(GOOD))

    monkeypatch.setattr(utils_rpi.time, "sleep", answer_on_retry)

    assert utils_rpi.read_ds18b20(SERIAL) == 19.75
    assert len(attempts) == 1


def test_a_sensor_that_never_answers_fails_with_a_reason(bus):
    bus.attach(lines=[])
    assert utils_rpi.read_ds18b20(SERIAL) is None
    assert utils_rpi.last_failure_reason(SERIAL) == utils_rpi.FAILURE_NO_PRESENCE


def test_a_sensor_the_kernel_has_dropped_says_so(bus):
    """Previously this returned None in silence, so an outage had a logged
    start and no logged end."""
    assert not utils_rpi.sensor_present(SERIAL)
    assert utils_rpi.read_ds18b20(SERIAL) is None
    assert utils_rpi.last_failure_reason(SERIAL) == utils_rpi.FAILURE_ABSENT


def test_a_missing_device_is_not_retried(bus, monkeypatch):
    """There is nothing to retry until the kernel's next bus scan, and a rig
    with three missing sensors must not spend its read loop waiting."""
    slept = []
    monkeypatch.setattr(utils_rpi.time, "sleep", lambda d: slept.append(d))
    utils_rpi.read_ds18b20(SERIAL)
    assert slept == []


def test_the_retry_budget_bounds_a_slow_failing_sensor(bus, monkeypatch):
    """Retries are capped by wall time as well as by count, so a sensor that
    makes the kernel sit through a conversion wait each attempt cannot stretch
    the read loop toward the safety watchdog's 10 s."""
    bus.attach(lines=[])
    monkeypatch.setattr(utils_rpi, "_READ_BUDGET_SECONDS", 0)
    slept = []
    monkeypatch.setattr(utils_rpi.time, "sleep", lambda d: slept.append(d))

    assert utils_rpi.read_ds18b20(SERIAL) is None
    assert slept == []  # gave up before the first retry


def test_recovery_clears_the_recorded_failure(bus):
    bus.attach(lines=[])
    utils_rpi.read_ds18b20(SERIAL)
    assert utils_rpi.last_failure_reason(SERIAL) is not None

    bus.attach(lines=GOOD)
    assert utils_rpi.read_ds18b20(SERIAL) == 19.75
    assert utils_rpi.last_failure_reason(SERIAL) is None


# ─── Logging ──────────────────────────────────────────────────────────────────

def test_a_stuck_sensor_logs_once_not_once_a_sweep(bus, caplog):
    """The BK outages produced ~100 identical lines each. One is enough."""
    bus.attach(lines=[])
    with caplog.at_level(logging.ERROR, logger=utils_rpi.__name__):
        for _ in range(5):
            utils_rpi.read_ds18b20(SERIAL)

    assert len(caplog.records) == 1
    assert "did not answer the bus" in caplog.records[0].getMessage()


def test_a_fault_changing_character_is_logged_again(bus, caplog):
    """Going from "answered with rubbish" to "did not answer at all" is a
    different fault, and worth a line even though both are failures."""
    bus.attach(lines=BAD_CRC)
    with caplog.at_level(logging.ERROR, logger=utils_rpi.__name__):
        utils_rpi.read_ds18b20(SERIAL)
        bus.attach(lines=[])
        utils_rpi.read_ds18b20(SERIAL)

    messages = [r.getMessage() for r in caplog.records]
    assert len(messages) == 2
    assert "CRC" in messages[0]
    assert "did not answer the bus" in messages[1]


# ─── Resolution across a dropout ──────────────────────────────────────────────

@pytest.fixture
def resolution_calls(app_module, monkeypatch):
    """Record every re-application of a sensor's resolution."""
    calls = []
    monkeypatch.setattr(
        utils_rpi, "initialize_ds18b20_resolution",
        lambda serial, resolution=None: calls.append((serial, resolution)),
    )
    return calls


def present(app_module, monkeypatch, *serials):
    monkeypatch.setattr(utils_rpi, "sensor_present", lambda s: s in serials)


def test_a_sensor_coming_back_has_its_resolution_re_applied(
    app_module, monkeypatch, resolution_calls
):
    """The setting lives in the chip's scratchpad, not its EEPROM, so a sensor
    that left the bus returns at the 12-bit power-on default. Before this,
    nothing re-applied it and the sensor stayed wrong until a restart."""
    sensors = app_module.read_config()["sensors"]["ds18b20"]
    app_module._sensor_node_present.update({"bk": False, "mlt": True, "hlt": True})
    present(app_module, monkeypatch, sensors["bk"], sensors["mlt"], sensors["hlt"])

    asyncio.run(app_module._resync_returned_sensors(sensors))

    assert resolution_calls == [(sensors["bk"], app_module._DS18B20_RESOLUTION)]
    assert app_module._sensor_node_present["bk"] is True


def test_a_sensor_that_never_left_is_not_touched(
    app_module, monkeypatch, resolution_calls
):
    sensors = app_module.read_config()["sensors"]["ds18b20"]
    present(app_module, monkeypatch, sensors["bk"], sensors["mlt"], sensors["hlt"])

    asyncio.run(app_module._resync_returned_sensors(sensors))
    asyncio.run(app_module._resync_returned_sensors(sensors))

    assert resolution_calls == []


def test_a_sensor_being_dropped_from_the_bus_is_logged(
    app_module, monkeypatch, resolution_calls, caplog
):
    """The transition that previously left no trace at all: once the node is
    gone every read fails instantly, so the error log simply stopped."""
    sensors = app_module.read_config()["sensors"]["ds18b20"]
    present(app_module, monkeypatch, sensors["mlt"], sensors["hlt"])

    with caplog.at_level(logging.ERROR):
        asyncio.run(app_module._resync_returned_sensors(sensors))

    assert any("dropped from the 1-Wire bus" in r.getMessage() for r in caplog.records)
    assert app_module._sensor_node_present["bk"] is False


def test_the_data_pin_entry_is_not_mistaken_for_a_sensor(
    app_module, monkeypatch, resolution_calls
):
    """`ds18b20` carries the bus's GPIO pin alongside the three serials, and it
    is not a device — the startup path has the same guard."""
    sensors = app_module.read_config()["sensors"]["ds18b20"]
    assert "pin" in sensors
    present(app_module, monkeypatch, sensors["bk"], sensors["mlt"], sensors["hlt"])

    asyncio.run(app_module._resync_returned_sensors(sensors))

    assert all(serial != sensors["pin"] for serial, _ in resolution_calls)


# ─── What the panel is told ───────────────────────────────────────────────────

def fault_report(app_module, pot_status, serial_reason=None):
    """The report as it would be built with the sensors in a given state."""
    sensors = app_module.read_config()["sensors"]["ds18b20"]
    app_module._sensor_status.update(pot_status)
    if serial_reason is not None:
        utils_rpi._last_failure[sensors["bk"]] = serial_reason
    return app_module._sensor_fault_report(), sensors


def test_healthy_sensors_report_no_fault(app_module):
    report, _ = fault_report(app_module, {"bk": "ok", "mlt": "ok", "hlt": "ok"})
    assert all(not f["active"] for f in report.values())
    assert all(f["detail"] is None for f in report.values())


def test_a_failed_sensor_reports_what_to_go_and_check(app_module):
    report, _ = fault_report(
        app_module, {"bk": "failed"}, utils_rpi.FAILURE_NO_PRESENCE
    )
    assert report["bk"]["active"] is True
    assert report["bk"]["reason"] == utils_rpi.FAILURE_NO_PRESENCE
    assert "check the probe's wiring" in report["bk"]["detail"]
    assert report["mlt"]["active"] is False


def test_the_guidance_follows_the_fault(app_module):
    """A probe that answers with rubbish and a probe that does not answer at all
    send you to look at different things."""
    report, _ = fault_report(app_module, {"bk": "failed"}, utils_rpi.FAILURE_CRC)
    assert "interference" in report["bk"]["detail"]

    report, _ = fault_report(app_module, {"bk": "failed"}, utils_rpi.FAILURE_ABSENT)
    assert "dropped off the 1-Wire bus" in report["bk"]["detail"]


def test_a_held_reading_is_not_a_fault(app_module):
    """Three seconds of bridging one dropped transaction is not something to put
    a banner on the screen for — doing so would teach the brewer to ignore it."""
    report, _ = fault_report(
        app_module, {"bk": "held"}, utils_rpi.FAILURE_NO_PRESENCE
    )
    assert report["bk"]["active"] is False
    assert report["bk"]["detail"] is None


def test_an_unrecognised_reason_still_says_something(app_module):
    report, _ = fault_report(app_module, {"bk": "failed"}, "something-new")
    assert report["bk"]["detail"] == app_module._SENSOR_FAULT_FALLBACK


def test_the_fault_report_rides_out_on_the_state_snapshot(app_module):
    fault_report(app_module, {"bk": "failed"}, utils_rpi.FAILURE_ABSENT)
    snapshot = app_module._state_snapshot()
    assert snapshot["sensorFaults"]["bk"]["active"] is True
    assert snapshot["sensorFaults"]["bk"]["detail"]
