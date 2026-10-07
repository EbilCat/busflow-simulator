#!/usr/bin/env python3
"""Compile published timetable data. Observed arrival/departure and actual assignments are never imported."""
import argparse, hashlib, json, sqlite3
from pathlib import Path
from datetime import datetime
from collections import defaultdict

parser=argparse.ArgumentParser()
parser.add_argument('--source',type=Path,default=Path(__file__).resolve().parents[2]/'lionlink-operations-network-candidate/data/lionlink-network.sqlite')
args=parser.parse_args(); root=Path(__file__).resolve().parents[1]
(root/'lib/schedule/days').mkdir(parents=True,exist_ok=True)
c=sqlite3.connect(f'file:{args.source}?mode=ro',uri=True);c.row_factory=sqlite3.Row
rows=lambda sql,params=():[dict(x) for x in c.execute(sql,params)]
def seconds(value):
 d=datetime.fromisoformat(value)
 return d.hour*3600+d.minute*60+d.second
stops={s['stop_id']:s for s in rows('select * from stops')}
colors=['#177956','#5376d2','#b07a27','#9469b2','#268691','#bd6577']
route_data=[]
for i,r in enumerate(rows('select * from routes order by service_no, direction')):
 calls=rows('select stop_id,stop_order,distance_km from route_stops where route_id=? order by stop_order',(r['route_id'],))
 route_data.append(dict(id=r['route_id'],label=r['service_no'],direction=r['direction'],name=f"Service {r['service_no']} · direction {r['direction']}",color=colors[i%len(colors)],origin=stops[r['origin_stop_id']]['description'],originId=r['origin_stop_id'],destination=stops[r['destination_stop_id']]['description'],destinationId=r['destination_stop_id'],points=[[stops[x['stop_id']]['latitude'],stops[x['stop_id']]['longitude']] for x in calls],distances=[round(x['distance_km']*1000) for x in calls],stops=[dict(id=x['stop_id'],name=stops[x['stop_id']]['description'],pointIndex=j) for j,x in enumerate(calls)]))
