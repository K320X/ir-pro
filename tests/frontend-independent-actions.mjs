import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {importModel,exportModel,reconcileCanonical,independentStateEffect,linkedActionEffect,actionStateField,controlledStateFields,recordStateFields,projectState,findSavedState} from '../custom_components/ir_pro/frontend/ir-pro-model.js';

const source=readFileSync(new URL('../custom_components/ir_pro/frontend/ir-pro-controller.js',import.meta.url),'utf8');
const extract=name=>{
  const start=[source.indexOf('  function '+name+'('),source.indexOf('  async function '+name+'(')].filter(index=>index>=0).sort((a,b)=>a-b)[0];
  const next=/\n  (?:async )?function /g;next.lastIndex=start+1;const end=next.exec(source)?.index??source.length;
  assert.ok(start>=0&&end>start,name);return source.slice(start,end);
};
const context={uid:randomUUID,copy:structuredClone,independentStateEffect,linkedActionEffect,symbols:[{value:'fan'},{value:'swing'},{value:'snowflake'},{value:'sun'},{value:'droplet'}],clamp:(value,min,max,fallback)=>Number.isFinite(Number(value))?Math.min(max,Math.max(min,Math.round(Number(value)))):fallback};
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
for(const effect of [{power:1},{temperature_delta:true},{temperature_delta:2},{swing_toggle:false},{temperature:24},{fan:'high',swing:'auto'},{fan:'invalid'},{toString:'auto'},{constructor:'auto'},JSON.parse('{"__proto__":"auto"}'),null])assert.equal(independentStateEffect({state_effect:effect}),null);
context.emitterFor=()=>({name:'IR salón'});
vm.runInContext(source.split('\n').find(line=>line.trimStart().startsWith('const entitySlug ='))+'\n'+source.split('\n').find(line=>line.trimStart().startsWith('const proposedEntitySuffix =')),context);
context.device=device;
assert.equal(run("proposedEntitySuffix(device,{name:'Automático',state_effect:{fan:'auto'}})"),'ir_salon_split_salon_ventilador_automatico');
assert.equal(run("proposedEntitySuffix(device,{name:'Automático',state_effect:{mode:'auto'}})"),'ir_salon_split_salon_modo_automatico');
assert.equal(run("proposedEntitySuffix(device,{name:'Posición 1',state_effect:{swing:'position_1'}})"),'ir_salon_split_salon_oscilacion_posicion_1');

// Execute the actual action path. An unknown option makes no request; a failed
// press never changes the display. Success applies exactly one field while off.
let calls=[],fail=false,renders=0,errors=0;
const replyWithState=state=>{const response={model:structuredClone(wire),revision:10};response.model.emitters[0].devices[0].studio.state=structuredClone(state);return response;};
let validatedDevices=0,validConfiguration=true;
const runtime={independentStateEffect,independentSending:false,signalBusy:false,disposed:false,model:importModel(wire,device.id),confirmedWire:{},revision:0,catalog:[],modes:run('modes'),fans:run('fans'),swingStates:run('swingStates'),emitterFor:()=>({sourceId:'broadlink-source'}),copy:structuredClone,importModel,validateDevice(){validatedDevices++;return validConfiguration;},render(){renders++;},toast(){},api:{call:async(action,data)=>{calls.push([action,data]);if(fail)throw new Error('IR unavailable');return replyWithState({...runtime.d.state,fan:'auto'});}},queuePhysical:async action=>{try{return await action();}catch{errors++;return false;}}};
vm.createContext(runtime);vm.runInContext(extract('adoptCommandEnvelope')+'\n'+extract('executeIndependent'),runtime);
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
releasePress(replyWithState({...before,fan:'auto'}));assert.equal(await pendingPress,true);assert.equal(runtime.independentSending,false);assert.deepEqual(runtime.d.state,{...before,fan:'auto'});
const afterSuccess=structuredClone(runtime.d.state),failedPress=vm.runInContext('executeIndependent(d,b)',runtime);
assert.equal(runtime.independentSending,true);rejectPress(new Error('IR unavailable'));
assert.equal(await failedPress,false);assert.equal(runtime.independentSending,false);assert.deepEqual(runtime.d.state,afterSuccess);assert.equal(snapshots,0);

