import asyncio
import json
import logging
import os
import tempfile
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Any, Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field

import utils_rpi
from session_logger import session_logger

# Load environment variables from .env file
load_dotenv(Path(__file__).parent.parent / ".env")

# Suppress high-frequency polling endpoints from the access log
class _SuppressPollingFilter(logging.Filter):
    _SUPPRESSED = {"/api/hardware/temperature", "/api/hardware/state"}

    def filter(self, record):
        msg = record.getMessage()
        return not any(path in msg for path in self._SUPPRESSED)

logging.getLogger("uvicorn.access").addFilter(_SuppressPollingFilter())


# Temperature cache — updated by background task, served instantly from the API
_temperature_cache: Dict[str, float] = {"bk": -1.0, "mlt": -1.0, "hlt": -1.0}


async def _temperature_read_loop():
    """Background task: continuously read all sensors and update the in-memory cache.

    Sensor reads are offloaded to a thread so the event loop stays responsive.
    Each read of 3 DS18B20 sensors takes ~2-3 s on the Pi (750 ms per sensor at
    12-bit resolution), which is why we must never call this inline in an API handler.
    """
    logger = logging.getLogger(__name__)
    while True:
        try:
            config = read_config()
            sensors = config["sensors"]["ds18b20"]
            temps = await asyncio.to_thread(utils_rpi.read_all_temperatures, sensors)
            _temperature_cache.update(temps)
        except Exception as e:
            logger.error("Temp read error: %s", e)
        # Yield briefly to keep the event loop healthy; the sensor read itself
        # already takes ~2-3 s so this effectively controls the update frequency.
        await asyncio.sleep(0.5)


async def _temperature_log_loop():
    """Background task: log cached temperatures at the configured interval."""
    while True:
        config = read_config()
        interval = config.get("app", {}).get("log_interval_seconds", 10)
        await asyncio.sleep(interval)
        try:
            session_logger.log_reading(**_temperature_cache)
        except Exception as e:
            logging.getLogger(__name__).error("Temp log error: %s", e)


def _normalize_config():
    """Ensure config.json contains all keys defined in the Settings model."""
    config = read_config()
    normalized = Settings(**config).model_dump()
    if normalized != config:
        write_config_atomic(normalized)


@asynccontextmanager
async def lifespan(app: FastAPI):
    _normalize_config()
    session_logger.start_new_session()
    read_task = asyncio.create_task(_temperature_read_loop())
    log_task = asyncio.create_task(_temperature_log_loop())
    yield
    read_task.cancel()
    log_task.cancel()
    for task in (read_task, log_task):
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Brew System API", lifespan=lifespan)

# Path to config file
CONFIG_FILE = Path(__file__).parent.parent / "config.json"
DEFAULT_CONFIG_FILE = Path(__file__).parent.parent / "config.default.json"

# Brew timer state — elapsed is in seconds, started_at is a monotonic timestamp
_timer_state: Dict[str, Any] = {
    "running": False,
    "elapsed": 0.0,      # accumulated seconds while stopped
    "started_at": None,   # time.monotonic() when last started
    "target": 0,          # countdown target in seconds (0 = stopwatch mode)
}

def _get_timer_seconds() -> int:
    """Return the current timer display value in whole seconds."""
    elapsed = _timer_state["elapsed"]
    if _timer_state["running"] and _timer_state["started_at"] is not None:
        elapsed += time.monotonic() - _timer_state["started_at"]
    elapsed = int(elapsed)
    if _timer_state["target"] > 0:
        remaining = max(_timer_state["target"] - elapsed, 0)
        # Auto-stop when countdown reaches zero
        if remaining == 0 and _timer_state["running"]:
            _timer_state["elapsed"] = float(_timer_state["target"])
            _timer_state["started_at"] = None
            _timer_state["running"] = False
        return remaining
    return elapsed

# Shared control state — the single source of truth for all connected clients
_control_state: Dict[str, Any] = {
    "pots": {
        "BK":  {"heaterOn": False, "sv": 100.0, "efficiency": 0, "regulationEnabled": False},
        "HLT": {"heaterOn": False, "sv": 55.0,  "efficiency": 0, "regulationEnabled": False},
    },
    "pumps": {
        "P1": {"on": False, "speed": 0.0},
        "P2": {"on": False, "speed": 0.0},
    },
}


