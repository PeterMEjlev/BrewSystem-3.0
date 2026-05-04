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