// Canonical state can include another client's changes, or omit the old effect
// if its action was deleted while sending. Never replay an effect over it.
const serverState={power:true,mode:'heat',temperature:28,fan:'high',swing:'position_3'};
const canonicalResponse=(state,removeAction=false)=>{
 const response={revision:20,model:structuredClone(wire)},target=response.model.emitters[0].devices[0];
 target.studio.state=structuredClone(state);
 target.studio.rows.push({id:'row-from-another-client',type:'display',height:3,width:4,style:'modern',accent:'#f4f6f8',fields:{temperature:true}});
 if(removeAction){target.functions=target.functions.filter(fn=>fn.key!==fanAuto.id);target.studio.rows[0].cells[0].independentActions=target.studio.rows[0].cells[0].independentActions.filter(node=>node.id!==fanAuto.id);for(const row of target.layout.rows)row.cells=row.cells.map(key=>key===fanAuto.id?null:key);}
 return response;
};
runtime.api.call=async()=>canonicalResponse(serverState);
assert.equal(await vm.runInContext('executeIndependent(d,b)',runtime),true);
assert.deepEqual(runtime.d.state,serverState);assert.equal(runtime.revision,20);assert.equal(runtime.model.selected,device.id);assert.equal(validatedDevices,3);
assert.deepEqual(runtime.model.emitters[0].devices[0].state,serverState);assert.ok(runtime.model.emitters[0].devices[0].rows.some(row=>row.id==='row-from-another-client'));
const stateAfterDeletion={power:false,mode:'dry',temperature:23,fan:'low',swing:'off'};
runtime.api.call=async()=>canonicalResponse(stateAfterDeletion,true);
assert.equal(await vm.runInContext('executeIndependent(d,b)',runtime),true);
assert.deepEqual(runtime.d.state,stateAfterDeletion);assert.equal(runtime.d.state.fan,'low','The removed action must not reapply fan:auto');
const current=runtime.model.emitters[0].devices[0];assert.equal(current.rows[0].cells[0].independentActions.some(node=>node.id===fanAuto.id),false);
assert.equal(exportModel(runtime.model).emitters[0].devices[0].functions.some(fn=>fn.key===fanAuto.id),false,'The next save cannot resurrect a concurrently deleted action');
assert.ok(!JSON.stringify(exportModel(runtime.model)).includes('captured-fan-auto'));
const canonicalBefore=JSON.stringify(runtime.confirmedWire);
for(const invalid of [{},{model:null,revision:21},canonicalResponse({...serverState,fan:'invalid'}),{model:{version:2,emitters:[]},revision:21}]){
 runtime.api.call=async()=>invalid;
 assert.equal(await vm.runInContext('executeIndependent(d,b)',runtime),false);assert.equal(runtime.independentSending,false);
 assert.deepEqual(runtime.d.state,stateAfterDeletion);assert.equal(JSON.stringify(runtime.confirmedWire),canonicalBefore);
}
validConfiguration=false;runtime.api.call=async()=>canonicalResponse(serverState);
assert.equal(await vm.runInContext('executeIndependent(d,b)',runtime),false);assert.equal(JSON.stringify(runtime.confirmedWire),canonicalBefore);assert.deepEqual(runtime.model.emitters[0].devices[0].state,stateAfterDeletion);validConfiguration=true;

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

