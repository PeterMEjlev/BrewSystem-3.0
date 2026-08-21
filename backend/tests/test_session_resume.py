"""Surviving a restart mid-brew.

The rig gets bounced during a brew day — an update deployed from BrewPlanner,
a service that fell over, the power blinking. What has to come back is the
record: the log it was writing, where the brew had got to, the boil clock. What
must NOT come back is anything that closes a relay.

Time is injected throughout, because the whole feature is about a gap in it.
"""
import json
import os

import pytest


@pytest.fixture
def clock(app_module, monkeypatch):
    """Wall clock the test drives by hand. Monotonic is left alone — nothing
    here spans a real interval, and asyncio is using it."""
    class Clock:
        now = 1_700_000_000.0

        def advance(self, seconds):
            self.now += seconds

    c = Clock()
    monkeypatch.setattr(app_module.time, "time", lambda: c.now)
    return c


@pytest.fixture
def brew(app_module, clock):
    """A brew in progress, written to disk the way the running rig writes it."""
    def _start(stage_steps=3, timer_target=0, timer_running=False, rows=2):
        app_module._start_fresh_session()
        for _ in range(rows):
            app_module.session_logger.log_reading(bk=64.0, mlt=63.0, hlt=70.0)
        for _ in range(stage_steps):
            app_module._step_brew_stage(1)
        if timer_target:
            app_module._timer_state.update({
                "target": timer_target,
                "elapsed": 0.0,
                "running": timer_running,
                "epoch_started_at": clock.now if timer_running else None,
                "started_at": app_module.time.monotonic() if timer_running else None,
            })
        app_module._save_session_state()
        return app_module.session_logger.current_path
    return _start


def restart(app_module, away_seconds=60, log_path=None):
    """Everything a new process starts with, then the startup restore.

    `away_seconds` is applied to the log file's mtime, which is what the
    restore reads as "when the rig was last alive".
    """
    path = log_path or app_module.session_logger.current_path
    if path is not None and path.exists():
        when = app_module.time.time() - away_seconds
        os.utime(path, (when, when))

    # As a fresh interpreter would have them.
    app_module._stage_state.update({"index": app_module.STAGE_NOT_STARTED, "markers": []})
    app_module._reset_timer()
    app_module._active_brew_session = None
    app_module._last_saved_session_state = None
    app_module.session_logger._log_path = None
    app_module.session_logger._history = []
    for pot in app_module._control_state["pots"].values():
        pot.update({"heaterOn": False, "efficiency": 0, "regulationEnabled": False})

    app_module._pending_resume = app_module._restore_interrupted_session()
    return app_module._pending_resume


# ── Picking the brew back up ──────────────────────────────────────────────────

def test_an_interrupted_brew_is_offered_back(app_module, brew):
    brew(stage_steps=3)
    offer = restart(app_module)
    assert offer is not None
    assert offer["stage"] == app_module.BREW_STAGES[2]
    assert offer["awaySeconds"] == 60


def test_the_stage_and_its_marks_come_back(app_module, brew):
    brew(stage_steps=3)
    marks_before = [dict(m) for m in app_module._stage_state["markers"]]
    restart(app_module)
    assert app_module._stage_state["index"] == 2
    assert app_module._stage_state["markers"] == marks_before


def test_the_session_log_is_reopened_rather_than_rolled(app_module, brew):
    """The curve on the chart is the whole point — it must not start again."""
    path = brew(rows=5)
    restart(app_module)
    assert app_module.session_logger.current_path == path
    assert len(app_module.session_logger.get_history()) == 5


def test_readings_continue_into_the_same_file(app_module, brew):
    brew(rows=5)
    restart(app_module)
    app_module.session_logger.log_reading(bk=66.0, mlt=65.0, hlt=71.0)
    assert len(app_module.session_logger.get_history()) == 6


def test_a_failed_sensor_reading_survives_the_round_trip(app_module, brew):
    """None means "no reading" and must not come back as a temperature."""
    brew(rows=0)
    app_module.session_logger.log_reading(bk=64.0, mlt=None, hlt=70.0)
    app_module._save_session_state()
    restart(app_module)
    row = app_module.session_logger.get_history()[-1]
    assert row["bk"] == 64.0
    assert row["mlt"] is None


def test_set_values_come_back(app_module, brew):
    """One press to re-arm, not a re-setup."""
    app_module._control_state["pots"]["BK"].update({"sv": 67.5, "efficiency": 80})
    brew()
    restart(app_module)
    assert app_module._control_state["pots"]["BK"]["sv"] == 67.5
    assert app_module._control_state["pots"]["BK"]["efficiency"] == 80


# ── What must never come back ─────────────────────────────────────────────────

