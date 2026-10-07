'use client';
import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { type Snapshot } from '@/lib/simulation';
type Props={data:Snapshot;selectedId:string|null;onSelect:(id:string)=>void;routeFilter:string;follow:boolean;fitRequest:number;onDispatch:(id:string)=>void};
type RouteLayers={line:Leaflet.Polyline;outline:Leaflet.Polyline;stops:Leaflet.CircleMarker[]};
export default function BusMap({data,selectedId,onSelect,routeFilter,follow,fitRequest,onDispatch}:Props) {
 const container=useRef<HTMLDivElement>(null),map=useRef<Leaflet.Map|null>(null),lib=useRef<typeof Leaflet|null>(null);
 const markers=useRef(new Map<string,Leaflet.Marker>()),lines=useRef(new Map<string,RouteLayers>()),routeLayer=useRef<Leaflet.LayerGroup|null>(null);
 const iconKeys=useRef(new Map<string,string>());
 const select=useRef(onSelect),dispatch=useRef(onDispatch),latest=useRef(data);
 const [ready,setReady]=useState(0),[tileError,setTileError]=useState(false);
 select.current=onSelect;dispatch.current=onDispatch;latest.current=data;
 const routeKey=data.routes.map(r=>r.id).join('|');
 const selectedRouteId=data.buses.find(b=>b.id===selectedId)?.routeId;
 useEffect(()=>{let cancelled=false;let observer:ResizeObserver|undefined;
  import('leaflet').then(L=>{if(cancelled||!container.current)return;lib.current=L;
   const m=L.map(container.current,{zoomControl:false,preferCanvas:true,scrollWheelZoom:true,minZoom:11,maxBounds:[[1.144,103.535],[1.494,104.502]]}).setView([1.288,103.84],14);map.current=m;
   L.control.zoom({position:'bottomright'}).addTo(m);
   L.tileLayer('https://www.onemap.gov.sg/maps/tiles/Grey/{z}/{x}/{y}.png',{maxZoom:19,minZoom:11,attribution:'<img src="https://www.onemap.gov.sg/web-assets/images/logo/om_logo.png" alt="OneMap" style="height:20px;width:20px;vertical-align:middle;"/> <a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener noreferrer">OneMap</a> &copy; contributors | <a href="https://www.sla.gov.sg/" target="_blank" rel="noopener noreferrer">Singapore Land Authority</a>'}).on('tileerror',()=>setTileError(true)).on('tileload',()=>setTileError(false)).addTo(m);
   latest.current.interchanges.forEach(i=>{
    const icon=L.divIcon({className:'interchange-marker',html:'INT',iconSize:[28,20],iconAnchor:[14,10]});
    L.marker([i.latitude,i.longitude],{icon,title:`Dispatch from ${i.name}`,keyboard:true,zIndexOffset:20}).bindTooltip(`${i.name} · click to dispatch`).on('click',()=>dispatch.current(i.id)).addTo(m);
   });
   m.fitBounds(L.latLngBounds(latest.current.routes.flatMap(r=>r.points)),{padding:[45,55]});
   observer=new ResizeObserver(()=>m.invalidateSize());observer.observe(container.current);setReady(n=>n+1);
  }).catch(()=>setTileError(true));
  return()=>{cancelled=true;observer?.disconnect();map.current?.remove();map.current=null;markers.current.clear();lines.current.clear();iconKeys.current.clear();};
 },[]);
 useEffect(()=>{if(!ready||!lib.current||!map.current)return;const L=lib.current,m=map.current;
  routeLayer.current?.remove();const group=L.layerGroup().addTo(m);routeLayer.current=group;lines.current.clear();
  latest.current.routes.forEach(route=>{
   const outline=L.polyline(route.points,{color:'#fff',weight:12,opacity:0,interactive:false}).addTo(group);
   const line=L.polyline(route.points,{color:route.color,weight:2,opacity:.2,interactive:false}).addTo(group);
   const stops=route.stops.map(stop=>L.circleMarker(route.points[stop.pointIndex],{radius:4,color:route.color,weight:2,fillColor:'#fff',fillOpacity:1}).bindTooltip(stop.name,{direction:'top'}));
   lines.current.set(route.id,{line,outline,stops});
  });
 },[ready,routeKey]);
 useEffect(()=>{
  if(!ready||!routeLayer.current)return;
  const group=routeLayer.current;
  lines.current.forEach(({line,outline,stops},id)=>{
   const selected=id===selectedRouteId,inFilter=routeFilter==='all'||routeFilter===id;
   const opacity=selected?1:!inFilter?0.06:selectedRouteId?0.2:0.65;
   line.setStyle({weight:selected?7:2,opacity});
   outline.setStyle({opacity:selected?1:0});
   stops.forEach(stop=>{if(selected)group.addLayer(stop);else group.removeLayer(stop);});
  });
  // Draw the chosen route last so shared road segments cannot obscure it.
  const selected=selectedRouteId?lines.current.get(selectedRouteId):undefined;
  if(selected){selected.outline.bringToFront();selected.line.bringToFront();selected.stops.forEach(stop=>stop.bringToFront());}
 },[ready,routeKey,selectedRouteId,routeFilter]);
 useEffect(()=>{if(!ready||!lib.current||!map.current)return;const L=lib.current,m=map.current;
  const movements:{marker:Leaflet.Marker;from:Leaflet.LatLng;to:Leaflet.LatLng}[]=[];
  const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  for(const [id,marker] of markers.current)if(!data.buses.some(b=>b.id===id)){marker.remove();markers.current.delete(id);iconKeys.current.delete(id);}
  data.buses.forEach(bus=>{const route=data.routes.find(r=>r.id===bus.routeId)!;
   const disrupted=['breakdown','unavailable','delayed'].includes(bus.status),color=disrupted?(bus.status==='delayed'?'#b46c12':'#c04d3d'):route.color;
   let marker=markers.current.get(bus.id);
   const key=`${color}:${selectedId===bus.id}:${disrupted}`;
   if(!marker||iconKeys.current.get(bus.id)!==key){
    const icon=L.divIcon({className:'bus-marker-shell',html:`<div class="bus-marker ${selectedId===bus.id?'selected':''}" style="--bus-color:${color}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="3" width="14" height="17" rx="3"/><path d="M5 11h14M8 20v2m8-2v2M8 15h1m6 0h1M9 6h6"/></svg><span>${bus.id.replace('NW-','')}</span>${disrupted?'<b>!</b>':''}</div>`,iconSize:[65,32],iconAnchor:[32,16]});
    if(!marker){marker=L.marker([bus.latitude,bus.longitude],{icon,keyboard:true,title:bus.id,zIndexOffset:100}).on('click',()=>select.current(bus.id)).addTo(m);markers.current.set(bus.id,marker);}else marker.setIcon(icon);
    iconKeys.current.set(bus.id,key);
   }
   const selected=selectedId===bus.id,onSelectedRoute=bus.routeId===selectedRouteId;
   const opacity=selectedRouteId!==undefined&&!selected?0.4:1;
   marker.setOpacity(opacity);marker.setZIndexOffset(selected?1000:onSelectedRoute?200:100);
   const target=L.latLng(bus.latitude,bus.longitude),from=marker.getLatLng();
   if((bus.status==='moving'||bus.status==='deadheading')&&data.simulation.running&&!reducedMotion)movements.push({marker,from,to:target});else marker.setLatLng(target);
   if(follow&&bus.id===selectedId)m.panTo(target,{animate:true,duration:.8});
  });
  // One animation loop for the entire fleet; unchanged icons retain their DOM and focus.
  let frame=0;const started=performance.now();
  const animate=(time:number)=>{const t=Math.min(1,(time-started)/850);for(const {marker,from,to} of movements)marker.setLatLng([from.lat+(to.lat-from.lat)*t,from.lng+(to.lng-from.lng)*t]);if(t<1)frame=requestAnimationFrame(animate);};
  if(movements.length)frame=requestAnimationFrame(animate);
  return()=>cancelAnimationFrame(frame);
 },[data,selectedId,selectedRouteId,follow,ready]);
 useEffect(()=>{if(ready&&map.current&&lib.current)map.current.fitBounds(lib.current.latLngBounds(latest.current.routes.flatMap(r=>r.points)),{padding:[45,55]});},[fitRequest,ready]);
 return <><div ref={container} className="map-canvas" aria-label="Live bus positions on the Singapore map"/>{tileError&&<div className="map-warning">Some map tiles could not load. Bus positions remain live.</div>}</>;
}
