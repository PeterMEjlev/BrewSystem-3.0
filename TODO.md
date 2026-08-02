## Option to calibrate the temp sensors

## Generic alarm sound when a manual timer is up 





## Change hostname on pi to "Brewsystem" allowing user to hit http://brewsystem.local to control pi. 

---

# Code Review Findings (2026-07-02) — remaining open items

## SECURITY

### No auth on the LAN-facing API
The API binds to `0.0.0.0` with no auth, so anyone on the LAN can switch an 8.5 kW element on. Consider a shared token header checked by a FastAPI dependency on the `/api/hardware/*` routes.

## SMALLER ITEMS

### Log a loud warning when IS_RPI is false
pigpio is now in requirements.txt, but if the pigpio daemon isn't running the backend silently falls into simulation mode while real relays sit idle. Log a prominent startup warning.

### read_config() raises HTTPException outside request contexts
It's called from lifespan and the read loop; an HTTP exception is the wrong type there. Raise a plain RuntimeError and translate to HTTPException in the endpoints.

### Sequential sensor reads take ~565 ms of the 1 s budget
If you want 12-bit resolution back or a faster loop, use the w1_therm bulk conversion: write `trigger` to `/sys/bus/w1/devices/w1_bus_master1/therm_bulk_read`, wait once (~188 ms for all sensors), then read each — one conversion window instead of three.

### fsync in write_config_atomic
Power loss during an SD-card write can leave a truncated config. Add `tmp_file.flush(); os.fsync(tmp_file.fileno())` before `os.replace`, and consider falling back to config.default.json (with a loud log) if config.json fails to parse at startup.

### Electron gives up waiting for the backend after 30 s
electron/main.js shows a dead-end page if the backend isn't up in 30 s (reachable on a slow Pi boot). Make the failure page auto-retry.

### No tests
The power-capping/priority logic (now centralized in `_apply_efficiency` / `_regulation_tick` in main.py) and the timer state machine are the most intricate code in the repo. A small pytest suite using FastAPI's TestClient with utils_rpi mocked would lock down the BK-priority/headroom math cheaply.