def test_heaters_are_not_restored(app_module, brew):
    """_regulation_tick turns elements on by itself. A rig that restored an
    armed regulator would start heating, unattended, in an empty brewery."""
    app_module._control_state["pots"]["BK"].update({
        "heaterOn": True, "regulationEnabled": True, "sv": 67.0,
    })
    brew()
    restart(app_module)
    assert app_module._control_state["pots"]["BK"]["heaterOn"] is False
    assert app_module._control_state["pots"]["BK"]["regulationEnabled"] is False


def test_the_record_never_carries_the_switches(app_module, brew):
    app_module._control_state["pots"]["BK"].update({"heaterOn": True, "regulationEnabled": True})
    brew()
    blob = json.loads(app_module._session_state_path().read_text())
    saved = json.dumps(blob["setpoints"])
    assert "heaterOn" not in saved and "regulationEnabled" not in saved


# ── When not to ask ───────────────────────────────────────────────────────────

def test_a_rig_idling_on_the_bench_is_not_offered_a_resume(app_module, brew):
    """No stage, no timer, no batch — a reboot must not stop to ask."""
    brew(stage_steps=0)
    assert restart(app_module) is None


def test_a_brew_older_than_the_window_is_not_offered(app_module, brew):
    brew(stage_steps=3)
    assert restart(app_module, away_seconds=7 * 3600) is None


def test_a_brew_inside_the_window_still_is(app_module, brew):
    brew(stage_steps=3)
    assert restart(app_module, away_seconds=5 * 3600) is not None


def test_a_missing_log_file_is_not_resumable(app_module, brew):
    path = brew(stage_steps=3)
    when = app_module.time.time() - 60
    os.utime(path, (when, when))
    path.unlink()
    assert restart(app_module, log_path=None) is None


def test_a_record_from_another_version_is_ignored(app_module, brew):
    brew(stage_steps=3)
    state_path = app_module._session_state_path()
    blob = json.loads(state_path.read_text())
    blob["version"] = app_module._SESSION_STATE_VERSION + 1
    state_path.write_text(json.dumps(blob))
    assert restart(app_module) is None


def test_an_unreadable_record_is_ignored(app_module, brew):
    """A power cut can leave a half-written file. It must not stop the rig."""
    brew(stage_steps=3)
    app_module._session_state_path().write_text("{not json at all")
    assert restart(app_module) is None


def test_no_record_at_all_is_ignored(app_module):
    assert app_module._restore_interrupted_session() is None


def test_a_timer_alone_is_enough_to_ask(app_module, brew):
    """A boil clock set but no stage tapped is still a brew in progress."""
    brew(stage_steps=0, timer_target=3600)
    assert restart(app_module) is not None


def test_a_logged_batch_alone_is_enough_to_ask(app_module, brew):
    brew(stage_steps=0)
    # Set after the session rolls, the way start_brew_session records it.
    app_module._active_brew_session = {"brewSessionId": "abc", "name": "Konfus IPA"}
    app_module._save_session_state()
    offer = restart(app_module)
    assert offer is not None
    assert offer["brewSession"]["name"] == "Konfus IPA"


# ── The timer across the gap ──────────────────────────────────────────────────

def test_a_running_boil_keeps_counting_through_the_outage(app_module, brew, clock):
    """The deploy button bounces the service; the wort does not stop boiling."""
    brew(stage_steps=5, timer_target=3600, timer_running=True)
    clock.advance(40)
    restart(app_module, away_seconds=40)
    assert app_module._timer_state["running"] is True
    assert app_module._get_timer_seconds() == pytest.approx(3560, abs=1)


def test_a_boil_that_ended_while_the_rig_was_away_comes_back_at_zero(app_module, brew, clock):
    brew(stage_steps=5, timer_target=600, timer_running=True)
    clock.advance(900)
    restart(app_module, away_seconds=900)
    assert app_module._get_timer_seconds() == 0
    assert app_module._timer_state["running"] is False


def test_a_paused_timer_comes_back_paused(app_module, brew, clock):
    brew(stage_steps=5, timer_target=3600, timer_running=False)
    app_module._timer_state["elapsed"] = 1200.0
    app_module._last_saved_session_state = None
    app_module._save_session_state()
    clock.advance(300)
    restart(app_module, away_seconds=300)
    assert app_module._timer_state["running"] is False
    assert app_module._get_timer_seconds() == 2400


# ── Answering the offer ───────────────────────────────────────────────────────

def test_resuming_settles_the_question_and_keeps_everything(app_module, brew):
    import asyncio

    path = brew(stage_steps=3, rows=4)
    restart(app_module)
    asyncio.run(app_module.resolve_session_resume(
        app_module.SessionResumeRequest(action="resume")
    ))
    assert app_module._pending_resume is None
    assert app_module.session_logger.current_path == path
    assert app_module._stage_state["index"] == 2
    assert len(app_module.session_logger.get_history()) == 4