class AutoEfficiencyStep(BaseModel):
    threshold: float
    power: float


class AutoEfficiencySettings(BaseModel):
    enabled: bool = True
    steps: list[AutoEfficiencyStep] = Field(default_factory=lambda: [
        AutoEfficiencyStep(threshold=5,   power=100),
        AutoEfficiencyStep(threshold=2,   power=60),
        AutoEfficiencyStep(threshold=0.5, power=30),
        AutoEfficiencyStep(threshold=0,   power=0),
    ])


class AppSettings(BaseModel):
    model_config = ConfigDict(extra='allow')

    log_interval_seconds: int = 10
    max_watts: int = 11000
    max_chart_points: int = 150
    auto_efficiency: AutoEfficiencySettings = Field(default_factory=AutoEfficiencySettings)


class Settings(BaseModel):
    """Settings model matching the config.json structure"""
    gpio: Dict[str, Any]
    pwm: Dict[str, Any]
    sensors: Dict[str, Any]
    app: AppSettings = Field(default_factory=AppSettings)
    theme: Dict[str, str] = Field(default_factory=dict)


_config_cache: Optional[Dict[str, Any]] = None


def read_config() -> Dict[str, Any]:
    """Read configuration, using an in-memory cache to avoid SD-card I/O on
    every request.  The cache is invalidated on writes."""
    global _config_cache
    if _config_cache is not None:
        return _config_cache
    try:
        with open(CONFIG_FILE, 'r') as f:
            _config_cache = json.load(f)
            return _config_cache
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Config file not found")
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Invalid config file format")


def write_config_atomic(data: Dict[str, Any]) -> None:
    """Write configuration to JSON file atomically and invalidate the cache"""
    global _config_cache
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
    _config_cache = data


@app.get("/api/settings")
async def get_settings():
    """Get current settings (always includes Pydantic defaults)"""
    config = read_config()
    return Settings(**config).model_dump()


@app.post("/api/settings/reset")
async def reset_settings() -> Settings:
    """Reset settings to factory defaults from config.default.json"""
    try:
        with open(DEFAULT_CONFIG_FILE, 'r') as f:
            defaults = json.load(f)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Default config file not found")
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Invalid default config file format")
    write_config_atomic(defaults)
    return Settings(**defaults)


@app.post("/api/settings")
async def update_settings(settings: Settings) -> Dict[str, str]:
    """Update settings with atomic write"""
    try:
        write_config_atomic(settings.model_dump())
        return {"status": "success", "message": "Settings updated successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update settings: {str(e)}")


# ─── Hardware endpoints ────────────────────────────────────────────────────────

class TimerActionRequest(BaseModel):
    action: str  # "start", "stop", "reset", "set"
    seconds: Optional[int] = None  # target seconds for "set" action

class PotPowerRequest(BaseModel):
    on: bool

class PotEfficiencyRequest(BaseModel):
    value: float

class PotSvRequest(BaseModel):
    value: float

class PotRegulationRequest(BaseModel):
    enabled: bool

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
    for pot in _control_state["pots"].values():
        pot["heaterOn"] = False
        pot["efficiency"] = 0
    for pump in _control_state["pumps"].values():
        pump["on"] = False
        pump["speed"] = 0.0
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

    _control_state["pots"][pot]["heaterOn"] = body.on
    if body.on:
        utils_rpi.set_gpio_high(relay_pin)
        utils_rpi.set_pwm_signal(pwm_pin, frequency, 0)
    else:
        utils_rpi.set_gpio_low(relay_pin)
        utils_rpi.stop_pwm_signal(pwm_pin)

    return {"status": "ok"}


# Max wattage per heating element
_BK_MAX_WATTS = 8500
_HLT_MAX_WATTS = 5000


