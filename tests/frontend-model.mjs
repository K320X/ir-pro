import assert from 'node:assert/strict';
import {importModel,exportModel,reconcileCanonical,STATE_FIELDS,controlledStateFields,recordStateFields,projectState,findSavedState} from '../custom_components/ir_pro/frontend/ir-pro-model.js';

const fn=(key,type='button',refs={press:'real-reference'})=>({key,name:key,showName:true,icon:'power',color:'#56c4ed',type,entity:type+'.'+key,signals:Object.fromEntries(Object.keys(refs).map(signal=>[signal,true])),signal_refs:refs,on:type==='switch'?true:null});
const legacy={version:2,emitters:[{id:'emitter',sourceId:'registry-source',name:'IR salón',model:'RM4 mini',devices:[{id:'remote',name:'Televisor',icon:'tv',functions:[fn('power'),fn('toggle','switch',{on:'on-ref',off:'off-ref'})],layout:{heightScale:'square-at-two',rows:[{id:'row',columns:2,height:2,cells:['power','toggle']}]}}]}]};
const imported=importModel(legacy);
assert.equal(imported.emitters[0].devices[0].rows[0].cells[1].type,'dual');
assert.equal(imported.emitters[0].devices[0].rows[0].cells[1].activeSide,1);
const roundTrip=exportModel(imported);
assert.deepEqual(roundTrip.emitters[0].devices[0].functions.map(item=>[item.key,item.entity,item.type,item.signal_refs]),legacy.emitters[0].devices[0].functions.map(item=>[item.key,item.entity,item.type,item.signal_refs]));
const partial=structuredClone(legacy);partial.emitters[0].devices[0].studio={type:'simple',state:{power:false,mode:'cool',temperature:24,fan:'auto',swing:'off'},rows:[{id:'empty-row',type:'buttons',columns:1,height:2,cells:[null]}]};
const recovered=importModel(partial);assert.equal(exportModel(recovered).emitters[0].devices[0].functions.length,2);
recovered.emitters[0].devices[0].rows=[];assert.equal(exportModel(recovered).emitters[0].devices[0].functions.length,0);

const stateful=structuredClone(legacy);const device=stateful.emitters[0].devices[0];
device.functions=[fn('accessory'),fn('child'),fn('state')];
device.studio={type:'stateful',state:{power:true,mode:'heat',temperature:24,fan:'high',swing:'position_3'},rows:[{id:'screen',type:'display',width:3,height:2,fields:{temperature:true}},{id:'controls',type:'buttons',columns:2,height:2,cells:[{id:'accessory',type:'button',action:'learned',name:'Luz',icon:'light',color:'#56c4ed',showName:true},{id:'folder',type:'group',group:'custom',name:'Opciones',icon:'folder',color:'#56c4ed',showName:true,children:[{id:'child',type:'button',action:'learned',name:'Extra',icon:'power',color:'#56c4ed',showName:true}]}]}],savedStates:[{id:'state',name:'Confort',settings:{power:false}}]};
const stateModel=importModel(stateful);const exported=exportModel(stateModel);const output=exported.emitters[0].devices[0];
assert.deepEqual(output.layout.rows.flatMap(row=>row.cells).filter(Boolean).sort(),['accessory','child','state']);
assert.equal(output.studio.rows.length,2);
assert.equal(output.functions.find(item=>item.key==='state').signal_refs.press,'real-reference');
assert.equal(stateModel.emitters[0].devices[0].savedStates[0].signal.kind,'learned');

// An old, unconfirmed reference survives migration without being shown as ready.
const unconfirmed=structuredClone(stateful);unconfirmed.emitters[0].devices[0].functions.find(item=>item.key==='state').signals.press=false;
const pending=importModel(unconfirmed);assert.equal(pending.emitters[0].devices[0].savedStates[0].signal,null);
assert.equal(exportModel(pending).emitters[0].devices[0].functions.find(item=>item.key==='state').signal_refs.press,'real-reference');