// Build the actual default remote: its dual labels describe the CURRENT state,
// so the side labelled Apagado must learn Encender, never an off command.
vm.runInContext(['symbols','actionOptions','actionValueChoices','defaultActionValue'].map(name=>source.split('\n').find(line=>line.trimStart().startsWith('const '+name+' ='))).join('\n')+'\n'+source.slice(source.indexOf('  const row ='),source.indexOf('  function validateDevice'))+'\nglobalThis.generic=newRemote("Genérico","wind");',context);
context.control=context.generic.rows[1].cells[1];context.control.sendMode='independent';run('ensureIndependentActions(control)');
const powerChildren=context.control.independentActions;
assert.equal(context.control.actions[0].name,'Apagado');assert.equal(powerChildren[0].name,'Encender');assert.deepEqual(independentStateEffect(powerChildren[0]),{power:true});assert.equal(powerChildren[0].value,'power_on');assert.equal(powerChildren[1].name,'Apagar');
const ready=node=>{for(const child of node.independentActions||[]){child.signal_refs={press:'capture-'+child.id};child.signals={press:true};child.entity='button.action_'+child.id.replaceAll('-','');}};
ready(context.control);
const genericModel={version:1,selected:context.generic.id,emitters:[{id:'generic-emitter',sourceId:'generic-source',name:'IR genérico',devices:[context.generic]}]};
let genericCalls=[],genericRevision=1;
const genericRuntime={model:genericModel,disposed:false,independentSending:false,signalBusy:false,revision:1,catalog:[],confirmedWire:{},copy:structuredClone,importModel,independentStateEffect,linkedActionEffect,actionStateField,controlledStateFields,modes:run('modes'),fans:run('fans'),swingStates:run('swingStates'),independentChoices:run('independentChoices'),independentActionFor:run('independentActionFor'),dualActions:run('dualActions'),dualStateIndex:run('dualStateIndex'),dualPowerLinked:run('dualPowerLinked'),emitterFor:()=>({sourceId:'generic-source'}),validateDevice:()=>true,render(){},toast(){},clearActionError(){},temperatureAvailable:()=>true,clamp:context.clamp,queuePhysical:async action=>action(),persist:async after=>after?.(),savedStateFor:()=>null};
genericRuntime.api={call:async(action,data)=>{
 genericCalls.push([action,data]);const next=exportModel(genericRuntime.model),target=next.emitters[0].devices[0],fn=target.functions.find(fn=>fn.key===data.function_key);assert.equal(action,'press');assert.ok(fn);
 const effect=fn.state_effect;if(Object.hasOwn(effect,'temperature_delta'))target.studio.state.temperature=Math.min(30,Math.max(18,target.studio.state.temperature+effect.temperature_delta));else if(effect.swing_toggle)target.studio.state.swing=target.studio.state.swing==='auto'?'off':'auto';else Object.assign(target.studio.state,effect);
 for(const row of target.studio.rows)for(const parent of row.cells||[])if(parent?.type==='dual'){const child=parent.independentActions?.find(child=>child.id===fn.key);if(child)parent.activeSide=1-child.action_index;}
 for(const fn of target.functions)fn.signals=Object.fromEntries(Object.keys(fn.signal_refs||{}).map(key=>[key,true]));
 return {model:next,revision:++genericRevision};
}};
vm.createContext(genericRuntime);vm.runInContext(['adoptCommandEnvelope','executeIndependent','learnedActionFor','executeAction','commitState'].map(extract).join('\n'),genericRuntime);
const pressDual=async()=>{genericRuntime.d=genericRuntime.model.emitters[0].devices[0];genericRuntime.b=genericRuntime.d.rows[1].cells[1];return vm.runInContext('executeAction(d,b)',genericRuntime);};
assert.equal(await pressDual(),true);assert.equal(genericRuntime.model.emitters[0].devices[0].state.power,true);assert.equal(genericCalls[0][1].function_key,powerChildren[0].id);
assert.equal(await pressDual(),true);assert.equal(genericRuntime.model.emitters[0].devices[0].state.power,false);assert.equal(genericCalls[1][1].function_key,powerChildren[1].id);

