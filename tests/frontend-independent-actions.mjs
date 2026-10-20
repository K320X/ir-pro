import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {importModel,exportModel,reconcileCanonical,independentStateEffect} from '../custom_components/ir_pro/frontend/ir-pro-model.js';

const source=readFileSync(new URL('../custom_components/ir_pro/frontend/ir-pro-controller.js',import.meta.url),'utf8');
const extract=name=>{
  const start=[source.indexOf('  function '+name+'('),source.indexOf('  async function '+name+'(')].filter(index=>index>=0).sort((a,b)=>a-b)[0];
  const next=/\n  (?:async )?function /g;next.lastIndex=start+1;const end=next.exec(source)?.index??source.length;
  assert.ok(start>=0&&end>start,name);return source.slice(start,end);
};
const context={uid:randomUUID,independentStateEffect,symbols:[{value:'fan'},{value:'swing'},{value:'snowflake'},{value:'sun'},{value:'droplet'}],clamp:(value,min,max,fallback)=>Number.isFinite(Number(value))?Math.min(max,Math.max(min,Math.round(Number(value)))):fallback};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('  const modes ='),source.indexOf('  const symbols ='))+'\n'+source.slice(source.indexOf('  const button ='),source.indexOf('  const row =')),context);
const run=code=>vm.runInContext(code,context);
context.folder={id:'folder',type:'group',name:'Ventilador',group:'fan',color:'#56c4ed',fanSpeedCount:5,fanAuto:true,sendMode:'settings'};

// Settings folders create no entities or captured actions merely by opening.
run('ensureIndependentActions(folder)');assert.equal(context.folder.independentActions,undefined);
context.folder.sendMode='independent';run('ensureIndependentActions(folder)');
const folder=context.folder;assert.equal(folder.independentActions.length,6);
const fanAuto=run("independentActionFor(folder,'auto')");
fanAuto.entity='button.ir_salon_split_ventilador_auto';fanAuto.signal_refs={press:'captured-fan-auto'};fanAuto.signals={press:true};
const stable=JSON.stringify(folder.independentActions.map(node=>[node.id,node.state_effect,node.entity,node.signal_refs]));
folder.sendMode='settings';run('ensureIndependentActions(folder)');folder.sendMode='independent';run('ensureIndependentActions(folder)');
assert.equal(JSON.stringify(folder.independentActions.map(node=>[node.id,node.state_effect,node.entity,node.signal_refs])),stable);

// Capacity changes hide choices without deleting their IDs, entities or signals.
folder.fanSpeedCount=2;folder.fanAuto=false;run('ensureIndependentActions(folder)');
assert.equal(run('officialGroupChoices(folder).length'),2);assert.equal(folder.independentActions.length,6);
folder.fanSpeedCount=5;folder.fanAuto=true;run('ensureIndependentActions(folder)');
assert.equal(run("independentActionFor(folder,'auto').id"),fanAuto.id);

// Auto fan and auto swing are different commands, even within a reused folder.
folder.group='swing';folder.swingPositionCount=6;folder.swingAuto=true;folder.swingOff=true;run('ensureIndependentActions(folder)');
const swingAuto=run("independentActionFor(folder,'auto')");assert.notEqual(swingAuto.id,fanAuto.id);
assert.deepEqual(independentStateEffect(swingAuto),{swing:'auto'});assert.deepEqual(independentStateEffect(fanAuto),{fan:'auto'});
swingAuto.entity='button.ir_salon_split_oscilacion_auto';swingAuto.signal_refs={press:'captured-swing-auto'};swingAuto.signals={press:true};
folder.group='fan';run('ensureIndependentActions(folder)');assert.equal(run("independentActionFor(folder,'auto').id"),fanAuto.id);

