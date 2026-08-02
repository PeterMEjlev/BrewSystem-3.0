"""The brew timer state machine.

Time is injected rather than slept through: these want to assert what happens
after twenty minutes, and a test suite that takes twenty minutes gets skipped.
"""
import pytest


@pytest.fixture
def clock(app_module, monkeypatch):
    """A monotonic clock the test drives by hand."""
    class Clock:
        now = 1000.0

        def advance(self, seconds):
            self.rewind(-seconds)

        def rewind(self, seconds):
            self.now -= seconds

    c = Clock()
    monkeypatch.setattr(app_module.time, "monotonic", lambda: c.now)
    return c


@pytest.fixture
def timer(app_module):
    return app_module._timer_state


def act(app_module, action, seconds=None):
    """Drive the timer the way the endpoint does, without the HTTP layer."""
    state = app_module._timer_state
    if action == "start":
        if not state["running"]:
            state["started_at"] = app_module.time.monotonic()
            state["running"] = True
    elif action == "stop":
        if state["running"]:
            state["elapsed"] += app_module.time.monotonic() - state["started_at"]
            state["started_at"] = None
            state["running"] = False
    elif action == "reset":
        state.update({"running": False, "elapsed": 0.0, "started_at": None, "target": 0})
    elif action == "set":
        state.update({"target": seconds, "running": False, "elapsed": 0.0, "started_at": None})
    return app_module._get_timer_seconds()


# ── Stopwatch mode (no target) ────────────────────────────────────────────────

def test_stopwatch_counts_up(app_module, clock, timer):
    act(app_module, "start")
    clock.advance(42)
    assert app_module._get_timer_seconds() == 42


def test_stopwatch_holds_while_paused(app_module, clock):
    act(app_module, "start")
    clock.advance(30)
    act(app_module, "stop")
    clock.advance(120)  # time passes, the timer does not
    assert app_module._get_timer_seconds() == 30


def test_resume_continues_from_where_it_stopped(app_module, clock):
    act(app_module, "start")
    clock.advance(30)
    act(app_module, "stop")
    clock.advance(120)
    act(app_module, "start")
    clock.advance(10)
    assert app_module._get_timer_seconds() == 40


def test_reset_clears_everything(app_module, clock, timer):
    act(app_module, "start")
    clock.advance(90)
    act(app_module, "reset")
    assert app_module._get_timer_seconds() == 0
    assert timer["running"] is False
    assert timer["target"] == 0


# ── Countdown mode ────────────────────────────────────────────────────────────

def test_countdown_counts_down(app_module, clock):
    act(app_module, "set", 60)
    act(app_module, "start")
    clock.advance(20)
    assert app_module._get_timer_seconds() == 40


def test_countdown_stops_itself_at_zero(app_module, clock, timer):
    """The hop-addition case: it has to stop, and stay stopped, on its own."""
    act(app_module, "set", 60)
    act(app_module, "start")
    clock.advance(60)
    assert app_module._get_timer_seconds() == 0
    assert timer["running"] is False


def test_countdown_does_not_go_negative(app_module, clock):
    act(app_module, "set", 60)
    act(app_module, "start")
    clock.advance(300)  # nobody was looking for five minutes
    assert app_module._get_timer_seconds() == 0


def test_a_finished_countdown_stays_finished(app_module, clock):
    act(app_module, "set", 10)
    act(app_module, "start")
    clock.advance(10)
    assert app_module._get_timer_seconds() == 0
    clock.advance(600)
    assert app_module._get_timer_seconds() == 0


def test_setting_a_target_rearms_a_finished_timer(app_module, clock, timer):
    act(app_module, "set", 10)
    act(app_module, "start")
    clock.advance(10)
    act(app_module, "set", 90)
    assert app_module._get_timer_seconds() == 90
    assert timer["running"] is False
    act(app_module, "start")
    clock.advance(30)
    assert app_module._get_timer_seconds() == 60


def test_pausing_a_countdown_holds_the_remainder(app_module, clock):
    act(app_module, "set", 3600)  # a 60 minute boil
    act(app_module, "start")
    clock.advance(1200)
    act(app_module, "stop")
    assert app_module._get_timer_seconds() == 2400
    clock.advance(999)
    assert app_module._get_timer_seconds() == 2400


def test_starting_twice_does_not_lose_elapsed_time(app_module, clock):
    """A double tap must not restart the clock mid-boil."""
    act(app_module, "start")
    clock.advance(50)
    act(app_module, "start")  # already running — should be a no-op
    clock.advance(10)
    assert app_module._get_timer_seconds() == 60


def test_stopping_twice_is_harmless(app_module, clock):
    act(app_module, "start")
    clock.advance(25)
    act(app_module, "stop")
    act(app_module, "stop")
    assert app_module._get_timer_seconds() == 25