// A non-power dual relies on the phase in the canonical response, not on a
// detached pre-import object. Two presses must use distinct up/down captures.
const active=genericRuntime.model.emitters[0].devices[0],tempDual=active.rows[1].cells[1];tempDual.actions=[{name:'Subir',icon:'plus',color:'#56c4ed',showName:true,action:'temp_up'},{name:'Bajar',icon:'minus',color:'#56c4ed',showName:true,action:'temp_down'}];tempDual.activeSide=0;
context.control=tempDual;run('ensureIndependentActions(control)');ready(tempDual);const up=run("independentActionFor(control,'temp_up',0)"),down=run("independentActionFor(control,'temp_down',1)");active.state.temperature=24;
assert.equal(await pressDual(),true);assert.equal(genericRuntime.model.emitters[0].devices[0].state.temperature,25);assert.equal(genericRuntime.model.emitters[0].devices[0].rows[1].cells[1].activeSide,1);assert.equal(genericCalls.at(-1)[1].function_key,up.id);
assert.equal(await pressDual(),true);assert.equal(genericRuntime.model.emitters[0].devices[0].state.temperature,24);assert.equal(genericCalls.at(-1)[1].function_key,down.id);

// One independent temperature control excludes the whole temperature field.
// Its settings sibling may prepare the number, but cannot send another preset.
const mixed=genericRuntime.model.emitters[0].devices[0];mixed.rows[1].cells[1].sendMode='settings';mixed.state.power=true;const tempUp=mixed.rows[2].cells[2],tempDown=mixed.rows[2].cells[0];tempUp.sendMode='independent';context.control=tempUp;run('ensureIndependentActions(control)');ready(tempUp);
const sendsBefore=genericCalls.length;genericRuntime.d=mixed;genericRuntime.b=tempDown;
assert.equal(await vm.runInContext('executeAction(d,b)',genericRuntime),true);assert.equal(mixed.state.temperature,23);assert.equal(genericCalls.length,sendsBefore);assert.ok(!controlledStateFields(mixed).includes('temperature'));
assert.match(source,/Si algún control de este ajuste es independiente, el ajuste queda fuera del estado general/);
const powerIndependent=structuredClone(context.generic);powerIndependent.state.power=false;powerIndependent.state.temperature=24;genericRuntime.d=powerIndependent;genericRuntime.b=powerIndependent.rows[2].cells[2];genericRuntime.savedStateFor=()=>({signal:{kind:'learned',id:'aggregate'}});let offAggregate;
genericRuntime.api.call=async(action,data)=>{offAggregate=[action,data];return {revision:++genericRevision,model:exportModel({version:1,emitters:[{id:'generic-emitter',sourceId:'generic-source',name:'IR genérico',devices:[powerIndependent]}]})};};
assert.equal(await vm.runInContext('executeAction(d,b)',genericRuntime),true);assert.equal(offAggregate[0],'send_state');assert.equal(offAggregate[1].state.power,false);assert.equal(offAggregate[1].state.temperature,25);assert.ok(!offAggregate[1].controlled_fields.includes('power'));
console.log('Generic independent buttons: real default power intent, canonical non-power dual phases and mixed-temperature no-send policy passed.');

