# Busflow simulator

A map and HTTP API for testing a disruption-aware scheduling planner against the **intended LionLink timetable**. The frontend and planner consume the same server-side simulation, persisted in Cloudflare D1.

## Timetable coverage

- 172 listed vehicles, 24 services, 36 directional/loop route patterns, and 13 departure points.
- 690 trips and 25,238 ordered stop calls per day across all 10 supplied service dates, 5–16 October 2026 (weekdays).
- Default replay: **7 October 2026, 08:00 SGT**, when every route pattern has a moving bus. Other times reflect the timetable; routes need not have an in-service bus outside their scheduled operating periods.
- Published departures run from 06:00 to 11:59. Final alighting finishes by 13:22. All 36 patterns remain available on the map and API throughout the day.

The supplied operating records are fictional exercise data built on Singapore route/stop geography. Positions are simulated, not live operator GPS.

## Run locally

Requires Node 22.13+ and Python 3 for reimporting source data. The compiled timetable is checked into the project; the source database is not needed to run it.

```sh
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_cloudy_may_parker.sql
npm run dev
```

Apply the migration once to a fresh local database. Use the migration filename present in `drizzle/`. The server normally prints `http://localhost:5173`.

## Operator flow

Choose a service date and time, then **Load timetable**. This positions all buses at that point in the intended plan and pauses the replay, clearing interventions and dispatch confirmations. **Start**, **Pause**, and the 1×/3×/10×/30× clock multiplier control shared simulation time. **Reset** returns the current date to 08:00 and pauses. The clock stops when all duties finish, or at 23:59:59 if disruptions leave vehicles held.

All trips automatically dispatch using their **planned vehicle and crew**. A physical vehicle keeps the same identifier across its daily trips. **Dispatch scheduled bus**, or an INT marker, lets an operator select an origin, route, and upcoming trip and confirm that existing assignment. Confirmation is idempotent: it records the operator action, without adding a spare vehicle, advancing the departure, or replacing resources. The previous arbitrary BUS-### creation behavior has been replaced with timetable-backed dispatch. Departed trips and unavailable assignments cannot be newly confirmed.

Select a bus on the map or in the fleet list. **Apply bus speed** overrides travel speed for that vehicle (0–80 km/h); zero holds it in place. **Use timetable speed** restores each segment's published running time without teleporting the bus or erasing accrued delay. Overrides continue across that vehicle's later trips until cleared. The global clock multiplier remains independent.

Breakdown and unavailability freeze a bus until **Restore service**. Timed delays automatically end after the chosen number of simulation seconds. Speed changes do not resolve a disruption. Recovery continues from the held position, retains required terminal activities, and uses available layover time to recover delay. Later trips never depart before their published departure. The detail panel shows planned times, crew, projected arrival and deviation.

## Timing and position model

The importer reads `scheduled_departure_at`, `scheduled_arrival_at`, `planned_vehicle_id`, `planned_crew_id`, and scheduled stop-call arrivals. **Recorded actual trip/stop times and actual vehicle/crew substitutions do not drive the replay.**

Each route preserves every stop occurrence, including repeated stops on loops. A bus boards at its origin, travels from its published departure to the next scheduled stop arrival, and continues between successive scheduled arrivals. The source has no intermediate scheduled departure timestamps: intermediate dwell is therefore not separately modeled. Latitude/longitude interpolate between stop coordinates; distance/progress/speed use the route's published cumulative distances. This is not road-snapped geometry or a traffic model.

Terminal handling uses the supplied exercise constraints: 45 seconds final alighting, then 420 seconds turnaround including the next 120 seconds of boarding at the same terminal. For a different terminal, use the full 420 seconds stationary turnaround, the supplied terminal movement planning allowance, and 120 seconds boarding after transfer. Transfers are placed to end at the next boarding time. Their positions interpolate between terminal endpoints, using the supplied planned distance/duration; observed movement timestamps are excluded. Remaining stationary time is layover. Crew changes fit within stationary turnaround; individual crew activity and passenger queues/capacity are not simulated.

On 7 and 14 October, the first service 235 trip's planned crew availability conflicts with the published trip. Those source inconsistencies are exposed as warnings; the intended replay retains the planned assignment rather than substituting the recorded actual replacement. Dispatch confirmation checks source warnings, vehicle release, crew record availability, holds and disruptions. This simulator replays a plan; it does not solve resource reassignment or enforce crew feasibility after interventions. The scheduling planner can use the resulting deviations to propose changes.

## Position API

JSON responses use `Cache-Control: no-store`. Poll about once per second. ISO timestamps are UTC representations of the simulation's Singapore time; `generatedAt` is real response time. Numeric trip/stop times from `/api/trips` are **seconds since midnight SGT** on `serviceDate`.

