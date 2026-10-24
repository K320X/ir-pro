import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createI18n,normalizeLanguage,panelLanguage,hassLanguage,refreshBindings,isLocalizedServerError} from '../custom_components/ir_pro/frontend/ir-pro-i18n.js';
import {template,styles} from '../custom_components/ir_pro/frontend/ir-pro-theme.js';
import {messages} from '../custom_components/ir_pro/frontend/ir-pro-translations.js';
import {controlledStateFields,recordStateFields,projectState,findSavedState} from '../custom_components/ir_pro/frontend/ir-pro-model.js';
import {controlEditorHarness,Element} from './frontend-control-editor.mjs';

const placeholders=text=>(text.match(/\{[a-zA-Z][\w]*\}/g)||[]).sort();
const plain=value=>JSON.parse(JSON.stringify(value));
const source=readFileSync(new URL('../custom_components/ir_pro/frontend/ir-pro-controller.js',import.meta.url),'utf8');
const extract=name=>{
 const start=[source.indexOf('  function '+name+'('),source.indexOf('  async function '+name+'(')].filter(index=>index>=0).sort((a,b)=>a-b)[0];
 const closing=/\n  }\r?(?=\n|$)/g;closing.lastIndex=start+1;const end=(closing.exec(source)?.index??-5)+4;
 assert.ok(start>=0&&end>start,name);return source.slice(start,end);
};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

// Home Assistant selects the UI language; region variants never require their
// own catalog and unsupported languages receive the complete English panel.
for(const language of ['es','es-ES','es-MX','ES_ar',' ES '])assert.equal(normalizeLanguage(language),'es',String(language));
for(const language of ['en','en-GB','fr','de','estonian','',null,undefined])assert.equal(normalizeLanguage(language),'en',String(language));
assert.equal(panelLanguage('es-ES'),'es');assert.equal(hassLanguage({language:'es-MX',locale:{language:'en'}}),'es');assert.equal(hassLanguage({locale:{language:'es'}}),'es');assert.equal(hassLanguage({language:'fr'}),'en');
for(const code of ['ambiguous_state','busy','command_failed','invalid_model','invalid_signal','learn_failed','revision_conflict','source_unavailable','storage_error','permission_denied','not_loaded'])assert.equal(isLocalizedServerError({code}),true,code);
for(const code of ['unknown_error','invalid_format','disconnected','future_native_error',null,undefined])assert.equal(isLocalizedServerError({code}),false,String(code));

