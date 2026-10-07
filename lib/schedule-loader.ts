import {prepareSchedule, SimulationError, type ScheduleData, type Schedule} from './simulation';
const loaders:Record<string,()=>Promise<{default:unknown}>>={
  '2026-10-05':()=>import('./schedule/days/2026-10-05.json'),
  '2026-10-06':()=>import('./schedule/days/2026-10-06.json'),
  '2026-10-07':()=>import('./schedule/days/2026-10-07.json'),
  '2026-10-08':()=>import('./schedule/days/2026-10-08.json'),
  '2026-10-09':()=>import('./schedule/days/2026-10-09.json'),
  '2026-10-12':()=>import('./schedule/days/2026-10-12.json'),
  '2026-10-13':()=>import('./schedule/days/2026-10-13.json'),
  '2026-10-14':()=>import('./schedule/days/2026-10-14.json'),
  '2026-10-15':()=>import('./schedule/days/2026-10-15.json'),
  '2026-10-16':()=>import('./schedule/days/2026-10-16.json'),
};
let cached:Schedule|undefined;
export async function loadSchedule(date:string){
  if(typeof date!=='string'||!Object.hasOwn(loaders,date))throw new SimulationError('No published timetable for that date.');
  if(cached?.serviceDate===date)return cached;
  const data=(await loaders[date]()).default as ScheduleData;
  const result=prepareSchedule(data);cached=result;return result;
}
