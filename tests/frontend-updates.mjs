import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../custom_components/ir_pro/frontend/ir-pro-controller.js',import.meta.url),'utf8');
const extract=name=>{
  const start=[source.indexOf('  function '+name+'('),source.indexOf('  async function '+name+'(')].filter(index=>index>=0).sort((a,b)=>a-b)[0];
  const next=/\n  (?:async )?function /g;next.lastIndex=start+1;const end=next.exec(source)?.index??source.length;
  assert.ok(start>=0&&end>start,name);return source.slice(start,end);
};

// Native dialog autofocus is directed to a neutral container BEFORE showModal.
const focusCalls=[],headingAttributes=new Set(),dialogAttributes=new Set();let restored=0;
const heading={tabIndex:0,setAttribute:key=>headingAttributes.add(key),focus:options=>focusCalls.push(options)};
const dialog={querySelector:()=>heading,setAttribute:key=>dialogAttributes.add(key),showModal(){assert.ok(dialogAttributes.has('autofocus'));assert.ok(headingAttributes.has('autofocus'));assert.equal(heading.tabIndex,-1);}};
let locked=0,unlocked=0;
const modalContext={modalScroll:{lock(){locked++;},unlock(){unlocked++;}},captureScrollPosition:()=>()=>{restored++;}};vm.createContext(modalContext);vm.runInContext(extract('openNeutralDialog'),modalContext);modalContext.dialog=dialog;
vm.runInContext('openNeutralDialog(dialog)',modalContext);assert.equal(focusCalls.length,1);assert.equal(focusCalls[0].preventScroll,true);assert.equal(restored,1);
assert.equal(locked,1);dialog.showModal=()=>{throw new Error('dialog failure');};assert.throws(()=>vm.runInContext('openNeutralDialog(dialog)',modalContext),/dialog failure/);assert.equal(unlocked,1);
assert.ok(!source.includes('first.focus()'));assert.ok(!source.includes('entityModal.showModal();input.focus()'));

// Ambient changes touch only their text slots and skip unchanged readings.
let slotWrites=0;
const slot=()=>{let html='';return {get innerHTML(){return html;},set innerHTML(value){html=value;slotWrites++;}};};
const humiditySlot=slot(),temperatureSlot=slot(),target={hasChildNodes:()=>true};
const container={hidden:false,classList:{toggle(){}}};
const display={dataset:{displayDevice:'remote'},querySelector:selector=>({'[data-ambient-kind="humidity"]':humiditySlot,'[data-ambient-kind="temperature"]':temperatureSlot,'.display-readings':container,'.display-target':target})[selector]};
const readings={humidity:{state:'56',unit:'%'},temperature:{state:'24.5',unit:'°C'}};
const ambientContext={disposed:false,lastAmbientSnapshot:'',root:{querySelectorAll:()=>[display]},model:{emitters:[{devices:[{id:'remote'}]}]},ambientFor:()=>readings,glyph:()=>'',esc:value=>String(value??'')};
vm.createContext(ambientContext);vm.runInContext(['ambientScalar','ambientHTML','refreshAmbientReadings'].map(extract).join('\n'),ambientContext);
vm.runInContext('refreshAmbientReadings()',ambientContext);assert.equal(slotWrites,2);const before=slotWrites;
vm.runInContext('refreshAmbientReadings();refreshAmbientReadings()',ambientContext);assert.equal(slotWrites,before);
readings.temperature.state='24.6';vm.runInContext('refreshAmbientReadings()',ambientContext);assert.equal(slotWrites,before+1);assert.match(temperatureSlot.innerHTML,/24,6/);
readings.humidity.state='unavailable';vm.runInContext('refreshAmbientReadings()',ambientContext);assert.equal(humiditySlot.innerHTML,'');assert.equal(container.hidden,false);

