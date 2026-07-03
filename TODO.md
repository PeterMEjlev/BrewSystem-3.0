## Option to calibrate the temp sensors

## Generic alarm sound when a manual timer is up 

## If pot is turned on, but the relevant sensor doesnt get hotter than a certain amount after x time (check connection reminder)

## Replace 500 ms polling with WebSocket push
Currently the UI polls `getAllStates()` every 500 ms from BrewingPanel.jsx and TemperatureChart.jsx, plus a separate poll loop for the chart. This means the Pi handles ~2 requests/sec per client even when nothing changes, and UI updates lag by up to 500 ms after a state change.

Switch to a single persistent WebSocket connection where the backend pushes state updates only when something actually changes (sensor read, heater toggle, pump speed change, timer tick). Goals:
- Idle = near-zero traffic instead of constant polling
- Heater/pump toggles reflect in the UI within a few ms instead of waiting for the next poll tick
- Scales cleanly when a second client is added (e.g. phone companion view)

Scope:
- Backend: add a WS endpoint (FastAPI has it built in), a connection registry, and broadcast hooks wherever pot/pump/timer state mutates. Send diffs, not full snapshots.
- Frontend: replace the setInterval polls in BrewingPanel and TemperatureChart with a WS client. Handle reconnect + full-state resync on drop.
- Keep the existing REST endpoints for one-shot writes (set SV, toggle heater, etc.) — only the read path moves to WS.

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
