"""The brew-stage state machine, and the marks it leaves on the chart.

The markers are the part worth testing: the index on its own is only ever one
button press away from being corrected, but a stray mark is a line drawn across
a brew day's temperature curve that nothing in the UI offers to remove.
"""
import pytest


@pytest.fixture
def clock(app_module, monkeypatch):
    """A wall clock the test drives by hand — markers are stamped from time.time."""
    class Clock:
        now = 1_700_000_000.0

        def advance(self, seconds):
            self.now += seconds

    c = Clock()
    monkeypatch.setattr(app_module.time, "time", lambda: c.now)
    return c


@pytest.fixture
def stage(app_module):
    return app_module._stage_state


def indices(app_module):
    return [marker["index"] for marker in app_module._stage_state["markers"]]


# ── Walking forward ───────────────────────────────────────────────────────────

def test_a_fresh_session_has_not_started(app_module, stage):
    assert stage["index"] == app_module.STAGE_NOT_STARTED
    assert stage["markers"] == []


def test_the_first_step_enters_the_first_stage(app_module, stage, clock):
    app_module._step_brew_stage(1)
    assert stage["index"] == 0
    assert stage["markers"] == [{"index": 0, "ts": int(clock.now * 1000)}]


def test_every_stage_is_marked_as_it_is_entered(app_module, clock):
    for _ in app_module.BREW_STAGES:
        app_module._step_brew_stage(1)
        clock.advance(600)
    assert indices(app_module) == list(range(len(app_module.BREW_STAGES)))


def test_markers_are_stamped_when_the_stage_was_entered(app_module, clock):
    app_module._step_brew_stage(1)
    clock.advance(1800)  # half an hour of heating water
    app_module._step_brew_stage(1)
    first, second = app_module._stage_state["markers"]
    assert second["ts"] - first["ts"] == 1800 * 1000


def test_the_last_stage_leads_to_complete(app_module):
    for _ in range(len(app_module.BREW_STAGES) + 1):
        app_module._step_brew_stage(1)
    assert app_module._stage_state["index"] == app_module.STAGE_COMPLETE


def test_finishing_marks_the_end_of_the_brew(app_module):
    """The last mark is when cooling ended, which is worth a line of its own."""
    for _ in range(len(app_module.BREW_STAGES) + 1):
        app_module._step_brew_stage(1)
    assert indices(app_module)[-1] == app_module.STAGE_COMPLETE


def test_a_finished_brew_does_not_step_further(app_module):
    for _ in range(len(app_module.BREW_STAGES) + 1):
        app_module._step_brew_stage(1)
    before = list(app_module._stage_state["markers"])
    app_module._step_brew_stage(1)
    app_module._step_brew_stage(1)
    assert app_module._stage_state["index"] == app_module.STAGE_COMPLETE
    assert app_module._stage_state["markers"] == before


# ── Going back ────────────────────────────────────────────────────────────────

def test_stepping_back_drops_the_mark_for_the_stage_being_left(app_module):
    app_module._step_brew_stage(1)  # Heat water
    app_module._step_brew_stage(1)  # Mash in
    app_module._step_brew_stage(-1)
    assert app_module._stage_state["index"] == 0
    assert indices(app_module) == [0]


def test_a_wrong_tap_leaves_no_line_behind(app_module, clock):
    """The whole point of the back button: undo, not a second timestamp."""
    app_module._step_brew_stage(1)
    clock.advance(60)
    app_module._step_brew_stage(1)  # mis-tap
    app_module._step_brew_stage(-1)
    clock.advance(3000)
    app_module._step_brew_stage(1)  # for real this time
    marks = app_module._stage_state["markers"]
    assert indices(app_module) == [0, 1]
    assert marks[1]["ts"] == int(clock.now * 1000)


def test_stepping_back_to_before_the_start_clears_every_mark(app_module):
    app_module._step_brew_stage(1)
    app_module._step_brew_stage(-1)
    assert app_module._stage_state["index"] == app_module.STAGE_NOT_STARTED
    assert app_module._stage_state["markers"] == []


def test_a_brew_that_has_not_started_does_not_step_back(app_module, stage):
    app_module._step_brew_stage(-1)
    app_module._step_brew_stage(-1)
    assert stage["index"] == app_module.STAGE_NOT_STARTED
    assert stage["markers"] == []


def test_stepping_back_from_complete_returns_to_the_last_stage(app_module):
    for _ in range(len(app_module.BREW_STAGES) + 1):
        app_module._step_brew_stage(1)
    app_module._step_brew_stage(-1)
    assert app_module._stage_state["index"] == len(app_module.BREW_STAGES) - 1
    assert indices(app_module)[-1] == len(app_module.BREW_STAGES) - 1


def test_markers_always_describe_the_stages_actually_reached(app_module):
    """Invariant the chart relies on: the marks are a prefix of the stage list."""
    for delta in (1, 1, 1, -1, 1, 1, -1, -1, 1, 1, 1):
        app_module._step_brew_stage(delta)
        index = app_module._stage_state["index"]
        assert indices(app_module) == list(range(index + 1))


# ── Reset, and what the clients are told ──────────────────────────────────────

def test_reset_puts_the_brew_back_before_the_first_stage(app_module, stage):
    for _ in range(4):
        app_module._step_brew_stage(1)
    app_module._reset_brew_stage()
    assert stage["index"] == app_module.STAGE_NOT_STARTED
    assert stage["markers"] == []


def test_the_report_carries_the_stage_names(app_module):
    report = app_module._brew_stage_report()
    assert report["stages"] == app_module.BREW_STAGES
    assert report["index"] == app_module.STAGE_NOT_STARTED
    assert report["markers"] == []


def test_the_report_does_not_hand_out_the_live_state(app_module):
    """A client's copy must not be able to mutate the rig's own record."""
    app_module._step_brew_stage(1)
    report = app_module._brew_stage_report()
    report["stages"].append("Bottling")
    report["markers"][0]["index"] = 99
    assert "Bottling" not in app_module.BREW_STAGES
    assert indices(app_module) == [0]


def test_the_state_snapshot_includes_the_stage(app_module):
    app_module._step_brew_stage(1)
    snapshot = app_module._state_snapshot()
    assert snapshot["brewStage"]["index"] == 0
    assert snapshot["brewStage"]["stages"][0] == app_module.BREW_STAGES[0]


def test_the_stage_diffs_to_nothing_while_it_is_not_moving(app_module):
    """The stage list rides on every snapshot — it must cost a client nothing."""
    first = app_module._comparable(app_module._state_snapshot())
    second = app_module._comparable(app_module._state_snapshot())
    assert app_module._diff(first, second) == {}


def test_a_stage_change_diffs_to_the_stage_alone(app_module):
    before = app_module._comparable(app_module._state_snapshot())
    app_module._step_brew_stage(1)
    after = app_module._comparable(app_module._state_snapshot())
    assert set(app_module._diff(before, after)) == {"brewStage"}


# ── Rolling the session ───────────────────────────────────────────────────────

def test_starting_a_new_log_session_starts_a_new_brew(app_module, gpio):
    """The marks are timestamps into the session log — they go when it does."""
    import asyncio

    for _ in range(3):
        app_module._step_brew_stage(1)
    asyncio.run(app_module.initialize_hardware())
    assert app_module._stage_state["index"] == app_module.STAGE_NOT_STARTED
    assert app_module._stage_state["markers"] == []
