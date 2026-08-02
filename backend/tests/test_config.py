"""Config durability, and the warnings that say the rig isn't itself.

Everything here is about the SD card: it is the least reliable part of a Pi,
and the file it holds is this rig's wiring.
"""
import json
import os
from pathlib import Path

import pytest

import utils_rpi


def read_config_file(app_module):
    return json.loads(Path(app_module.CONFIG_FILE).read_text())


# ── Atomic writes ─────────────────────────────────────────────────────────────

def test_a_write_lands(app_module):
    data = read_config_file(app_module)
    data["app"]["max_watts"] = 9999
    app_module.write_config_atomic(data)
    assert read_config_file(app_module)["app"]["max_watts"] == 9999


def test_the_write_is_flushed_before_the_rename(app_module, monkeypatch):
    """Durability you cannot observe without pulling the power out, so this
    asserts the syscalls instead — and their order, which is the whole point:
    the bytes must be on the card before the rename that publishes them, or a
    power cut leaves a config the filesystem thinks is fine and json.load does
    not.
    """
    order = []
    real_fsync, real_replace = os.fsync, os.replace
    monkeypatch.setattr(app_module.os, "fsync",
                        lambda fd: (order.append("fsync"), real_fsync(fd))[1])
    monkeypatch.setattr(app_module.os, "replace",
                        lambda src, dst: (order.append("replace"), real_replace(src, dst))[1])

    app_module.write_config_atomic(read_config_file(app_module))
    assert order == ["fsync", "replace"]


def test_a_write_leaves_no_stray_tmp_file(app_module):
    directory = Path(app_module.CONFIG_FILE).parent
    app_module.write_config_atomic(read_config_file(app_module))
    assert [f for f in os.listdir(directory) if f.endswith(".tmp")] == []


def test_a_failed_write_cleans_up_after_itself(app_module, monkeypatch):
    """A tmp file left beside the config outlives the failure that made it."""
    directory = Path(app_module.CONFIG_FILE).parent

    def boom(*_args, **_kwargs):
        raise OSError("no space left on device")

    monkeypatch.setattr(app_module.os, "replace", boom)
    with pytest.raises(OSError):
        app_module.write_config_atomic(read_config_file(app_module))
    assert [f for f in os.listdir(directory) if f.endswith(".tmp")] == []


def test_a_failed_write_leaves_the_old_config_intact(app_module, monkeypatch):
    original = read_config_file(app_module)
    monkeypatch.setattr(app_module.os, "replace",
                        lambda *a, **k: (_ for _ in ()).throw(OSError("disk full")))
    with pytest.raises(OSError):
        app_module.write_config_atomic({"gpio": {}, "wrecked": True})
    assert read_config_file(app_module) == original


# ── Surviving a corrupt config ────────────────────────────────────────────────

def test_a_truncated_config_falls_back_instead_of_refusing_to_start(app_module):
    """The classic power-cut-mid-write failure. Not booting is the wrong answer
    on a brew day; booting silently on the wrong pins is a worse one."""
    Path(app_module.CONFIG_FILE).write_text('{"gpio": {"pot": {"bk": 17, "hl')
    app_module._config_cache = None
    app_module._config_fallback_reason = None

    config = app_module.read_config()
    defaults = json.loads(Path(app_module.DEFAULT_CONFIG_FILE).read_text())
    assert config["gpio"] == defaults["gpio"]
    assert app_module._config_fallback_reason is not None


def test_the_fallback_is_visible_on_screen(app_module):
    """A log line nobody reads is not a warning. This is what reaches the UI."""
    Path(app_module.CONFIG_FILE).write_text("not json at all")
    app_module._config_cache = None
    app_module._config_fallback_reason = None
    app_module.read_config()

    warning = app_module._system_warnings().get("configFallback")
    assert warning and warning["active"] is True
    assert "Settings" in warning["detail"], "it must say where to go and fix it"


def test_a_healthy_config_raises_no_fallback(app_module):
    app_module._config_cache = None
    app_module._config_fallback_reason = None
    app_module.read_config()
    assert app_module._config_fallback_reason is None
    assert "configFallback" not in app_module._system_warnings()


# ── Normalising an older config ───────────────────────────────────────────────

def test_a_config_predating_calibration_gains_the_block(app_module):
    """Every config.json on an existing rig. The Settings panel should find the
    field already there rather than having to invent it."""
    data = read_config_file(app_module)
    data["sensors"].pop("calibration", None)
    Path(app_module.CONFIG_FILE).write_text(json.dumps(data))
    app_module._config_cache = None

    app_module._normalize_config()

    assert read_config_file(app_module)["sensors"]["calibration"] == {
        "bk": 0.0, "mlt": 0.0, "hlt": 0.0,
    }


def test_normalising_does_not_lose_the_sensor_serials(app_module):
    """`sensors` is typed now; the serials and 1-Wire pin ride through as extras
    and losing them would mean a rig that reads no temperatures at all."""
    before = read_config_file(app_module)["sensors"]["ds18b20"]
    app_module._config_cache = None
    app_module._normalize_config()
    assert read_config_file(app_module)["sensors"]["ds18b20"] == before


def test_normalising_is_idempotent(app_module):
    app_module._config_cache = None
    app_module._normalize_config()
    once = read_config_file(app_module)
    app_module._config_cache = None
    app_module._normalize_config()
    assert read_config_file(app_module) == once


# ── Simulation mode ───────────────────────────────────────────────────────────

def test_simulation_mode_is_reported(app_module, monkeypatch):
    """Entered by the absence of pigpio, so it announces itself nowhere else."""
    monkeypatch.setattr(utils_rpi, "IS_RPI", False)
    warning = app_module._system_warnings().get("simulation")
    assert warning and warning["active"] is True


def test_a_real_rig_reports_nothing(app_module, monkeypatch):
    """No banner on a healthy rig — a warning that is always up is wallpaper."""
    monkeypatch.setattr(utils_rpi, "IS_RPI", True)
    app_module._config_cache = None
    app_module._config_fallback_reason = None
    app_module.read_config()
    assert app_module._system_warnings() == {}
