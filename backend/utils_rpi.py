import json
import logging
import random
import os
import time
from pathlib import Path

logger = logging.getLogger(__name__)

# Auto-detect Raspberry Pi by attempting pigpio connection
try:
    import pigpio
    _pi = pigpio.pi()
    IS_RPI = _pi.connected
except Exception:
    _pi = None
    IS_RPI = False

pi = _pi

# Track active PWM objects: { pin_number: ('hardware'|'software', frequency) }
_pwm_objects = {}


def load_config():
    """Load configuration from config.json"""
    config_path = Path(__file__).parent.parent / "config.json"
    with open(config_path, 'r') as f:
        return json.load(f)


def set_gpio_high(pin_number):
    if IS_RPI:
        try:
            pi.write(pin_number, 1)
            logger.debug("GPIO pin %s set to HIGH.", pin_number)
        except Exception as e:
            logger.error("Error setting GPIO pin %s HIGH: %s", pin_number, e)
    else:
        logger.debug("GPIO pin %s set to HIGH (simulated).", pin_number)


def set_gpio_low(pin_number):
    if IS_RPI:
        try:
            pi.write(pin_number, 0)
            logger.debug("GPIO pin %s set to LOW.", pin_number)
        except Exception as e:
            logger.error("Error setting GPIO pin %s LOW: %s", pin_number, e)
    else:
        logger.debug("GPIO pin %s set to LOW (simulated).", pin_number)


def set_pwm_signal(pin_number, frequency, duty_cycle):
    if IS_RPI:
        try:
            pi.set_mode(pin_number, pigpio.OUTPUT)
            duty_hw = int((duty_cycle / 100) * 1_000_000)
            try:
                pi.hardware_PWM(pin_number, frequency, duty_hw)
                _pwm_objects[pin_number] = ('hardware', frequency)
                logger.debug("Started hardware PWM on pin %s, freq=%sHz, duty=%s%%.", pin_number, frequency, duty_cycle)
            except pigpio.error:
                logger.warning("Hardware PWM not available on pin %s, falling back to software PWM.", pin_number)
                pi.set_PWM_frequency(pin_number, frequency)
                pi.set_PWM_range(pin_number, 100)
                pi.set_PWM_dutycycle(pin_number, duty_cycle)
                _pwm_objects[pin_number] = ('software', frequency)
                logger.debug("Started software PWM on pin %s, freq=%sHz, duty=%s%%.", pin_number, frequency, duty_cycle)
            return pin_number
        except Exception as e:
            logger.error("Failed to start PWM on pin %s: %s", pin_number, e)
            return None
    else:
        _pwm_objects[pin_number] = ('software', frequency)
        logger.debug("PWM started on pin %s (simulated), freq=%s, duty=%s%%.", pin_number, frequency, duty_cycle)
        return pin_number


def stop_pwm_signal(pin_number):
    if IS_RPI and pin_number in _pwm_objects:
        mode, _ = _pwm_objects[pin_number]
        try:
            if mode == 'hardware':
                pi.hardware_PWM(pin_number, 0, 0)
            elif mode == 'software':
                pi.set_PWM_dutycycle(pin_number, 0)
            logger.debug("Stopped %s PWM on pin %s.", mode, pin_number)
            _pwm_objects.pop(pin_number, None)
        except Exception as e:
            logger.error("Error stopping PWM on pin %s: %s", pin_number, e)
    else:
        _pwm_objects.pop(pin_number, None)
        logger.debug("PWM stopped on pin %s (simulated or not started).", pin_number)


def change_pwm_duty_cycle(pin_number, duty_cycle):
    if IS_RPI and pin_number in _pwm_objects:
        mode, frequency = _pwm_objects[pin_number]
        try:
            if mode == 'hardware':
                duty_hw = int((duty_cycle / 100) * 1_000_000)
                pi.hardware_PWM(pin_number, frequency, duty_hw)
            elif mode == 'software':
                pi.set_PWM_dutycycle(pin_number, duty_cycle)
            logger.debug("%s PWM duty cycle on pin %s changed to %s%%", mode.capitalize(), pin_number, duty_cycle)
        except Exception as e:
            logger.error("Error changing PWM duty cycle on pin %s to %s%%: %s", pin_number, duty_cycle, e)
    else:
        logger.debug("Simulated PWM duty cycle change on pin %s to %s%%", pin_number, duty_cycle)


