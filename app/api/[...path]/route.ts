import { readState, mutateState } from '@/lib/simulation-store';
import { snapshot, allRoutes, interchanges, SimulationError, timetable, dispatchOptions, type State } from '@/lib/simulation';
import { loadSchedule } from '@/lib/schedule-loader';
export const dynamic='force-dynamic';
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const stateSnapshot=async(state:State)=>snapshot(state,await loadSchedule(state.serviceDate));
function failure(error:unknown){if(error instanceof SimulationError)return response({error:error.message},error.status);console.error('Simulation API',error);return response({error:'Simulation is temporarily unavailable. Please retry.'},503);}
export async function GET(request:Request){
  try{
    const url=new URL(request.url),path=url.pathname.replace(/^\/api\//,'');
    if(path==='routes')return response({routes:allRoutes});
    if(path==='interchanges')return response({interchanges});
    if(path==='timetable')return response(timetable);
    const state=await readState(),schedule=await loadSchedule(state.serviceDate);
    if(path==='dispatch-options')return response({serviceDate:state.serviceDate,trips:dispatchOptions(state,schedule).filter(t=>(!url.searchParams.get('routeId')||t.routeId===url.searchParams.get('routeId'))&&(!url.searchParams.get('interchangeId')||t.interchangeId===url.searchParams.get('interchangeId')))});
    if(path==='trips')return response({serviceDate:schedule.serviceDate,timeBasis:'published',trips:schedule.trips.filter(t=>!url.searchParams.get('routeId')||t.routeId===url.searchParams.get('routeId'))});
    const data=snapshot(state,schedule);
    if(path==='snapshot')return response(data);
    if(path==='buses')return response({simulation:data.simulation,generatedAt:data.generatedAt,buses:data.buses.filter(b=>(!url.searchParams.get('routeId')||b.routeId===url.searchParams.get('routeId'))&&(!url.searchParams.get('status')||b.status===url.searchParams.get('status')))});
    if(path.startsWith('buses/')){const bus=data.buses.find(b=>b.id===path.slice(6));return bus?response({simulation:data.simulation,generatedAt:data.generatedAt,bus}):response({error:'Bus not found.'},404);}
    if(path==='simulation')return response({simulation:data.simulation,generatedAt:data.generatedAt});
    if(path==='disruptions')return response({disruptions:data.disruptions});
    if(path==='events')return response({events:data.events});
    return response({error:'Endpoint not found.'},404);
  }catch(error){return failure(error);}
}
export async function POST(request:Request){
  try{
    const path=new URL(request.url).pathname.replace(/^\/api\//,'');let input:unknown;
    try{input=await request.json();}catch{return response({error:'Valid JSON is required.'},400);}
    if(!input||typeof input!=='object'||Array.isArray(input))return response({error:'A JSON object is required.'},400);
    const body=input as Record<string,unknown>;
    if(path==='simulation/control'&&['start','pause','reset','speed','seek'].includes(String(body.action)))return response(await stateSnapshot(await mutateState(body)));
    if(path==='disruptions')return response(await stateSnapshot(await mutateState({...body,action:'disrupt'})),201);
    if(path==='buses/dispatch')return response(await stateSnapshot(await mutateState({...body,action:'dispatch'})));
    const speed=/^buses\/([^/]+)\/speed$/.exec(path);
    if(speed)return response(await stateSnapshot(await mutateState({...body,action:'bus-speed',busId:speed[1]})));
    const resolve=/^disruptions\/([^/]+)\/resolve$/.exec(path);
    if(resolve)return response(await stateSnapshot(await mutateState({action:'resolve',id:resolve[1]})));
    return response({error:'Unknown endpoint or control action.'},400);
  }catch(error){return failure(error);}
}
