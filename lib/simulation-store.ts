import { env } from 'cloudflare:workers';
import { applyCommand, createState, SimulationError, timetable, type State } from './simulation';
import { loadSchedule } from './schedule-loader';
// Preserve the previous sample scenario, whose state used a different schema.
const stateId='published-timetable-v1';
function database(){if(!env.DB)throw new Error('Simulation storage is unavailable.');return env.DB;}
export async function readState():Promise<State>{
  const db=database();
  let row=await db.prepare('SELECT state FROM simulations WHERE id = ?').bind(stateId).first<{state:string}>();
  if(!row){
    const schedule=await loadSchedule(timetable.defaultDate);
    await db.prepare('INSERT OR IGNORE INTO simulations (id, revision, state) VALUES (?, ?, ?)').bind(stateId,0,JSON.stringify(createState(schedule))).run();
    row=await db.prepare('SELECT state FROM simulations WHERE id = ?').bind(stateId).first<{state:string}>();
  }
  if(!row)throw new Error('Unable to initialize simulation.');
  return JSON.parse(row.state);
}
export async function mutateState(input:unknown):Promise<State>{
  for(let attempt=0;attempt<5;attempt++){
    const previous=await readState(),cmd=input as {action?:string;serviceDate?:string};
    const date=cmd.action==='seek'?(cmd.serviceDate??previous.serviceDate):previous.serviceDate;
    const schedule=await loadSchedule(date),next=applyCommand(previous,input,schedule);
    if(next.revision===previous.revision)return next;
    const result=await database().prepare('UPDATE simulations SET state = ?, revision = ? WHERE id = ? AND revision = ?').bind(JSON.stringify(next),next.revision,stateId,previous.revision).run();
    if(result.meta.changes===1)return next;
  }
  throw new SimulationError('Another operator changed the simulation. Please try again.',409);
}