# ─── DS18B20 ──────────────────────────────────────────────────────────────────
#
# Where the kernel exposes 1-Wire slaves. A module constant rather than a
# literal so the tests can point the whole layer at a fake bus.
W1_DEVICES_DIR = "/sys/bus/w1/devices"

# Why a read failed. These are deliberately distinct: they are different faults
# with different repairs, and the previous code collapsed all of them into one
# "Error reading DS18B20" line that could not tell them apart.
FAILURE_ABSENT = "absent"
FAILURE_NO_PRESENCE = "no-presence"
FAILURE_CRC = "crc"
FAILURE_MALFORMED = "malformed"
FAILURE_IO = "io"

_FAILURE_DESCRIPTIONS = {
    FAILURE_ABSENT:
        "device node is gone — the kernel dropped it from the 1-Wire bus after "
        "it missed too many scans. Check the probe's wiring, not the software",
    FAILURE_NO_PRESENCE:
        "empty read — the device is still registered but did not answer the "
        "bus at all. That is an open connection or a dead chip, not noise",
    FAILURE_CRC:
        "CRC check failed — the sensor answered but the data was corrupt, "
        "which points at signal integrity rather than a broken conductor",
    FAILURE_MALFORMED:
        "w1_slave contents could not be parsed",
    FAILURE_IO:
        "I/O error reading w1_slave",
}

# How hard one sweep tries before calling a sensor failed. A DS18B20 that is on
# the bus at all almost always answers first time, so these retries are for the
# sensor that drops a single transaction — not for the one that has left it.
#
# Bounded by wall time as well as by count, because a silent sensor can make the
# kernel sit through its conversion wait on every attempt. Three sensors each
# burning the full budget is ~1.5 s, which stretches the 1 s read loop but stays
# well inside the 10 s the safety watchdog allows before it forces heaters off.
_READ_ATTEMPTS = 3
_READ_RETRY_DELAY = 0.05
_READ_BUDGET_SECONDS = 0.5

# The reason each sensor's last read failed, keyed by serial, or None while it
# is reading. Kept so a stuck sensor logs once instead of once a second — the
# old behaviour buried the one useful transition under thousands of identical
# lines — and so callers can name the fault rather than just report its absence.
_last_failure = {}


def sensor_dir(serial_code):
    return f"{W1_DEVICES_DIR}/{serial_code}"


def sensor_present(serial_code):
    """Whether the kernel currently has this sensor registered on the bus.

    The w1 core drops a slave that misses `slave_ttl` consecutive bus scans, so
    this going False means the sensor stayed silent long enough for the kernel
    to give up on it. That is a different fault from a read failing while the
    device is still registered, and — because reads of a missing node fail
    instantly — it is the one that would otherwise leave the least trace.
    """
    return os.path.exists(f"{sensor_dir(serial_code)}/w1_slave")


def last_failure_reason(serial_code):
    """Why this sensor's last read failed, or None if it succeeded."""
    return _last_failure.get(serial_code)


def _note_failure(serial_code, reason):
    """Log a failure when it first appears, then stay quiet until it changes."""
    if _last_failure.get(serial_code) != reason:
        logger.error(
            "DS18B20 %s: %s.", serial_code,
            _FAILURE_DESCRIPTIONS.get(reason, reason),
        )
    _last_failure[serial_code] = reason


def _note_success(serial_code):
    if _last_failure.get(serial_code) is not None:
        logger.info("DS18B20 %s is reading again.", serial_code)
    _last_failure[serial_code] = None


def parse_w1_slave(lines):
    """Turn a w1_slave read into (°C, None), or (None, failure reason).

    Split out from the file handling so every failure mode can be exercised
    without a 1-Wire bus underneath it.
    """
    if not lines:
        # Zero bytes back means the kernel got no presence pulse: the device is
        # still registered, but nothing on the other end answered. A probe with
        # a broken conductor looks exactly like this, and it is emphatically not
        # a CRC failure — the old code reported it as "list index out of range".
        return None, FAILURE_NO_PRESENCE
    if lines[0].strip()[-3:] != "YES":
        return None, FAILURE_CRC
    if len(lines) < 2:
        return None, FAILURE_MALFORMED
    parts = lines[1].split("t=")
    if len(parts) < 2:
        return None, FAILURE_MALFORMED
    try:
        return float(parts[1]) / 1000.0, None
    except ValueError:
        return None, FAILURE_MALFORMED


