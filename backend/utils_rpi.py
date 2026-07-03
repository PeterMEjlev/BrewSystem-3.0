import json
import logging
import random
import os
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


def initialize_ds18b20_resolution(serial_code, resolution="9"):
    if IS_RPI:
        sensor_dir = f"/sys/bus/w1/devices/{serial_code}"
        resolution_file = os.path.join(sensor_dir, "resolution")
        if os.path.exists(resolution_file):
            try:
                with open(resolution_file, "w") as f:
                    f.write(resolution)
                logger.info("Sensor %s resolution set to %s-bit.", serial_code, resolution)
            except Exception as e:
                logger.warning("Unable to set sensor %s resolution: %s", serial_code, e)
        else:
            logger.warning("Resolution file for sensor %s not found.", serial_code)


def read_ds18b20(serial_code):
    """Read one DS18B20 sensor. Returns °C as float, or None on any failure
    (disconnected probe, CRC error, missing sysfs entry). Callers must treat
    None as 'no reading' — never as a temperature."""
    if IS_RPI:
        sensor_file_path = f"/sys/bus/w1/devices/{serial_code}/w1_slave"
        try:
            with open(sensor_file_path, 'r') as f:
                lines = f.readlines()

            if lines[0].strip()[-3:] != "YES":
                raise ValueError("CRC check failed.")

            temp_output = lines[1].split("t=")
            if len(temp_output) < 2:
                raise ValueError("Temperature data not found.")
            return float(temp_output[1]) / 1000.0
        except FileNotFoundError:
            return None
        except Exception as e:
            logger.error("Error reading DS18B20 %s: %s", serial_code, e)
            return None
    else:
        return round(random.uniform(20.0, 30.0), 1)


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
