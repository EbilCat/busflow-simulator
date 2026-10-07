import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareSchedule,createState,advance,snapshot,applyCommand,routes,timetable,dispatchOptions} from '../lib/simulation.ts';
const close=(a,b,message='numbers differ')=>assert.ok(Math.abs(a-b)<1e-6,`${message}: ${a} vs ${b}`);
const read=date=>prepareSchedule(JSON.parse(readFileSync(new URL(`../lib/schedule/days/${date}.json`,import.meta.url))));
let tripsChecked=0,stopsChecked=0;
for(const date of timetable.dates){
  const schedule=read(date.date),initial=createState(schedule,0,schedule.startSeconds);
  assert.equal(initial.buses.length,172);assert.equal(schedule.trips.length,690);assert.equal(routes.length,36);
  const finished=advance(initial,schedule,(schedule.endSeconds-schedule.startSeconds)*1000);
  assert.equal(finished.running,false);assert.equal(Object.keys(finished.departures).length,690);assert.equal(Object.keys(finished.arrivals).length,690);
  // Repeated read-only snapshots must stop at completion even without a persisted command.
  assert.equal(snapshot(initial,schedule,86400000).simulation.elapsedSeconds,schedule.endSeconds);
  assert.equal(snapshot(initial,schedule,864000000).simulation.elapsedSeconds,schedule.endSeconds);
  for(const t of schedule.trips){
    assert.equal(finished.departures[t.id],t.departure,`${t.id} departure`);
    assert.equal(finished.arrivals[t.id],t.arrival,`${t.id} arrival`);
    const plan=schedule.plans.get(t.vehicleId),legs=plan.filter(p=>p.trip.id===t.id&&p.status==='moving'),route=routes.find(r=>r.id===t.routeId);
    assert.equal(legs.length,t.arrivals.length-1);
    assert.equal(legs[0].start,t.departure);
    legs.forEach((leg,i)=>{assert.equal(leg.end,t.arrivals[i+1]);assert.deepEqual(leg.to,route.points[i+1]);assert.equal(leg.toDistance,route.distances[i+1]);if(i)assert.equal(leg.start,t.arrivals[i]);});
    stopsChecked+=t.arrivals.length;tripsChecked++;
  }
  const eight=snapshot(createState(schedule,0),schedule,0);
  assert.equal(new Set(eight.buses.filter(b=>b.status==='moving').map(b=>b.routeId)).size,36);
  assert.equal(eight.buses.length,172);assert.equal(new Set(eight.buses.map(b=>b.id)).size,172);
  for(const r of routes){
    const t=schedule.trips.find(t=>t.routeId===r.id),middle=Math.floor(t.arrivals.length/2),seconds=t.arrivals[middle];
    const atStop=snapshot(createState(schedule,0,seconds),schedule,0).buses.find(b=>b.id===t.vehicleId);
    close(atStop.latitude,r.points[middle][0]);close(atStop.longitude,r.points[middle][1]);
  }
  const parked=snapshot(finished,schedule,finished.anchorReal);
  assert.ok(parked.buses.every(b=>b.status==='completed'&&b.progress===1));
  assert.ok(parked.buses.every(b=>Number.isFinite(b.latitude)&&Number.isFinite(b.longitude)));
  // Ready location must match the initial origin; do not invent teleporting buses.
  for(const v of schedule.vehicles){const p=schedule.plans.get(v.id)[0];assert.equal(schedule.readiness[v.id].location,schedule.routeById.get(p.trip.routeId).originId);}
}
console.log(`PASS: ${tripsChecked} intended trips and ${stopsChecked} stop calls across all 10 days; 36 moving routes at 08:00, planned resources, departures, arrivals, loops, finite positions and completed duties.`);
const schedule=read('2026-10-07');
const trip=schedule.trips[0],route=routes.find(r=>r.id===trip.routeId);
assert.equal(trip.vehicleId,'NW-V001');assert.equal(trip.crewId,'NW-C001');assert.equal(trip.warnings.length,1);
let s=createState(schedule,0,trip.departure+5),id=trip.vehicleId;
const bus=(state,now)=>snapshot(state,schedule,now).buses.find(b=>b.id===id);
s=applyCommand(s,{action:'pause'},schedule,10000);
const paused=bus(s,10000);assert.equal(bus(s,20000).latitude,paused.latitude);
s=applyCommand(s,{action:'start'},schedule,20000);
s=applyCommand(s,{action:'disrupt',busId:id,type:'breakdown'},schedule,21000);
const held=bus(s,21000);assert.equal(bus(s,31000).latitude,held.latitude);assert.equal(bus(s,31000).eta,null);assert.equal(bus(s,31000).available,false);
assert.throws(()=>applyCommand(s,{action:'disrupt',busId:id,type:'unavailable'},schedule,31000),/Resolve/);
s=applyCommand(s,{action:'resolve',id:s.buses.find(b=>b.id===id).disruptionId},schedule,31000);
assert.equal(bus(s,31000).latitude,held.latitude);assert.ok(bus(s,32000).distanceMeters>held.distanceMeters);
s=applyCommand(s,{action:'disrupt',busId:id,type:'delay',durationSeconds:30},schedule,32000);
const delayPosition=bus(s,32000);assert.equal(bus(s,61000).latitude,delayPosition.latitude);assert.equal(bus(s,62000).status,'moving');assert.equal(bus(s,62000).latitude,delayPosition.latitude);assert.ok(bus(s,63000).distanceMeters>delayPosition.distanceMeters);
s=applyCommand(s,{action:'bus-speed',busId:id,speedKph:0},schedule,64000);const zero=bus(s,64000);assert.equal(bus(s,84000).status,'held');assert.equal(bus(s,84000).latitude,zero.latitude);
s=applyCommand(s,{action:'bus-speed',busId:id,speedKph:36},schedule,84000);assert.equal(bus(s,84000).latitude,zero.latitude);
const tenMeters=bus(s,85000).distanceMeters-zero.distanceMeters;assert.ok(tenMeters>=9&&tenMeters<=11);
s=applyCommand(s,{action:'bus-speed',busId:id,speedKph:null},schedule,85000);assert.equal(bus(s,85000).speedOverride,null);
assert.throws(()=>applyCommand(s,{action:'bus-speed',busId:id,speedKph:81},schedule,85000),/between/);
assert.throws(()=>applyCommand(s,{action:'bus-speed',busId:id},schedule,85000),/between/);
assert.throws(()=>applyCommand(s,{action:'disrupt',busId:id,type:'delay',durationSeconds:NaN},schedule,85000),/Delay/);
assert.throws(()=>applyCommand(s,{action:'speed',speed:0},schedule,85000),/Speed/);
assert.throws(()=>createState(schedule,0,NaN),/time/);
assert.throws(()=>createState(schedule,0,19799),/time/);
const reset=applyCommand(s,{action:'reset'},schedule,85000);assert.equal(reset.elapsed,28800);assert.equal(reset.running,false);assert.equal(reset.disruptions.length,0);assert.ok(reset.buses.every(b=>b.speedOverride===null));
const seek=applyCommand(s,{action:'seek',timeSeconds:21600},read('2026-10-05'),85000);assert.equal(seek.serviceDate,'2026-10-05');assert.equal(seek.elapsed,21600);assert.equal(seek.running,false);assert.equal(seek.revision,s.revision+1);
console.log('PASS: pause, resume, breakdown continuity, recovery, delay expiry, zero speed, fixed speed, restore timetable speed, invalid commands, reset and date/time seek.');
// A fast bus cannot start subsequent services before their scheduled departure.
let fast=createState(schedule,0,schedule.startSeconds);fast=applyCommand(fast,{action:'bus-speed',busId:id,speedKph:80},schedule,0);
fast=advance(fast,schedule,(schedule.endSeconds-schedule.startSeconds)*1000);
for(const t of schedule.trips.filter(t=>t.vehicleId===id))assert.ok(fast.departures[t.id]>=t.departure);
// Layover absorbs disruption delay, while travel, alighting, turnaround and boarding remain intact.
const one=advance(s,schedule,1200000);let many=s;
for(let now=86000;now<=1200000;now+=1000)many=advance(many,schedule,now);
assert.equal(one.buses.length,many.buses.length);
one.buses.forEach((b,i)=>{assert.equal(b.phase,many.buses[i].phase);close(b.progress,many.buses[i].progress);});
Object.keys(one.departures).forEach(k=>close(one.departures[k],many.departures[k]));
// An actual planned transfer stays between its terminal endpoints and reaches the next boarding point.
const movement=schedule.movements[0],next=schedule.tripById.get(movement.toTripId),middle=next.arrivals[0]-movement.duration/2;
const transfer=snapshot(createState(schedule,0,middle),schedule,0).buses.find(b=>b.id===movement.vehicleId);
assert.equal(transfer.status,'deadheading');close(transfer.latitude,(movement.fromPoint[0]+movement.toPoint[0])/2);close(transfer.longitude,(movement.fromPoint[1]+movement.toPoint[1])/2);
console.log('PASS: no early subsequent departures, terminal transfer interpolation, and tick-size invariance after interventions.');
// Confirming dispatch is idempotent and uses a listed trip, bus, crew, route and origin.
let dispatchState=applyCommand(createState(schedule,0),{action:'pause'},schedule,0);
const option=dispatchOptions(dispatchState,schedule,0).find(t=>t.eligible);
const command={action:'dispatch',tripId:option.tripId,interchangeId:option.interchangeId,routeId:option.routeId};
dispatchState=applyCommand(dispatchState,command,schedule,0);assert.equal(dispatchState.buses.length,172);assert.deepEqual(dispatchState.confirmedTrips,[option.tripId]);
const duplicate=applyCommand(dispatchState,command,schedule,0);assert.equal(duplicate.revision,dispatchState.revision);assert.equal(duplicate.confirmedTrips.length,1);
assert.throws(()=>applyCommand(dispatchState,{...command,interchangeId:'bad'},schedule,0),/does not start/);
assert.throws(()=>applyCommand(dispatchState,{...command,tripId:trip.id,routeId:trip.routeId,interchangeId:route.originId},schedule,0),/already departed/);
assert.throws(()=>applyCommand(dispatchState,{...command,tripId:'missing'},schedule,0),/not found/);
const conflict=dispatchOptions(createState(schedule,0,schedule.startSeconds),schedule,0).find(t=>t.tripId===trip.id);assert.equal(conflict.eligible,false);
const other=dispatchOptions(dispatchState,schedule,0).find(t=>t.eligible&&!t.confirmed&&t.vehicleId!==option.vehicleId);
dispatchState=applyCommand(dispatchState,{action:'disrupt',busId:other.vehicleId,type:'unavailable'},schedule,0);
assert.throws(()=>applyCommand(dispatchState,{action:'dispatch',tripId:other.tripId,routeId:other.routeId,interchangeId:other.interchangeId},schedule,0),/unresolved disruption/);
assert.equal(new Set(dispatchOptions(createState(schedule,0,schedule.startSeconds),schedule,0).map(t=>t.interchangeId)).size,13);
console.log('PASS: planned dispatch at all 13 departure points, no duplicate vehicles, idempotency, wrong origin, missing trip, departed trip and unavailable resources.');
