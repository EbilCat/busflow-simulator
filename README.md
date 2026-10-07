# Busflow simulator

A working bus-movement prototype for testing a disruption-aware scheduling planner. The map and HTTP endpoints share one server-side simulation persisted in Cloudflare D1.

## Run locally

Requires Node 22.13 or newer. Install with `npm ci`, then:

```sh
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_cloudy_may_parker.sql
npm run dev
```

Use the **actual generated migration filename** in `drizzle/` in place of `0000_cloudy_may_parker.sql`. Apply it once to a fresh local database. The development server prints its URL, normally `http://localhost:5173`.

## Operator flow

Use **Dispatch new bus** to choose one of 13 departure points and its available service/destination from 36 route patterns in the workspace network snapshot. Click an INT marker to preselect that departure point. A new simulated bus is created at the origin, selected, and followed on the map. Dispatch while paused queues the bus in place until the simulation resumes.

Select a bus in the fleet list or map. Use **Bus speed** (0–80 km/h), then **Apply bus speed**, to alter only that bus. Zero holds it in place. Raising the speed resumes it without jumping. Speed changes do not clear breakdowns or other disruptions; the new speed applies when the disruption ends. The global time multiplier remains independent.

Select a bus in the fleet list or map. Inject a breakdown, unavailability, or a timed delay. Restore it with **Restore service**. Pause, resume, reset, and choose 1×, 3×, 10×, or 30× simulation speed. Reset removes dispatched buses, restores the original nine buses to their origins, and pauses the scenario. Route and status filters, map fit, follow-bus, and the event timeline help inspect the outcome.

Nine synthetic buses run single trips along three illustrative Singapore corridors. Trips depart in 90-second simulation-time intervals. Paths are sample coordinate polylines, not official routes or turn-by-turn road routing. Stops are reference waypoints; dwell times, traffic, passengers, driver shifts, and existing-trip reassignment commands are not modeled yet. Dispatched trips use real ordered stop coordinates from the local public network snapshot, joined by approximate segments, not road-snapped paths. New dispatched vehicles are simulator objects and do not assert any real spare-fleet availability. Trips finish at the destination; reset to repeat.

## Position API

All responses are JSON with `Cache-Control: no-store`. Poll about once per second.

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/api/buses` | All bus positions and states |
| GET | `/api/buses?routeId=01&status=moving` | Filter fleet |
| GET | `/api/buses/BUS-101` | One bus |
| GET | `/api/routes` | All available routes, polylines, and stops |
| GET | `/api/interchanges` | Available departure points |
| POST | `/api/buses/dispatch` | `{ "interchangeId": "53009", "routeId": "B54_1", "speedKph": 30 }` |
| POST | `/api/buses/BUS-101/speed` | `{ "speedKph": 40 }` (0–80) |
| GET | `/api/simulation` | Clock, running state, speed, revision |
| GET | `/api/disruptions` | Active and resolved disruptions |
| GET | `/api/events` | Recent events |
| GET | `/api/snapshot` | Same combined snapshot used by the frontend |
| POST | `/api/simulation/control` | `{ "action": "start" }`, `pause`, `reset`, or `{ "action": "speed", "speed": 10 }` |
| POST | `/api/disruptions` | `{ "busId": "BUS-101", "type": "breakdown" }` |
| POST | `/api/disruptions` | `{ "busId": "BUS-101", "type": "unavailable" }` |
| POST | `/api/disruptions` | `{ "busId": "BUS-101", "type": "delay", "durationSeconds": 120 }` |
| POST | `/api/disruptions/{id}/resolve` | `{}` |

```sh
curl http://localhost:5173/api/buses
curl -X POST http://localhost:5173/api/disruptions \
  -H 'Content-Type: application/json' \
  -d '{"busId":"BUS-101","type":"breakdown"}'
```

Position fields include latitude/longitude in WGS84, heading in degrees, speedKph, operational status, availability, routeId, tripId, progress, nextStop, and eta. Simulation starts at 08:00 SGT on the scenario date, 2026-10-07. ISO timestamps `updatedAt`, `eta`, and `simulation.time` use that clock. `generatedAt` is real response time. Availability represents operational capability, not whether an in-service bus is free for a new assignment.

Breakdown and unavailability both freeze the bus at its current location until resolved. Timed delays automatically end after the specified **simulation** seconds. Pause stops both travel and delay countdowns. Speed changes preserve position and clock continuity. Invalid input returns 400, missing IDs 404, conflicting actions 409, and storage failures 503.

The hosted demo is private and its API requires site sign-in. An unattended planner can directly use local endpoints; deployment with machine-to-machine authentication or a controlled proxy is a follow-up integration. Do not expose unauthenticated write endpoints to the public internet.

## Engine and consistency

The clock is calculated from a persisted real-time anchor, simulation-time anchor, and speed multiplier. Positions are evaluated on demand without requiring a background timer, so time keeps advancing even when the frontend is closed. Every command rebases the state before applying changes. Reads do not move the anchor. Compare-and-swap revision updates prevent concurrent operators from overwriting each other.

Frontend polling is sequential. Older responses cannot replace a newer revision. Moving markers interpolate for 850 ms toward each received position (a small visual lag); stopped/disrupted markers snap to the exact authoritative location. A stale-feed label appears after four seconds without a successful response. The map can continue showing routes and vehicle data if external map tiles fail.

## Validation

```sh
node --experimental-strip-types scripts/test-simulation.mjs
npx tsc --noEmit
npm run build
```

The engine checks cover movement, staggered starts, pause, breakdown, recovery without jumping, timed delays, speed changes, input validation, exact destination arrival, reset, and independence from update frequency.

Mapping: [Leaflet](https://leafletjs.com/reference-1.9.4.html), with properly attributed [Singapore OneMap tiles](https://www.onemap.gov.sg/docs/maps/grey.html). Internet access is needed for the basemap. Routes and bus markers are generated locally from scenario data.

## Dispatch geography

`lib/network.json` contains only public route/stop geography from the supplied LionLink network snapshot (`../lionlink-operations-network-candidate/data/{stops,routes,route_stops}.csv`). No vehicle, driver, passenger, timetable, or other fictional operating records were copied. All origin points are supported, including eight interchanges plus terminals and two other service origins. The selector is bounded to this provided sample network, not every interchange in Singapore.

The dispatch endpoint validates that the service actually starts at the selected origin. IDs are generated on the server and remain unique during concurrent dispatch. The prototype caps a scenario at 100 vehicles. Command errors do not change the prior state. Speed/dispatch/disruption actions are all recorded in the event timeline.

Engine tests also exercise all 36 dispatch route patterns, dispatch while paused, individual speed changes, 0 km/h holding, exact position continuity, disruption precedence, and reset cleanup. The optional browser WebMCP control tool is feature-detected; invocation validation was unavailable in this preview browser.