@app.post("/api/hardware/pot/{pot}/efficiency")
async def set_pot_efficiency(pot: str, body: PotEfficiencyRequest) -> Dict[str, str]:
    """Set heating element PWM duty cycle, enforcing the system power limit."""
    pot = pot.upper()
    if pot not in ("BK", "HLT"):
        raise HTTPException(status_code=400, detail=f"Unknown pot: {pot}")

    config = read_config()
    max_watts = config.get("app", {}).get("max_watts", 11000)
    other = "HLT" if pot == "BK" else "BK"
    pot_max = _BK_MAX_WATTS if pot == "BK" else _HLT_MAX_WATTS
    other_max = _HLT_MAX_WATTS if pot == "BK" else _BK_MAX_WATTS

    # When both REGs are on, BK has priority — HLT must yield.
    both_regs = (
        _control_state["pots"]["BK"]["regulationEnabled"]
        and _control_state["pots"]["HLT"]["regulationEnabled"]
    )

    _, pwm_pin, _ = _pot_pin_map(pot, config)

    if both_regs and pot == "HLT":
        # BK has priority: cap HLT to fit within remaining headroom after BK
        bk_used = (_control_state["pots"]["BK"]["efficiency"] / 100) * _BK_MAX_WATTS
        hlt_cap = max(0, min(100, ((max_watts - bk_used) / _HLT_MAX_WATTS) * 100))
        capped = min(body.value, hlt_cap)
        _control_state["pots"]["HLT"]["efficiency"] = capped
        utils_rpi.change_pwm_duty_cycle(pwm_pin, capped)
    else:
        # Apply the requested efficiency to this pot
        _control_state["pots"][pot]["efficiency"] = body.value
        utils_rpi.change_pwm_duty_cycle(pwm_pin, body.value)

        # Throttle the other pot if both heaters are on and total power exceeds the limit
        if _control_state["pots"][other]["heaterOn"]:
            used_by_this = (body.value / 100) * pot_max if _control_state["pots"][pot]["heaterOn"] else 0
            headroom = max_watts - used_by_this
            other_cap = max(0, min(100, (headroom / other_max) * 100))
            other_eff = _control_state["pots"][other]["efficiency"]
            if other_eff > other_cap:
                _, other_pwm, _ = _pot_pin_map(other, config)
                _control_state["pots"][other]["efficiency"] = other_cap
                utils_rpi.change_pwm_duty_cycle(other_pwm, other_cap)

    return {"status": "ok"}


@app.post("/api/hardware/pump/{pump}/power")
async def set_pump_power(pump: str, body: PumpPowerRequest) -> Dict[str, str]:
    """Turn a pump relay on or off"""
    pump = pump.upper()
    if pump not in ("P1", "P2"):
        raise HTTPException(status_code=400, detail=f"Unknown pump: {pump}")

    config = read_config()
    relay_pin, pwm_pin, frequency = _pump_pin_map(pump, config)

    _control_state["pumps"][pump]["on"] = body.on
    if body.on:
        utils_rpi.set_gpio_high(relay_pin)
        utils_rpi.set_pwm_signal(pwm_pin, frequency, _control_state["pumps"][pump]["speed"])
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

    _control_state["pumps"][pump]["speed"] = body.value
    config = read_config()
    _, pwm_pin, _ = _pump_pin_map(pump, config)
    utils_rpi.change_pwm_duty_cycle(pwm_pin, body.value)
    return {"status": "ok"}


@app.post("/api/hardware/pot/{pot}/sv")
async def set_pot_sv(pot: str, body: PotSvRequest) -> Dict[str, str]:
    """Set pot target temperature (set value)"""
    pot = pot.upper()
    if pot not in ("BK", "HLT"):
        raise HTTPException(status_code=400, detail=f"Unknown pot: {pot}")
    _control_state["pots"][pot]["sv"] = body.value
    return {"status": "ok"}


@app.post("/api/hardware/pot/{pot}/regulation")
async def set_pot_regulation(pot: str, body: PotRegulationRequest) -> Dict[str, str]:
    """Enable or disable auto-regulation for a pot"""
    pot = pot.upper()
    if pot not in ("BK", "HLT"):
        raise HTTPException(status_code=400, detail=f"Unknown pot: {pot}")
    _control_state["pots"][pot]["regulationEnabled"] = body.enabled
    return {"status": "ok"}


