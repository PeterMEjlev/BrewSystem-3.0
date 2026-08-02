"""The regulation tick and the safety rules that override it.

_regulation_tick is the authoritative control loop — the browser only displays
what it decides — so these are the assertions that matter most in the repo.
"""
import pytest

BK_RELAY, HLT_RELAY = 17, 18
BK_PWM = 12


@pytest.fixture
def pots(app_module):
    return app_module._control_state["pots"]


def regulate(app_module, config, **temps):
    app_module._temperature_cache.update(temps)
    app_module._regulation_tick(config)


# ── Walking the auto-efficiency curve ─────────────────────────────────────────

# Default BK curve, in "degrees still to go": >5 → 100 %, >2 → 60 %,
# >0.5 → 30 %, otherwise 0 %. The thresholds are exclusive, so a pot exactly
# 5.0 °C off its set value is already on the step below — the boundaries are
# the cases worth writing down, so they are all here.
@pytest.mark.parametrize("pv,expected", [
    (50.0, 100.0),   # 18.0 to go
    (62.5, 100.0),   #  5.5 to go — above the top threshold
    (63.0, 60.0),    #  5.0 exactly — exclusive, so already stepping down
    (65.5, 60.0),    #  2.5 to go
    (66.0, 30.0),    #  2.0 exactly
    (67.0, 30.0),    #  1.0 to go
    (67.5, 0.0),     #  0.5 exactly — the curve has closed off
])
def test_curve_steps_down_as_it_closes_in(app_module, config, pots, pv, expected):
    """Power tapers as the pot approaches its set value — the whole point of
    the curve, and what stops a 100 L kettle overshooting its mash rest.

    Each case starts at 45 %, which is not one of the steps, so every one of
    them has to actively move rather than happening to already be right.
    """
    pots["BK"].update({"sv": 68.0, "regulationEnabled": True, "heaterOn": True, "efficiency": 45})
    regulate(app_module, config, bk=pv)
    assert pots["BK"]["efficiency"] == expected


def test_regulation_switches_the_heater_off_at_the_set_value(app_module, config, gpio, pots):
    pots["BK"].update({"sv": 68.0, "regulationEnabled": True, "heaterOn": True, "efficiency": 100})
    regulate(app_module, config, bk=68.5)
    assert pots["BK"]["heaterOn"] is False
    assert not gpio.is_on(BK_RELAY)


def test_regulation_switches_the_heater_back_on_when_it_drops(app_module, config, gpio, pots):
    pots["BK"].update({"sv": 68.0, "regulationEnabled": True, "heaterOn": False})
    regulate(app_module, config, bk=60.0)
    assert pots["BK"]["heaterOn"] is True
    assert gpio.is_on(BK_RELAY)
    assert gpio.duty[BK_PWM] == 100


def test_manual_efficiency_regulation_is_bang_bang(app_module, write_config, pots):
    """With auto-efficiency off, regulation keeps the brewer's chosen duty and
    only decides on/off."""
    config = write_config(lambda d: d["app"]["auto_efficiency"]["bk"].update({"enabled": False}))
    pots["BK"].update({"sv": 68.0, "regulationEnabled": True, "heaterOn": True, "efficiency": 40})
    regulate(app_module, config, bk=50.0)
    assert pots["BK"]["efficiency"] == 40, "the curve overrode a manual duty"
    assert pots["BK"]["heaterOn"] is True


def test_an_unregulated_pot_is_left_alone(app_module, config, pots):
    """Manual mode means manual: the loop must not touch the duty."""
    pots["BK"].update({"sv": 68.0, "regulationEnabled": False, "heaterOn": True, "efficiency": 35})
    regulate(app_module, config, bk=20.0)
    assert pots["BK"]["efficiency"] == 35
    assert pots["BK"]["heaterOn"] is True


# ── Safety rules, which apply whatever the mode ───────────────────────────────

def test_over_temperature_cuts_power_even_in_manual_mode(app_module, config, gpio, pots):
    pots["BK"].update({"regulationEnabled": False, "heaterOn": True, "efficiency": 100, "sv": 110})
    regulate(app_module, config, bk=app_module._MAX_TEMP_CUTOFF_C + 0.5)
    assert pots["BK"]["heaterOn"] is False
    assert not gpio.is_on(BK_RELAY)


def test_a_failed_sensor_cuts_power_to_a_regulating_pot(app_module, config, gpio, pots):
    """Regulating on no reading would mean regulating at full power."""
    pots["BK"].update({"sv": 68.0, "regulationEnabled": True, "heaterOn": True, "efficiency": 100})
    regulate(app_module, config, bk=None)
    assert pots["BK"]["heaterOn"] is False
    assert not gpio.is_on(BK_RELAY)


def test_a_failed_sensor_leaves_a_manual_pot_running(app_module, config, gpio, pots):
    """A brewer holding a manual duty has their own reason to; losing a probe
    is not the loop's cue to kill a boil."""
    pots["BK"].update({"regulationEnabled": False, "heaterOn": True, "efficiency": 80})
    regulate(app_module, config, bk=None)
    assert pots["BK"]["heaterOn"] is True


def test_over_temperature_beats_regulation_wanting_more_heat(app_module, config, pots):
    """sv above the cutoff must not let regulation win the argument."""
    pots["BK"].update({"sv": 120.0, "regulationEnabled": True, "heaterOn": True, "efficiency": 100})
    regulate(app_module, config, bk=app_module._MAX_TEMP_CUTOFF_C + 1)
    assert pots["BK"]["heaterOn"] is False


# ── Regulation inside the shared power budget ─────────────────────────────────

def test_regulation_respects_the_power_cap(app_module, config, gpio, pots):
    """Both pots cold and regulating: the curve asks for 100 % each, and the
    supply cannot give it."""
    pots["BK"].update({"sv": 100.0, "regulationEnabled": True, "heaterOn": True})
    pots["HLT"].update({"sv": 80.0, "regulationEnabled": True, "heaterOn": True})
    regulate(app_module, config, bk=20.0, hlt=20.0)

    drawn = pots["BK"]["efficiency"] / 100 * 8500 + pots["HLT"]["efficiency"] / 100 * 5000
    assert drawn <= 11000 + 1, f"regulation drew {drawn} W"
    assert pots["BK"]["efficiency"] == 100, "BK should keep priority"


def test_repeated_ticks_are_stable(app_module, config, pots):
    """Nothing should oscillate while the temperatures hold still."""
    pots["BK"].update({"sv": 100.0, "regulationEnabled": True, "heaterOn": True})
    pots["HLT"].update({"sv": 80.0, "regulationEnabled": True, "heaterOn": True})
    regulate(app_module, config, bk=20.0, hlt=20.0)
    settled = (pots["BK"]["efficiency"], pots["HLT"]["efficiency"])
    for _ in range(10):
        app_module._regulation_tick(config)
    assert (pots["BK"]["efficiency"], pots["HLT"]["efficiency"]) == settled