// A delayed acknowledgement must not overwrite a newer capture queued by the user.
const node=stateModel.emitters[0].devices[0].rows[1].cells[0];node.signal_refs.press='new-reference';
reconcileCanonical(stateModel,stateful,exported);
assert.equal(node.signal_refs.press,'new-reference');
const collision=structuredClone(stateful);collision.emitters[0].devices[0].functions[0].entity='button.accessory_2';
reconcileCanonical(stateModel,collision);
assert.equal(node.entity,'button.accessory_2');
assert.equal(node.signal_refs.press,'real-reference');
console.log('Frontend model: legacy identities, switch state, nested/state layout, trusted readiness and delayed-save reconciliation passed.');

// Reversing pictograms never migrates a stored position or its captured signal.
for(let position=1;position<=6;position++){
 const original=structuredClone(stateful),device=original.emitters[0].devices[0];
 device.studio.state.swing='position_'+position;
 device.studio.savedStates[0].settings={...device.studio.state};
 const output=exportModel(importModel(original)).emitters[0].devices[0];
 assert.equal(output.studio.state.swing,'position_'+position);
 assert.equal(output.studio.savedStates[0].settings.swing,'position_'+position);
 assert.deepEqual(output.functions.map(fn=>[fn.key,fn.entity,fn.type,fn.signal_refs]),device.functions.map(fn=>[fn.key,fn.entity,fn.type,fn.signal_refs]));
}
console.log('All six saved swing positions retain their IDs, settings, entities and learned references.');

