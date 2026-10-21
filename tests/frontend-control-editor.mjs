import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {setMaxListeners} from 'node:events';
import vm from 'node:vm';
import {template} from '../custom_components/ir_pro/frontend/ir-pro-theme.js';
import {importModel,exportModel,reconcileCanonical,independentStateEffect,linkedActionEffect} from '../custom_components/ir_pro/frontend/ir-pro-model.js';
import {createControlEditor,controlNeedsState} from '../custom_components/ir_pro/frontend/ir-pro-editing.js';

const source=readFileSync(new URL('../custom_components/ir_pro/frontend/ir-pro-controller.js',import.meta.url),'utf8');
const extract=name=>{
 const start=[source.indexOf('  function '+name+'('),source.indexOf('  async function '+name+'(')].filter(index=>index>=0).sort((a,b)=>a-b)[0];
 const next=/\n  (?:async )?function /g;next.lastIndex=start+1;const end=next.exec(source)?.index??source.length;
 assert.ok(start>=0&&end>start,name);return source.slice(start,end);
};
const constant=name=>source.split('\n').find(line=>line.trimStart().startsWith('const '+name+' ='));
const plain=value=>JSON.parse(JSON.stringify(value));
const decode=value=>value.replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');

// This DOM adapter models only native markup, values and events. All identity,
// conversion, confirmation, validation and save decisions execute production
// controller functions and the production editor/model modules below.
class Element {
 constructor(tag='div',attributes={}){
  this.tagName=tag.toUpperCase();this.attributes={...attributes};this.children=[];this.parentElement=null;this.listeners=new Map();this.ownText='';this.html='';
  this.value=attributes.value||'';this.checked=Object.hasOwn(attributes,'checked');this.disabled=Object.hasOwn(attributes,'disabled');this.hidden=Object.hasOwn(attributes,'hidden');this.open=false;
  this.classList={add(){},remove(){},toggle(){}};
 }
 get id(){return this.attributes.id;} get type(){return this.attributes.type;} set type(value){this.attributes.type=value;}
 get name(){return this.attributes.name;} get className(){return this.attributes.class||'';} set className(value){this.attributes.class=value;}
 get dataset(){return Object.fromEntries(Object.entries(this.attributes).filter(([key])=>key.startsWith('data-')).map(([key,value])=>[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),value]));}
 get isConnected(){return !!this.parentElement;} get lastElementChild(){return this.children.at(-1);}
 get innerHTML(){return this.html;} set innerHTML(html){this.html=html;this.children=[];this.ownText='';parse(html,this);}
 get textContent(){return this.ownText+this.children.map(child=>child.textContent).join('');} set textContent(text){this.ownText=String(text);this.children=[];}
 appendChild(child){child.parentElement=this;this.children.push(child);return child;}
 setAttribute(key,value){this.attributes[key]=String(value);} getAttribute(key){return this.attributes[key]??null;}
 removeAttribute(key){delete this.attributes[key];} hasAttribute(key){return Object.hasOwn(this.attributes,key);}
 matches(selector){
  const parts=selector.trim().split(/\s+(?![^\[]*\])/);if(parts.length>1){const last=parts.pop();if(!this.matches(last))return false;let parent=this.parentElement;while(parent){if(parent.matches(parts.join(' ')))return true;parent=parent.parentElement;}return false;}
  const tag=selector.match(/^[a-z][\w-]*/i)?.[0];if(tag&&tag.toUpperCase()!==this.tagName)return false;
  const id=selector.match(/#([\w-]+)/)?.[1];if(id&&this.id!==id)return false;
  for(const [,name]of selector.matchAll(/\.([\w-]+)/g))if(!this.className.split(/\s+/).includes(name))return false;
  for(const [,key,quoted,bare]of selector.matchAll(/\[([\w-]+)(?:=(?:"([^"]*)"|([^\]]+)))?\]/g)){if(!this.hasAttribute(key))return false;const value=quoted??bare;if(value!==undefined&&this.getAttribute(key)!==value)return false;}
  return true;
 }
 querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;}
 addEventListener(name,callback,options={}){
  const entry={callback,once:options.once};if(options.signal?.aborted)return;const entries=this.listeners.get(name)||[];entries.push(entry);this.listeners.set(name,entries);
  if(options.signal){setMaxListeners(0,options.signal);options.signal.addEventListener('abort',()=>this.listeners.set(name,(this.listeners.get(name)||[]).filter(item=>item!==entry)),{once:true});}
 }
 async emit(name){const event={type:name,target:this,preventDefault(){},stopPropagation(){}};const pending=[];if(this['on'+name])pending.push(this['on'+name](event));for(const entry of [...(this.listeners.get(name)||[])]){if(entry.once)this.listeners.set(name,this.listeners.get(name).filter(item=>item!==entry));pending.push(entry.callback(event));}await Promise.all(pending);}
 click(){assert.equal(this.disabled,false,'A disabled control cannot be clicked');return this.emit('click');}
 focus(){this.focused=true;} showModal(){this.open=true;} close(){this.open=false;void this.emit('close');}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}
}
function parse(html,root){
 const stack=[root],voids=new Set(['INPUT','BR','HR','IMG']);
 for(const token of html.match(/<[^>]+>|[^<]+/g)||[]){
  if(token.startsWith('</')){if(stack.length>1)stack.pop();continue;}
  if(token.startsWith('<')){
   const tag=token.match(/^<([\w-]+)/)?.[1];if(!tag)continue;const attrs={};
   for(const [,key,double,single,bare]of token.slice(tag.length+1,-1).matchAll(/([^\s=/>]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))attrs[key]=decode(double??single??bare??'');
   const child=new Element(tag,attrs),parent=stack.at(-1);parent.appendChild(child);
   if(child.tagName==='OPTION'&&(Object.hasOwn(attrs,'selected')||parent.children.length===1))parent.value=child.value;
   if(!voids.has(child.tagName)&&!token.endsWith('/>'))stack.push(child);
  }else stack.at(-1).ownText+=decode(token);
 }
}

function harness(){
 const root=new Element('root');root.innerHTML=template;
 const $=(selector,scope=root)=>scope.querySelector(selector),$$=(selector,scope=root)=>scope.querySelectorAll(selector);
 const calls=[],messages=[],scope={
  root,document:{createElement:tag=>new Element(tag)},$,$$,AbortController,createControlEditor,controlNeedsState,independentStateEffect,linkedActionEffect,
  importModel,exportModel,reconcileCanonical,uid:randomUUID,copy:structuredClone,esc:String,glyph:()=>'',CSS:{escape:String},
  modal:$('#modal'),modalBody:$('#modal-body'),modalFoot:$('#modal-foot'),entityModal:$('#entity-modal'),modalAbort:null,
  modalScroll:{lock(){},unlock(){}},captureScrollPosition:()=>()=>{},isAdmin:true,signalBusy:false,disposed:false,saveFailed:false,pendingSaves:0,revision:1,catalog:[],saveQueue:Promise.resolve(true),
  render(){},toast:message=>messages.push(message),flushDeferredEnvelope(){},queueRequest:action=>action(),
  api:{call:async(action,data)=>{calls.push([action,plain(data)]);assert.equal(action,'save','Editing and confirmation must never learn or emit IR');if(scope.rejectSave)throw scope.rejectSave;const model=structuredClone(data.model);for(const emitter of model.emitters)for(const device of emitter.devices)for(const fn of device.functions)fn.signals=Object.fromEntries(Object.keys(fn.signal_refs||{}).map(key=>[key,true]));return {model,revision:++scope.revision};}}
 };
 scope.emitterFor=id=>scope.model.emitters.find(emitter=>emitter.devices.some(device=>device.id===id));
 vm.createContext(scope);
 const options=source.slice(source.indexOf('  const clamp ='),source.indexOf('  const button ='));
 const constructors=source.slice(source.indexOf('  const button ='),source.indexOf('  function validateDevice'));
 const constants=['entitySlug','entityDomain','selectOptions','actionSelectOptions','field','checkField'].map(constant).join('\n');
 vm.runInContext(options+'\n'+constructors+'\n'+constants+'\n'+['automationButtons','entityTaken','ensureModelEntities','getButton','buttonSymbol','findEmpty','closeModal','openNeutralDialog','showModal','confirmEntityChanges','formError','editButton','persist'].map(extract).join('\n'),scope);
 vm.runInContext('globalThis.model={version:1,emitters:[{id:"editor-emitter",sourceId:"source",name:"IR salón",devices:[newRemote("Televisor","tv")]}]};ensureModelEntities();',scope);
 const initial=exportModel(scope.model);for(const fn of initial.emitters[0].devices[0].functions){fn.signal_refs=fn.type==='switch'?{on:'original-on',off:'original-off'}:{press:'original-'+fn.key};fn.signals=Object.fromEntries(Object.keys(fn.signal_refs).map(signal=>[signal,true]));}
 scope.model=importModel(initial);scope.confirmedWire=structuredClone(initial);
 const device=()=>scope.model.emitters[0].devices[0];
 const edit=key=>{scope.d=device();scope.original=device().rows.flatMap(row=>row.cells||[]).find(node=>node?.id===key);assert.ok(scope.original);vm.runInContext('editButton(d,original)',scope);};
 const control=selector=>{const element=$(selector);assert.ok(element,'Editor control '+selector+' exists');return element;};
 const change=async(selector,value,event='change')=>{const element=control(selector);element.value=value;await element.emit(event);};
 const button=label=>{const element=scope.modalFoot.children.find(child=>child.textContent===label);assert.ok(element,label);return element;};
 const confirmation=()=>root.children.find(child=>child.className==='signal-delete-modal');
 return {scope,calls,messages,device,edit,control,change,button,confirmation};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

const assertActionSelector=select=>{
 assert.deepEqual(select.children.slice(0,3).map(child=>[child.tagName,child.value]),[['OPTION','learned'],['OPTION','send_state'],['HR','']]);
 assert.equal(select.children[2].className,'action-separator');
 assert.equal(select.children.filter(child=>child.tagName==='HR').length,1);
 assert.equal(select.children[0].textContent,'Enviar una señal aprendida');assert.equal(select.children[1].textContent,'Enviar señal de ajustes del mando');
 assert.ok(select.querySelectorAll('option').every(option=>option.value&&option.disabled===false),'The separator is not a selectable fake option');
};

// All three action selectors show the two direct sending choices first and one
// native separator before the setting-changing actions.
{
 const h=harness();h.edit(h.device().rows[0].cells[1].id);assertActionSelector(h.control('[data-dual-field="action"]'));await h.button('Cancelar').click();
 h.edit(h.device().rows[1].cells[0].id);assertActionSelector(h.control('#button-action'));
 await h.change('#function-type','group');assert.equal(h.control('#group-kind').value,'custom');await h.control('#add-folder-child').click();assert.equal(h.scope.modalBody.querySelectorAll('[data-child-action]').length,1,'The first add click uses the current child array after parent identity replacement');assertActionSelector(h.control('[data-child-action]'));await h.button('Cancelar').click();assert.deepEqual(h.calls,[]);
}

// Choosing a generic current-state signal on a saved TV promotes its editing
// capabilities only after confirmation; the sending control has no own entity.
{
 const h=harness(),original=h.device().rows[1].cells[0];h.edit(original.id);await h.change('#button-action','send_state');
 assert.equal(h.device().type,'simple');assert.match(h.control('#action-fields').innerHTML,/sin cambiar sus valores/);
 const saving=h.button('Guardar cambios').click();await tick();assert.ok(h.confirmation());assert.deepEqual(h.calls,[]);await h.confirmation().querySelector('[data-confirm]').click();await saving;
 const saved=h.device().rows[1].cells[0],functions=h.calls[0][1].model.emitters[0].devices[0].functions;
 assert.equal(h.device().type,'stateful');assert.equal(saved.action,'send_state');assert.notEqual(saved.id,original.id);assert.ok(!saved.entity);assert.ok(!functions.some(fn=>fn.key===saved.id||fn.key===original.id));assert.equal(functions.length,16);
}

// A child added on the first click remains the live draft child through action
// and name changes, confirmation and canonical persistence of its new folder.
{
 const h=harness(),original=h.device().rows[1].cells[0];h.edit(original.id);await h.change('#function-type','group');await h.control('#add-folder-child').click();
 await h.change('[data-child-action]','send_state');await h.change('[data-child-name]','Enviar ajustes','input');const childId=h.control('[data-child-entity]').dataset.childEntity;
 const saving=h.button('Guardar cambios').click();await tick();await h.confirmation().querySelector('[data-confirm]').click();await saving;
 const group=h.device().rows[1].cells[0],functions=h.calls[0][1].model.emitters[0].devices[0].functions;
 assert.equal(group.type,'group');assert.equal(group.group,'custom');assert.equal(group.children.length,1);assert.equal(group.children[0].id,childId);assert.equal(group.children[0].name,'Enviar ajustes');assert.equal(group.children[0].action,'send_state');assert.equal(h.device().type,'stateful');assert.ok(!functions.some(fn=>fn.key===childId||fn.key===group.id||fn.key===original.id));
}

// A saved TV has an enabled function selector and all action choices. Merely
// changing the draft, or cancelling the editor, leaves the server untouched.
{
 const h=harness(),power=h.device().rows[0].cells[1],before=JSON.stringify(h.scope.model);h.edit(power.id);
 assert.equal(h.control('#function-type').disabled,false);assert.equal(h.control('#function-type').value,'dual');
 const action=h.control('[data-dual-field="action"]');assert.equal(action.disabled,false);assert.ok(action.querySelectorAll('option').some(option=>option.value==='power_on'));assert.ok(action.querySelectorAll('option').some(option=>option.value==='learned'));
 await h.change('#function-type','button');assert.equal(h.control('#button-action').disabled,false);assert.ok(h.control('#button-action').querySelectorAll('option').some(option=>option.value==='power_off'));
 await h.change('#button-action','power_off');await h.button('Cancelar').click();
 assert.equal(JSON.stringify(h.scope.model),before);assert.deepEqual(h.calls,[]);
}

// Replacing the switch by a mixed dual requires confirmation. A refused change
// preserves everything; acceptance creates fresh IDs without stealing on/off.
{
 const h=harness(),power=h.device().rows[0].cells[1],before=JSON.stringify(h.scope.model);h.edit(power.id);
 await h.change('[data-dual-field="action"]','power_on');
 const childKey=h.control('[data-signal="press"]').dataset.learnFunction;
 assert.notEqual(childKey,power.id);assert.match(childKey,/^[0-9a-f-]{36}$/);assert.match(h.control('#function-learning').innerHTML,/Sin señal/);
 assert.ok(h.control('#function-learning').querySelector('[data-entity-edit]'),'The mixed learned child exposes its entity editor');
 let saving=h.button('Guardar cambios').click();await tick();assert.ok(h.confirmation());assert.match(h.confirmation().innerHTML,new RegExp(power.entity.replace('.','\\.')));assert.deepEqual(h.calls,[]);
 await h.confirmation().querySelector('[data-cancel]').click();await saving;assert.equal(JSON.stringify(h.scope.model),before);assert.deepEqual(h.calls,[]);
 saving=h.button('Guardar cambios').click();await tick();await h.confirmation().querySelector('[data-confirm]').click();await saving;
 const saved=h.device().rows[0].cells[1],functions=h.calls[0][1].model.emitters[0].devices[0].functions;
 assert.equal(h.device().type,'stateful');assert.notEqual(saved.id,power.id);assert.equal(saved.learnedActions.length,1);assert.equal(saved.learnedActions[0].id,childKey);assert.equal(saved.learnedActions[0].action_index,1);
 assert.deepEqual(plain(saved.learnedActions[0].signal_refs),{});assert.ok(!functions.some(fn=>fn.key===power.id));assert.equal(functions.find(fn=>fn.key===childKey).type,'button');assert.deepEqual(functions.find(fn=>fn.key===childKey).signal_refs,{});assert.ok(!Object.hasOwn(h.calls[0][1],'entity_renames'));
}

// Name and color edits are compatible: no replacement warning or signal loss.
{
 const h=harness(),light=h.device().rows[1].cells[0],before=structuredClone(light);h.edit(light.id);
 await h.change('#button-name','Volumen bajo','input');await h.change('#button-color','#123456','input');await h.button('Guardar cambios').click();
 const saved=h.device().rows[1].cells[0];assert.equal(saved.id,before.id);assert.equal(saved.entity,before.entity);assert.equal(saved.name,'Volumen bajo');assert.equal(saved.color,'#123456');assert.deepEqual(plain(saved.signal_refs),plain(before.signal_refs));assert.equal(h.confirmation(),undefined);assert.equal(h.calls.length,1);assert.ok(!Object.hasOwn(h.calls[0][1],'entity_renames'));
}

// The pencil edits the draft only. Actual rename intent is sent explicitly,
// with unchanged UUID/captures, only after Save and its final confirmation.
{
 const h=harness(),light=h.device().rows[1].cells[0],before=structuredClone(light);h.edit(light.id);
 await h.control('[data-entity-edit]').click();assert.equal(h.scope.entityModal.open,true);assert.equal(h.control('#entity-warning').hidden,false);
 h.control('#entity-suffix').value='volumen_personalizado';await h.control('#entity-accept').click();
 assert.deepEqual(h.calls,[]);assert.equal(h.device().rows[1].cells[0].entity,before.entity);
 let saving=h.button('Guardar cambios').click();await tick();assert.ok(h.confirmation());assert.match(h.confirmation().innerHTML,/conservando sus señales/);assert.deepEqual(h.calls,[]);
 await h.confirmation().querySelector('[data-cancel]').click();await saving;assert.deepEqual(h.calls,[]);assert.equal(h.device().rows[1].cells[0].entity,before.entity);
 saving=h.button('Guardar cambios').click();await tick();await h.confirmation().querySelector('[data-confirm]').click();await saving;
 const saved=h.device().rows[1].cells[0];assert.equal(saved.id,before.id);assert.equal(saved.entity,'button.volumen_personalizado');assert.deepEqual(plain(saved.signal_refs),plain(before.signal_refs));
 assert.deepEqual(h.calls[0][1].entity_renames,{[before.id]:'button.volumen_personalizado'});assert.equal(h.calls[0][1].model.emitters[0].devices[0].functions.find(fn=>fn.key===before.id).entity,'button.volumen_personalizado');
 await vm.runInContext('persist()',h.scope);assert.equal(h.calls.length,2);assert.ok(!Object.hasOwn(h.calls[1][1],'entity_renames'),'Later ordinary saves do not repeat rename authorization');
}

// The dual's visible names and colors also remain compatible with the existing
// two-channel switch and never replace its HA identity or its captured signals.
{
 const h=harness(),power=h.device().rows[0].cells[1],before=structuredClone(power);h.edit(power.id);
 await h.change('[data-dual-field="name"]','Encender TV','input');await h.change('[data-dual-field="color"]','#234567','input');await h.button('Guardar cambios').click();
 const saved=h.device().rows[0].cells[1];assert.equal(saved.id,before.id);assert.equal(saved.entity,before.entity);assert.equal(saved.actions[0].name,'Encender TV');assert.equal(saved.actions[0].color,'#234567');assert.deepEqual(plain(saved.signal_refs),plain(before.signal_refs));assert.equal(h.confirmation(),undefined);assert.equal(h.calls.length,1);assert.ok(!Object.hasOwn(h.calls[0][1],'entity_renames'));
}

// A collision reported by HA is a recoverable form error. It must not leave the
// candidate model active, force a page reload or prevent correcting the draft.
{
 const h=harness(),light=h.device().rows[1].cells[0],before=JSON.stringify(h.scope.model);h.edit(light.id);
 await h.control('[data-entity-edit]').click();h.control('#entity-suffix').value='identificador_ocupado';await h.control('#entity-accept').click();
 h.scope.rejectSave=Object.assign(new Error('La entidad ya existe en Home Assistant.'),{code:'invalid_model'});
 let saving=h.button('Guardar cambios').click();await tick();await h.confirmation().querySelector('[data-confirm]').click();await saving;
 assert.equal(h.scope.saveFailed,false);assert.equal(h.scope.modal.open,true);assert.equal(JSON.stringify(h.scope.model),before);assert.equal(h.control('#form-error').hidden,false);assert.match(h.control('#form-error').textContent,/ya existe/);
 h.scope.rejectSave=null;await h.control('[data-entity-edit]').click();h.control('#entity-suffix').value='identificador_libre';await h.control('#entity-accept').click();
 saving=h.button('Guardar cambios').click();await tick();await h.confirmation().querySelector('[data-confirm]').click();await saving;
 assert.equal(h.calls.length,2);assert.equal(h.scope.saveFailed,false);assert.equal(h.device().rows[1].cells[0].id,light.id);assert.equal(h.device().rows[1].cells[0].entity,'button.identificador_libre');
}

// Version 1.0.0 could retain inactive independent commands on a custom folder
// or an ordinary learned button. Cosmetic editing must keep those hidden
// canonical entities and captures, even though neither currently executes them.
for(const kind of ['custom-folder','learned-button']){
 const h=harness(),wire=exportModel(h.scope.model),device=wire.emitters[0].devices[0],slot=device.studio.rows[1].cells,original=structuredClone(slot[0]);
 const latent={id:randomUUID(),type:'button',action:'learned',name:'Automático conservado',icon:'fan',color:'#56c4ed',showName:true,value:'auto',state_effect:{fan:'auto'},entity:'button.latent_'+kind.replaceAll('-','_'),signal_refs:{press:'retained-latent-'+kind},signals:{press:true}};
 device.studio.type='stateful';
 slot[0]=kind==='custom-folder'?{id:randomUUID(),type:'group',group:'custom',action:'open_group',name:'Opciones',icon:'folder',color:'#56c4ed',showName:true,sendMode:'settings',children:[original],independentActions:[latent]}:{...original,independentActions:[latent]};
 device.functions.push({key:latent.id,name:latent.name,icon:latent.icon,color:latent.color,showName:true,type:'button',entity:latent.entity,signal_refs:structuredClone(latent.signal_refs),signals:{press:true},state_effect:{fan:'auto'},on:null});
 device.layout.rows.push({id:randomUUID(),type:'buttons',columns:1,height:1,cells:[latent.id]});
 for(const fn of device.functions)fn.signals=Object.fromEntries(Object.keys(fn.signal_refs).map(signal=>[signal,true]));
 h.scope.model=importModel(wire);h.scope.confirmedWire=structuredClone(wire);
 const current=h.device().rows[1].cells[0],before=structuredClone(current),identities=model=>exportModel(model).emitters[0].devices[0].functions.map(fn=>[fn.key,fn.type,fn.entity,fn.signal_refs,fn.state_effect]).sort(([left],[right])=>left.localeCompare(right)),canonicalBefore=plain(identities(h.scope.model));
 h.edit(current.id);await h.change('#button-name','Nombre renovado','input');await h.change('#button-color','#345678','input');await h.button('Guardar cambios').click();
 const saved=h.device().rows[1].cells[0];assert.equal(saved.id,before.id);assert.equal(saved.name,'Nombre renovado');assert.equal(saved.color,'#345678');
 assert.deepEqual(plain(saved.independentActions.map(node=>[node.id,node.entity,node.signal_refs,node.state_effect])),plain(before.independentActions.map(node=>[node.id,node.entity,node.signal_refs,node.state_effect])),kind+' retains dormant commands');
 assert.deepEqual(plain(identities(h.scope.model)),canonicalBefore);assert.equal(h.confirmation(),undefined);assert.equal(h.calls.length,1);assert.ok(!Object.hasOwn(h.calls[0][1],'entity_renames'));
}
console.log('Real control editor: enabled TV selectors, confirmed replacements, draft-only cancellation, preserved cosmetic identities and explicit entity renames passed.');