const device={id:'device',name:'Split salón',icon:'wind',type:'stateful',state:{power:false,mode:'cool',temperature:24,fan:'low',swing:'off'},rows:[{id:'controls',type:'buttons',columns:1,height:2,cells:[folder]}],savedStates:[],_functions:[]};
const model={version:1,emitters:[{id:'emitter',sourceId:'broadlink-source',name:'IR salón',model:'RM4 mini',devices:[device]}]};
for(const node of folder.independentActions)node.entity||='button.option_'+node.id.replaceAll('-','');
folder.sendMode='settings';
const wire=exportModel(model),canonical=wire.emitters[0].devices[0];
assert.equal(canonical.functions.length,14);assert.equal(canonical.functions.find(fn=>fn.key===fanAuto.id).signal_refs.press,'captured-fan-auto');
assert.deepEqual(canonical.functions.find(fn=>fn.key===fanAuto.id).state_effect,{fan:'auto'});
assert.deepEqual(canonical.functions.find(fn=>fn.key===swingAuto.id).state_effect,{swing:'auto'});
assert.equal(new Set(canonical.layout.rows.flatMap(row=>row.cells).filter(Boolean)).size,14);
for(const fn of canonical.functions)fn.signals=Object.fromEntries(Object.keys(fn.signal_refs).map(key=>[key,true]));
const imported=importModel(wire),roundTrip=exportModel(imported).emitters[0].devices[0];
assert.equal(imported.emitters[0].devices[0].rows.length,1,'No hidden action becomes a stray root button');
assert.deepEqual(roundTrip.functions.map(fn=>[fn.key,fn.entity,fn.state_effect,fn.signal_refs]),canonical.functions.map(fn=>[fn.key,fn.entity,fn.state_effect,fn.signal_refs]));
const hydrated=imported.emitters[0].devices[0].rows[0].cells[0].independentActions.find(node=>node.id===fanAuto.id);
assert.equal(hydrated.signals.press,true);assert.equal(hydrated.entity,fanAuto.entity);
canonical.functions.find(fn=>fn.key===fanAuto.id).entity='button.renamed_by_home_assistant';reconcileCanonical(imported,wire);
assert.equal(hydrated.entity,'button.renamed_by_home_assistant');
for(const effect of [{power:true},{temperature:24},{fan:'high',swing:'auto'},{fan:'invalid'},{toString:'auto'},{constructor:'auto'},JSON.parse('{"__proto__":"auto"}'),null])assert.equal(independentStateEffect({state_effect:effect}),null);
context.emitterFor=()=>({name:'IR salón'});
vm.runInContext(source.split('\n').find(line=>line.trimStart().startsWith('const entitySlug ='))+'\n'+source.split('\n').find(line=>line.trimStart().startsWith('const proposedEntitySuffix =')),context);
context.device=device;
assert.equal(run("proposedEntitySuffix(device,{name:'Automático',state_effect:{fan:'auto'}})"),'ir_salon_split_salon_ventilador_automatico');
assert.equal(run("proposedEntitySuffix(device,{name:'Automático',state_effect:{mode:'auto'}})"),'ir_salon_split_salon_modo_automatico');
assert.equal(run("proposedEntitySuffix(device,{name:'Posición 1',state_effect:{swing:'position_1'}})"),'ir_salon_split_salon_oscilacion_posicion_1');

// Execute the actual action path. An unknown option makes no request; a failed
// press never changes the display. Success applies exactly one field while off.
let calls=[],fail=false,renders=0,errors=0;
const runtime={independentStateEffect,independentSending:false,signalBusy:false,disposed:false,model:{},confirmedWire:{},revision:0,catalog:[],copy:structuredClone,reconcileCanonical(){},render(){renders++;},toast(){},api:{call:async(action,data)=>{calls.push([action,data]);if(fail)throw new Error('IR unavailable');return {};}},queuePhysical:async action=>{try{return await action();}catch{errors++;return false;}}};
vm.createContext(runtime);vm.runInContext(extract('executeIndependent'),runtime);
runtime.d=structuredClone(device);runtime.b=structuredClone(fanAuto);
const before=structuredClone(runtime.d.state);runtime.b.signals.press=false;
assert.equal(await vm.runInContext('executeIndependent(d,b)',runtime),false);assert.equal(calls.length,0);assert.deepEqual(runtime.d.state,before);
runtime.b.signals.press=true;fail=true;
assert.equal(await vm.runInContext('executeIndependent(d,b)',runtime),false);assert.equal(errors,1);assert.deepEqual(runtime.d.state,before);assert.equal(renders,0);
fail=false;
assert.equal(await vm.runInContext('executeIndependent(d,b)',runtime),true);
assert.deepEqual(runtime.d.state,{...before,fan:'auto'});assert.equal(runtime.d.state.power,false);assert.equal(renders,1);
assert.equal(calls.length,2);assert.ok(calls.every(([action])=>action==='press'));assert.equal(calls[1][1].function_key,fanAuto.id);assert.deepEqual(Object.keys(calls[1][1]),['function_key']);

