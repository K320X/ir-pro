import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {styles} from '../custom_components/ir_pro/frontend/ir-pro-theme.js';
import {exportModel} from '../custom_components/ir_pro/frontend/ir-pro-model.js';

// Execute the actual controller render functions. This catches reentrant routing
// after a failed creation; a separate implementation of render would miss it.
const source=readFileSync(new URL('../custom_components/ir_pro/frontend/ir-pro-controller.js',import.meta.url),'utf8');
const extract=name=>{
  const start=[source.indexOf('  function '+name+'('),source.indexOf('  async function '+name+'(')].filter(index=>index>=0).sort((a,b)=>a-b)[0];
  const next=/\n  (?:async )?function /g;next.lastIndex=start+1;const end=next.exec(source)?.index??source.length;
  assert.ok(start>=0&&end>start,'Controller function '+name+' is present');
  return source.slice(start,end);
};
const renderCode=['renderRemote','renderHome','render','clearActionError','handleActionError'].map(extract).join('\n');
let warningCount=0,actionErrorCount=0,html='';
const app={
  set innerHTML(value){html=value;warningCount=0;actionErrorCount=0;},
  querySelector(selector){return selector==='[data-save-failure]'&&warningCount?{}:null;},
  insertAdjacentHTML(position,value){assert.equal(position,'afterbegin');html=value+html;if(value.includes('data-save-failure'))warningCount++;if(value.includes('data-action-error'))actionErrorCount++;}
};
const context={app,view:'remote',saveFailed:true,actionError:'',editing:false,model:{emitters:[],selected:'rolled-back-device'},ensureModelEntities(){},glyph:()=>'',esc:value=>value??''};
context.selected=()=>context.model.emitters.flatMap(emitter=>emitter.devices).find(device=>device.id===context.model.selected);
context.emitterFor=id=>context.model.emitters.find(emitter=>emitter.devices.some(device=>device.id===id));
vm.createContext(context);vm.runInContext(renderCode,context);

// A failed new remote no longer exists in the confirmed model. Route to home
// before rendering, while retaining exactly one persistent save failure alert.
vm.runInContext('render();',context);
assert.equal(context.view,'home');assert.equal(warningCount,1);assert.match(html,/Emisores/);assert.match(html,/Recargar panel/);
vm.runInContext('render();',context);assert.equal(warningCount,1);

// Existing remote failures and repeated HA updates keep the same single alert.
const remote={id:'existing',name:'Split salón',type:'simple',icon:'remote',rows:[]};
context.model={emitters:[{id:'emitter',name:'IR salón',model:'RM4 mini',devices:[remote]}],selected:remote.id};context.view='remote';
vm.runInContext('render();render();',context);assert.equal(warningCount,1);assert.match(html,/Split salón/);
assert.match(source,/hassChanged\(\)[^\n]*render\(\);/,'HA state updates must preserve the save failure alert');

context.saveFailed=false;vm.runInContext('render();',context);assert.equal(warningCount,0);
vm.runInContext("handleActionError({code:'service_unavailable',message:'El emisor no está disponible.'});",context);
assert.equal(actionErrorCount,1);assert.equal(context.saveFailed,false);assert.match(html,/El emisor no está disponible/);
vm.runInContext('render();',context);assert.equal(actionErrorCount,1);
vm.runInContext("handleActionError({code:'invalid_signal',message:'Este estado no tiene señal.'});",context);
assert.equal(actionErrorCount,1);assert.equal(context.saveFailed,false);
vm.runInContext("handleActionError({message:'Fallo de conexión'});clearActionError();",context);assert.equal(actionErrorCount,0);

// Informational feedback remains an aria-live announcement, without a visible
// lower notification or hidden=true that would silence assistive technology.
const classes=new Set(['visible','show']);
const notice={textContent:'',hidden:true,classList:{remove(...names){names.forEach(name=>classes.delete(name));},add(name){classes.add(name);}}};
context.$=selector=>selector==='#toast'?notice:null;context.toastTimer=null;context.clearTimeout=()=>{};context.setTimeout=()=>1;
vm.runInContext(extract('toast')+"\ntoast('Entidad copiada.');",context);
assert.equal(notice.textContent,'Entidad copiada.');assert.equal(notice.hidden,false);assert.ok(classes.has('sr-only'));assert.ok(!classes.has('visible'));assert.ok(!classes.has('show'));
const primaryRules=styles.match(/\.btn\.primary(?::hover)?\{[^}]*\}/g);
assert.ok(primaryRules?.length);assert.ok(primaryRules.filter(rule=>rule.includes('color:')).every(rule=>rule.includes('color:#0f1721')));

