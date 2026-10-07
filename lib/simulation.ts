import network from './network.json' with { type: 'json' };
import manifest from './schedule/manifest.json' with { type: 'json' };

export type Coordinate = [number, number];
export type Status = 'moving' | 'scheduled' | 'boarding' | 'alighting' | 'turnaround' | 'layover' | 'deadheading' | 'breakdown' | 'unavailable' | 'delayed' | 'completed' | 'held';
export type DisruptionType = 'breakdown' | 'unavailable' | 'delay';
export type Route = { id:string; label:string; direction:number; name:string; color:string; origin:string; originId:string; destination:string; destinationId:string; points:Coordinate[]; distances:number[]; stops:{id:string;name:string;pointIndex:number}[] };
export const routes = network.routes as Route[];
export const allRoutes = routes;
export const dispatchRoutes = routes;
export const interchanges = network.interchanges;
export const timetable = manifest;
export type Trip = {id:string;routeId:string;vehicleId:string;crewId:string;departure:number;arrival:number;arrivals:number[];warnings:string[]};
export type ScheduleData = {
  serviceDate:string; timeBasis:string; startSeconds:number; endSeconds:number;
  vehicles:{id:string;serviceNo:string;capacity:number;type:string}[];
  trips:Trip[];
  readiness:Record<string,{availableFrom:number;availableUntil:number;issuedAt:number;location:string;released:boolean}>;
  crew:Record<string,{id:string;serviceNo:string;availableFrom:number;availableUntil:number;issuedAt:number;breakStart:number;breakEnd:number;takeoverSeconds:number}>;
  movements:{id:string;vehicleId:string;fromTripId:string;toTripId:string;fromStopId:string;toStopId:string;duration:number;distanceMeters:number;fromPoint:Coordinate;toPoint:Coordinate}[];
};
type PhaseStatus = Exclude<Status,'breakdown'|'unavailable'|'delayed'|'completed'|'held'>;
export type Phase = {status:PhaseStatus;start:number;end:number;trip:Trip;from:Coordinate;to:Coordinate;fromDistance:number;toDistance:number;meters:number;stopIndex:number;firstLeg?:boolean};
export type Schedule = ScheduleData & {plans:Map<string,Phase[]>;tripById:Map<string,Trip>;routeById:Map<string,Route>};
export type BusState = {id:string;phase:number;progress:number;speedOverride:number|null;disruptionId:string|null;delayUntil:number|null};
export type SimEvent = {id:string;time:number;type:string;busId?:string;message:string};
export type Disruption = {id:string;busId:string;type:DisruptionType;createdAt:number;resolvedAt:number|null;durationSeconds?:number};
export type State = {version:2;serviceDate:string;anchorReal:number;elapsed:number;running:boolean;speed:number;revision:number;buses:BusState[];events:SimEvent[];disruptions:Disruption[];confirmedTrips:string[];departures:Record<string,number>;arrivals:Record<string,number>};
export class SimulationError extends Error {status:number;constructor(message:string,status=400){super(message);this.status=status;}}

