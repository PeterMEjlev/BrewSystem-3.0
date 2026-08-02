"""The shared power budget: capping, BK priority, and what reaches the pins.

The rig has two elements totalling 13.5 kW on a supply rated for 11 kW, so
something always has to give. These tests pin down what.
"""
import pytest

BK_RELAY, HLT_RELAY = 17, 18
BK_PWM, HLT_PWM = 12, 13
BK_WATTS, HLT_WATTS, MAX_WATTS = 8500, 5000, 11000


def watts(duty, element):
    return duty / 100 * element


@pytest.fixture
def pots(app_module):
    return app_module._control_state["pots"]


# ── A single element may not exceed the supply on its own ─────────────────────

def test_bk_alone_gets_full_duty(app_module, config, gpio, pots):
    """BK is 8.5 kW against an 11 kW limit, so 100 % is genuinely available."""
    app_module._apply_pot_power("BK", True, config)
    app_module._apply_efficiency("BK", 100, config)
    assert pots["BK"]["efficiency"] == 100
    assert gpio.duty[BK_PWM] == 100


def test_an_oversized_element_is_capped(app_module, write_config, gpio, pots):
    """A 14 kW element on an 11 kW supply must never be given full duty."""
    config = write_config(lambda d: d["app"].update({"bk_element_watts": 14000}))
    app_module._apply_pot_power("BK", True, config)
    app_module._apply_efficiency("BK", 100, config)
    cap = MAX_WATTS / 14000 * 100
    assert pots["BK"]["efficiency"] == pytest.approx(cap)
    assert gpio.duty[BK_PWM] == pytest.approx(cap)
    assert watts(gpio.duty[BK_PWM], 14000) <= MAX_WATTS + 1


# ── Two elements sharing one supply ───────────────────────────────────────────

def test_second_element_is_throttled_into_the_headroom(app_module, config, gpio, pots):
    """BK at 100 % leaves 2.5 kW, which is 50 % of the HLT element."""
    app_module._apply_pot_power("HLT", True, config)
    app_module._apply_efficiency("HLT", 100, config)
    app_module._apply_pot_power("BK", True, config)
    app_module._apply_efficiency("BK", 100, config)

    assert pots["BK"]["efficiency"] == 100
    expected_hlt = (MAX_WATTS - BK_WATTS) / HLT_WATTS * 100  # 50 %
    assert pots["HLT"]["efficiency"] == pytest.approx(expected_hlt)
    assert gpio.duty[HLT_PWM] == pytest.approx(expected_hlt)

    total = watts(gpio.duty[BK_PWM], BK_WATTS) + watts(gpio.duty[HLT_PWM], HLT_WATTS)
    assert total <= MAX_WATTS + 1


def test_the_total_never_exceeds_the_limit_across_the_range(app_module, config, gpio, pots):
    """Whatever the two are asked for, what reaches the pins has to fit."""
    app_module._apply_pot_power("BK", True, config)
    app_module._apply_pot_power("HLT", True, config)
    for bk in (0, 25, 50, 75, 100):
        for hlt in (0, 25, 50, 75, 100):
            app_module._apply_efficiency("HLT", hlt, config)
            app_module._apply_efficiency("BK", bk, config)
            total = watts(gpio.duty[BK_PWM], BK_WATTS) + watts(gpio.duty[HLT_PWM], HLT_WATTS)
            assert total <= MAX_WATTS + 1, f"BK={bk} HLT={hlt} drew {total} W"


def test_an_off_element_does_not_reserve_power(app_module, config, pots):
    """A pot that is switched off is using nothing, so the other gets the lot."""
    app_module._apply_pot_power("HLT", False, config)
    pots["HLT"]["efficiency"] = 100          # asked for, but the relay is open
    app_module._apply_pot_power("BK", True, config)
    app_module._apply_efficiency("BK", 100, config)
    assert pots["BK"]["efficiency"] == 100


# ── BK priority when both are regulating ──────────────────────────────────────

def test_bk_keeps_priority_when_both_regulate(app_module, config, gpio, pots):
    """With both under regulation BK holds its duty and HLT yields — otherwise
    the two would take turns throttling each other every tick."""
    pots["BK"].update({"regulationEnabled": True})
    pots["HLT"].update({"regulationEnabled": True})
    app_module._apply_pot_power("BK", True, config)
    app_module._apply_pot_power("HLT", True, config)

    app_module._apply_efficiency("BK", 100, config)
    app_module._apply_efficiency("HLT", 100, config)

    assert pots["BK"]["efficiency"] == 100, "BK yielded when it should have priority"
    assert pots["HLT"]["efficiency"] == pytest.approx((MAX_WATTS - BK_WATTS) / HLT_WATTS * 100)


def test_hlt_cannot_push_bk_down_while_both_regulate(app_module, config, pots):
    """The ordering trap: setting HLT after BK must not demote BK."""
    pots["BK"].update({"regulationEnabled": True})
    pots["HLT"].update({"regulationEnabled": True})
    app_module._apply_pot_power("BK", True, config)
    app_module._apply_pot_power("HLT", True, config)
    app_module._apply_efficiency("BK", 100, config)

    for _ in range(5):  # a few ticks' worth of HLT asking for everything
        app_module._apply_efficiency("HLT", 100, config)

    assert pots["BK"]["efficiency"] == 100


# ── Turning a pot on re-applies its stored duty ───────────────────────────────

def test_power_on_reapplies_the_stored_duty(app_module, config, gpio, pots):
    """Switching on used to leave the element at 0 % while the UI showed the
    old duty — the relay clicked and nothing happened."""
    pots["BK"]["efficiency"] = 60
    app_module._apply_pot_power("BK", True, config)
    assert gpio.is_on(BK_RELAY)
    assert gpio.duty[BK_PWM] == 60


def test_power_off_opens_the_relay_and_stops_pwm(app_module, config, gpio):
    app_module._apply_pot_power("BK", True, config)
    app_module._apply_pot_power("BK", False, config)
    assert not gpio.is_on(BK_RELAY)
    assert BK_PWM in gpio.pwm_stopped