// Repeated backend sensor notifications carry the same canonical model. They
// must not replace local UI objects or change a modal's unsaved selections.
const wire={version:2,emitters:[]},localModel={emitters:[],selected:'keep-selection'};let renders=0,ambientUpdates=0;
const envelopeContext={disposed:false,catalog:[],revision:4,confirmedWire:structuredClone(wire),model:localModel,pendingSaves:0,modal:{open:false},entityModal:{open:false},editing:false,signalBusy:false,saveFailed:false,deferredEnvelope:null,refreshAmbientReadings(){ambientUpdates++;},copy:structuredClone,importModel:(model,selected)=>({...structuredClone(model),selected}),validateDevice(){},render(){renders++;}};
vm.createContext(envelopeContext);vm.runInContext(extract('receiveEnvelope')+'\n'+extract('flushDeferredEnvelope'),envelopeContext);
envelopeContext.envelope={model:structuredClone(wire),revision:4,catalog:[{ambient:'updated'}]};vm.runInContext('receiveEnvelope(envelope)',envelopeContext);
assert.equal(renders,0);assert.equal(envelopeContext.model,localModel);assert.equal(ambientUpdates,1);
envelopeContext.envelope.revision=5;envelopeContext.modal.open=true;vm.runInContext('receiveEnvelope(envelope)',envelopeContext);assert.equal(envelopeContext.revision,5);assert.equal(renders,0);
const changed={version:2,emitters:[{id:'external',devices:[]}]};
envelopeContext.envelope={model:changed,revision:6,catalog:[]};envelopeContext.pendingSaves=1;vm.runInContext('receiveEnvelope(envelope)',envelopeContext);
assert.equal(envelopeContext.revision,5);assert.equal(envelopeContext.model,localModel);assert.ok(envelopeContext.deferredEnvelope);
envelopeContext.pendingSaves=0;vm.runInContext('flushDeferredEnvelope()',envelopeContext);assert.equal(renders,0);
envelopeContext.modal.open=false;envelopeContext.editing=true;vm.runInContext('flushDeferredEnvelope()',envelopeContext);assert.equal(renders,0);
envelopeContext.editing=false;vm.runInContext('flushDeferredEnvelope()',envelopeContext);assert.equal(renders,1);assert.equal(envelopeContext.revision,6);assert.equal(envelopeContext.model.selected,'keep-selection');assert.equal(envelopeContext.deferredEnvelope,null);
envelopeContext.envelope={model:wire,revision:5,catalog:[]};vm.runInContext('receiveEnvelope(envelope)',envelopeContext);assert.equal(renders,1);assert.equal(envelopeContext.revision,6);

// Preserve every existing scrolling boundary across HA Shadow DOM ancestors,
// the panel and modal. A new user gesture cancels the delayed restoration.
const scroller=top=>({scrollTop:top,scrollLeft:0,scrollHeight:1500,clientHeight:300,scrollWidth:300,clientWidth:300,isConnected:true});
const haScroll=scroller(600),docScroll=scroller(80),modalScroll=scroller(120),panelScroll=scroller(40),frames=[];
panelScroll.parentNode={host:haScroll};panelScroll.ownerDocument={scrollingElement:docScroll};panelScroll.querySelectorAll=()=>[modalScroll];
const scrollContext={disposed:false,root:panelScroll,scrollGeneration:0,inputGeneration:0,requestAnimationFrame:callback=>frames.push(callback)};
vm.createContext(scrollContext);vm.runInContext(extract('captureScrollPosition'),scrollContext);const restore=vm.runInContext('captureScrollPosition()',scrollContext);
for(const node of [haScroll,docScroll,modalScroll,panelScroll])node.scrollTop=0;restore();assert.deepEqual([haScroll.scrollTop,docScroll.scrollTop,modalScroll.scrollTop,panelScroll.scrollTop],[600,80,120,40]);
scrollContext.inputGeneration++;haScroll.scrollTop=720;frames.shift()();assert.equal(haScroll.scrollTop,720);
const navigate=vm.runInContext('captureScrollPosition(true)',scrollContext);navigate();assert.deepEqual([haScroll.scrollTop,docScroll.scrollTop,modalScroll.scrollTop,panelScroll.scrollTop],[0,0,0,0]);
console.log('Frontend updates: neutral modal focus, ambient-only DOM patches, unchanged-model notifications, deferred drafts and HA/modal scroll preservation passed.');