| Method | Endpoint | Description / body |
| --- | --- | --- |
| GET | `/api/buses` | All 172 positions and planned assignments |
| GET | `/api/buses?routeId=B235_1&status=moving` | Filter the fleet |
| GET | `/api/buses/NW-V001` | One physical bus |
| GET | `/api/routes` | All 36 route patterns, ordered stops, distances and geometry |
| GET | `/api/interchanges` | All 13 supplied departure points |
| GET | `/api/timetable` | Available dates, coverage, source hash and modeling basis |
| GET | `/api/trips?routeId=B235_1` | Current date's intended trips and ordered arrival times |
| GET | `/api/dispatch-options?interchangeId=52009` | Remaining trips, planned resources, eligibility and reasons; also accepts `routeId` |
| POST | `/api/buses/dispatch` | `{ "tripId": "<listed trip>", "routeId": "<matching route>", "interchangeId": "<matching origin>" }` |
| POST | `/api/buses/NW-V001/speed` | `{ "speedKph": 40 }`; `0` holds, `null` restores timetable speed |
| GET | `/api/simulation` | Date, clock, revision, trip counts, source warnings |
| GET | `/api/disruptions` | Active and resolved disruptions |
| GET | `/api/events` | Latest 100 events, including simulated departures and arrivals |
| GET | `/api/snapshot` | Combined snapshot consumed by the dashboard |
| POST | `/api/simulation/control` | `{ "action": "start" }`, `pause`, `reset`, or `{ "action": "speed", "speed": 10 }` |
| POST | `/api/simulation/control` | `{ "action": "seek", "serviceDate": "2026-10-07", "timeSeconds": 28800 }` |
| POST | `/api/disruptions` | `{ "busId": "NW-V001", "type": "breakdown" }` or `unavailable` |
| POST | `/api/disruptions` | `{ "busId": "NW-V001", "type": "delay", "durationSeconds": 120 }` |
| POST | `/api/disruptions/{id}/resolve` | `{}` |

A bus includes WGS84 position, heading, `speedKph`, `speedOverride`, `publishedSpeedKph`, status, availability, `routeId`, `tripId`, planned vehicle/crew, scheduled and simulated departure/arrival times, trip progress, next stop occurrence, ETA and schedule deviation. `available` means operational and within the vehicle release window, not free for reassignment. While paused, current speed is zero; `publishedSpeedKph` still describes the segment's nominal speed. During terminal turnaround or layover, the bus reports its just-completed trip until it begins positioning/boarding for the next one.

Status values: `scheduled`, `boarding`, `moving`, `alighting`, `turnaround`, `layover`, `deadheading`, `completed`, `breakdown`, `unavailable`, `delayed`, `held`. A bus remains at its final destination after completing its daily duty.

```sh
curl http://localhost:5173/api/buses
curl -X POST http://localhost:5173/api/disruptions \
  -H 'Content-Type: application/json' \
  -d '{"busId":"NW-V001","type":"breakdown"}'
```

Invalid input returns 400, missing identifiers 404, conflicting actions 409, and storage failures 503. The private hosted API requires site sign-in; a local planner can call these endpoints directly.

## Data import and consistency

```sh
npm run data:import
# Or choose another source explicitly:
python3 scripts/import-timetable.py --source /absolute/path/lionlink-network.sqlite
```

Default source: `../lionlink-operations-network-candidate/data/lionlink-network.sqlite` opened read-only. Generated files: `lib/network.json`, `lib/schedule/manifest.json`, and one JSON file per date under `lib/schedule/days/`. The importer checks stop ordering, vehicle duty spacing and required transfers; the manifest records the source SHA-256. No passenger records are imported. Schedule chunks load on demand on the server; only the active day's prepared plan is cached.

The simulation uses a persisted real-time anchor, simulation-time anchor and clock multiplier. Reads advance positions deterministically without writing or needing a background timer. Commands rebase and compare-and-swap the D1 revision to avoid lost updates. The timetable engine stores its state under `published-timetable-v1`, preserving the old sample scenario's row. Seeking starts a new baseline and keeps revisions increasing.

Frontend polling is sequential and rejects old responses. Moving map markers interpolate toward each received position over 850 ms; the API remains authoritative. Routes and bus markers remain usable if external basemap tiles fail. Mapping uses Leaflet with attributed Singapore OneMap tiles.

## Validation

```sh
npm test
npx tsc --noEmit
npm run build
# Optional live integration checks: resets the local shared scenario, then leaves it running at 08:00.
node scripts/test-api.mjs --reset-local-scenario
```

Deterministic checks cover all 6,900 planned departures/arrivals, all 252,380 stop-call mappings, all dates/routes, repeated stops, source assignment conflicts, transfers, pause, disruption recovery, speed overrides, no early departures on subsequent trips, tick-size invariance, dispatch resource validation/idempotency, reset and seek. Live checks cover API filtering, concurrent commands, assignment-backed dispatch, disruptions, date changes and input errors.