def initialize_ds18b20_resolution(serial_code, resolution="9"):
    """Set one sensor's conversion resolution. Returns whether it was applied.

    This writes the chip's scratchpad, not its EEPROM, so it does not survive
    the sensor losing power or leaving the bus — see the caller in main.py,
    which re-applies it whenever a sensor comes back.
    """
    if not IS_RPI:
        return False
    resolution_file = os.path.join(sensor_dir(serial_code), "resolution")
    if not os.path.exists(resolution_file):
        # Expected while the sensor is off the bus: there is no device
        # directory to write into until the kernel rediscovers it.
        logger.warning(
            "Cannot set sensor %s resolution — it is not on the bus.", serial_code
        )
        return False
    try:
        with open(resolution_file, "w") as f:
            f.write(resolution)
        logger.info("Sensor %s resolution set to %s-bit.", serial_code, resolution)
        return True
    except Exception as e:
        logger.warning("Unable to set sensor %s resolution: %s", serial_code, e)
        return False


def read_ds18b20(serial_code):
    """Read one DS18B20 sensor. Returns °C as float, or None on any failure
    (disconnected probe, CRC error, missing sysfs entry). Callers must treat
    None as 'no reading' — never as a temperature.

    A single failed transaction is retried within the sweep; what the caller
    sees is the verdict after those retries. Why it failed is recorded against
    the serial and available from last_failure_reason().
    """
    if not IS_RPI:
        return round(random.uniform(20.0, 30.0), 1)

    sensor_file_path = f"{sensor_dir(serial_code)}/w1_slave"
    started = time.monotonic()
    reason = FAILURE_IO

    for attempt in range(_READ_ATTEMPTS):
        try:
            with open(sensor_file_path, "r") as f:
                lines = f.readlines()
        except FileNotFoundError:
            # Nothing here is worth retrying — the device is not registered at
            # all, and will not be until the kernel's next bus scan finds it.
            _note_failure(serial_code, FAILURE_ABSENT)
            return None
        except OSError as e:
            reason = FAILURE_IO
            logger.debug("DS18B20 %s read attempt %s failed: %s",
                         serial_code, attempt + 1, e)
        else:
            value, reason = parse_w1_slave(lines)
            if value is not None:
                _note_success(serial_code)
                return value

        if attempt + 1 >= _READ_ATTEMPTS:
            break
        if time.monotonic() - started >= _READ_BUDGET_SECONDS:
            logger.debug("DS18B20 %s: out of retry budget after %s attempt(s).",
                         serial_code, attempt + 1)
            break
        time.sleep(_READ_RETRY_DELAY)

    _note_failure(serial_code, reason)
    return None


def read_all_temperatures(sensors: dict) -> dict:
    """Read all three DS18B20 sensors. Blocking — call from a thread."""
    return {
        "bk":  read_ds18b20(sensors["bk"]),
        "mlt": read_ds18b20(sensors["mlt"]),
        "hlt": read_ds18b20(sensors["hlt"]),
    }


def initialize_gpio():
    config = load_config()
    gpio = config["gpio"]

    pins = [
        gpio["pot"]["bk"],
        gpio["pot"]["hlt"],
        gpio["pwm_heating"]["bk"],
        gpio["pwm_heating"]["hlt"],
        gpio["pump"]["p1"],
        gpio["pump"]["p2"],
        gpio["pwm_pump"]["p1"],
        gpio["pwm_pump"]["p2"],
    ]

    if IS_RPI:
        try:
            for pin in pins:
                pi.set_mode(pin, pigpio.OUTPUT)
                pi.write(pin, 0)
            logger.info("GPIO pins initialized with pigpio.")
        except Exception as e:
            logger.error("Error initializing GPIO with pigpio: %s", e)
    else:
        logger.info("GPIO initialization skipped (simulated). Pins: %s", pins)