assert.deepEqual(Object.keys(messages).sort(),['en','es']);
assert.deepEqual(Object.keys(messages.es).sort(),Object.keys(messages.en).sort(),'Every panel message has both translations');
assert.ok(Object.keys(messages.es).length>100,'The complete panel catalog is covered');
for(const [key,text]of Object.entries(messages.es)){
 assert.equal(typeof text,'string',key);assert.ok(text.trim(),key);assert.equal(typeof messages.en[key],'string',key);assert.ok(messages.en[key].trim(),key);
 assert.deepEqual(placeholders(messages.en[key]),placeholders(text),'Interpolation contract '+key);
}
for(const module of ['ir-pro-controller.js','ir-pro-panel.js','ir-pro-pickers.js']){
 const code=readFileSync(new URL('../custom_components/ir_pro/frontend/'+module,import.meta.url),'utf8');
 const literalCalls=/\b(?:t|h|toast|formError|showModal)\(("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*(?=,|\))/g;
 for(const [,literal]of code.matchAll(literalCalls)){
  const key=vm.runInNewContext(literal);assert.ok(Object.hasOwn(messages.es,key),module+' UI source is registered: '+key);assert.ok(Object.hasOwn(messages.en,key),module+' English translation exists: '+key);
 }
}

for(const language of ['es','en']){
 const locale=createI18n(language);
 for(const key of Object.keys(messages.es)){
  assert.equal(locale.t(key),messages[language][key],language+' '+key);
  const params=Object.fromEntries(placeholders(messages.es[key]).map(token=>[token.slice(1,-1),'IR salón_12']));
  assert.deepEqual(placeholders(locale.t(key,params)),[],'Every placeholder resolves in '+language+' '+key);
 }
 assert.equal(locale.number(24.5,{maximumFractionDigits:1}),language==='es'?'24,5':'24.5');
 assert.equal(locale.number(53.64,{maximumFractionDigits:1}),language==='es'?'53,6':'53.6');
 const identifier='switch.ir_salon_tv_de_prueba_encender_apagar';assert.equal(locale.t(identifier),identifier,'Entity identifiers are not translated');
 const custom='Mi luz · calor 24 ºC';assert.equal(locale.t(custom),custom,'Unknown user text is preserved');
 assert.equal(locale.error(new Error('Private exception with server internals')),locale.t('No se ha podido completar la operación.'));
 assert.equal(locale.error({code:'future_native_error',message:'Private exception with server internals'}),locale.t('No se ha podido completar la operación.'));
 assert.equal(locale.error({code:'unknown_error',message:'Private exception with server internals',irProLocalized:true,irProLanguage:language}),locale.t('No se ha podido completar la operación.'));
 assert.equal(locale.error({code:'invalid_model',message:'Trusted localized validation',irProLocalized:true,irProLanguage:language}),'Trusted localized validation');
 assert.equal(locale.error({code:'command_failed',message:'Trusted localized command failure',irProLocalized:true,irProLanguage:language}),'Trusted localized command failure');
 assert.equal(locale.error({message:'A stale response in the old language',irProLocalized:true,irProLanguage:language==='es'?'en':'es'}),locale.t('No se ha podido completar la operación.'));
 assert.equal(locale.error({},'No se ha podido conectar con IR Pro.'),locale.t('No se ha podido conectar con IR Pro.'));
 assert.equal(locale.t('Acción {number}',{number:2}),language==='es'?'Acción 2':'Action 2');
 assert.equal(locale.t('Copiar entidad {entity}',{entity:identifier}),language==='es'?'Copiar entidad '+identifier:'Copy entity '+identifier);
 assert.equal(locale.t('Apunta al receptor y pulsa {key} en el mando original.',{key:{message:'Encender'}}),language==='es'?'Apunta al receptor y pulsa Encender en el mando original.':'Point at the receiver and press Turn on on the original remote.');
 assert.equal(locale.setLanguage(language==='es'?'es-MX':'fr'),false);assert.equal(locale.language,language);
}

console.log('Panel languages: region fallback, complete bilingual catalog, interpolation contracts and localized numeric formatting passed.');

{
 const root=new Element('root');root.innerHTML=template;const locale=createI18n('en');refreshBindings(root,locale);
 assert.equal(root.getElementById('entity-modal-title').textContent,locale.t('Cambiar nombre de la entidad'));
 assert.equal(root.getElementById('entity-cancel').textContent,locale.t('Cancelar'));assert.equal(root.getElementById('entity-accept').textContent,locale.t('Aceptar'));
 assert.equal(root.getElementById('sidebar-toggle').getAttribute('aria-label'),locale.t('Abrir menú de Home Assistant'));
 const input=new Element('input',{'data-ir-text':'["Nombre",{}]',value:'Nombre'}),textarea=new Element('textarea',{'data-ir-text':'["Nombre",{}]'}),custom=new Element('span');textarea.textContent='Mi borrador';custom.textContent='Nombre';root.appendChild(input);root.appendChild(textarea);root.appendChild(custom);
 const bad=new Element('span',{'data-ir-text':'not valid JSON'});bad.textContent='Keep';root.appendChild(bad);refreshBindings(root,locale);
 assert.equal(input.value,'Nombre');assert.equal(textarea.textContent,'Mi borrador');assert.equal(custom.textContent,'Nombre');assert.equal(bad.textContent,'Keep');
}

// Translate the actual editor's existing DOM, preserving its unsaved name,
// selected text, identity/captures and open nested entity editor. No reload,
// save, learning request or IR transmission is involved in a language change.
{
 const h=controlEditorHarness('es'),scope=h.scope,control=h.device().rows[1].cells[0];
 let refreshes=0,restores=0;scope.refreshAmbientReadings=()=>{refreshes++;};scope.captureScrollPosition=()=>()=>{restores++;};scope.lastAmbientSnapshot='before';
 vm.runInContext(extract('languageChanged'),scope);
 h.edit(control.id);await h.change('#button-name','Nombre','input');
 const name=h.control('#button-name'),modal=scope.modal,body=scope.modalBody,abort=scope.modalAbort,originalWire=plain(scope.confirmedWire);
 name.focus();name.selectionStart=1;name.selectionEnd=4;body.scrollTop=137;
 await h.control('[data-entity-edit]').click();const suffix=h.control('#entity-suffix');suffix.value='entidad_sin_guardar';suffix.selectionStart=3;suffix.selectionEnd=7;
 const entityModal=scope.entityModal,restoresBefore=restores;
 assert.equal(scope.locale.setLanguage('en-GB'),true);vm.runInContext('languageChanged()',scope);
 assert.equal(h.control('#button-name'),name);assert.equal(name.value,'Nombre');assert.deepEqual([name.selectionStart,name.selectionEnd],[1,4]);assert.equal(name.focused,true);
 assert.equal(scope.modal,modal);assert.equal(scope.modalBody,body);assert.equal(scope.modalAbort,abort);assert.equal(modal.open,true);assert.equal(body.scrollTop,137);
 assert.equal(scope.entityModal,entityModal);assert.equal(entityModal.open,true);assert.equal(h.control('#entity-suffix'),suffix);assert.equal(suffix.value,'entidad_sin_guardar');assert.deepEqual([suffix.selectionStart,suffix.selectionEnd],[3,7]);
 assert.equal(h.control('#modal-title').textContent,scope.locale.t('Editar función'));
 assert.ok(scope.modalFoot.textContent.includes(scope.locale.t('Guardar cambios')));assert.ok(scope.modalFoot.textContent.includes(scope.locale.t('Cancelar')));
 assert.deepEqual(plain(scope.confirmedWire),originalWire);assert.equal(h.device().rows[1].cells[0].name,control.name);assert.deepEqual(h.calls,[]);assert.equal(refreshes,1);assert.equal(restores,restoresBefore+1);
 const idsBefore=plain(h.device());assert.equal(scope.locale.setLanguage('es-MX'),true);vm.runInContext('languageChanged()',scope);assert.deepEqual(plain(h.device()),idsBefore);assert.deepEqual(h.calls,[]);
 assert.equal(h.control('#modal-title').textContent,'Editar función');assert.equal(name.value,'Nombre');assert.equal(suffix.value,'entidad_sin_guardar');
}

// Numeric bindings and accessibility text are updated in place. User strings
// that happen to equal a UI phrase remain ordinary content and stay untouched.
{
 const h=controlEditorHarness('es'),scope=h.scope,root=scope.root;
 scope.refreshAmbientReadings=()=>{};scope.lastAmbientSnapshot='';vm.runInContext(extract('languageChanged'),scope);
 const fixture=new Element();root.appendChild(fixture);
 fixture.innerHTML=vm.runInContext('h("Humedad")+numberHTML(53.6,{maximumFractionDigits:1})+"<button"+attr("aria-label","Editar función")+attr("title","Oscilación")+">Personal</button><span class=user-name>Nombre</span>"',scope);
 const number=fixture.querySelector('[data-ir-number]'),button=fixture.querySelector('button'),user=fixture.querySelector('.user-name');
 assert.equal(number.textContent,'53,6');scope.locale.setLanguage('en');vm.runInContext('languageChanged()',scope);
 assert.equal(fixture.querySelector('[data-ir-number]'),number);assert.equal(number.textContent,'53.6');assert.equal(button.getAttribute('aria-label'),scope.locale.t('Editar función'));assert.equal(button.getAttribute('title'),scope.locale.t('Oscilación'));assert.equal(user.textContent,'Nombre');
}

console.log('Live language changes retain editor and entity drafts, input selection, modal sessions, model identities and captures while updating explicit text, attributes and numbers.');

{
 const h=controlEditorHarness('es'),scope=h.scope;scope.refreshAmbientReadings=()=>{};scope.lastAmbientSnapshot='';vm.runInContext(extract('languageChanged'),scope);h.edit(h.device().rows[1].cells[0].id);
 scope.failure={code:'unknown_error',message:'Private server detail'};vm.runInContext('formError(failure,"No se ha podido probar la señal.")',scope);const error=h.control('#form-error');
 assert.equal(error.textContent,scope.locale.t('No se ha podido probar la señal.'));assert.ok(!error.textContent.includes('Private'));
 scope.locale.setLanguage('en');vm.runInContext('languageChanged()',scope);assert.equal(h.control('#form-error'),error);assert.equal(error.textContent,scope.locale.t('No se ha podido probar la señal.'));
 scope.locale.setLanguage('es');scope.failure={code:'invalid_model',message:'Validación localizada del servidor',irProLocalized:true,irProLanguage:'es'};vm.runInContext('formError(failure,"Revisa la configuración de la función.")',scope);assert.equal(error.textContent,'Validación localizada del servidor');
 scope.locale.setLanguage('en');vm.runInContext('languageChanged()',scope);assert.equal(error.textContent,scope.locale.t('Revisa la configuración de la función.'));assert.deepEqual(h.calls,[]);
}

// Every action selector and dynamically added folder child renders in the
// chosen language, while model values remain stable protocol identifiers.
{
 const h=controlEditorHarness('en'),scope=h.scope,control=h.device().rows[1].cells[0];h.edit(control.id);
 assert.equal(h.device().rows[0].cells[1].name,scope.locale.t('Encender/apagar'));assert.deepEqual(h.device().rows[0].cells[1].actions.map(side=>side.name),[scope.locale.t('Encender'),scope.locale.t('Apagar')]);
 vm.runInContext('globalThis.newClimate=newRemote("Nombre elegido por mí","air-vent");',scope);assert.equal(scope.newClimate.name,'Nombre elegido por mí');assert.equal(scope.newClimate.rows[1].cells[0].name,scope.locale.t('Modo'));assert.equal(scope.newClimate.rows[1].cells[2].name,scope.locale.t('Ventilador'));assert.equal(scope.newClimate.rows[2].cells[1].name,scope.locale.t('Oscilación'));
 assert.deepEqual(Array.from(scope.newClimate.rows[2].cells[1].independentActions,child=>child.name),[1,2,3,4,5,6].map(number=>scope.locale.t('Posición {number}',{number})).concat(scope.locale.t('Oscilación'),scope.locale.t('Desactivado')));
 assert.equal(h.control('#modal-title').textContent,scope.locale.t('Editar función'));
 for(const option of h.control('#button-action').children.filter(child=>child.tagName==='OPTION')){
  const raw=messages.es[Object.keys(messages.es).find(key=>messages.en[key]===option.textContent)];assert.ok(raw,'Translated action option '+option.value);assert.equal(option.textContent,scope.locale.t(raw));
 }
 assert.equal(h.control('#button-action').value,'learned');await h.change('#function-type','group');await h.control('#add-folder-child').click();
 assert.equal(h.control('[data-child-action]').value,'learned');assert.ok(h.control('[data-child-action]').querySelectorAll('option').some(option=>option.value==='send_state'&&option.textContent===scope.locale.t('Enviar señal de ajustes del mando')));
 const childName=h.control('[data-child-name]');childName.value='Oscilación personalizada';await childName.emit('input');await h.button(scope.locale.t('Cancelar')).click();assert.deepEqual(h.calls,[]);
}

// A language switch during the real asynchronous capture keeps the operation
// and its user-edited name alive. Completion uses the new language once, then
// can be saved without changing the captured IR reference or state settings.
{
 const h=controlEditorHarness('es'),scope=h.scope;
 Object.assign(scope,{controlledStateFields,recordStateFields,projectState,findSavedState,operation:0,viewedSavedStateId:null,lastAmbientSnapshot:'',refreshAmbientReadings(){},allEntityRecords:()=>[]});
 vm.runInContext(['configurationLabel','proposedStateEntity','learnState','languageChanged'].map(extract).join('\n'),scope);
 vm.runInContext('globalThis.d=newRemote("Split de pruebas","air-vent");d.state.power=true;globalThis.model={version:1,selected:d.id,emitters:[{id:"capture-emitter",sourceId:"capture-source",name:"IR salón",devices:[d]}]};ensureModelEntities();',scope);
 let resolveCapture,learnCalls=0,saves=0;
 scope.api.call=async(action,data)=>{assert.equal(action,'learn');learnCalls++;return new Promise(resolve=>{resolveCapture=resolve;});};scope.persist=async()=>{saves++;return true;};
 vm.runInContext('learnState(d)',scope);await tick();
 const name=h.control('#state-record-name'),status=h.control('#state-learn-status'),modal=scope.modal,abort=scope.modalAbort,state=plain(scope.d.state),before=plain(scope.model);
 name.value='Nombre personalizado';await name.emit('input');name.focus();name.selectionStart=2;name.selectionEnd=7;scope.modalBody.scrollTop=92;
 assert.equal(scope.signalBusy,true);assert.equal(learnCalls,1);const token=scope.operation;
 scope.locale.setLanguage('en');vm.runInContext('languageChanged()',scope);
 assert.equal(scope.signalBusy,true);assert.equal(scope.operation,token);assert.equal(scope.modal,modal);assert.equal(scope.modalAbort,abort);assert.equal(modal.open,true);assert.equal(h.control('#state-record-name'),name);assert.equal(name.value,'Nombre personalizado');assert.deepEqual([name.selectionStart,name.selectionEnd],[2,7]);assert.equal(scope.modalBody.scrollTop,92);assert.equal(learnCalls,1);assert.equal(saves,0);assert.deepEqual(plain(scope.model),before);
 assert.ok(status.textContent.includes(scope.locale.t('Escuchando el mando original')));
 resolveCapture({captured:true,signal_ref:'exact-captured-reference'});await tick();
 assert.equal(scope.signalBusy,false);assert.equal(learnCalls,1);assert.equal(h.control('#state-learn-status'),status);assert.ok(status.textContent.includes(scope.locale.t('Señal recibida')));
 await h.button(scope.locale.t('Guardar estado')).click();assert.equal(saves,1);assert.equal(scope.d.savedStates.length,1);assert.equal(scope.d.savedStates[0].name,'Nombre personalizado');assert.equal(scope.d.savedStates[0].signal.id,'exact-captured-reference');assert.deepEqual(plain(scope.d.state),state);assert.equal(scope.modal.open,false);
}

console.log('English action/folder editors and an active real IR capture keep protocol values, unsaved names and the exact learned signal through language changes.');

// Execute the real custom panel class against a native-markup adapter. Only
// the already tested controller mount is stubbed here, so HA language changes,
// API payloads, loading/error lifecycles and preservation of its live instance
// are decisions made by production code.
const panelSource=readFileSync(new URL('../custom_components/ir_pro/frontend/ir-pro-panel.js',import.meta.url),'utf8');
function panelHarness(language='es'){
 const requests=[],subscriptions=[],mounts=[],counts={changed:0,ambient:0,disposed:0,colorsDisposed:0};let fail=null;
 class Host {
  constructor(){this.isConnected=false;}
  attachShadow(){return this.shadowRoot=new Element('shadow-root');}
  toggleAttribute(){}dispatchEvent(){}
 }
 const controller={languageChanged(){counts.changed++;},hassChanged(){counts.ambient++;},dispose(){counts.disposed++;}};
 const globals={HTMLElement:Host,customElements:{get:()=>false,define(){}},AbortController,CustomEvent:class {},template,styles,createI18n,hassLanguage,refreshBindings,isLocalizedServerError,
  mountColorControls:()=>()=>{counts.colorsDisposed++;},mountStudio(...args){mounts.push(args);return controller;}};
 vm.createContext(globals);vm.runInContext(panelSource.replace(/^import .*;\r?\n/gm,'')+'\nglobalThis.Panel=IRProPanel;',globals);
 const panel=new globals.Panel();
 const hass=next=>({language:next,user:{is_admin:true},states:{'sensor.ambient':{state:'24.5',attributes:{unit_of_measurement:'°C'}}},
  connection:{subscribeMessage:async(handler,message)=>{subscriptions.push({handler,message:plain(message)});return ()=>{};}},
  callWS:async message=>{requests.push(plain(message));if(fail)throw fail;return {model:{version:2,emitters:[]},catalog:[],revision:4,version:'test'};}});
 panel.hass=hass(language);
 return {panel,requests,subscriptions,mounts,counts,controller,hass,fail(error){fail=error;}};
}
{
 const h=panelHarness('es-ES'),{panel}=h;panel.isConnected=true;await panel._load();assert.equal(h.mounts.length,1);const [root,api,,,,locale]=h.mounts[0];
 assert.equal(locale.language,'es');assert.equal(root.getAttribute('lang'),'es');assert.equal(panel._controller,h.controller);assert.deepEqual(h.requests,[{type:'ir_pro/get',language:'es'}]);
 const subscription=()=>{};await api.subscribe(subscription);assert.deepEqual(h.subscriptions[0],{handler:subscription,message:{type:'ir_pro/subscribe',language:'es'}});
 await api.call('save',{expected_revision:4,model:{version:2,emitters:[]}});assert.deepEqual(h.requests.at(-1),{type:'ir_pro/save',expected_revision:4,model:{version:2,emitters:[]},language:'es'});
 const oldController=panel._controller,oldRoot=root,oldApi=api,oldLocale=locale,count=h.requests.length;
 panel.hass=h.hass('en-GB');assert.equal(panel._controller,oldController);assert.equal(h.mounts.length,1);assert.equal(h.mounts[0][0],oldRoot);assert.equal(h.mounts[0][1],oldApi);assert.equal(h.mounts[0][5],oldLocale);assert.equal(locale.language,'en');assert.equal(root.getAttribute('lang'),'en');assert.equal(h.counts.changed,1);assert.equal(h.counts.ambient,1);assert.equal(h.counts.disposed,0);assert.equal(h.requests.length,count,'Changing language never reloads, saves or emits a command');
 for(const language of ['en','en-US','fr','de'])panel.hass=h.hass(language);assert.equal(h.counts.changed,1);assert.equal(h.mounts.length,1);assert.equal(h.requests.length,count);
 await api.call('get');assert.deepEqual(h.requests.at(-1),{type:'ir_pro/get',language:'en'});await api.subscribe(subscription);assert.deepEqual(h.subscriptions.at(-1).message,{type:'ir_pro/subscribe',language:'en'});
 const fresh=h.hass('en');fresh.states['sensor.ambient'].state='25.6';panel.hass=fresh;assert.equal(api.entity('sensor.ambient'),fresh.states['sensor.ambient']);assert.equal(api.state('sensor.ambient'),'25.6');assert.equal(api.available('sensor.ambient'),true);fresh.states['sensor.ambient'].state='unavailable';assert.equal(api.available('sensor.ambient'),false);assert.equal(api.available('sensor.missing'),false);
 h.fail({code:'invalid_model',message:'English validation error'});await assert.rejects(api.call('save'),error=>error.code==='invalid_model'&&error.irProLocalized===true&&error.irProLanguage==='en'&&locale.error(error)==='English validation error');
 h.fail({code:'unknown_error',message:'Private native error'});await assert.rejects(api.call('get'),error=>error.irProLocalized===false&&locale.error(error)===locale.t('No se ha podido completar la operación.'));
}
{
 const h=panelHarness('es');h.panel.isConnected=true;await h.panel._load();const api=h.mounts[0][1],locale=h.mounts[0][5];let reject;
 h.panel._hass.callWS=()=>new Promise((resolve,no)=>{reject=no;});const pending=api.call('get');h.panel.hass=h.hass('en');reject({code:'invalid_model',message:'Respuesta antigua en español'});
 await assert.rejects(pending,error=>error.irProLanguage==='es'&&error.irProLocalized===true&&locale.error(error)===locale.t('No se ha podido completar la operación.'));assert.equal(h.mounts.length,1);
}
{
 const h=panelHarness('en');h.fail({code:'connection_failed',message:'Server internals should never be displayed'});h.panel.isConnected=true;await h.panel._load();
 assert.equal(h.mounts.length,0);assert.equal(h.panel._loading,false);assert.ok(h.panel._loadError);assert.equal(h.panel.shadowRoot.getElementById('load-error').textContent,h.panel._locale.t('No se ha podido conectar con IR Pro.'));assert.ok(!h.panel.shadowRoot.textContent.includes('Server internals'));
 const before=h.requests.length;for(let i=0;i<15;i++)h.panel.hass=h.hass('en-US');assert.equal(h.requests.length,before,'A failed initial load does not retry on every HA sensor update');
 h.panel.hass=h.hass('es-MX');assert.equal(h.requests.length,before);assert.equal(h.panel.shadowRoot.querySelector('[data-retry-load]').textContent,h.panel._locale.t('Volver a intentar'));
 h.fail(null);await h.panel.shadowRoot.querySelector('[data-retry-load]').click();assert.equal(h.mounts.length,1);assert.equal(h.requests.at(-1).language,'es');
}
console.log('Real HA panel language integration retains its controller/API/state access, sends current language on WS actions/subscriptions, and does not reload or retry on sensor notifications.');