// Aggregate sends use exactly the same canonical adoption and interaction lock.
// A concurrent swing change and deletion must survive the next local save.
const aggregateWire=structuredClone(wire),aggregateDevice=aggregateWire.emitters[0].devices[0];
aggregateDevice.studio.rows[0].cells[0].group='swing';aggregateDevice.studio.rows[0].cells[0].sendMode='independent';aggregateDevice.studio.state={power:true,mode:'cool',temperature:24,fan:'high',swing:'position_1'};
const aggregateReply={revision:30,model:structuredClone(aggregateWire)},aggregateTarget=aggregateReply.model.emitters[0].devices[0];
aggregateTarget.studio.state.swing='position_6';aggregateTarget.functions=aggregateTarget.functions.filter(fn=>fn.key!==fanAuto.id);aggregateTarget.studio.rows[0].cells[0].independentActions=aggregateTarget.studio.rows[0].cells[0].independentActions.filter(node=>node.id!==fanAuto.id);aggregateTarget.studio.rows.push({id:'concurrent-row',type:'display',width:3,height:2,fields:{temperature:true}});for(const row of aggregateTarget.layout.rows)row.cells=row.cells.map(key=>key===fanAuto.id?null:key);
let resolveAggregate,aggregateError,aggregateCall;
const aggregateRuntime={independentSending:false,disposed:false,catalog:[],revision:20,confirmedWire:structuredClone(aggregateWire),model:importModel(aggregateWire,aggregateDevice.id),controlledStateFields,importModel,copy:structuredClone,modes:run('modes'),fans:run('fans'),swingStates:run('swingStates'),emitterFor:()=>({sourceId:'broadlink-source'}),validateDevice:()=>true,render(){},toast(){},clearActionError(){},savedStateFor:()=>({signal:{kind:'learned',id:'aggregate'}}),persist:async after=>{try{return await after();}catch(error){aggregateError=error;return false;}},api:{call:async(action,data)=>{aggregateCall=[action,data];return new Promise(resolve=>{resolveAggregate=resolve;});}}};
vm.createContext(aggregateRuntime);vm.runInContext(extract('adoptCommandEnvelope')+'\n'+extract('commitState')+'\n'+extract('executeAction'),aggregateRuntime);aggregateRuntime.d=aggregateRuntime.model.emitters[0].devices[0];
const aggregatePending=vm.runInContext('commitState(d,"Enviar",true)',aggregateRuntime);assert.equal(aggregateRuntime.independentSending,true);assert.equal(aggregateCall[0],'send_state');assert.deepEqual(Array.from(aggregateCall[1].controlled_fields),['power','mode','temperature','fan']);
const beforePending=JSON.stringify(aggregateRuntime.model);aggregateRuntime.b={type:'button',action:'temp_up'};assert.equal(await vm.runInContext('executeAction(d,b)',aggregateRuntime),false);assert.equal(JSON.stringify(aggregateRuntime.model),beforePending);
resolveAggregate(aggregateReply);assert.equal(await aggregatePending,true);assert.equal(aggregateRuntime.independentSending,false);const afterAggregate=aggregateRuntime.model.emitters[0].devices[0];assert.equal(afterAggregate.state.swing,'position_6');assert.equal(aggregateRuntime.d.state.swing,'position_6');assert.ok(afterAggregate.rows.some(row=>row.id==='concurrent-row'));assert.ok(!exportModel(aggregateRuntime.model).emitters[0].devices[0].functions.some(fn=>fn.key===fanAuto.id));
const safeModel=aggregateRuntime.model,safeWire=JSON.stringify(aggregateRuntime.confirmedWire),safeState=structuredClone(aggregateRuntime.d.state);aggregateRuntime.api.call=async()=>({model:null,revision:31});assert.equal(await vm.runInContext('commitState(d,"Enviar",true)',aggregateRuntime),false);assert.equal(aggregateRuntime.independentSending,false);assert.equal(aggregateRuntime.model,safeModel);assert.equal(JSON.stringify(aggregateRuntime.confirmedWire),safeWire);assert.deepEqual(aggregateRuntime.d.state,safeState);assert.ok(aggregateError);
console.log('Aggregate sends preserve canonical concurrent state/topology, lock pending edits and reject invalid responses without adoption.');