interchanges=[dict(id=k,name=stops[k]['description'],latitude=stops[k]['latitude'],longitude=stops[k]['longitude']) for k in sorted({r['originId'] for r in route_data},key=lambda k:stops[k]['description'])]
(root/'lib/network.json').write_text(json.dumps(dict(source='Published LionLink network snapshot',interchanges=interchanges,routes=route_data),separators=(',',':'))+'\n')
vehicles=[dict(id=v['vehicle_id'],serviceNo=v['assigned_service_no'],capacity=v['capacity_people'],type=v['vehicle_type']) for v in rows('select * from vehicles order by vehicle_id')]
calendar=rows('select * from service_calendar order by service_date')
summary=[]
for day in calendar:
 date=day['service_date']; calls=defaultdict(list)
 for call in rows('select trip_id,scheduled_arrival_at from stop_calls where service_date=? order by trip_id,stop_order',(date,)):calls[call['trip_id']].append(seconds(call['scheduled_arrival_at']))
 duties={x['crew_id']:dict(id=x['crew_id'],serviceNo=x['qualified_service_no'],availableFrom=seconds(x['available_from']),availableUntil=seconds(x['available_until']),issuedAt=seconds(x['record_issued_at']),breakStart=seconds(x['protected_break_start']),breakEnd=seconds(x['protected_break_end']),takeoverSeconds=x['takeover_seconds']) for x in rows('select * from crew_duties where service_date=?',(date,))}
 readiness={x['vehicle_id']:dict(availableFrom=seconds(x['available_from']),availableUntil=seconds(x['available_until']),issuedAt=seconds(x['issued_at']),location=x['location_stop_id'],released=x['release_state']=='released') for x in rows('select * from vehicle_readiness where service_date=?',(date,))}
 trips=[]
 for t in rows('select trip_id,route_id,service_no,planned_vehicle_id,planned_crew_id,scheduled_departure_at,scheduled_arrival_at,origin_stop_id,destination_stop_id from trips where service_date=? order by scheduled_departure_at,trip_id',(date,)):
  arrival_times=calls[t['trip_id']];route=next(r for r in route_data if r['id']==t['route_id'])
  assert len(arrival_times)==len(route['points']) and arrival_times==sorted(arrival_times)
  departure=seconds(t['scheduled_departure_at']);arrival=seconds(t['scheduled_arrival_at']);assert arrival_times[-1]==arrival
  crew=duties[t['planned_crew_id']]; vehicle=readiness[t['planned_vehicle_id']];warnings=[]
  if arrival_times[0]<crew['availableFrom'] or arrival+45>crew['availableUntil']:warnings.append('Planned crew duty window conflicts with this published trip.')
  if crew['serviceNo']!=t['service_no']:warnings.append('Planned crew is not qualified for this service.')
  if arrival_times[0]<crew['breakEnd'] and arrival+45>crew['breakStart']:warnings.append('Published trip overlaps the planned crew protected break.')
  if arrival_times[0]<vehicle['availableFrom'] or arrival+45>vehicle['availableUntil']:warnings.append('Vehicle release window conflicts with this published trip.')
  trips.append(dict(id=t['trip_id'],routeId=t['route_id'],vehicleId=t['planned_vehicle_id'],crewId=t['planned_crew_id'],departure=departure,arrival=arrival,arrivals=arrival_times,warnings=warnings))
 # Only the supplied positioning allowance/endpoints are used; observed movement timestamps are excluded.
 movements=[dict(id=m['movement_id'],vehicleId=m['vehicle_id'],fromTripId=m['from_trip_id'],toTripId=m['to_trip_id'],fromStopId=m['from_stop_id'],toStopId=m['to_stop_id'],duration=m['planning_seconds'],distanceMeters=round(m['planning_distance_km']*1000),fromPoint=[stops[m['from_stop_id']]['latitude'],stops[m['from_stop_id']]['longitude']],toPoint=[stops[m['to_stop_id']]['latitude'],stops[m['to_stop_id']]['longitude']]) for m in rows('select movement_id,vehicle_id,from_trip_id,to_trip_id,from_stop_id,to_stop_id,planning_seconds,planning_distance_km from terminal_movements where service_date=?',(date,))]
 for v in vehicles:
  tasks=sorted((t for t in trips if t['vehicleId']==v['id']),key=lambda t:t['departure'])
  assert tasks
  for a,b in zip(tasks,tasks[1:]):
   ra=next(r for r in route_data if r['id']==a['routeId']);rb=next(r for r in route_data if r['id']==b['routeId'])
   assert b['departure']>=a['arrival']+465,(date,v['id'],'turnaround')
   if ra['destinationId']!=rb['originId']:
    match=[m for m in movements if m['fromTripId']==a['id'] and m['toTripId']==b['id'] and m['vehicleId']==v['id']]
    assert len(match)==1,(date,v['id'],'missing transfer')
    assert b['departure']>=a['arrival']+465+match[0]['duration']+120
 output=dict(serviceDate=date,timeBasis='published',startSeconds=19800,endSeconds=max(t['arrival']+45 for t in trips),vehicles=vehicles,trips=trips,readiness=readiness,crew=duties,movements=movements)
 (root/f'lib/schedule/days/{date}.json').write_text(json.dumps(output,separators=(',',':'))+'\n')
 summary.append(dict(date=date,trips=len(trips),vehicles=len(vehicles),routes=len({t['routeId'] for t in trips}),sourceWarnings=sum(bool(t['warnings']) for t in trips),startSeconds=output['startSeconds'],endSeconds=output['endSeconds']))
manifest=dict(timeBasis='published',defaultDate='2026-10-07',defaultSeconds=28800,dates=summary,sourceSha256=hashlib.sha256(args.source.read_bytes()).hexdigest(),positionBasis='Interpolated between published stop arrivals; no intermediate departure times supplied.',transferBasis='Supplied planning allowances, positioned to finish 120 seconds before the next departure.')
(root/'lib/schedule/manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(dict(days=len(summary),trips=sum(s['trips'] for s in summary),vehicles=len(vehicles),routes=len(route_data),warnings=sum(s['sourceWarnings'] for s in summary))))
