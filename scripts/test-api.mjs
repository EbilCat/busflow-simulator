// Explicitly opt in: this resets the shared LOCAL simulator and ends running at 08:00.
import assert from 'node:assert/strict';
if(process.argv[2]!=='--reset-local-scenario')throw new Error('Pass --reset-local-scenario to test the local server. This clears current interventions.');
const root='http://127.0.0.1:5173';
const call=async(path,body,status=200)=>{
 const r=await fetch(root+path,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
 const result=await r.json();assert.equal(r.status,status,JSON.stringify(result).slice(0,300));assert.equal(r.headers.get('Cache-Control'),'no-store');return result;
};
try{
 let state=await call('/api/simulation/control',{action:'seek',serviceDate:'2026-10-07',timeSeconds:28800});
 assert.equal(state.buses.length,172);assert.equal(state.routes.length,36);assert.equal(state.simulation.running,false);
 assert.equal(new Set(state.buses.filter(b=>b.status==='moving').map(b=>b.routeId)).size,36);
 assert.equal((await call('/api/trips')).trips.length,690);
 assert.equal((await call('/api/timetable')).dates.length,10);
 assert.equal((await call('/api/interchanges')).interchanges.length,13);
 const moving=state.buses.find(b=>b.status==='moving');
 assert.equal((await call(`/api/buses/${moving.id}`)).bus.tripId,moving.tripId);
 assert.ok((await call(`/api/buses?routeId=${moving.routeId}&status=moving`)).buses.every(b=>b.routeId===moving.routeId&&b.status==='moving'));
 const option=(await call('/api/dispatch-options')).trips.find(t=>t.eligible);
 const command={tripId:option.tripId,routeId:option.routeId,interchangeId:option.interchangeId};
 state=await call('/api/buses/dispatch',command);assert.equal(state.buses.length,172);assert.deepEqual(state.confirmedTrips,[option.tripId]);
 const duplicate=await call('/api/buses/dispatch',command);assert.equal(state.simulation.revision,duplicate.simulation.revision);
 const revisions=await Promise.all([call(`/api/buses/${moving.id}/speed`,{speedKph:18}),call('/api/simulation/control',{action:'speed',speed:3})]);
 assert.equal(new Set(revisions.map(s=>s.simulation.revision)).size,2);
 state=await call('/api/snapshot');assert.equal(state.simulation.speed,3);assert.equal(state.buses.find(b=>b.id===moving.id).speedOverride,18);
 state=await call('/api/disruptions',{busId:moving.id,type:'breakdown'},201);const stopped=state.buses.find(b=>b.id===moving.id);assert.equal(stopped.status,'breakdown');assert.equal(stopped.eta,null);assert.equal(stopped.latitude,moving.latitude);
 await call('/api/simulation/control',{action:'start'});
 state=await call('/api/buses/'+moving.id);assert.equal(state.bus.latitude,stopped.latitude);
 state=await call(`/api/disruptions/${stopped.disruptionId}/resolve`,{});assert.equal(state.buses.find(b=>b.id===moving.id).status,'moving');
 await call(`/api/buses/${moving.id}/speed`,{speedKph:null});
 await call('/api/buses/dispatch',{...command,interchangeId:'bad'},400);
 await call(`/api/buses/${moving.id}/speed`,{speedKph:81},400);
 await call('/api/simulation/control',{action:'seek',serviceDate:'2026-10-04'},400);
 await call('/api/simulation/control',{action:'seek',timeSeconds:-1},400);
 await call('/api/buses/no-such-bus',undefined,404);
 state=await call('/api/simulation/control',{action:'seek',serviceDate:'2026-10-05',timeSeconds:21600});
 assert.equal(state.simulation.serviceDate,'2026-10-05');assert.equal(state.simulation.sourceWarnings.length,0);assert.equal(state.simulation.running,false);assert.ok(state.buses.every(b=>b.tripId.startsWith('NW-20261005-')));
 console.log('PASS: live API timetable, 172 buses / 36 routes, per-bus and filtered positions, scheduled dispatch idempotency, concurrent CAS commands, breakdown/recovery, speed restoration, date seek and errors.');
}finally{
 await call('/api/simulation/control',{action:'seek',serviceDate:'2026-10-07',timeSeconds:28800});
 await call('/api/simulation/control',{action:'speed',speed:1});
 await call('/api/simulation/control',{action:'start'});
 console.log('Local simulator left running at 08:00 SGT on 2026-10-07, 1× speed.');
}