// Run the real factory, keeping preexisting remotes untouched. Only the learned
// accessory creates an entity; display, folders and dual power are state controls.
const beforeFactory=JSON.stringify(context.model);context.uid=randomUUID;
const constructors=source.slice(source.indexOf('  const button ='),source.indexOf('  function validateDevice'));
vm.runInContext(constructors+"\nglobalThis.freshRemote=newRemote('Aire nuevo','wind','stateful');",context);
const fresh=JSON.parse(JSON.stringify(context.freshRemote));assert.equal(JSON.stringify(context.model),beforeFactory);
assert.deepEqual(fresh.state,{power:false,mode:'cool',temperature:24,fan:'auto',swing:'off'});
assert.equal(fresh.rows[0].type,'display');assert.equal(fresh.rows[0].style,'modern');assert.equal(fresh.rows[0].accent,'#f4f6f8');
assert.deepEqual(fresh.rows.slice(1).map(row=>row.cells.map(node=>node?.name||null)),[['Modo','Encendido del aire','Ventilador'],['Bajar','Oscilación','Subir'],[null,'Luz',null]]);
const dual=fresh.rows[1].cells[1],fan=fresh.rows[1].cells[2],swing=fresh.rows[2].cells[1],light=fresh.rows[3].cells[1];
assert.equal(dual.type,'dual');assert.deepEqual(dual.actions.map(action=>[action.name,action.icon,action.action]),[['Apagado','power-off','power_on'],['Encendido','power','power_off']]);
assert.equal(fan.fanSpeedCount,5);assert.equal(fan.fanAuto,true);assert.equal(swing.swingPositionCount,6);assert.equal(swing.swingAuto,true);assert.equal(swing.swingOff,true);
light.entity='button.ir_salon_aire_nuevo_luz';
const wire=exportModel({version:1,emitters:[{id:'new-emitter',sourceId:'source',name:'IR salón',model:'RM4 mini',devices:[fresh]}]});
assert.equal(wire.emitters[0].devices[0].functions.length,1);assert.equal(wire.emitters[0].devices[0].functions[0].key,light.id);assert.equal(wire.emitters[0].devices[0].functions[0].type,'button');
assert.ok(!source.includes('Mando con ajustes'));
vm.runInContext(extract('displayAccent'),context);
assert.equal(vm.runInContext("displayAccent('#b9c9b0')",context),'#f4f6f8');
assert.equal(vm.runInContext("displayAccent('#B9C9B0')",context),'#f4f6f8');
assert.equal(vm.runInContext("displayAccent('#f4f6f8')",context),'#f4f6f8');
assert.equal(vm.runInContext("displayAccent('#c6b5ff')",context),'#c6b5ff');
assert.match(source,/draft\.accent=displayAccent\(draft\.accent\)/,'Editing must show the same resolved color in its picker and preview');

// Unknown combinations prepare the UI without a request. An unexpected backend
// invalid_signal for an apparently learned state must remain a real inline error.
let sends=0,learned=false,sendFailure=null;
const sendContext={d:{id:'remote',state:fresh.state},configurationCopy:state=>({...state}),render(){},toast(){},clearActionError(){},savedStateFor:()=>learned?{signal:{kind:'learned',id:'real'}}:null,persist:async after=>{try{return await after();}catch(error){sendFailure=error;return false;}},api:{call:async()=>{sends++;throw {code:'invalid_signal',message:'Referencia perdida'};}}};
vm.createContext(sendContext);vm.runInContext(extract('commitState'),sendContext);
assert.equal(await vm.runInContext("commitState(d,'Preparado',true)",sendContext),false);assert.equal(sends,0);
learned=true;assert.equal(await vm.runInContext("commitState(d,'Enviar',true)",sendContext),false);assert.equal(sends,1);assert.equal(sendFailure.code,'invalid_signal');
console.log('Frontend rendering, quiet accessible feedback, state remote defaults, canonical entities and unlearned-send guards passed.');