@app.post("/api/hardware/timer")
async def control_timer(body: TimerActionRequest) -> Dict[str, Any]:
    """Start, stop, or reset the brew timer"""
    action = body.action.lower()
    if action == "start":
        if not _timer_state["running"]:
            _timer_state["started_at"] = time.monotonic()
            _timer_state["running"] = True
    elif action == "stop":
        if _timer_state["running"]:
            _timer_state["elapsed"] += time.monotonic() - _timer_state["started_at"]
            _timer_state["started_at"] = None
            _timer_state["running"] = False
    elif action == "reset":
        _timer_state["running"] = False
        _timer_state["elapsed"] = 0.0
        _timer_state["started_at"] = None
        _timer_state["target"] = 0
    elif action == "set":
        if body.seconds is None or body.seconds < 0:
            raise HTTPException(status_code=400, detail="'set' action requires a non-negative 'seconds' value.")
        _timer_state["target"] = body.seconds
        _timer_state["running"] = False
        _timer_state["elapsed"] = 0.0
        _timer_state["started_at"] = None
    else:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}. Use start, stop, reset, or set.")
    return {"status": "ok", "timer": {"running": _timer_state["running"], "seconds": _get_timer_seconds(), "target": _timer_state["target"]}}


@app.get("/api/hardware/state")
async def get_full_state() -> Dict[str, Any]:
    """Return temperatures, control state, and timer in a single response.

    Temperatures come from the in-memory cache updated by the background read
    loop — this endpoint returns immediately without touching the 1-Wire bus.
    """
    return {
        "temperatures": _temperature_cache,
        "controlState": _control_state,
        "timer": {"running": _timer_state["running"], "seconds": _get_timer_seconds(), "target": _timer_state["target"]},
    }


@app.get("/api/temperature/average")
async def get_temperature_average(pot: str, minutes: float) -> Dict[str, Any]:
    """Return the average temperature of a pot over the last N minutes of session history."""
    pot = pot.lower()
    if pot not in ("bk", "mlt", "hlt"):
        raise HTTPException(status_code=400, detail=f"Unknown pot: {pot}. Must be bk, mlt, or hlt.")
    if minutes <= 0:
        raise HTTPException(status_code=400, detail="minutes must be positive.")

    history = session_logger.get_history()
    if not history:
        return {"pot": pot.upper(), "average": None, "minutes_requested": minutes, "minutes_available": 0, "sample_count": 0}

    now = datetime.now()
    cutoff = now - timedelta(minutes=minutes)

    # Find the actual time span of available data
    first_ts = datetime.fromisoformat(history[0]["timestamp"])
    available_minutes = (now - first_ts).total_seconds() / 60

    # Filter readings within the requested window
    readings = []
    for row in history:
        ts = datetime.fromisoformat(row["timestamp"])
        if ts >= cutoff:
            val = row.get(pot)
            if val is not None:
                readings.append(val)

    if not readings:
        return {"pot": pot.upper(), "average": None, "minutes_requested": minutes, "minutes_available": round(available_minutes, 1), "sample_count": 0}

    avg = sum(readings) / len(readings)
    return {
        "pot": pot.upper(),
        "average": round(avg, 2),
        "minutes_requested": minutes,
        "minutes_available": round(available_minutes, 1),
        "sample_count": len(readings),
    }


@app.get("/api/hardware/temperature")
async def get_temperatures() -> Dict[str, Any]:
    """Return the latest cached DS18B20 temperature readings"""
    return _temperature_cache


# ─── Brewer's Friend recipe endpoint ──────────────────────────────────────────

BREWERSFRIEND_API_BASE = "https://api.brewersfriend.com/v1"


