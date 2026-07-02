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

# Code Review Findings (2026-07-02)

## SAFETY-CRITICAL

### Move temperature regulation from browser to backend
The auto-efficiency control loop currently lives in a React effect in PotCard.jsx (lines 57-80). The backend just obeys the last duty cycle it was told. If Chromium crashes, the tab freezes, WiFi drops, or the Pi's display process dies mid-brew, the heater keeps running at its last duty cycle indefinitely — nothing on the backend will ever throttle it as the wort approaches setpoint.

The backend already has everything it needs: `_control_state` holds `sv` and `regulationEnabled`, `_temperature_cache` holds `pv`, and the step config is in config.json. Add a regulation pass to the existing 1 s read loop in main.py (lines 40-59):
- For each pot with `regulationEnabled` + `ae["enabled"]`, compute `diff = sv - pv`, walk the steps to find the power level, apply it via the same relay/PWM path `set_pot_efficiency` uses (including max_watts headroom capping).
- Then strip the two regulation effects out of PotCard and let the UI purely display polled state.
- Also add a dead-man's switch: if the sensor cache hasn't refreshed for N seconds, or temp exceeds an absolute ceiling (e.g. 105°C), force heaters off. (ARCHITECTURE.md lists this under "Production Requirements" but it was never implemented.)

### Failed sensor reads as -1°C drive regulation to 100% power
utils_rpi.py (lines 143-147) returns `-1.0` on any read failure (disconnected probe, CRC failure). Under regulation, `diff = sv - (-1)` is always huge, so a sensor failure mid-brew drives the element to full power with no feedback — the worst possible response to a broken sensor. The sentinel also pollutes the chart and corrupts `/api/temperature/average`.
- Return `None` on failure instead of `-1.0`.
- In the regulation loop: `if pv is None`, force heater off and set a sensorError flag the UI surfaces prominently.
- In session_logger.log_reading, write empty cells for `None` so averages/charts skip them.
- In the UI, show `--` and a warning instead of `-1.0°`.

### Reloading the page kills heaters and wipes the session log
BrewingPanel.jsx (lines 53-55) calls `hardwareApi.initialize()` on every mount in production. That endpoint (main.py 326-337) drives all GPIO pins LOW, zeroes control state, AND starts a new logging session. A mid-brew browser reload — which Chromium kiosk mode does automatically after a renderer crash — silently turns off both heaters and pumps and deletes the entire temperature history.
- Initialize GPIO once in the backend `lifespan`, not from the UI.
- On frontend mount, only do `getFullState()` and sync.
- Make "start new session" an explicit button (Settings or Tools page), not a side effect.

### Same-day backend restart truncates the session log
session_logger.py (lines 17-21) names the file by date only (`session_02-07-2026.csv`) and opens with `"w"`. Restart the service twice in one day (or hit the reload bug above) and earlier data is gone.
- Add a time component: `datetime.now().strftime("%Y-%m-%d_%H%M%S")` (also sorts chronologically, unlike `%d-%m-%Y`).
- Consider seeding `_history` from the newest existing CSV so a backend restart mid-brew doesn't blank the chart.

## SECURITY

### Path traversal in the SPA catch-all serves .env
main.py (lines 937-944) does `STATIC_DIR / full_path` with no containment check. Uvicorn doesn't normalize `..`, so `curl --path-as-is http://<pi>:8000/../.env` returns the Brewer's Friend API key; `/../config.json`, `/../backend/main.py` also work. Fix: resolve the path and verify `file_path.is_relative_to(STATIC_DIR.resolve())` before serving.
- Related: the API binds to `0.0.0.0` with no auth, so anyone on the LAN can switch an 8.5 kW element on. Consider a shared token header checked by a FastAPI dependency on the `/api/hardware/*` routes.

### Validate control inputs
`PotEfficiencyRequest.value`, `PumpSpeedRequest.value`, and `PotSvRequest.value` accept any float — `{"value": 1000}` goes straight into `pi.hardware_PWM` duty math. Add Pydantic bounds: efficiency/speed `Field(ge=0, le=100)`, sv `Field(ge=0, le=110)`.

## PERFORMANCE & EFFICIENCY

### Debounce settings writes (SD-card wear)
Every onChange in Settings.jsx calls updateSettings -> persist -> POST -> full atomic config.json rewrite. Color pickers fire onChange continuously while dragging, producing dozens of writes/sec to the Pi's SD card. Debounce in SettingsContext.jsx (lines 69-75): update React state immediately, persist on a ~500 ms trailing timer.

### Recipe list refetches every Brewer's Friend page on every tab visit
RecipePage unmounts when leaving the tab (App.jsx line 46), and its mount effect calls fetchRecipes(), which walks all pages of the remote API (main.py 665-700). Browsing back and forth is slow and risks the 429 rate limit. Either cache the list at module level / sessionStorage (only refetch on explicit refresh button), or wrap get_recipes in a 5-10 min TTL cache on the backend.

### Replace backend print() spam with logging
Once regulation runs at 1 Hz, utils_rpi.py prints on every duty-cycle change. Under systemd that's journal churn (more SD writes). Replace `print` with `logging.getLogger(__name__).debug(...)`.

### Centralize hard-coded element wattages
`_BK_MAX_WATTS = 8500` / `_HLT_MAX_WATTS = 5000` exist in both main.py (362-363) and BrewingPanel.jsx (11-12), while the comment at main.py:163 says HLT is 5.5 kW. Put `bk_element_watts` / `hlt_element_watts` in config.json next to max_watts; backend enforces, frontend reads from /api/settings. Same for the default regulation steps, duplicated across PotCard.jsx, SettingsContext.jsx, main.py, and config.default.json.

### Incremental history fetch instead of full-session payloads
/api/temperature/history returns the whole session every chart remount, and /api/temperature/average re-parses ISO timestamps for every row. Store the epoch timestamp in each history row when logging (no fromisoformat in the average endpoint), and accept `?since=<ts>` on the history endpoint so the chart tops up rather than re-downloads. Would also let the chart use server timestamps exclusively instead of mixing server history with client-clock Date.now() points (TemperatureChart.jsx 65-71), which can drift if clocks disagree.

## SMALLER ITEMS

### LTTB downsampling only uses BK to pick points
downsample.js line 18 — an MLT or HLT spike that BK doesn't share can be dropped from the rendered chart. Compute triangle area per series and keep the index with max combined area.

### pigpio missing from requirements.txt
Deployment on a fresh Pi will import-fail silently into simulation mode (the try/except in utils_rpi masks it). Add it, and log a loud warning at startup when IS_RPI is false so a misconfigured Pi doesn't quietly simulate GPIO while real relays sit idle.

### read_config() raises HTTPException outside request contexts
It's called from lifespan and the read loop (main.py:52); an HTTP exception is the wrong type there. Raise a plain RuntimeError and translate to HTTPException in the endpoints.

### Sequential sensor reads take ~565 ms of the 1 s budget
If you want 12-bit resolution back or a faster loop, use the w1_therm bulk conversion: write `trigger` to `/sys/bus/w1/devices/w1_bus_master1/therm_bulk_read`, wait once (~188 ms for all sensors), then read each — one conversion window instead of three.

### No tests
The power-capping/priority logic in set_pot_efficiency and handlePotUpdate is the most intricate code in the repo and is duplicated across languages. A small pytest suite using FastAPI's TestClient with utils_rpi mocked would lock down the BK-priority/headroom math and the timer state machine cheaply.