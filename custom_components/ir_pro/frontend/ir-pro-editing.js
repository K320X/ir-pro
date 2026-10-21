import {independentStateEffect,linkedActionEffect} from './ir-pro-model.js?v=1.0.1';

const metadata=['entity','_existingType','on','signals','signal_refs'];
const collections=['children','independentActions','learnedActions'];
const descendants=node=>collections.flatMap(key=>(node[key]||[]).filter(child=>child&&typeof child==='object'));
const effectFor=node=>node.type==='button'&&node.action==='learned'?independentStateEffect(node):null;
const contract=node=>JSON.stringify([
  node.type,
  node.type==='button'&&node.action==='learned'?'button':node.type==='dual'&&node.actions?.length===2&&node.actions.every(side=>side.action==='learned')&&!node.learnedActions?.length?'switch':null,
  node.type==='group'?node.group:null,
  effectFor(node),
  node.action_index??null
]);

// One editor owns its replacement identities. Re-rendering or returning to the
// original contract must not silently create another entity or discard a capture.
export function createControlEditor(original,makeId) {
  const baseline=new Map(),origins=new Map(),variants=new Map();
  const remember=node=>{
    if(!node||typeof node!=='object')return;
    baseline.set(node.id,structuredClone(node));origins.set(node.id,node.id);
    descendants(node).forEach(remember);
  };
  remember(original);
  return {prepare(draft){
    const prepared=structuredClone(draft);
    const visit=node=>{
      const source=origins.get(node.id)||node.id,signature=contract(node);
      // A newly added control can receive a capture before its first save. Its
      // first contract needs the same protection as an already registered one.
      if(!baseline.has(source))remember(node);
      const before=baseline.get(source);
      if(before){
        const reverted=signature===contract(before),variant=source+'\0'+signature;
        if(!reverted&&!variants.has(variant)){const id=makeId();variants.set(variant,id);origins.set(id,source);}
        const id=reverted?source:variants.get(variant);
        if(node.id!==id){
          metadata.forEach(key=>delete node[key]);node.id=id;
          if(reverted){
            for(const key of metadata)if(Object.hasOwn(before,key))node[key]=structuredClone(before[key]);
            for(const key of collections){
              if(Object.hasOwn(before,key))node[key]=structuredClone(before[key]);else delete node[key];
            }
          }
        }
      }
      const effect=effectFor(node);
      if(effect)node.state_effect=effect;else delete node.state_effect;
      descendants(node).forEach(visit);
    };
    visit(prepared);return prepared;
  }};
}

export function controlNeedsState(node) {
  if(!node||typeof node!=='object')return false;
  return node.type==='display'||!!independentStateEffect(node)||!!linkedActionEffect(node)||
    node.type==='group'&&['mode','fan','swing'].includes(node.group)||
    node.type==='dual'&&(node.actions||[]).some(side=>!!linkedActionEffect(side))||
    descendants(node).some(controlNeedsState);
}
