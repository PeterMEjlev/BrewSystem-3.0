import asyncio
import json
import logging
import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, Any

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

import utils_rpi
from session_logger import session_logger

# Suppress high-frequency polling endpoints from the access log
class _SuppressPollingFilter(logging.Filter):
    _SUPPRESSED = {"/api/hardware/temperature"}

    def filter(self, record):
        msg = record.getMessage()
        return not any(path in msg for path in self._SUPPRESSED)

logging.getLogger("uvicorn.access").addFilter(_SuppressPollingFilter())


async def _temperature_log_loop():
    """Background task: read all three sensors every 10 seconds and log them."""
    while True:
        await asyncio.sleep(10)
        try:
            config = read_config()
            sensors = config["sensors"]["ds18b20"]
            session_logger.log_reading(
                bk=utils_rpi.read_ds18b20(sensors["bk"]),
                mlt=utils_rpi.read_ds18b20(sensors["mlt"]),
                hlt=utils_rpi.read_ds18b20(sensors["hlt"]),
            )
        except Exception as e:
            logging.getLogger(__name__).error("Temp log error: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    session_logger.start_new_session()
    task = asyncio.create_task(_temperature_log_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Brew System API", lifespan=lifespan)

# Path to config file
CONFIG_FILE = Path(__file__).parent.parent / "config.json"

# Track last known pump speed so we can restore it when toggling power
_pump_speeds: Dict[str, float] = {"P1": 0.0, "P2": 0.0}


class Settings(BaseModel):
    """Settings model matching the config.json structure"""
    gpio: Dict[str, Any]
    pwm: Dict[str, Any]
    sensors: Dict[str, Any]


def read_config() -> Dict[str, Any]:
    """Read configuration from JSON file"""
    try:
        with open(CONFIG_FILE, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Config file not found")
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Invalid config file format")


def write_config_atomic(data: Dict[str, Any]) -> None:
    """Write configuration to JSON file atomically"""
    # Create a temporary file in the same directory as the config file
    config_dir = CONFIG_FILE.parent

    # Write to temporary file first
    with tempfile.NamedTemporaryFile(
        mode='w',
        dir=config_dir,
        delete=False,
        suffix='.tmp'
    ) as tmp_file:
        json.dump(data, tmp_file, indent=2)
        tmp_path = tmp_file.name

    # Atomically replace the old config file with the new one
    os.replace(tmp_path, CONFIG_FILE)


@app.get("/api/settings")
async def get_settings() -> Settings:
    """Get current settings"""
    config = read_config()
    return Settings(**config)


@app.post("/api/settings")
async def update_settings(settings: Settings) -> Dict[str, str]:
    """Update settings with atomic write"""
    try:
        write_config_atomic(settings.model_dump())
        return {"status": "success", "message": "Settings updated successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update settings: {str(e)}")


# ─── Hardware endpoints ────────────────────────────────────────────────────────

class PotPowerRequest(BaseModel):
    on: bool

class PotEfficiencyRequest(BaseModel):
    value: float

class PumpPowerRequest(BaseModel):
    on: bool

class PumpSpeedRequest(BaseModel):
    value: float


def _pot_pin_map(pot: str, config: Dict[str, Any]):
    """Return (relay_pin, pwm_pin, pwm_frequency) for a pot name"""
    pot_lower = pot.lower()
    relay_pin = config["gpio"]["pot"][pot_lower]
    pwm_pin = config["gpio"]["pwm_heating"][pot_lower]
    frequency = config["pwm"]["frequency"]
    return relay_pin, pwm_pin, frequency


def _pump_pin_map(pump: str, config: Dict[str, Any]):
    """Return (relay_pin, pwm_pin, pwm_frequency) for a pump name"""
    pump_lower = pump.lower()
    relay_pin = config["gpio"]["pump"][pump_lower]
    pwm_pin = config["gpio"]["pwm_pump"][pump_lower]
    frequency = config["pwm"]["software_frequency"]
    return relay_pin, pwm_pin, frequency


@app.post("/api/hardware/initialize")
async def initialize_hardware() -> Dict[str, str]:
    """Initialize all GPIO pins to LOW and start a new temperature log session"""
    utils_rpi.initialize_gpio()
    session_logger.start_new_session()
    return {"status": "ok"}


@app.post("/api/hardware/pot/{pot}/power")
async def set_pot_power(pot: str, body: PotPowerRequest) -> Dict[str, str]:
    """Turn a pot heating element relay on or off"""
    pot = pot.upper()
    if pot not in ("BK", "HLT"):
        raise HTTPException(status_code=400, detail=f"Unknown pot: {pot}")

    config = read_config()
    relay_pin, pwm_pin, frequency = _pot_pin_map(pot, config)

    if body.on:
        utils_rpi.set_gpio_high(relay_pin)
        utils_rpi.set_pwm_signal(pwm_pin, frequency, 0)
    else:
        utils_rpi.set_gpio_low(relay_pin)
        utils_rpi.stop_pwm_signal(pwm_pin)

    return {"status": "ok"}


@app.post("/api/hardware/pot/{pot}/efficiency")
async def set_pot_efficiency(pot: str, body: PotEfficiencyRequest) -> Dict[str, str]:
    """Set heating element PWM duty cycle"""
    pot = pot.upper()
    if pot not in ("BK", "HLT"):
        raise HTTPException(status_code=400, detail=f"Unknown pot: {pot}")

    config = read_config()
    _, pwm_pin, _ = _pot_pin_map(pot, config)
    utils_rpi.change_pwm_duty_cycle(pwm_pin, body.value)
    return {"status": "ok"}


@app.post("/api/hardware/pump/{pump}/power")
async def set_pump_power(pump: str, body: PumpPowerRequest) -> Dict[str, str]:
    """Turn a pump relay on or off"""
    pump = pump.upper()
    if pump not in ("P1", "P2"):
        raise HTTPException(status_code=400, detail=f"Unknown pump: {pump}")

    config = read_config()
    relay_pin, pwm_pin, frequency = _pump_pin_map(pump, config)

    if body.on:
        utils_rpi.set_gpio_high(relay_pin)
        utils_rpi.set_pwm_signal(pwm_pin, frequency, _pump_speeds.get(pump, 0))
    else:
        utils_rpi.set_gpio_low(relay_pin)
        utils_rpi.stop_pwm_signal(pwm_pin)

    return {"status": "ok"}


@app.post("/api/hardware/pump/{pump}/speed")
async def set_pump_speed(pump: str, body: PumpSpeedRequest) -> Dict[str, str]:
    """Set pump PWM duty cycle"""
    pump = pump.upper()
    if pump not in ("P1", "P2"):
        raise HTTPException(status_code=400, detail=f"Unknown pump: {pump}")

    _pump_speeds[pump] = body.value
    config = read_config()
    _, pwm_pin, _ = _pump_pin_map(pump, config)
    utils_rpi.change_pwm_duty_cycle(pwm_pin, body.value)
    return {"status": "ok"}


@app.get("/api/hardware/temperature")
async def get_temperatures() -> Dict[str, Any]:
    """Read all three DS18B20 temperature sensors"""
    config = read_config()
    sensors = config["sensors"]["ds18b20"]
    return {
        "bk":  utils_rpi.read_ds18b20(sensors["bk"]),
        "mlt": utils_rpi.read_ds18b20(sensors["mlt"]),
        "hlt": utils_rpi.read_ds18b20(sensors["hlt"]),
    }


# Serve React build
STATIC_DIR = Path(__file__).parent.parent / "dist"

if STATIC_DIR.exists():
    # Mount static files
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    # Serve index.html for all other routes (SPA routing)
    @app.get("/{full_path:path}")
    async def serve_react_app(full_path: str):
        # If requesting a file that exists, serve it
        file_path = STATIC_DIR / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        # Otherwise, serve index.html for SPA routing
        return FileResponse(STATIC_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