def test_starting_fresh_rolls_the_log_and_clears_the_brew(app_module, brew):
    import asyncio

    path = brew(stage_steps=3, rows=4)
    restart(app_module)
    asyncio.run(app_module.resolve_session_resume(
        app_module.SessionResumeRequest(action="fresh")
    ))
    assert app_module._pending_resume is None
    assert app_module.session_logger.current_path != path
    assert app_module.session_logger.get_history() == []
    assert app_module._stage_state["index"] == app_module.STAGE_NOT_STARTED
    assert app_module._timer_state["target"] == 0


def test_answering_twice_is_not_an_error(app_module, brew):
    """Two screens can be showing this dialog; the second tap finds it settled."""
    import asyncio

    brew(stage_steps=3)
    restart(app_module)
    first = asyncio.run(app_module.resolve_session_resume(
        app_module.SessionResumeRequest(action="resume")
    ))
    second = asyncio.run(app_module.resolve_session_resume(
        app_module.SessionResumeRequest(action="resume")
    ))
    assert first["resolved"] is True
    assert second["resolved"] is False


def test_the_offer_is_reported_to_the_screens(app_module, brew):
    brew(stage_steps=3)
    assert app_module._state_snapshot()["sessionResume"]["pending"] is False
    restart(app_module)
    report = app_module._state_snapshot()["sessionResume"]
    assert report["pending"] is True
    assert report["stage"] == app_module.BREW_STAGES[2]


def test_the_offer_describes_the_timer_it_found(app_module, brew, clock):
    """Frozen at restore, not read live — reporting it live would re-identify
    the whole section every tick and push it to every screen every second."""
    brew(stage_steps=5, timer_target=3600, timer_running=True)
    clock.advance(40)
    offer = restart(app_module, away_seconds=40)
    assert offer["timer"]["running"] is True
    assert offer["timer"]["target"] == 3600
    assert offer["timer"]["seconds"] == pytest.approx(3560, abs=1)


def test_a_settled_offer_holds_still_on_the_wire(app_module, brew):
    """The section must not change from one snapshot to the next while it sits
    pending, or a running timer inside it would put a frame on the wire every
    second for as long as nobody answers."""
    brew(stage_steps=5, timer_target=3600, timer_running=True)
    restart(app_module)
    first = app_module._comparable(app_module._state_snapshot())
    second = app_module._comparable(app_module._state_snapshot())
    assert "sessionResume" not in app_module._diff(first, second)


def test_settling_the_offer_leaves_no_fields_behind(app_module, brew):
    """The socket diff only reports keys the new state has, so this section has
    to keep its shape or a client holds a settled offer's details forever."""
    import asyncio

    brew(stage_steps=3)
    restart(app_module)
    pending = app_module._state_snapshot()["sessionResume"]
    asyncio.run(app_module.resolve_session_resume(
        app_module.SessionResumeRequest(action="resume")
    ))
    settled = app_module._state_snapshot()["sessionResume"]
    assert set(settled) == set(pending)
    assert settled["pending"] is False
    assert settled["stage"] is None


# ── Keeping the record current, and off the SD card ───────────────────────────

def test_an_unchanged_brew_is_not_rewritten(app_module, brew):
    """The log loop saves every tick. A rig sitting in the mash must not be
    writing this file all day."""
    brew(stage_steps=3)
    path = app_module._session_state_path()
    before = path.stat().st_mtime_ns
    for _ in range(5):
        app_module._save_session_state()
    assert path.stat().st_mtime_ns == before


def test_a_stage_change_is_written_through(app_module, brew):
    brew(stage_steps=3)
    app_module._step_brew_stage(1)
    app_module._save_session_state()
    blob = json.loads(app_module._session_state_path().read_text())
    assert blob["brewStage"]["index"] == 3


def test_a_new_session_never_lands_on_an_existing_log(app_module):
    """Seconds are not fine enough on their own, and this file is the only
    copy of the readings the previous session took."""
    app_module._start_fresh_session()
    first = app_module.session_logger.current_path
    app_module.session_logger.log_reading(bk=64.0, mlt=63.0, hlt=70.0)
    app_module._start_fresh_session()
    assert app_module.session_logger.current_path != first
    assert first.exists()
    assert len(first.read_text().strip().splitlines()) == 2  # header + reading


def test_a_new_session_leaves_nothing_to_resume(app_module, brew):
    brew(stage_steps=3)
    app_module._start_fresh_session()
    blob = json.loads(app_module._session_state_path().read_text())
    assert app_module._looks_like_a_brew(blob) is False