def _get_api_key() -> str:
    api_key = os.getenv("BREWERSFRIEND_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=500, detail="BREWERSFRIEND_API_KEY not configured in .env")
    return api_key


@app.get("/api/recipes")
async def get_recipes() -> Dict[str, Any]:
    """Fetch all recipes from Brewer's Friend (without ingredients for speed)."""
    api_key = _get_api_key()
    headers = {"X-API-Key": api_key}

    all_recipes = []
    offset = 0
    limit = 100  # max allowed by the API

    async with httpx.AsyncClient(timeout=15) as client:
        while True:
            resp = await client.get(
                f"{BREWERSFRIEND_API_BASE}/recipes",
                headers=headers,
                params={"sort": "created_at:-1", "limit": limit, "offset": offset},
            )
            if resp.status_code == 401:
                raise HTTPException(status_code=401, detail="Invalid Brewer's Friend API key")
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail=f"Brewer's Friend API error: {resp.text}")

            data = resp.json()
            batch = data.get("recipes", [])
            if not batch:
                break

            for r in batch:
                all_recipes.append({
                    "id": r.get("id"),
                    "name": r.get("title", ""),
                    "style": r.get("stylename", ""),
                    "abv": r.get("abv", ""),
                    "ibu": r.get("ibutinseth", ""),
                    "ebc": r.get("srmecbmorey", ""),
                    "createdAt": r.get("created_at", ""),
                })

            if len(batch) < limit:
                break
            offset += limit

    return {"recipes": all_recipes}


@app.get("/api/recipes/{recipe_id}")
async def get_recipe(recipe_id: int) -> Dict[str, Any]:
    """Fetch a single recipe with full ingredients from Brewer's Friend."""
    api_key = _get_api_key()
    headers = {"X-API-Key": api_key}

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{BREWERSFRIEND_API_BASE}/recipes",
            headers=headers,
            params={"id": recipe_id, "ingredients": "true"},
        )
        if resp.status_code == 401:
            raise HTTPException(status_code=401, detail="Invalid Brewer's Friend API key")
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=f"Brewer's Friend API error: {resp.text}")

        data = resp.json()
        recipes = data.get("recipes", [])
        if not recipes:
            raise HTTPException(status_code=404, detail="Recipe not found")

        recipe = recipes[0]

        return {
            "id": recipe.get("id"),
            "name": recipe.get("title", ""),
            "style": recipe.get("stylename", ""),
            "og": recipe.get("og", ""),
            "preBoilGravity": recipe.get("boilgravity") or None,
            "postBoilGravity": recipe.get("post_boilgravity") or None,
            "fg": recipe.get("fg", ""),
            "abv": recipe.get("abv", ""),
            "ibu": recipe.get("ibutinseth", ""),
            "ebc": recipe.get("srmecbmorey", ""),
            "batchSize": _extract_batch_size_liters(recipe),
            "mashTemp": _extract_mash_temp(recipe),
            "fermentationTemp": _extract_fermentation_temp(recipe),
            "fermentables": _extract_fermentables(recipe),
            "hops": _extract_hops(recipe),
            "yeast": _extract_yeast(recipe),
            "mashGuidelines": _extract_mash_guidelines(recipe),
            "otherIngredients": _extract_other_ingredients(recipe),
            "waterProfile": _extract_water_profile(recipe),
        }


def _extract_mash_temp(recipe: Dict) -> Optional[str]:
    """Pull the main mash temperature from the recipe."""
    # Check mash steps first
    mash_steps = recipe.get("mashsteps", [])
    if mash_steps:
        # Find the longest step (typically the saccharification rest)
        main_step = max(mash_steps, key=lambda s: float(s.get("steptime", 0) or 0))
        temp = main_step.get("steptemp")
        unit = main_step.get("steptempunit", "C")
        if temp:
            return f"{temp}\u00b0{unit}"
    # Fallback: check recipe-level mash temp
    mash_temp = recipe.get("mashtemp")
    if mash_temp:
        return f"{mash_temp}\u00b0C"
    return None


def _extract_batch_size_liters(recipe: Dict) -> Optional[float]:
    """Return batch size in liters, converting from gallons if needed."""
    size = recipe.get("batchsize")
    if size is None:
        return None
    try:
        size = float(size)
    except (ValueError, TypeError):
        return None
    unit = (recipe.get("batchsizeunit") or "l").lower()
    if unit in ("gal", "gallon", "gallons"):
        size = round(size * 3.78541, 2)
    return size


def _extract_fermentation_temp(recipe: Dict) -> Optional[str]:
    """Pull the primary fermentation temperature from the recipe."""
    steps = recipe.get("fermentationsteps", [])
    if steps:
        step = steps[0]
        temp = step.get("steptemp")
        unit = step.get("steptempunit", "C")
        if temp:
            return f"{temp}\u00b0{unit}"
    temp = recipe.get("primarytemp") or recipe.get("fermentationtemp")
    if temp:
        return f"{temp}\u00b0C"
    return None