// Eight independent swing signals remain ordinary functions, never complete
// states. A new climate capture controls four fields at every louver position.
const scoped=structuredClone(stateModel),scopedDevice=scoped.emitters[0].devices[0];
scopedDevice.savedStates=[];scopedDevice.rows=[{id:'swing-row',type:'buttons',columns:2,height:2,cells:[{id:'swing-folder',type:'group',group:'swing',sendMode:'independent',independentActions:Array.from({length:8},(_,index)=>({id:'swing-'+index,type:'button',action:'learned',name:'Swing '+index,value:index<6?'position_'+(index+1):index===6?'auto':'off',state_effect:{swing:index<6?'position_'+(index+1):index===6?'auto':'off'},entity:'button.swing_'+index,signals:{press:true},signal_refs:{press:'swing-ref-'+index}}))},{id:'light',type:'button',action:'learned',name:'Luz',entity:'button.luz'}]}];
scopedDevice.state={power:true,mode:'cool',temperature:24,fan:'high',swing:'position_1'};
const independentBefore=JSON.stringify(scopedDevice.rows[0].cells[0].independentActions);
assert.equal(exportModel(scoped).emitters[0].devices[0].studio.savedStates.length,0);
assert.deepEqual(controlledStateFields(scopedDevice),['power','mode','temperature','fan']);
const captured={id:'climate',name:'Encendido · Frío · 24 °C · Ventilador 3',entity:'button.frio_24_ventilador_3',settings:projectState(scopedDevice.state,controlledStateFields(scopedDevice)),controlled_fields:controlledStateFields(scopedDevice),signal:{kind:'learned',id:'climate-ref'}};
scopedDevice.savedStates.push(captured);assert.ok(!Object.hasOwn(captured.settings,'swing'));
for(const swing of ['off','auto',...Array.from({length:6},(_,index)=>'position_'+(index+1))]){scopedDevice.state.swing=swing;assert.equal(findSavedState(scopedDevice)?.id,'climate');}
assert.equal(JSON.stringify(scopedDevice.rows[0].cells[0].independentActions),independentBefore);
const scopedWire=exportModel(scoped),scopedRound=importModel(scopedWire).emitters[0].devices[0];
assert.deepEqual(scopedRound.savedStates[0].settings,captured.settings);assert.deepEqual(scopedRound.savedStates[0].controlled_fields,captured.controlled_fields);
const old={id:'legacy',name:'Nombre original',entity:'button.original',settings:{...scopedDevice.state},signal:{kind:'learned',id:'legacy-ref'}};
scopedDevice.savedStates=[old];const unchanged=JSON.stringify(old);assert.equal(findSavedState(scopedDevice),undefined,'A wider legacy capture cannot substitute for the active scope');assert.equal(JSON.stringify(old),unchanged);
scopedDevice.rows[0].cells[0].sendMode='settings';assert.deepEqual(controlledStateFields(scopedDevice),STATE_FIELDS);assert.equal(findSavedState(scopedDevice)?.id,'legacy');
const explicit={...structuredClone(old),id:'explicit',controlled_fields:[...STATE_FIELDS]};scopedDevice.savedStates.push(explicit);assert.equal(findSavedState(scopedDevice)?.id,'explicit');scopedDevice.savedStates.push({...explicit,id:'duplicate'});assert.equal(findSavedState(scopedDevice),undefined,'Ambiguous equivalents never pick an arbitrary signal');
scopedDevice.rows[0].cells[0].sendMode='independent';scopedDevice.rows[0].cells.push({type:'group',group:'custom',children:[{type:'group',group:'fan',sendMode:'independent'},{type:'group',group:'mode',sendMode:'independent'}]});
assert.deepEqual(controlledStateFields(scopedDevice),['power','temperature']);
assert.deepEqual(controlledStateFields({...scopedDevice,rows:[]}),STATE_FIELDS,'Deleting controls does not reinterpret existing full states');
assert.deepEqual(controlledStateFields(scopedDevice,{power:false}),['power']);assert.deepEqual(projectState({power:false,mode:'heat'},STATE_FIELDS),{power:false});assert.deepEqual(recordStateFields({settings:{power:false}}),['power']);
scopedDevice.savedStates=[{id:'mode-free',controlled_fields:['power','temperature'],settings:{power:true,temperature:24}}];scopedDevice.state={power:true,mode:'dry',temperature:25,fan:'high',swing:'off'};assert.equal(findSavedState(scopedDevice),undefined,'Temperature remains significant when mode is independently controlled');scopedDevice.state.temperature=24;assert.equal(findSavedState(scopedDevice)?.id,'mode-free');
scopedDevice.rows=[];scopedDevice.savedStates=[{id:'dry-full',settings:{power:true,mode:'dry',temperature:20,fan:'high',swing:'off'}}];scopedDevice.state.temperature=29;assert.equal(findSavedState(scopedDevice)?.id,'dry-full','Dry ignores temperature only in a scope that includes mode');
scopedDevice.rows=[{type:'buttons',cells:[{type:'dual',sendMode:'independent',actions:[{action:'power_on'},{action:'power_off'}]}]}];scopedDevice.state={power:false,mode:'cool',temperature:24,fan:'high',swing:'off'};
assert.deepEqual(controlledStateFields(scopedDevice),['mode','temperature','fan','swing']);
const noPower={id:'no-power',controlled_fields:controlledStateFields(scopedDevice),settings:projectState(scopedDevice.state,controlledStateFields(scopedDevice))};assert.ok(!Object.hasOwn(noPower.settings,'power'));scopedDevice.savedStates=[noPower];assert.equal(findSavedState(scopedDevice)?.id,'no-power');scopedDevice.state.power=true;assert.equal(findSavedState(scopedDevice)?.id,'no-power');
scopedDevice.rows[0].cells.push({type:'button',action:'temp_up',sendMode:'independent'},...['mode','fan','swing'].map(group=>({type:'group',group,sendMode:'independent'})));assert.deepEqual(controlledStateFields(scopedDevice),[]);assert.equal(findSavedState(scopedDevice),undefined);
console.log('Scoped climate captures exclude independent folders, preserve eight signals and legacy semantics, and match only an unambiguous active scope.');
