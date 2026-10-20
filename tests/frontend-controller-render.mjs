import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {styles} from '../custom_components/ir_pro/frontend/ir-pro-theme.js';

// Execute the actual controller render functions. This catches reentrant routing
// after a failed creation; a separate implementation of render would miss it.
const source=readFileSync(new URL('../custom_components/ir_pro/frontend/ir-pro-controller.js',import.meta.url),'utf8');
const extract=name=>{
  const start=source.indexOf('  function '+name+'('),end=source.indexOf('\n  function ',start+1);
  assert.ok(start>=0&&end>start,'Controller function '+name+' is present');
  return source.slice(start,end);
};
const renderCode=['renderRemote','renderHome','render'].map(extract).join('\n');
let warningCount=0,html='';
const app={
  set innerHTML(value){html=value;warningCount=0;},
  querySelector(selector){return selector==='[data-save-failure]'&&warningCount?{}:null;},
  insertAdjacentHTML(position,value){assert.equal(position,'afterbegin');html=value+html;warningCount++;}
};
const context={app,view:'remote',saveFailed:true,editing:false,model:{emitters:[],selected:'rolled-back-device'},ensureModelEntities(){},glyph:()=>'',esc:value=>value??''};
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
const primaryRules=styles.match(/\.btn\.primary(?::hover)?\{[^}]*\}/g);
assert.ok(primaryRules?.length);assert.ok(primaryRules.filter(rule=>rule.includes('color:')).every(rule=>rule.includes('color:#0f1721')));
console.log('Frontend rendering: rollback routes without recursion, one persistent error banner, HA rerenders and primary text contrast passed.');
