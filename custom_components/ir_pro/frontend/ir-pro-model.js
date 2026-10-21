// The server owns entities and learned signal references. Studio rows are UI metadata.
const clone=value=>structuredClone(value);
export const STATE_FIELDS=['power','mode','temperature','fan','swing'];
export function linkedActionEffect(action) {
  if(action?.action==='power_on'||action?.action==='power_off')return {power:action.action==='power_on'};
  if(action?.action==='temp_up'||action?.action==='temp_down')return {temperature_delta:action.action==='temp_up'?1:-1};
  if(action?.action==='swing')return {swing_toggle:true};
  const field={set_mode:'mode',set_fan:'fan',set_swing:'swing'}[action?.action];
  return field?independentStateEffect({state_effect:{[field]:action.value}}):null;
}
export function actionStateField(action) {
  const key=Object.keys(linkedActionEffect(action)||{})[0];
  return key==='temperature_delta'?'temperature':key==='swing_toggle'?'swing':key;
}
export function controlledStateFields(device,state=device.state) {
  const independent=new Set();
  const visit=node=>{
    if(!node)return;
    if(node.sendMode==='independent'){
      if(node.type==='group'&&['mode','fan','swing'].includes(node.group))independent.add(node.group);
      else if(node._existingType!=='switch')for(const action of node.type==='dual'?node.actions||[]:[node]){const field=actionStateField(action);if(field)independent.add(field);}
    }
    if(node.type==='group'&&node.group==='custom')(node.children||[]).forEach(visit);
  };
  for(const row of device.rows||[])if(row.type==='buttons')(row.cells||[]).forEach(visit);
  if(!state?.power&&!independent.has('power'))return ['power'];
  return STATE_FIELDS.filter(field=>!independent.has(field));
}
export function recordStateFields(record) {
  if(!Object.hasOwn(record,'controlled_fields'))return record?.settings?.power===false?['power']:[...STATE_FIELDS];
  const fields=record.controlled_fields;
  if(!Array.isArray(fields)||!fields.length||new Set(fields).size!==fields.length||fields.some(field=>!STATE_FIELDS.includes(field)))return null;
  return STATE_FIELDS.filter(field=>fields.includes(field));
}
export function projectState(state,fields=STATE_FIELDS) {
  if(fields.includes('power')&&state.power===false)return {power:false};
  return Object.fromEntries(fields.map(field=>[field,field==='swing'?(state.swing===true?'auto':state.swing===false?'off':state.swing):state[field]]));
}
export function scopedStateKey(state,fields) {
  if(fields.includes('power')&&state.power===false)return '[false]';
  const settings=projectState(state,fields);
  return JSON.stringify(fields.map(field=>[field,field==='temperature'&&fields.includes('mode')&&['dry','fan'].includes(settings.mode)?null:settings[field]]));
}
export function stateRecordMatches(record,state,fields) {
  const stored=recordStateFields(record);
  return !!stored&&JSON.stringify(stored)===JSON.stringify(fields)&&scopedStateKey(record.settings,stored)===scopedStateKey(state,fields);
}
export function findSavedState(device,state=device.state,fields=controlledStateFields(device,state)) {
  if(!fields.length)return undefined;
  const matches=(device.savedStates||[]).filter(record=>stateRecordMatches(record,state,fields));
  const explicit=matches.filter(record=>Object.hasOwn(record,'controlled_fields'));
  const candidates=explicit.length?explicit:matches;
  return candidates.length===1?candidates[0]:undefined;
}
// Independent actions describe one confirmed change, never a complete state.
export function independentStateEffect(node) {
  const effect=node?.state_effect;
  if(!effect||typeof effect!=='object'||Array.isArray(effect)||Object.keys(effect).length!==1)return null;
  const [key]=Object.keys(effect),value=effect[key];
  if(key==='power')return typeof value==='boolean'?{power:value}:null;
  if(key==='temperature_delta')return Number.isInteger(value)&&Math.abs(value)===1?{temperature_delta:value}:null;
  if(key==='swing_toggle')return value===true?{swing_toggle:true}:null;
  const allowed={mode:['cool','heat','dry','fan','auto'],fan:['auto','low','medium','high','speed_4','speed_5'],swing:['off','auto',...Array.from({length:6},(_,index)=>'position_'+(index+1))]};
  return Object.hasOwn(allowed,key)&&allowed[key].includes(value)?{[key]:value}:null;
}
const nodes=device=>{
  const result=[];
  const visit=node=>{if(!node)return;result.push(node);if(node.type==='group'&&node.group==='custom')(node.children||[]).forEach(visit);(node.independentActions||[]).forEach(visit);(node.learnedActions||[]).forEach(visit);};
  (device.rows||[]).filter(row=>row.type==='buttons').forEach(row=>(row.cells||[]).forEach(visit));
  return result;
};
export function importModel(wire,selected='') {
  const model={version:1,emitters:[],selected};
  for(const emitter of wire.emitters||[]) {
    const target={...clone(emitter),devices:[]};
    for(const device of emitter.devices||[]) {
      const metadata=device.studio||{};
      const result={id:device.id,name:device.name,icon:device.icon||'remote',type:metadata.type||'simple',state:{power:false,mode:'cool',temperature:24,fan:'auto',swing:'off',...metadata.state},rows:clone(metadata.rows||[]),savedStates:clone(metadata.savedStates||[]),_functions:clone(device.functions||[])};
      const canonical=new Map(result._functions.map(fn=>[fn.key,fn]));
      if(!result.rows.length) {
        const buttons=new Map(result._functions.map(fn=>[fn.key,{id:fn.key,name:fn.name,showName:fn.showName!==false,icon:fn.icon||'remote',color:fn.color||'#56c4ed',type:fn.type==='switch'?'dual':'button',action:'learned',...(fn.type==='switch'?{actions:[{name:'Apagado',icon:fn.icon||'power-off',color:fn.color||'#ff8b80',showName:fn.showName!==false,action:'learned'},{name:'Encendido',icon:fn.icon||'power',color:fn.color||'#6cd9a2',showName:fn.showName!==false,action:'learned'}]}:{})}]));
        const placed=new Set();
        for(const row of device.layout?.rows||[])result.rows.push({id:row.id,type:'buttons',height:row.height||2,columns:row.columns||1,cells:(row.cells||[]).map(key=>{const node=buttons.get(key);if(node&&!placed.has(key)){placed.add(key);return node;}return null;})});
        for(const [key,node] of buttons)if(!placed.has(key))result.rows.push({id:'row-'+key,type:'buttons',height:2,columns:1,cells:[node]});
        if(!result.rows.length)result.rows.push({id:'row-'+device.id,type:'buttons',height:2,columns:1,cells:[null]});
      }
      const represented=new Set(nodes(result).map(node=>node.id).concat(result.savedStates.map(record=>record.id)));
      for(const fn of result._functions)if(!represented.has(fn.key)){
        const node={id:fn.key,name:fn.name,showName:fn.showName!==false,icon:fn.icon||'remote',color:fn.color||'#56c4ed',type:fn.type==='switch'?'dual':'button',action:'learned'};
        if(fn.type==='switch')node.actions=[{name:'Apagado',icon:fn.icon||'power-off',color:fn.color||'#ff8b80',showName:fn.showName!==false,action:'learned'},{name:'Encendido',icon:fn.icon||'power',color:fn.color||'#6cd9a2',showName:fn.showName!==false,action:'learned'}];
        result.rows.push({id:'legacy-'+fn.key,type:'buttons',columns:1,height:2,cells:[node]});
      }
      for(const node of nodes(result)) {
        const fn=canonical.get(node.id);if(!fn)continue;
        node.entity=fn.entity;node.signal_refs=clone(fn.signal_refs||{});node.signals=clone(fn.signals||{});node.on=fn.on;node._existingType=fn.type;
        if(independentStateEffect(fn))node.state_effect=clone(fn.state_effect);
        if(node.type==='dual'){node.activeSide=fn.on===true?1:0;node.actions?.forEach((side,index)=>{side.signal=node.signal_refs[index===0?'on':'off']?{kind:'learned',id:node.signal_refs[index===0?'on':'off']}:null;});}
      }
      for(const record of result.savedStates){const fn=canonical.get(record.id);record.entity=fn?.entity||record.entity;record.signal_refs=clone(fn?.signal_refs||{});record.signal=fn?.signals?.press&&record.signal_refs.press?{kind:'learned',id:record.signal_refs.press}:null;}
      target.devices.push(result);
    }
    model.emitters.push(target);
  }
  return model;
}
export function exportModel(model) {
  return {version:2,emitters:model.emitters.map(emitter=>({id:emitter.id,sourceId:emitter.sourceId,name:emitter.name,model:emitter.model||'',devices:emitter.devices.map(device=>{
    const previous=new Map((device._functions||[]).map(fn=>[fn.key,fn]));
    const functions=[],seen=new Set();
    const add=(node,type,refs)=>{
      if(seen.has(node.id))return;seen.add(node.id);
      const old=previous.get(node.id);
      const effect=independentStateEffect(node)||independentStateEffect(old);
      functions.push({key:node.id,name:node.name,showName:node.showName!==false,icon:node.icon||'remote',color:node.color||'#56c4ed',type:old?.type||type,entity:old?.entity||node.entity,signals:{},signal_refs:clone(refs||{}),on:old?.on??null,...(effect?{state_effect:effect}:{})});
    };
    for(const node of nodes(device)) {
      if(node.type==='button'&&node.action==='learned')add(node,'button',node.signal_refs||{});
      else if(node.type==='dual'&&(node._existingType==='switch'||(!(node.learnedActions||[]).length&&node.actions?.length===2&&node.actions.every(side=>side.action==='learned'))))add(node,'switch',node.signal_refs||{});
    }
    for(const record of device.savedStates||[])add(record,'button',record.signal?.kind==='learned'?{press:record.signal.id}:record.signal_refs||{});
    const studio={type:device.type,state:clone(device.state),rows:clone(device.rows),savedStates:clone(device.savedStates||[]).map(record=>({...record,signal_refs:record.signal?.kind==='learned'?{press:record.signal.id}:record.signal_refs||{}}))};
    const placed=new Set();
    const layoutRows=device.rows.filter(row=>row.type==='buttons').map(row=>({id:row.id,columns:row.columns,height:row.height,cells:row.cells.map(node=>{if(seen.has(node?.id)&&!placed.has(node.id)){placed.add(node.id);return node.id;}return null;})}));
    // Canonical layout also indexes learned children and state entities. Their
    // visible placement is independently described by studio rows.
    for(const fn of functions)if(!placed.has(fn.key)){placed.add(fn.key);layoutRows.push({id:'layout-'+fn.key,columns:1,height:2,cells:[fn.key]});}
    if(!layoutRows.length)layoutRows.push({id:'layout-'+device.id,columns:1,height:2,cells:[null]});
    return {id:device.id,name:device.name,icon:device.icon,functions,studio,layout:{heightScale:'square-at-two',rows:layoutRows}};
  })}))};
}
export function reconcileCanonical(model,wire,requested) {
  const expected=requested?new Map(requested.emitters.flatMap(emitter=>emitter.devices.flatMap(device=>device.functions)).map(fn=>[fn.key,fn])):null;
  for(const emitter of wire.emitters||[])for(const device of emitter.devices||[]) {
    const target=model.emitters.flatMap(item=>item.devices).find(item=>item.id===device.id);if(!target)continue;
    target._functions=clone(device.functions||[]);
    const canonical=new Map(target._functions.map(fn=>[fn.key,fn]));
    for(const node of nodes(target)){const fn=canonical.get(node.id);if(fn){node.entity=fn.entity;node._existingType=fn.type;node.on=fn.on;
      if(independentStateEffect(fn))node.state_effect=clone(fn.state_effect);
      if(!expected||JSON.stringify(node.signal_refs||{})===JSON.stringify(expected.get(node.id)?.signal_refs||{})){node.signal_refs=clone(fn.signal_refs||{});node.signals=clone(fn.signals||{});}
      if(node.type==='dual'&&fn.type==='switch')node.activeSide=fn.on===true?1:0;
    }}
    for(const record of target.savedStates||[]){const fn=canonical.get(record.id);if(fn){record.entity=fn.entity;if(!expected||(record.signal?.id||null)===(expected.get(record.id)?.signal_refs?.press||null)){record.signal_refs=clone(fn.signal_refs||{});record.signal=fn.signals?.press&&fn.signal_refs?.press?{kind:'learned',id:fn.signal_refs.press}:null;}}}
  }
}