// A settings dual must advance the CURRENT model after an aggregate response
// replaces all local objects. It cannot revive a deleted/reconfigured control.
const settingsFixture=()=>{
 const target=structuredClone(context.generic),dual=target.rows[1].cells[1];
 target.state={power:true,mode:'cool',temperature:24,fan:'high',swing:'off'};target.savedStates=[];
 dual.sendMode='settings';dual.activeSide=0;dual.independentActions=[];dual.actions=[{name:'Subir',icon:'plus',color:'#56c4ed',showName:true,action:'temp_up'},{name:'Bajar',icon:'minus',color:'#56c4ed',showName:true,action:'temp_down'}];
 return {version:1,selected:target.id,emitters:[{id:'settings-emitter',sourceId:'settings-source',name:'IR ajustes',devices:[target]}]};
};
let responseChange='keep',phaseSaves=[],settingsRequests=0;
const settingsRuntime={model:settingsFixture(),independentSending:false,disposed:false,catalog:[],revision:0,confirmedWire:{},signalBusy:false,controlledStateFields,actionStateField,linkedActionEffect,independentStateEffect,importModel,copy:structuredClone,modes:run('modes'),fans:run('fans'),swingStates:run('swingStates'),dualActions:run('dualActions'),dualStateIndex:run('dualStateIndex'),dualPowerLinked:run('dualPowerLinked'),emitterFor:()=>({sourceId:'settings-source'}),validateDevice:()=>true,temperatureAvailable:()=>true,clamp:context.clamp,render(){},toast(){},clearActionError(){},savedStateFor:()=>({signal:{kind:'learned',id:'full'}}),persist:async after=>{if(after)return after();phaseSaves.push(settingsRuntime.model.emitters[0].devices[0].rows[1].cells[1]?.activeSide);return true;},api:{call:async(action,data)=>{
 settingsRequests++;assert.equal(action,'send_state');const next=exportModel(settingsRuntime.model),target=next.emitters[0].devices[0],dual=target.studio.rows[1].cells[1];target.studio.state=structuredClone(data.state);
 if(responseChange==='delete')target.studio.rows[1].cells[1]=null;
 if(responseChange==='replace')target.studio.rows[1].cells[1]={...dual,type:'button',action:'temp_up'};
 if(responseChange==='actions')dual.actions[1].action='set_mode';
 if(responseChange==='phase')dual.activeSide=1;
 return {revision:++genericRevision,model:next};
}}};
vm.createContext(settingsRuntime);vm.runInContext(['adoptCommandEnvelope','commitState','learnedActionFor','executeAction'].map(extract).join('\n'),settingsRuntime);
const pressSettingsDual=async()=>{settingsRuntime.d=settingsRuntime.model.emitters[0].devices[0];settingsRuntime.b=settingsRuntime.d.rows[1].cells[1];return vm.runInContext('executeAction(d,b)',settingsRuntime);};
const detachedDual=settingsRuntime.model.emitters[0].devices[0].rows[1].cells[1];assert.equal(await pressSettingsDual(),true);assert.equal(detachedDual.activeSide,0);assert.equal(settingsRuntime.model.emitters[0].devices[0].rows[1].cells[1].activeSide,1);assert.deepEqual(phaseSaves,[1]);
assert.equal(await pressSettingsDual(),true);assert.equal(settingsRuntime.model.emitters[0].devices[0].rows[1].cells[1].activeSide,0);assert.deepEqual(phaseSaves,[1,0]);assert.equal(settingsRuntime.model.emitters[0].devices[0].state.temperature,24);
for(const change of ['delete','replace','actions','phase']){
 settingsRuntime.model=settingsFixture();phaseSaves=[];responseChange=change;assert.equal(await pressSettingsDual(),true);assert.equal(phaseSaves.length,0);
 const current=settingsRuntime.model.emitters[0].devices[0].rows[1].cells[1];if(change==='delete')assert.equal(current,null);if(change==='replace')assert.equal(current.type,'button');if(change==='phase')assert.equal(current.activeSide,1);
}
assert.equal(settingsRequests,6);
console.log('Settings dual phases advance only the current matching control after canonical adoption; deleted/replaced/reconfigured nodes remain authoritative.');