def _extract_fermentables(recipe: Dict) -> list:
    """Extract fermentable ingredients from the recipe."""
    fermentables = recipe.get("fermentables", [])
    result = []
    for f in fermentables:
        lovibond = f.get("lovibond")
        try:
            ebc = round(((float(lovibond) * 1.3546) - 0.76) * 1.97, 1) if lovibond is not None else None
        except (ValueError, TypeError):
            ebc = None
        result.append({
            "name": f.get("name", ""),
            "amount": f.get("amount", ""),
            "unit": f.get("unit", ""),
            "percent": f.get("percent", ""),
            "ebc": ebc,
        })
    return result


def _extract_hops(recipe: Dict) -> list:
    """Extract hop ingredients from the recipe."""
    hops = recipe.get("hops", [])
    return [
        {
            "name": h.get("name", ""),
            "amount": h.get("amount", ""),
            "unit": h.get("unit", ""),
            "use": h.get("hopuse", ""),
            "time": h.get("hoptime", ""),
            "aa": h.get("aa", ""),
            "ibu": h.get("ibu", ""),
            "temp": h.get("hopstand_temp", ""),
        }
        for h in hops
    ]


def _extract_water_profile(recipe: Dict) -> Optional[Dict[str, Any]]:
    """Extract target water profile from the recipe."""
    minerals = {
        "calcium": recipe.get("ca2"),
        "magnesium": recipe.get("mg2"),
        "sodium": recipe.get("na"),
        "chloride": recipe.get("cl"),
        "sulfate": recipe.get("so4"),
        "bicarbonate": recipe.get("hco3"),
    }
    name = recipe.get("waterprofile") or None
    ph = recipe.get("ph") or None
    notes = recipe.get("waternotes") or None

    # Filter out None/empty mineral values
    filled = {k: v for k, v in minerals.items() if v is not None and v != ""}

    # Only return a profile if there's at least a name or some mineral data
    if not name and not filled and not ph:
        return None

    return {
        "name": name,
        "ph": ph,
        "notes": notes,
        **minerals,
    }


def _extract_yeast(recipe: Dict) -> list:
    """Extract yeast from the recipe."""
    yeasts = recipe.get("yeasts", [])
    return [
        {
            "name": y.get("name", ""),
            "lab": y.get("laboratory", "") or y.get("lab", ""),
            "attenuation": y.get("attenuation", ""),
            "amount": y.get("amount", ""),
            "amountUnit": y.get("unit", ""),
        }
        for y in yeasts
    ]


def _extract_mash_guidelines(recipe: Dict) -> Optional[Dict[str, Any]]:
    """Extract full mash guidelines: all steps and notes."""
    mash_steps = recipe.get("mashsteps", [])
    steps = []
    for s in mash_steps:
        temp = s.get("temp") or s.get("steptemp")
        time_min = s.get("mashtime") or s.get("steptime")
        name = s.get("mashtype") or s.get("name") or ""
        amount = s.get("amount")
        unit = s.get("unit", "")
        step_data = {
            "name": name,
            "temp": f"{temp}°C" if temp else None,
            "time": time_min,
        }
        if amount:
            step_data["amount"] = f"{amount} {unit}".strip()
        steps.append(step_data)

    notes = recipe.get("mashnotes") or recipe.get("notes_mash") or None

    if not steps and not notes:
        return None

    return {
        "steps": steps,
        "notes": notes,
    }


def _extract_other_ingredients(recipe: Dict) -> list:
    """Extract miscellaneous / other ingredients from the recipe."""
    others = recipe.get("others", []) or recipe.get("miscs", [])
    result = []
    for m in others:
        name = m.get("name", "")
        amount = m.get("amount", "")
        unit = m.get("unit", "")
        use = m.get("otheruse") or m.get("miscuse") or m.get("use", "")
        time_val = m.get("othertime") or m.get("misctime") or m.get("time", "")
        other_type = m.get("othertype") or m.get("type", "")
        if name:
            result.append({
                "name": name,
                "amount": amount,
                "unit": unit,
                "use": use,
                "time": time_val,
                "type": other_type,
            })
    return result


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
