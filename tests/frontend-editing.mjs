import assert from 'node:assert/strict';
import {createControlEditor,controlNeedsState} from '../custom_components/ir_pro/frontend/ir-pro-editing.js';

let sequence=0;
const makeId=()=>`replacement-${++sequence}`;
const clone=structuredClone;
const learned={id:'original',type:'button',action:'learned',name:'Luz',icon:'light',color:'#ffffff',entity:'button.luz',_existingType:'button',on:null,signals:{press:true},signal_refs:{press:'captured-original'}};
const original=clone(learned),snapshot=JSON.stringify(original),editor=createControlEditor(original,makeId);

// Cosmetic changes leave the existing HA identity and learned reference intact.
const renamed=editor.prepare({...original,name:'Otra luz',icon:'remote',color:'#123456',showName:false});
assert.equal(renamed.id,original.id);assert.equal(renamed.entity,original.entity);
assert.deepEqual(renamed.signal_refs,original.signal_refs);
assert.equal(JSON.stringify(original),snapshot);

// Changing the actual contract creates one stable replacement, without copying
// a press capture into the incompatible on/off channels of a switch.
const dualDraft={...original,type:'dual',actions:[{action:'learned'},{action:'learned'}]};
const dual=editor.prepare(dualDraft);
assert.notEqual(dual.id,original.id);
for(const key of ['entity','_existingType','on','signals','signal_refs'])assert.ok(!Object.hasOwn(dual,key));
assert.equal(editor.prepare(dual).id,dual.id);
assert.equal(editor.prepare(dualDraft).id,dual.id);

// Captures received for the replacement survive subsequent renders and cosmetic
// changes. They are not confused with the original capture when reverting.
dual.signals={on:true};dual.signal_refs={on:'new-on-capture'};
const captured=editor.prepare({...dual,name:'Nuevo doble'});
assert.equal(captured.id,dual.id);assert.deepEqual(captured.signal_refs,{on:'new-on-capture'});
const restored=editor.prepare({...captured,type:'button',action:'learned'});
assert.equal(restored.id,original.id);assert.equal(restored.entity,original.entity);
assert.deepEqual(restored.signals,original.signals);assert.deepEqual(restored.signal_refs,original.signal_refs);
assert.notEqual(restored.signal_refs,original.signal_refs);

const linked=editor.prepare({...original,action:'power_on'});
assert.notEqual(linked.id,original.id);assert.notEqual(linked.id,dual.id);assert.ok(!linked.entity);assert.ok(!linked.signal_refs);
assert.equal(editor.prepare({...linked,action:'learned'}).id,original.id);
assert.deepEqual(editor.prepare({...linked,action:'learned'}).signal_refs,original.signal_refs);

// Editing a setting value that has no standalone canonical function retains its
// visual identity. Learned independent effects, in contrast, are immutable.
const setting={id:'setting',type:'button',action:'set_fan',value:'low',name:'Ventilador'};
const settingEditor=createControlEditor(setting,makeId);
assert.equal(settingEditor.prepare({...setting,value:'high'}).id,setting.id);
const leaf={...learned,id:'leaf',entity:'button.position_1',state_effect:{swing:'position_1'},action_index:0};
const folder={id:'folder',type:'group',group:'swing',action:'open_group',independentActions:[leaf]};
const folderSnapshot=JSON.stringify(folder),folderEditor=createControlEditor(folder,makeId);
const changed=folderEditor.prepare({...folder,independentActions:[{...leaf,state_effect:{swing:'position_2'}}]});
const newLeaf=changed.independentActions[0];
assert.equal(changed.id,folder.id);assert.notEqual(newLeaf.id,leaf.id);
assert.deepEqual(newLeaf.state_effect,{swing:'position_2'});assert.ok(!newLeaf.signal_refs);
assert.equal(folderEditor.prepare(changed).independentActions[0].id,newLeaf.id);
const leafRestored=folderEditor.prepare({...changed,independentActions:[{...newLeaf,state_effect:{swing:'position_1'}}]}).independentActions[0];
assert.equal(leafRestored.id,leaf.id);assert.deepEqual(leafRestored.signal_refs,leaf.signal_refs);
assert.equal(JSON.stringify(folder),folderSnapshot);

const mixed={id:'mixed',type:'dual',actions:[{action:'learned'},{action:'power_off'}],learnedActions:[{...learned,id:'side',action_index:0}]};
const mixedEditor=createControlEditor(mixed,makeId);
assert.equal(mixedEditor.prepare(mixed).learnedActions[0].id,'side');
const moved=mixedEditor.prepare({...mixed,learnedActions:[{...mixed.learnedActions[0],action_index:1}]}).learnedActions[0];
assert.notEqual(moved.id,'side');assert.ok(!moved.signal_refs);
assert.equal(createControlEditor(null,makeId).prepare(learned).id,learned.id);