// Generic sending is separate from a setting-changing action: run its actual
// helper, physical queue, matcher, validator and canonical adoption together.
const plain=value=>JSON.parse(JSON.stringify(value));
function genericSendHarness(){
 const calls=[],messages=[],errors=[],stats={persists:0};
 const runtime={copy:structuredClone,uid:randomUUID,independentStateEffect,linkedActionEffect,actionStateField,controlledStateFields,recordStateFields,projectState,findSavedState,importModel,exportModel,
  disposed:false,independentSending:false,signalBusy:false,saveFailed:false,pendingSaves:0,saveQueue:Promise.resolve(true),revision:1,catalog:[],confirmedWire:{},
  render(){},toast:message=>messages.push(message),clearActionError(){},handleActionError:error=>errors.push(error),flushDeferredEnvelope(){},
  persist:async()=>{stats.persists++;assert.ok(runtime.allowPhasePersist,'Sending current settings cannot persist or alter them');return true;},
  api:{call:async(action,data)=>{calls.push([action,plain(data)]);assert.equal(action,'send_state');if(runtime.rejectSend)throw runtime.rejectSend;if(runtime.delayedResponse)return runtime.delayedResponse();return response();}}
 };
 runtime.emitterFor=id=>runtime.model.emitters.find(emitter=>emitter.devices.some(device=>device.id===id));
 vm.createContext(runtime);
 const constant=name=>source.split('\n').find(line=>line.trimStart().startsWith('const '+name+' ='));
 const config=source.slice(source.indexOf('  const clamp ='),source.indexOf('  const button ='));
 const constructors=source.slice(source.indexOf('  const button ='),source.indexOf('  function validateDevice'));
 const validate=extract('validateDevice').split('\n  let model=')[0];
 vm.runInContext(config+'\n'+constructors+'\n'+['entitySlug','entityDomain'].map(constant).join('\n')+'\n'+['automationButtons','ensureModelEntities','queuePhysical','adoptCommandEnvelope','sendCurrentState','executeAction'].map(extract).join('\n')+'\n'+validate,runtime);
 vm.runInContext('globalThis.d=newRemote("Estado actual","wind");d.state={power:true,mode:"cool",temperature:24,fan:"high",swing:"off"};d.rows.push(row([button("Enviar","remote","send_state")]));globalThis.model={version:1,selected:d.id,emitters:[{id:"send-emitter",sourceId:"send-source",name:"IR emisor",devices:[d]}]};ensureModelEntities();',runtime);
 const device=()=>runtime.model.emitters[0].devices[0];
 const response=()=>{const next=exportModel(runtime.model);for(const emitter of next.emitters)for(const device of emitter.devices)for(const fn of device.functions)fn.signals=Object.fromEntries(Object.keys(fn.signal_refs||{}).map(signal=>[signal,true]));runtime.changeResponse?.(next);return {revision:runtime.revision+1,model:next};};
 const capture=()=>{const d=device(),fields=controlledStateFields(d),id=randomUUID(),record={id,name:'Ajustes capturados',entity:'button.saved_'+id.replaceAll('-',''),controlled_fields:fields,settings:projectState(d.state,fields),signal:{kind:'learned',id:'saved-reference-'+id}};d.savedStates=[record];return record;};
 const send=()=>{runtime.d=device();runtime.b=runtime.d.rows.at(-1).cells[0];return vm.runInContext('executeAction(d,b)',runtime);};
 return {runtime,calls,messages,errors,stats,device,response,capture,send};
}

// Each press sends one exact snapshot, including an off state, without first
// changing power/temperature/mode or issuing an unrelated save or button press.
for(const mode of ['on','off','dry','independent-temperature']){
 const h=genericSendHarness(),device=h.device();
 if(mode==='off')device.state.power=false;
 if(mode==='dry'){device.state.mode='dry';device.state.temperature=29;}
 if(mode==='independent-temperature')device.rows[2].cells[2].sendMode='independent';
 const record=h.capture();if(mode==='dry')record.settings.temperature=18;
 if(mode==='independent-temperature')device.state.temperature=30;
 const before=plain(device.state),fields=controlledStateFields(device),sending=device.rows.at(-1).cells[0];
 assert.ok(!sending.entity);assert.ok(!exportModel(h.runtime.model).emitters[0].devices[0].functions.some(fn=>fn.key===sending.id));
 assert.equal(await h.send(),true);assert.deepEqual(h.calls,[['send_state',{device_id:device.id,state:before,controlled_fields:fields}]]);assert.deepEqual(plain(h.device().state),before);assert.equal(h.stats.persists,0);assert.equal(h.runtime.independentSending,false);
 if(mode==='off')assert.deepEqual(fields,['power']);if(mode==='independent-temperature')assert.ok(!fields.includes('temperature'));
}

// Independent swing never enters combination matching, but its exact current
// display value is preserved in the request and in the canonical response.
{
 const h=genericSendHarness();h.capture();
 for(const swing of ['off','auto',...Array.from({length:6},(_,index)=>'position_'+(index+1))]){
  h.device().state.swing=swing;const before=plain(h.device().state),count=h.calls.length;
  assert.equal(await h.send(),true);assert.equal(h.calls.length,count+1);assert.deepEqual(h.calls.at(-1)[1].state,before);assert.ok(!h.calls.at(-1)[1].controlled_fields.includes('swing'));assert.deepEqual(plain(h.device().state),before);
 }
 assert.equal(h.stats.persists,0);
}

