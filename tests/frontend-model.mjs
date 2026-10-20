import assert from 'node:assert/strict';
import {importModel,exportModel,reconcileCanonical} from '../custom_components/ir_pro/frontend/ir-pro-model.js';

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