// A new unsaved button may be learned before changing its visual type. A press
// reference must never be copied to the switch's on/off capture channels.
const newEditor=createControlEditor(null,makeId);
const fresh=newEditor.prepare({id:'fresh',type:'button',action:'learned',name:'Nuevo',icon:'remote'});
fresh.signals={press:true};fresh.signal_refs={press:'new-unsaved-press'};
const freshDouble=newEditor.prepare({...fresh,type:'dual',actions:[{action:'learned'},{action:'learned'}]});
assert.notEqual(freshDouble.id,fresh.id);assert.ok(!freshDouble.signal_refs);assert.ok(!freshDouble.signals);
assert.equal(newEditor.prepare(freshDouble).id,freshDouble.id);
freshDouble.signal_refs={on:'new-unsaved-on'};freshDouble.signals={on:true};
assert.deepEqual(newEditor.prepare(freshDouble).signal_refs,{on:'new-unsaved-on'});

// Descendants removed by a temporary type selection return with their original
// entities and captures when that exact parent contract is restored.
const options=Array.from({length:8},(_,index)=>({...learned,id:'swing-'+index,entity:'button.swing_'+index,signal_refs:{press:'swing-capture-'+index},state_effect:{swing:index<6?'position_'+(index+1):index===6?'auto':'off'}}));
const eightSwing={id:'swing-folder',name:'Oscilación',type:'group',group:'swing',action:'open_group',independentActions:options};
const swingEditor=createControlEditor(eightSwing,makeId);
const interim=swingEditor.prepare({...eightSwing,type:'button',action:'learned',independentActions:[],children:[]});
assert.notEqual(interim.id,eightSwing.id);
const swingRestored=swingEditor.prepare({...interim,name:'Nombre conservado',type:'group',group:'swing',action:'open_group'});
assert.equal(swingRestored.id,eightSwing.id);assert.equal(swingRestored.name,'Nombre conservado');
assert.deepEqual(swingRestored.independentActions,options);
assert.notEqual(swingRestored.independentActions,options);
assert.ok(!Object.hasOwn(swingRestored,'children'));
assert.deepEqual(eightSwing.independentActions,options);

const nestedBase={id:'nested',type:'group',group:'custom',action:'open_group',children:[mixed]};
const nestedEditor=createControlEditor(nestedBase,makeId);
const temporary=nestedEditor.prepare({...nestedBase,type:'button',action:'learned',children:[]});
const nestedRestored=nestedEditor.prepare({...temporary,type:'group',group:'custom',action:'open_group'});
assert.deepEqual(nestedRestored.children,nestedBase.children);
assert.deepEqual(nestedRestored.children[0].learnedActions,mixed.learnedActions);

const addedChildEditor=createControlEditor({id:'empty-folder',type:'group',group:'custom',action:'open_group',children:[]},makeId);
const withChild=addedChildEditor.prepare({id:'empty-folder',type:'group',group:'custom',action:'open_group',children:[{id:'new-child',type:'button',action:'learned',name:'Nuevo hijo'}]});
withChild.children[0].signal_refs={press:'unsaved-child-capture'};
withChild.children[0].signals={press:true};
const changedChild=addedChildEditor.prepare({...withChild,children:[{...withChild.children[0],type:'dual',actions:[{action:'learned'},{action:'learned'}]}]}).children[0];
assert.notEqual(changedChild.id,'new-child');assert.ok(!changedChild.signal_refs);assert.ok(!changedChild.signals);

assert.equal(controlNeedsState(learned),false);
assert.equal(controlNeedsState(dualDraft),false);
assert.equal(controlNeedsState({type:'display'}),true);
assert.equal(controlNeedsState(setting),true);
assert.equal(controlNeedsState(folder),true);
assert.equal(controlNeedsState(mixed),true);
assert.equal(controlNeedsState({type:'group',group:'custom',children:[learned]}),false);
assert.equal(controlNeedsState({type:'group',group:'custom',children:[{type:'button',action:'temp_up'}]}),true);
assert.equal(controlNeedsState({type:'group',group:'custom',independentActions:[leaf]}),true);
assert.equal(controlNeedsState(null),false);
console.log('Control edits preserve compatible identities, replace incompatible captures, restore reverted contracts and detect state requirements.');
