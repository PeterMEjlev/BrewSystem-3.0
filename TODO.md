



## Change hostname on pi to "Brewsystem"

---

# Code Review Findings (2026-07-02) — remaining open items

## SECURITY

### No auth on the LAN-facing API
The API binds to `0.0.0.0` with no auth, so anyone on the LAN can switch an 8.5 kW element on. Consider a shared token header checked by a FastAPI dependency on the `/api/hardware/*` routes.

## SMALLER ITEMS

### read_config() raises HTTPException outside request contexts
It's called from lifespan and the read loop; an HTTP exception is the wrong type there. Raise a plain RuntimeError and translate to HTTPException in the endpoints.

### Sequential sensor reads take ~565 ms of the 1 s budget
If you want 12-bit resolution back or a faster loop, use the w1_therm bulk conversion: write `trigger` to `/sys/bus/w1/devices/w1_bus_master1/therm_bulk_read`, wait once (~188 ms for all sensors), then read each — one conversion window instead of three.

### Thin test coverage in places
`backend/tests/` now covers the power budget, regulation, the timer and config
durability (73 tests, `pytest` from `backend/`). Still uncovered: the heat-fault
watcher, the WebSocket diffing, and everything in `src/` — there is no frontend
test runner set up at all.
