import network from './network.json' with { type: 'json' };
export type Coordinate = [number, number];
export type Status = 'moving' | 'scheduled' | 'breakdown' | 'unavailable' | 'delayed' | 'completed' | 'held';
export type DisruptionType = 'breakdown' | 'unavailable' | 'delay';
export type Route = { id: string; label?: string; originId?: string; name: string; color: string; origin: string; destination: string; points: Coordinate[]; stops: { name: string; pointIndex: number }[] };
// Synthetic test corridors, not actual service routes or a road-routing model.
export const routes: Route[] = [
  { id: '01', name: 'Orchard corridor', color: '#177956', origin: 'Tanglin', destination: 'Marina Bay', points: [[1.3079,103.8184],[1.3062,103.822],[1.3052,103.8263],[1.3041,103.8312],[1.3021,103.8359],[1.3004,103.8389],[1.2981,103.8426],[1.296,103.8459],[1.2935,103.8485],[1.2908,103.8512],[1.2875,103.8531],[1.2833,103.8518],[1.2805,103.8541],[1.2786,103.8547]], stops: [{name:'Tanglin',pointIndex:0},{name:'Orchard',pointIndex:4},{name:'Dhoby Ghaut',pointIndex:7},{name:'City Hall',pointIndex:9},{name:'Marina Bay',pointIndex:13}] },
  { id: '02', name: 'Harbour connector', color: '#5376d2', origin: 'HarbourFront', destination: 'Bugis', points: [[1.2643,103.8218],[1.267,103.8234],[1.2701,103.826],[1.2726,103.8282],[1.2751,103.8316],[1.2779,103.836],[1.2805,103.8405],[1.2843,103.8432],[1.2875,103.846],[1.2902,103.8494],[1.2935,103.8523],[1.2973,103.855],[1.3008,103.8567]], stops:[{name:'HarbourFront',pointIndex:0},{name:'Outram Park',pointIndex:5},{name:'Chinatown',pointIndex:7},{name:'Clarke Quay',pointIndex:8},{name:'Bugis',pointIndex:12}] },
  { id: '03', name: 'Civic district', color: '#b07a27', origin: 'Little India', destination: 'Tanjong Pagar', points: [[1.3066,103.849],[1.3044,103.8503],[1.3023,103.8521],[1.3008,103.8545],[1.298,103.8562],[1.2959,103.858],[1.2931,103.8565],[1.2905,103.855],[1.2882,103.8536],[1.2855,103.8516],[1.2826,103.8484],[1.2801,103.8468],[1.2771,103.8459],[1.2755,103.845]], stops:[{name:'Little India',pointIndex:0},{name:'Bugis',pointIndex:3},{name:'Suntec',pointIndex:6},{name:'Raffles Place',pointIndex:10},{name:'Tanjong Pagar',pointIndex:13}] },
];
export const interchanges = network.interchanges;
export const dispatchRoutes = network.routes as Route[];
export const allRoutes = [...routes,...dispatchRoutes];
export type BusState = { id: string; routeId: string; distance: number; cruiseKph: number; departure: number; status: Status; delayUntil: number | null; disruptionId: string | null };
export type SimEvent = { id: string; time: number; type: string; busId?: string; message: string };
export type Disruption = { id: string; busId: string; type: DisruptionType; createdAt: number; resolvedAt: number | null; durationSeconds?: number };
export type State = { anchorReal: number; elapsed: number; running: boolean; speed: number; revision: number; buses: BusState[]; events: SimEvent[]; disruptions: Disruption[] };
export class SimulationError extends Error { status:number; constructor(message: string, status = 400) { super(message);this.status=status; } }
const radians = (d: number) => d * Math.PI / 180;
export function distanceMeters(a: Coordinate, b: Coordinate) {
  const lat = radians(b[0]-a[0]), lon = radians(b[1]-a[1]);
  const h = Math.sin(lat/2)**2 + Math.cos(radians(a[0]))*Math.cos(radians(b[0]))*Math.sin(lon/2)**2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
}
export function routeDistances(route: Route) { const result = [0]; for(let i=1;i<route.points.length;i++) result.push(result[i-1]+distanceMeters(route.points[i-1],route.points[i])); return result; }
export function locate(route: Route, distance: number) {
  const cumulative = routeDistances(route), total = cumulative.at(-1)!;
  let index = 1; while(index < cumulative.length-1 && cumulative[index] < distance) index++;
  const from = route.points[index-1], to = route.points[index];
  const fraction = Math.min(1,Math.max(0,(distance-cumulative[index-1])/((cumulative[index]-cumulative[index-1])||1)));
  const y = Math.sin(radians(to[1]-from[1]))*Math.cos(radians(to[0]));
  const x = Math.cos(radians(from[0]))*Math.sin(radians(to[0]))-Math.sin(radians(from[0]))*Math.cos(radians(to[0]))*Math.cos(radians(to[1]-from[1]));
  return {latitude:from[0]+(to[0]-from[0])*fraction,longitude:from[1]+(to[1]-from[1])*fraction,heading:(Math.atan2(y,x)*180/Math.PI+360)%360,total,cumulative};
}
export function createState(now = Date.now()): State {
  return {anchorReal:now,elapsed:0,running:true,speed:3,revision:0,
    buses:Array.from({length:9},(_,i)=>({id:`BUS-${101+i}`,routeId:routes[Math.floor(i/3)].id,distance:0,cruiseKph:22+(i%3)*4,departure:(i%3)*90,status:'scheduled' as Status,delayUntil:null,disruptionId:null})),
    events:[{id:'initial',time:0,type:'system',message:'Singapore sample scenario started'}],disruptions:[]};
}
export function advance(source: State, now = Date.now()): State {
  const state: State = structuredClone(source);
  const elapsed = source.elapsed + (source.running ? Math.max(0,now-source.anchorReal)/1000*source.speed : 0);
  state.buses = source.buses.map(original => {
    const bus = {...original};
    if(bus.status==='breakdown'||bus.status==='unavailable'||bus.status==='completed') return bus;
    const start = Math.max(source.elapsed,bus.departure,bus.delayUntil ?? 0);
    const total = routeDistances(allRoutes.find(r=>r.id===bus.routeId)!).at(-1)!;
    bus.distance = Math.min(total,bus.distance + Math.max(0,elapsed-start)*bus.cruiseKph/3.6);
    if(bus.delayUntil!==null && elapsed>=bus.delayUntil) {
      const d = state.disruptions.find(d=>d.id===bus.disruptionId);
      if(d && d.resolvedAt===null) { d.resolvedAt=bus.delayUntil; state.events.push({id:`${d.id}-auto`,time:bus.delayUntil,type:'recovery',busId:bus.id,message:`${bus.id} · delay cleared automatically`}); }
      bus.delayUntil=null;bus.disruptionId=null;
    }
    bus.status=bus.distance>=total?'completed':bus.delayUntil!==null?'delayed':elapsed<bus.departure?'scheduled':bus.cruiseKph===0?'held':'moving';
    if(bus.status==='completed'&&original.status!=='completed') state.events.push({id:`${bus.id}-arrived`,time:start+(total-original.distance)/(bus.cruiseKph/3.6),type:'arrival',busId:bus.id,message:`${bus.id} · arrived at destination`});
    return bus;
  });
  state.elapsed=elapsed;state.anchorReal=now;state.events=state.events.sort((a,b)=>a.time-b.time).slice(-100);
  return state;
}
export function simTimestamp(elapsed: number) { return new Date(Date.UTC(2026,9,7,0,0,0)+elapsed*1000).toISOString(); }
export function snapshot(source: State, now = Date.now()) {
  const state=advance(source,now);
  return {simulation:{id:'singapore-demo',running:state.running,speed:state.speed,elapsedSeconds:state.elapsed,time:simTimestamp(state.elapsed),timezone:'Asia/Singapore',revision:state.revision,scenario:'Singapore · morning service',synthetic:true},
    generatedAt:new Date(now).toISOString(),routes:allRoutes.filter(r=>state.buses.some(b=>b.routeId===r.id)),interchanges,
    buses:state.buses.map(bus=>{const route=allRoutes.find(r=>r.id===bus.routeId)!;const p=locate(route,bus.distance);const stopped=bus.status==='breakdown'||bus.status==='unavailable';const remaining=(p.total-bus.distance)/(bus.cruiseKph/3.6);const wait=Math.max(0,bus.departure-state.elapsed,(bus.delayUntil??0)-state.elapsed);
      return {...bus,tripId:`TRIP-${bus.id.slice(4)}`,latitude:p.latitude,longitude:p.longitude,heading:p.heading,speedKph:bus.status==='moving'&&state.running?bus.cruiseKph:0,available:!stopped&&bus.status!=='delayed',progress:Math.min(1,bus.distance/p.total),distanceMeters:Math.round(bus.distance),remainingMeters:Math.round(p.total-bus.distance),eta:stopped||bus.cruiseKph===0?null:bus.status==='completed'?simTimestamp(state.events.find(e=>e.id===`${bus.id}-arrived`)?.time??state.elapsed):simTimestamp(state.elapsed+remaining+wait),nextStop:route.stops.find(s=>p.cumulative[s.pointIndex]>bus.distance+5)?.name??route.destination,updatedAt:simTimestamp(state.elapsed)};
    }),events:[...state.events].reverse(),disruptions:state.disruptions};
}
export type Snapshot = ReturnType<typeof snapshot>;
export type Bus = Snapshot['buses'][number];
export type Command = {action:'start'|'pause'|'reset'|'speed';speed?:number}|{action:'disrupt';busId:string;type:DisruptionType;durationSeconds?:number}|{action:'resolve';id:string}|{action:'dispatch';interchangeId:string;routeId:string;speedKph:number}|{action:'bus-speed';busId:string;speedKph:number};
export function applyCommand(source: State, input: unknown, now=Date.now()): State {
  if(!input||typeof input!=='object') throw new SimulationError('A JSON command is required.');
  const cmd = input as Command; let state=advance(source,now);
  const event=(type:string,message:string,busId?:string)=>state.events.push({id:crypto.randomUUID(),time:state.elapsed,type,message,busId});
  if(cmd.action==='reset') {state=createState(now);state.running=false;state.events=[{id:crypto.randomUUID(),time:0,type:'system',message:'Scenario reset · ready to start'}];}
  else if(cmd.action==='pause'||cmd.action==='start') {state.running=cmd.action==='start';event('system',state.running?'Simulation resumed':'Simulation paused');}
  else if(cmd.action==='speed') {if(![1,3,10,30].includes(cmd.speed!)) throw new SimulationError('Speed must be 1, 3, 10, or 30.');state.speed=cmd.speed!;event('system',`Simulation speed set to ${cmd.speed}×`);}
  else if(cmd.action==='dispatch') {
    const interchange=interchanges.find(i=>i.id===cmd.interchangeId);
    if(!interchange) throw new SimulationError('Departure interchange not found.',404);
    const route=dispatchRoutes.find(r=>r.id===cmd.routeId&&r.originId===interchange.id);
    if(!route) throw new SimulationError('Choose a service that starts at the selected interchange.');
    if(!Number.isFinite(cmd.speedKph)||cmd.speedKph<1||cmd.speedKph>80) throw new SimulationError('Dispatch speed must be between 1 and 80 km/h.');
    if(state.buses.length>=100) throw new SimulationError('This prototype supports up to 100 buses. Reset to start a new scenario.',409);
    const id=`BUS-${Math.max(...state.buses.map(b=>Number(b.id.slice(4))))+1}`;
    state.buses.push({id,routeId:route.id,distance:0,cruiseKph:cmd.speedKph,departure:state.elapsed,status:'moving',delayUntil:null,disruptionId:null});
    event('dispatch',`${id} · dispatched from ${interchange.name} to ${route.destination}`,id);
  } else if(cmd.action==='bus-speed') {
    const bus=state.buses.find(b=>b.id===cmd.busId);if(!bus) throw new SimulationError('Bus not found.',404);
    if(!Number.isFinite(cmd.speedKph)||cmd.speedKph<0||cmd.speedKph>80) throw new SimulationError('Bus speed must be between 0 and 80 km/h.');
    if(bus.status==='completed') throw new SimulationError('This trip has already completed.',409);
    bus.cruiseKph=cmd.speedKph;
    if(!bus.disruptionId&&state.elapsed>=bus.departure) bus.status=cmd.speedKph===0?'held':'moving';
    event('speed',`${bus.id} · speed set to ${cmd.speedKph} km/h`,bus.id);
  } else if(cmd.action==='disrupt') {
    if(!['breakdown','unavailable','delay'].includes(cmd.type)) throw new SimulationError('Unknown disruption type.');
    const bus=state.buses.find(b=>b.id===cmd.busId);if(!bus) throw new SimulationError('Bus not found.',404);
    if(bus.disruptionId) throw new SimulationError('Resolve the current disruption first.',409);
    if(bus.status==='completed') throw new SimulationError('This trip has already completed. Reset to run it again.',409);
    if(cmd.type==='delay' && (!Number.isFinite(cmd.durationSeconds)||cmd.durationSeconds!<1||cmd.durationSeconds!>3600)) throw new SimulationError('Delay must be between 1 and 3600 simulation seconds.');
    const id=crypto.randomUUID();state.disruptions.push({id,busId:bus.id,type:cmd.type,createdAt:state.elapsed,resolvedAt:null,...(cmd.type==='delay'?{durationSeconds:cmd.durationSeconds}: {})});
    bus.status=cmd.type==='delay'?'delayed':cmd.type;bus.disruptionId=id;bus.delayUntil=cmd.type==='delay'?state.elapsed+cmd.durationSeconds!:null;
    event('disruption',`${bus.id} · ${cmd.type==='delay'?`delayed ${cmd.durationSeconds}s`:cmd.type==='breakdown'?'breakdown reported':'marked unavailable'}`,bus.id);
  } else if(cmd.action==='resolve') {
    const disruption=state.disruptions.find(d=>d.id===cmd.id);if(!disruption) throw new SimulationError('Disruption not found.',404);
    if(disruption.resolvedAt!==null) return state;
    const bus=state.buses.find(b=>b.id===disruption.busId)!;disruption.resolvedAt=state.elapsed;bus.disruptionId=null;bus.delayUntil=null;bus.status=state.elapsed<bus.departure?'scheduled':bus.cruiseKph===0?'held':'moving';
    event('recovery',`${bus.id} · restored to service`,bus.id);
  } else throw new SimulationError('Unknown simulation command.');
  state.revision=source.revision+1;state.events=state.events.slice(-100);return state;
}