// All travel is between route-stop occurrences, including repeated stops on loops.
// Planned terminal movements use the dataset's allowances, never observed timings.
export function prepareSchedule(data:ScheduleData):Schedule {
  const routeById=new Map(routes.map(r=>[r.id,r]));
  const plans=new Map<string,Phase[]>();
  for(const vehicle of data.vehicles){
    const trips=data.trips.filter(t=>t.vehicleId===vehicle.id).sort((a,b)=>a.departure-b.departure);
    const phases:Phase[]=[];
    const stationary=(status:PhaseStatus,start:number,end:number,trip:Trip,point:Coordinate,distance:number,stopIndex:number)=>{
      if(end>start)phases.push({status,start,end,trip,from:point,to:point,fromDistance:distance,toDistance:distance,meters:0,stopIndex});
    };
    for(let i=0;i<trips.length;i++){
      const trip=trips[i],route=routeById.get(trip.routeId)!,last=route.points.length-1;
      if(i===0)stationary('scheduled',data.startSeconds,trip.arrivals[0],trip,route.points[0],0,0);
      stationary('boarding',trip.arrivals[0],trip.departure,trip,route.points[0],0,0);
      for(let j=1;j<route.points.length;j++){
        const start=j===1?trip.departure:trip.arrivals[j-1],end=trip.arrivals[j];
        if(end<=start)throw new Error(`Nonpositive published running time: ${trip.id} stop ${j}`);
        phases.push({status:'moving',start,end,trip,from:route.points[j-1],to:route.points[j],fromDistance:route.distances[j-1],toDistance:route.distances[j],meters:route.distances[j]-route.distances[j-1],stopIndex:j,firstLeg:j===1});
      }
      stationary('alighting',trip.arrival,trip.arrival+45,trip,route.points[last],route.distances[last],last);
      const next=trips[i+1];
      if(next){
        const nextRoute=routeById.get(next.routeId)!,move=data.movements.find(m=>m.vehicleId===vehicle.id&&m.fromTripId===trip.id&&m.toTripId===next.id);
        if(route.destinationId!==nextRoute.originId&&!move)throw new Error(`Missing planned transfer: ${trip.id}`);
        // Same-terminal turnaround includes 120s boarding. Transfers require it afterwards.
        const ready=trip.arrival+45+(move?420:300),boarding=next.arrivals[0];
        stationary('turnaround',trip.arrival+45,ready,trip,route.points[last],route.distances[last],last);
        stationary('layover',ready,boarding-(move?.duration??0),trip,route.points[last],route.distances[last],last);
        if(move)phases.push({status:'deadheading',start:boarding-move.duration,end:boarding,trip:next,from:move.fromPoint,to:move.toPoint,fromDistance:0,toDistance:0,meters:move.distanceMeters,stopIndex:0});
      }
    }
    plans.set(vehicle.id,phases);
  }
  return {...data,plans,routeById,tripById:new Map(data.trips.map(t=>[t.id,t]))};
}
export function simTimestamp(seconds:number,date=manifest.defaultDate){return new Date(Date.parse(`${date}T00:00:00+08:00`)+seconds*1000).toISOString();}
export function createState(schedule:Schedule,now=Date.now(),seconds=manifest.defaultSeconds):State {
  if(!Number.isFinite(seconds)||seconds<schedule.startSeconds||seconds>86399)throw new SimulationError('Choose a time between 05:30 and 23:59:59 SGT.');
  return {version:2,serviceDate:schedule.serviceDate,anchorReal:now,elapsed:seconds,running:true,speed:1,revision:0,
    buses:schedule.vehicles.map(v=>{const phases=schedule.plans.get(v.id)!,index=phases.findIndex(p=>p.end>seconds);return {id:v.id,phase:index<0?phases.length:index,progress:index<0?0:Math.max(0,seconds-phases[index].start),speedOverride:null,disruptionId:null,delayUntil:null};}),
    events:[{id:'initial',time:seconds,type:'system',message:`Published timetable loaded · ${schedule.serviceDate} · 172 planned buses`}],disruptions:[],confirmedTrips:[],
    departures:Object.fromEntries(schedule.trips.filter(t=>t.departure<=seconds).map(t=>[t.id,t.departure])),arrivals:Object.fromEntries(schedule.trips.filter(t=>t.arrival<=seconds).map(t=>[t.id,t.arrival]))};
}
const isTravel=(p:Phase)=>p.status==='moving'||p.status==='deadheading';
const isWait=(p:Phase)=>p.status==='scheduled'||p.status==='layover';
function rate(p:Phase,bus:BusState){return isTravel(p)&&bus.speedOverride!==null&&p.meters>0?bus.speedOverride/3.6/(p.meters/(p.end-p.start)):1;}
function gate(p:Phase){return p.status==='boarding'||p.firstLeg?p.start:-Infinity;}
function record(state:State,id:string,time:number,type:string,busId:string,message:string){state.events.push({id,time,type,busId,message});}
function advanceBus(state:State,bus:BusState,schedule:Schedule,target:number){
  let clock=state.elapsed;
  const phases=schedule.plans.get(bus.id)!;
  if(bus.disruptionId){
    if(bus.delayUntil===null||bus.delayUntil>target)return;
    clock=Math.max(clock,bus.delayUntil);
    const disruption=state.disruptions.find(d=>d.id===bus.disruptionId)!;
    disruption.resolvedAt=bus.delayUntil;
    record(state,`${disruption.id}-auto`,clock,'recovery',bus.id,`${bus.id} · delay cleared`);
    bus.disruptionId=null;bus.delayUntil=null;
  }
  if(bus.speedOverride===0)return;
  while(bus.phase<phases.length){
    const p=phases[bus.phase];
    if(isWait(p)){
      if(target<p.end){bus.progress=Math.max(0,target-p.start);break;}
      clock=Math.max(clock,p.end);bus.phase++;bus.progress=0;continue;
    }
    if(clock<gate(p)){clock=gate(p);if(clock>target)break;}
    if(p.firstLeg&&state.departures[p.trip.id]===undefined){
      state.departures[p.trip.id]=clock;
      record(state,`${p.trip.id}-departure`,clock,'departure',bus.id,`${bus.id} · service ${schedule.routeById.get(p.trip.routeId)!.label} departed`);
    }
    if(p.status==='alighting'&&state.arrivals[p.trip.id]===undefined){
      state.arrivals[p.trip.id]=clock;
      record(state,`${p.trip.id}-arrival`,clock,'arrival',bus.id,`${bus.id} · arrived at ${schedule.routeById.get(p.trip.routeId)!.destination}`);
    }
    const multiplier=rate(p,bus),needed=(p.end-p.start-bus.progress)/multiplier;
    if(needed>target-clock+1e-8){bus.progress+=(target-clock)*multiplier;break;}
    clock+=Math.max(0,needed);bus.phase++;bus.progress=0;
    // Continue at an exact boundary so departure/arrival events and statuses agree.
  }
  return clock;
}
export function advance(source:State,schedule:Schedule,now=Date.now()):State {
  if(source.serviceDate!==schedule.serviceDate)throw new Error('State and timetable dates differ.');
  const state=structuredClone(source),target=Math.min(86399,source.elapsed+(source.running?Math.max(0,now-source.anchorReal)/1000*source.speed:0));
  let finishedAt=source.elapsed;
  for(const bus of state.buses){
    const clock=advanceBus(state,bus,schedule,target);
    if(bus.phase>=schedule.plans.get(bus.id)!.length&&clock!==undefined)finishedAt=Math.max(finishedAt,clock);
  }
  state.elapsed=target;state.anchorReal=now;
  if(state.buses.every(b=>b.phase>=schedule.plans.get(b.id)!.length)){
    state.elapsed=Math.min(target,finishedAt);state.running=false;
  }else if(target>=86399)state.running=false;
  state.events.sort((a,b)=>a.time-b.time);state.events=state.events.slice(-100);return state;
}
function projectedArrival(bus:BusState,state:State,schedule:Schedule,trip:Trip):number|null {
  if(state.arrivals[trip.id]!==undefined)return state.arrivals[trip.id];
  if(bus.speedOverride===0||(bus.disruptionId&&bus.delayUntil===null))return null;
  let clock=Math.max(state.elapsed,bus.delayUntil??0);
  const phases=schedule.plans.get(bus.id)!;
  for(let i=bus.phase;i<phases.length;i++){
    const p=phases[i];
    if(p.status==='alighting'&&p.trip.id===trip.id)return clock;
    if(isWait(p))clock=Math.max(clock,p.end);
    else clock=Math.max(clock,gate(p))+(p.end-p.start-(i===bus.phase?bus.progress:0))/rate(p,bus);
  }
  return null;
}
export function snapshot(source:State,schedule:Schedule,now=Date.now()){
  const state=advance(source,schedule,now);
  const buses=state.buses.map(bus=>{
    const plan=schedule.plans.get(bus.id)!,p=plan[Math.min(bus.phase,plan.length-1)],trip=p.trip,route=schedule.routeById.get(trip.routeId)!;
    const completed=bus.phase>=plan.length,fraction=completed?1:Math.min(1,Math.max(0,bus.progress/(p.end-p.start)));
    const d=state.disruptions.find(d=>d.id===bus.disruptionId);
    const status:Status=completed?'completed':d?(d.type==='delay'?'delayed':d.type):bus.speedOverride===0?'held':p.status;
    const distance=p.fromDistance+(p.toDistance-p.fromDistance)*fraction,total=route.distances.at(-1)!;
    const publishedSpeed=isTravel(p)?p.meters/(p.end-p.start)*3.6:0;
    const eta=projectedArrival(bus,state,schedule,trip);
    const vehicle=schedule.vehicles.find(v=>v.id===bus.id)!,readiness=schedule.readiness[bus.id];
    return {...bus,routeId:trip.routeId,tripId:trip.id,plannedVehicleId:trip.vehicleId,plannedCrewId:trip.crewId,capacity:vehicle.capacity,vehicleType:vehicle.type,status,
      latitude:p.from[0]+(p.to[0]-p.from[0])*fraction,longitude:p.from[1]+(p.to[1]-p.from[1])*fraction,
      heading:(Math.atan2((p.to[1]-p.from[1])*Math.cos(p.from[0]*Math.PI/180),p.to[0]-p.from[0])*180/Math.PI+360)%360,
      speedKph:state.running&&(status==='moving'||status==='deadheading')?(bus.speedOverride??publishedSpeed):0,
      publishedSpeedKph:publishedSpeed,cruiseKph:bus.speedOverride??publishedSpeed,
      available:!d&&bus.speedOverride!==0&&readiness.released&&readiness.availableFrom<=state.elapsed&&state.elapsed<=readiness.availableUntil,
      progress:distance/total,distanceMeters:Math.round(distance),remainingMeters:Math.round(total-distance),
      eta:eta===null?null:simTimestamp(eta,state.serviceDate),scheduleDeviationSeconds:eta===null?null:Math.round(eta-trip.arrival),
      scheduledDepartureAt:simTimestamp(trip.departure,state.serviceDate),scheduledArrivalAt:simTimestamp(trip.arrival,state.serviceDate),
      simulatedDepartureAt:state.departures[trip.id]===undefined?null:simTimestamp(state.departures[trip.id],state.serviceDate),
      simulatedArrivalAt:state.arrivals[trip.id]===undefined?null:simTimestamp(state.arrivals[trip.id],state.serviceDate),
      nextStop:route.stops[p.stopIndex].name,nextStopOrder:p.stopIndex+1,sourceWarnings:trip.warnings,
      positionBasis:p.status==='deadheading'?'planned terminal transfer':'published stop arrivals',updatedAt:simTimestamp(state.elapsed,state.serviceDate)};
  });
  return {simulation:{id:'published-timetable-v1',serviceDate:state.serviceDate,running:state.running,speed:state.speed,elapsedSeconds:state.elapsed,time:simTimestamp(state.elapsed,state.serviceDate),timezone:'Asia/Singapore',revision:state.revision,scenario:'LionLink · published timetable',timeBasis:'published',synthetic:true,totalTrips:schedule.trips.length,departedTrips:Object.keys(state.departures).length,completedTrips:Object.keys(state.arrivals).length,sourceWarnings:schedule.trips.filter(t=>t.warnings.length).map(t=>({tripId:t.id,messages:t.warnings})),positionBasis:manifest.positionBasis},
    generatedAt:new Date(now).toISOString(),routes,interchanges,buses,events:[...state.events].reverse(),disruptions:state.disruptions,confirmedTrips:state.confirmedTrips};
}
export type Snapshot=ReturnType<typeof snapshot>;
export type Bus=Snapshot['buses'][number];
export function dispatchOptions(source:State,schedule:Schedule,now=Date.now()){
  const state=advance(source,schedule,now);
  return schedule.trips.filter(t=>state.departures[t.id]===undefined).map(t=>{
    const bus=state.buses.find(b=>b.id===t.vehicleId)!,route=schedule.routeById.get(t.routeId)!,crew=schedule.crew[t.crewId],vehicle=schedule.readiness[t.vehicleId];
    const reasons=[...t.warnings];
    if(bus.disruptionId)reasons.push('The assigned vehicle has an unresolved disruption.');
    if(bus.speedOverride===0)reasons.push('The assigned vehicle is held at zero speed.');
    if(!vehicle.released||vehicle.issuedAt>state.elapsed)reasons.push('Vehicle release is not available at this simulation time.');
    if(crew.issuedAt>state.elapsed)reasons.push('Crew duty is not available at this simulation time.');
    if(t.departure<state.elapsed)reasons.push('This departure is overdue. Restore the assigned bus to resume its duty.');
    return {tripId:t.id,routeId:t.routeId,interchangeId:route.originId,vehicleId:t.vehicleId,crewId:t.crewId,departureAt:simTimestamp(t.departure,state.serviceDate),arrivalAt:simTimestamp(t.arrival,state.serviceDate),confirmed:state.confirmedTrips.includes(t.id),eligible:reasons.length===0,reasons};
  });
}
export type DispatchOption=ReturnType<typeof dispatchOptions>[number];
export type Command={action:'start'|'pause'|'reset'|'speed'|'seek';speed?:number;timeSeconds?:number;serviceDate?:string}|{action:'disrupt';busId:string;type:DisruptionType;durationSeconds?:number}|{action:'resolve';id:string}|{action:'dispatch';tripId:string;interchangeId:string;routeId:string}|{action:'bus-speed';busId:string;speedKph:number|null};
export function applyCommand(source:State,input:unknown,schedule:Schedule,now=Date.now()):State {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new SimulationError('A JSON command is required.');
  const cmd=input as Command;
  let state:State;
  if(cmd.action==='seek'||cmd.action==='reset'){
    state=createState(schedule,now,cmd.action==='reset'?manifest.defaultSeconds:cmd.timeSeconds??manifest.defaultSeconds);
    state.running=false;state.speed=source.speed;state.revision=source.revision+1;return state;
  }
  state=advance(source,schedule,now);
  const event=(type:string,message:string,busId?:string)=>state.events.push({id:crypto.randomUUID(),time:state.elapsed,type,message,busId});
  if(cmd.action==='start'||cmd.action==='pause'){
    if(cmd.action==='start'&&state.elapsed>=86399)throw new SimulationError('End of service day. Choose a new replay time.',409);
    state.running=cmd.action==='start';event('system',state.running?'Simulation resumed':'Simulation paused');
  }else if(cmd.action==='speed'){
    if(![1,3,10,30].includes(cmd.speed!))throw new SimulationError('Speed must be 1, 3, 10, or 30.');
    state.speed=cmd.speed!;event('system',`Simulation speed set to ${cmd.speed}×`);
  }else if(cmd.action==='dispatch'){
    const trip=schedule.tripById.get(cmd.tripId);if(!trip)throw new SimulationError('Scheduled trip not found.',404);
    if(trip.routeId!==cmd.routeId||schedule.routeById.get(trip.routeId)!.originId!==cmd.interchangeId)throw new SimulationError('Trip does not start on this route at this interchange.');
    if(state.confirmedTrips.includes(trip.id))return state;
    const option=dispatchOptions(state,schedule,now).find(o=>o.tripId===trip.id);
    if(!option)throw new SimulationError('This scheduled trip has already departed.',409);
    if(!option.eligible)throw new SimulationError(option.reasons.join(' '),409);
    state.confirmedTrips.push(trip.id);event('dispatch',`${trip.vehicleId} · scheduled dispatch confirmed for ${trip.id}`,trip.vehicleId);
  }else if(cmd.action==='bus-speed'||cmd.action==='disrupt'){
    const bus=state.buses.find(b=>b.id===cmd.busId);if(!bus)throw new SimulationError('Bus not found.',404);
    if(bus.phase>=schedule.plans.get(bus.id)!.length)throw new SimulationError('This bus has finished its daily duty.',409);
    if(cmd.action==='bus-speed'){
      if(cmd.speedKph!==null&&(!Number.isFinite(cmd.speedKph)||cmd.speedKph<0||cmd.speedKph>80))throw new SimulationError('Bus speed must be between 0 and 80 km/h, or null for timetable speed.');
      bus.speedOverride=cmd.speedKph;event('speed',`${bus.id} · ${cmd.speedKph===null?'timetable speed restored':`speed set to ${cmd.speedKph} km/h`}`,bus.id);
    }else{
      if(!['breakdown','unavailable','delay'].includes(cmd.type))throw new SimulationError('Unknown disruption type.');
      if(bus.disruptionId)throw new SimulationError('Resolve the current disruption first.',409);
      if(cmd.type==='delay'&&(!Number.isFinite(cmd.durationSeconds)||cmd.durationSeconds!<1||cmd.durationSeconds!>3600))throw new SimulationError('Delay must be between 1 and 3600 simulation seconds.');
      const id=crypto.randomUUID();state.disruptions.push({id,busId:bus.id,type:cmd.type,createdAt:state.elapsed,resolvedAt:null,...(cmd.type==='delay'?{durationSeconds:cmd.durationSeconds}:{})});
      bus.disruptionId=id;bus.delayUntil=cmd.type==='delay'?state.elapsed+cmd.durationSeconds!:null;
      event('disruption',`${bus.id} · ${cmd.type==='delay'?`delayed ${cmd.durationSeconds}s`:cmd.type}`,bus.id);
    }
  }else if(cmd.action==='resolve'){
    const d=state.disruptions.find(d=>d.id===cmd.id);if(!d)throw new SimulationError('Disruption not found.',404);
    if(d.resolvedAt!==null)return state;
    const bus=state.buses.find(b=>b.id===d.busId)!;d.resolvedAt=state.elapsed;bus.disruptionId=null;bus.delayUntil=null;event('recovery',`${bus.id} · restored to service`,bus.id);
  }else throw new SimulationError('Unknown simulation command.');
  state.revision=source.revision+1;state.events=state.events.slice(-100);return state;
}
