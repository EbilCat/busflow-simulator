import { env } from 'cloudflare:workers';
import { applyCommand, createState, SimulationError, type State } from './simulation';
function database() { if(!env.DB) throw new Error('Simulation storage is unavailable.'); return env.DB; }
export async function readState(): Promise<State> {
  const db=database();
  let row=await db.prepare('SELECT state FROM simulations WHERE id = ?').bind('default').first<{state:string}>();
  if(!row) {await db.prepare('INSERT OR IGNORE INTO simulations (id, revision, state) VALUES (?, ?, ?)').bind('default',0,JSON.stringify(createState())).run();row=await db.prepare('SELECT state FROM simulations WHERE id = ?').bind('default').first<{state:string}>();}
  if(!row) throw new Error('Unable to initialize simulation.');
  return JSON.parse(row.state);
}
export async function mutateState(input:unknown): Promise<State> {
  for(let attempt=0;attempt<5;attempt++) {
    const previous=await readState(), next=applyCommand(previous,input);
    if(next.revision===previous.revision) return next;
    const result=await database().prepare('UPDATE simulations SET state = ?, revision = ? WHERE id = ? AND revision = ?').bind(JSON.stringify(next),next.revision,'default',previous.revision).run();
    if(result.meta.changes===1) return next;
  }
  throw new SimulationError('Another operator changed the simulation. Please try again.',409);
}
