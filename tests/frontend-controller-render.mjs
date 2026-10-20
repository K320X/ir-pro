import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {styles} from '../custom_components/ir_pro/frontend/ir-pro-theme.js';
import {exportModel} from '../custom_components/ir_pro/frontend/ir-pro-model.js';
import {icon as renderIcon} from '../custom_components/ir_pro/frontend/ir-pro-icons.js';

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
const context={app,view:'remote',saveFailed:true,actionError:'',editing:false,model:{emitters:[],selected:'rolled-back-device'},ensureModelEntities(){},captureScrollPosition:()=>()=>{},refreshAmbientReadings(){},lastAmbientSnapshot:'',lastRenderedRoute:'',queueMicrotask(){},flushDeferredEnvelope(){},glyph:()=>'',esc:value=>value??''};
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
assert.match(source,/hassChanged\(\)\{refreshAmbientReadings\(\);\}/,'HA state updates must only patch ambient values, preserving the existing view and alerts');

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

const captureContext={viewedSavedStateId:null,savedStateFor:()=>null,configurationKey:JSON.stringify,configurationLabel:()=> 'Apagado',esc:String,glyph:()=>'',stateTable:()=>'',d:{state:{power:false},savedStates:[]}};
vm.createContext(captureContext);vm.runInContext(extract('stateCapturePanel'),captureContext);
const captureHTML=vm.runInContext('stateCapturePanel(d)',captureContext);
assert.match(captureHTML,/data-learn-state>Aprender estado<\/button>/);
assert.ok(!captureHTML.includes('Aprender este estado del mando original'));

// Unknown combinations prepare the UI without a request. An unexpected backend
// invalid_signal for an apparently learned state must remain a real inline error.
let sends=0,learned=false,sendFailure=null;
const sendContext={d:{id:'remote',state:fresh.state},configurationCopy:state=>({...state}),render(){},toast(){},clearActionError(){},savedStateFor:()=>learned?{signal:{kind:'learned',id:'real'}}:null,persist:async after=>{try{return await after();}catch(error){sendFailure=error;return false;}},api:{call:async()=>{sends++;throw {code:'invalid_signal',message:'Referencia perdida'};}}};
vm.createContext(sendContext);vm.runInContext(extract('commitState'),sendContext);
assert.equal(await vm.runInContext("commitState(d,'Preparado',true)",sendContext),false);assert.equal(sends,0);
learned=true;assert.equal(await vm.runInContext("commitState(d,'Enviar',true)",sendContext),false);assert.equal(sends,1);assert.equal(sendFailure.code,'invalid_signal');
console.log('Frontend rendering, quiet accessible feedback, state remote defaults, canonical entities and unlearned-send guards passed.');

// Official state folders render the current state without rewriting their name,
// chosen color, configured icon, state identity or learned references.
const symbolContext={editing:false,esc:String,glyph:name=>'<glyph data-name="'+name+'"></glyph>',dualPowerLinked:()=>false,dualStateIndex:()=>0};
vm.createContext(symbolContext);
const options=source.slice(source.indexOf('  const modes ='),source.indexOf('  const symbols ='));
const clampDefinition=source.split('\n').find(line=>line.trimStart().startsWith('const clamp ='));
const modeDefinition=source.split('\n').find(line=>line.trimStart().startsWith('const currentMode ='));
vm.runInContext(clampDefinition+'\n'+options+'\n'+modeDefinition+'\n'+extract('buttonSymbol')+'\n'+extract('buttonHTML'),symbolContext);
const stateRemote={type:'stateful',state:{power:false,mode:'heat',temperature:24,fan:'auto',swing:'off'}};
const stateFolder={id:'folder',type:'group',group:'fan',name:'Mi ventilador',icon:'settings',color:'#ad68cb',showName:true,fanSpeedCount:5};
symbolContext.d=stateRemote;symbolContext.b=stateFolder;symbolContext.r={id:'row'};
const originalFolder=JSON.stringify(stateFolder);
const symbol=()=>vm.runInContext('buttonSymbol(d,b)',symbolContext);
assert.equal(symbol(),'auto');
for(const [level,value] of ['low','medium','high','speed_4','speed_5'].entries()){
 stateRemote.state.fan=value;assert.equal(symbol(),'fan-speed-5-'+(level+1));
}
stateFolder.fanSpeedCount=2;stateRemote.state.fan='speed_5';assert.equal(symbol(),'fan-speed-5-5');assert.equal(stateFolder.fanSpeedCount,2);
stateRemote.state.fan='low';assert.equal(symbol(),'fan-speed-2-1');
stateFolder.fanSpeedCount=5;stateRemote.state.fan='auto';assert.equal(JSON.stringify(stateFolder),originalFolder);
for(const [value,expected] of [['cool','snowflake'],['heat','sun'],['dry','droplet'],['fan','fan'],['auto','auto']]){
 stateFolder.group='mode';stateRemote.state.mode=value;assert.equal(symbol(),expected);
}
stateFolder.group='swing';
for(const value of ['off','auto',...Array.from({length:6},(_,i)=>'position_'+(i+1))]){
 stateRemote.state.swing=value;assert.equal(symbol(),value==='off'?'swing-off':value==='auto'?'swing':'swing-'+value.replace('_','-'));
}
stateRemote.state.swing='position_2';
let folderHTML=vm.runInContext('buttonHTML(d,b,r,0)',symbolContext);
assert.match(folderHTML,/data-name="swing-position-2"/);assert.match(folderHTML,/aria-label="Mi ventilador"/);assert.match(folderHTML,/--button-color:#ad68cb/);assert.match(folderHTML,/title="Oscilación posición 2"/);assert.match(folderHTML,/>Mi ventilador<\/span>/);
symbolContext.editing=true;folderHTML=vm.runInContext('buttonHTML(d,b,r,0)',symbolContext);assert.match(folderHTML,/Editar carpeta/);assert.match(folderHTML,/data-name="swing-position-2"/);
stateFolder.group='custom';stateFolder.name='Ventilador';assert.equal(symbol(),'settings');
stateFolder.group='fan';stateRemote.type='simple';assert.equal(symbol(),'settings');
stateRemote.type='stateful';stateFolder.type='button';assert.equal(symbol(),'settings');
assert.match(source,/symbol=buttonSymbol\(d,draft,visual\)/,'Editing preview uses the same state symbol as the remote');

// Position IDs and labels remain stable; only their pictograms reverse. One is
// vertical/down and six is horizontal/up, with one active ray per fixed position.
const expectedRays=['M17 13V21','M15.146 12.706 12.674 20.315','M13.473 11.854 8.771 18.326','M12.146 10.527 5.674 15.229','M11.294 8.854 3.685 11.326','M11 7H3'];
for(let position=1;position<=6;position++){
 const rays=[...renderIcon('swing-position-'+position).matchAll(/<path d="([^"]+)"([^>]*)\/>/g)].slice(1);
 assert.equal(rays.length,6);assert.deepEqual(rays.filter(([,path,attrs])=>!attrs.includes('opacity')).map(([,path])=>path),[expectedRays[position-1]]);
 assert.equal(rays.filter(([,path,attrs])=>attrs.includes('opacity=".18"')).length,5);
}
assert.equal([...renderIcon('swing').matchAll(/<path /g)].length,7);
assert.ok(!renderIcon('swing').includes('opacity'));
assert.equal([...renderIcon('swing-off').matchAll(/<path /g)].length,1);
console.log('Live folder icons, unchanged labels/colors, editing preview and six reversed swing pictograms passed.');