// The guard is set before entering the physical queue, covering both a pending
// request and time spent behind earlier work. No stale full-state snapshot may
// be taken by quick fan/temperature/power actions while that press is pending.
let releasePress,rejectPress,snapshots=0;
runtime.commitState=()=>{snapshots++;return true;};runtime.temperatureAvailable=()=>true;
runtime.api.call=()=>new Promise((resolve,reject)=>{releasePress=resolve;rejectPress=reject;});
runtime.d.state=structuredClone(before);vm.runInContext(extract('executeAction'),runtime);
const pendingPress=vm.runInContext('executeIndependent(d,b)',runtime);
assert.equal(runtime.independentSending,true);
for(const action of [{type:'button',action:'set_fan',value:'high'},{type:'button',action:'temp_up'},{type:'button',action:'power_on'}]){
 runtime.next=action;assert.equal(await vm.runInContext('executeAction(d,next)',runtime),false);
}
assert.equal(snapshots,0);assert.deepEqual(runtime.d.state,before);
releasePress({});assert.equal(await pendingPress,true);assert.equal(runtime.independentSending,false);assert.deepEqual(runtime.d.state,{...before,fan:'auto'});
const afterSuccess=structuredClone(runtime.d.state),failedPress=vm.runInContext('executeIndependent(d,b)',runtime);
assert.equal(runtime.independentSending,true);rejectPress(new Error('IR unavailable'));
assert.equal(await failedPress,false);assert.equal(runtime.independentSending,false);assert.deepEqual(runtime.d.state,afterSuccess);assert.equal(snapshots,0);

// Opening an independent folder renders trusted availability without creating
// options, learning, saving or transmitting. Only an explicit choice may execute.
let modalHTML='',executed=0,closed=0;const controls=[];
context.d=device;context.folder=folder;folder.group='fan';folder.sendMode='independent';
Object.assign(context,{esc:String,glyph:name=>'<icon>'+name+'</icon>',swingValue:state=>state.swing,actionOptions:[],modalBody:{},modalAbort:{signal:new AbortController().signal},toast(){},closeModal(){closed++;},execute(){executed++;},$$:()=>controls,showModal(title,html,buttons,ready){modalHTML=html;const matches=[...html.matchAll(/data-group-option="(\d+)"/g)];matches.forEach(([,index])=>controls.push({dataset:{groupOption:index},addEventListener(type,listener){this.click=listener;}}));ready();}});
const beforeOpen=JSON.stringify(folder);vm.runInContext(extract('openGroup')+'\nopenGroup(d,folder)',context);
assert.equal(JSON.stringify(folder),beforeOpen);assert.equal(executed,0);assert.equal(closed,0);assert.match(modalHTML,/Sin señal/);assert.match(modalHTML,/ disabled/);
controls[0].click();assert.equal(executed,1);assert.equal(closed,1);

// Execute the actual duplication flow for both source choices. New option IDs
// and entity proposals never alter the original. A different IR clears captures.
const origin={id:'origin',sourceId:'source-a',devices:[device]},sameSource={id:'same',sourceId:'source-a',devices:[]},otherSource={id:'other',sourceId:'source-b',devices:[]};
let duplicateRun,destination='other';
const duplication={model:{emitters:[origin,sameSource,otherSource]},emitterFor:()=>origin,uid:randomUUID,copy:structuredClone,esc:String,field:()=>'',selectOptions:()=>'',glyph:()=>'',showModal(title,html,buttons){duplicateRun=buttons.at(-1).run;},$:selector=>({value:selector==='#duplicate-name'?'Otra habitación':destination}),persist:async()=>true,closeModal(){},render(){},toast(){},formError(message){throw new Error(message);}};
vm.createContext(duplication);vm.runInContext(extract('duplicateDevice'),duplication);duplication.d=device;
const originalDevice=JSON.stringify(device);
vm.runInContext('duplicateDevice(d)',duplication);await duplicateRun();
const other=otherSource.devices[0],otherActions=other.rows[0].cells[0].independentActions;
assert.equal(otherActions.length,14);assert.ok(otherActions.every(node=>!folder.independentActions.some(original=>original.id===node.id)));
assert.ok(otherActions.every(node=>!node.entity&&Object.keys(node.signal_refs).length===0&&Object.keys(node.signals).length===0));
assert.deepEqual(Array.from(otherActions,independentStateEffect),Array.from(folder.independentActions,independentStateEffect));
destination='same';vm.runInContext('duplicateDevice(d)',duplication);await duplicateRun();
const sameActions=sameSource.devices[0].rows[0].cells[0].independentActions;
assert.ok(sameActions.every(node=>!node.entity&&!folder.independentActions.some(original=>original.id===node.id)));
assert.equal(sameActions.find(node=>node.state_effect.fan==='auto').signal_refs.press,'captured-fan-auto');
assert.equal(JSON.stringify(device),originalDevice);
console.log('Independent folders: stable option identities, hidden capacity/mode retention, canonical roundtrip, safe press effects and no opening side effects passed.');
