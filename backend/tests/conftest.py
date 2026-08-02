"""Shared fixtures.

Everything here runs against a sandboxed copy of config.default.json with the
GPIO layer mocked out, so a test run never touches the rig's own config, its
session logs, or (on the Pi) its relays.
"""
import json
import shutil
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

import session_logger  # noqa: E402
import utils_rpi  # noqa: E402


class FakeGpio:
    """Records what the control code asked the hardware to do.

    The point of most of these tests is *not* what `_control_state` says — it
    is whether the pin that carries 8.5 kW agrees with it. So the assertions
    read from here rather than from the state dict wherever both would do.
    """

    def __init__(self):
        self.high = set()
        self.low = set()
        self.duty = {}          # pin -> last duty cycle written
        self.pwm_started = {}   # pin -> last (frequency, duty) started
        self.pwm_stopped = []

    def install(self, monkeypatch):
        monkeypatch.setattr(utils_rpi, "set_gpio_high", self._high)
        monkeypatch.setattr(utils_rpi, "set_gpio_low", self._low)
        monkeypatch.setattr(utils_rpi, "set_pwm_signal", self._start_pwm)
        monkeypatch.setattr(utils_rpi, "change_pwm_duty_cycle", self._duty)
        monkeypatch.setattr(utils_rpi, "stop_pwm_signal", self._stop_pwm)
        monkeypatch.setattr(utils_rpi, "initialize_gpio", lambda: None)
        monkeypatch.setattr(utils_rpi, "initialize_ds18b20_resolution", lambda *a, **k: None)
        return self

    def _high(self, pin):
        self.high.add(pin)
        self.low.discard(pin)

    def _low(self, pin):
        self.low.add(pin)
        self.high.discard(pin)

    def _start_pwm(self, pin, frequency, duty):
        self.pwm_started[pin] = (frequency, duty)
        self.duty[pin] = duty

    def _duty(self, pin, value):
        self.duty[pin] = value

    def _stop_pwm(self, pin):
        self.pwm_stopped.append(pin)
        self.duty[pin] = 0

    def is_on(self, pin):
        return pin in self.high


@pytest.fixture
def gpio(monkeypatch):
    return FakeGpio().install(monkeypatch)


@pytest.fixture
def app_module(tmp_path, monkeypatch, gpio):
    """`main`, pointed at a throwaway config and log directory.

    main is a module with global state, so each test resets the bits it owns
    rather than getting a fresh import — reimporting would re-run the pigpio
    probe and leave the previous module's background tasks behind.
    """
    import main

    config_path = tmp_path / "config.json"
    default_path = tmp_path / "config.default.json"
    shutil.copyfile(BACKEND_DIR.parent / "config.default.json", default_path)
    shutil.copyfile(default_path, config_path)

    monkeypatch.setattr(main, "CONFIG_FILE", config_path)
    monkeypatch.setattr(main, "DEFAULT_CONFIG_FILE", default_path)
    monkeypatch.setattr(main, "_config_cache", None)
    monkeypatch.setattr(main, "_config_fallback_reason", None)
    monkeypatch.setattr(session_logger, "LOG_DIR", tmp_path / "session_logs")

    # Known starting point: everything off, nothing regulating, no timer.
    for pot in main._control_state["pots"].values():
        pot.update({"heaterOn": False, "sv": 100.0, "efficiency": 0, "regulationEnabled": False})
    for pump in main._control_state["pumps"].values():
        pump.update({"on": False, "speed": 0.0})
    main._timer_state.update({"running": False, "elapsed": 0.0, "started_at": None, "target": 0})
    main._temperature_cache.update({"bk": None, "mlt": None, "hlt": None})
    for pot in main._heat_watch:
        main._heat_watch[pot].update({"since": None, "baseline": None, "faulted_at": None})

    return main


@pytest.fixture
def config(app_module):
    return app_module.read_config()


@pytest.fixture
def write_config(app_module):
    """Replace a slice of the sandboxed config and drop the cache."""
    def _write(mutate):
        data = json.loads(Path(app_module.CONFIG_FILE).read_text())
        mutate(data)
        Path(app_module.CONFIG_FILE).write_text(json.dumps(data))
        app_module._config_cache = None
        return app_module.read_config()
    return _write