// No signal, an unlearned match, ambiguity and wholly independent settings are
// local guards. None queues a request, changes the current state or saves it.
for(const situation of ['missing','unlearned','ambiguous','all-independent']){
 const h=genericSendHarness(),device=h.device();
 if(situation==='unlearned')h.capture().signal=null;
 if(situation==='ambiguous'){const record=h.capture();device.savedStates.push({...structuredClone(record),id:randomUUID(),entity:'button.ambiguous'});}
 if(situation==='all-independent'){device.rows[1].cells.forEach(node=>node.sendMode='independent');device.rows[2].cells.forEach(node=>node.sendMode='independent');assert.deepEqual(controlledStateFields(device),[]);}
 const before=JSON.stringify(h.runtime.model),queue=h.runtime.saveQueue;
 assert.equal(await h.send(),false);assert.deepEqual(h.calls,[]);assert.equal(JSON.stringify(h.runtime.model),before);assert.equal(h.stats.persists,0);assert.equal(h.runtime.pendingSaves,0);assert.equal(h.runtime.saveQueue,queue);assert.equal(h.runtime.independentSending,false);
}

// Pending sends lock other actions. A concurrent canonical response wins over
// the detached snapshot, and failures release the lock without local mutation.
{
 const h=genericSendHarness();h.capture();let resolveSend;
 h.runtime.delayedResponse=()=>new Promise(resolve=>{resolveSend=resolve;});
 const before=JSON.stringify(h.runtime.model),pending=h.send();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.runtime.independentSending,true);assert.equal(h.calls.length,1);assert.equal(await h.send(),false);
 h.runtime.b={type:'button',action:'temp_up'};assert.equal(await vm.runInContext('executeAction(d,b)',h.runtime),false);assert.equal(JSON.stringify(h.runtime.model),before);assert.equal(h.calls.length,1);
 h.runtime.changeResponse=next=>{next.emitters[0].devices[0].studio.state.swing='position_6';};resolveSend(h.response());assert.equal(await pending,true);assert.equal(h.device().state.swing,'position_6');assert.equal(h.runtime.independentSending,false);assert.equal(h.stats.persists,0);
}
{
 const h=genericSendHarness();h.capture();h.runtime.rejectSend=new Error('Emisor no disponible');const before=JSON.stringify(h.runtime.model);
 assert.equal(await h.send(),false);assert.equal(h.calls.length,1);assert.equal(h.errors.length,1);assert.equal(JSON.stringify(h.runtime.model),before);assert.equal(h.runtime.independentSending,false);assert.equal(h.runtime.saveFailed,false);assert.equal(h.stats.persists,0);
}

// A dual may alternate generic sends even if it retained independent mode.
// Only its visible phase is saved afterward; neither side changes settings.
{
 const h=genericSendHarness(),device=h.device(),control=device.rows.at(-1).cells[0];
 Object.assign(control,{type:'dual',activeSide:0,sendMode:'independent',actions:[{name:'Enviar primero',action:'send_state',icon:'power',color:'#56c4ed',showName:true},{name:'Enviar segundo',action:'send_state',icon:'power-off',color:'#56c4ed',showName:true}]});
 h.runtime.allowPhasePersist=true;h.capture();const before=plain(device.state);
 assert.equal(await h.send(),true);assert.equal(h.device().rows.at(-1).cells[0].activeSide,1);assert.equal(await h.send(),true);assert.equal(h.device().rows.at(-1).cells[0].activeSide,0);
 assert.equal(h.calls.length,2);assert.ok(h.calls.every(([action,data])=>action==='send_state'&&JSON.stringify(data.state)===JSON.stringify(before)));assert.equal(h.stats.persists,2);assert.deepEqual(plain(h.device().state),before);
}
console.log('Generic current-state sends: exact snapshots/scopes, ambiguity guards, no own entity or settings save, queue locking and canonical dual phases passed.');
