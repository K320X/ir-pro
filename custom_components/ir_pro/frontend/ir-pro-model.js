// The server owns entities and learned signal references. Studio rows are UI metadata.
const clone=value=>structuredClone(value);
const nodes=device=>{
  const result=[];
  const visit=node=>{if(!node)return;result.push(node);if(node.type==='group'&&node.group==='custom')(node.children||[]).forEach(visit);};
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
      functions.push({key:node.id,name:node.name,showName:node.showName!==false,icon:node.icon||'remote',color:node.color||'#56c4ed',type:old?.type||type,entity:old?.entity||node.entity,signals:{},signal_refs:clone(refs||{}),on:old?.on??null});
    };
    for(const node of nodes(device)) {
      if(node.type==='button'&&(device.type==='simple'||node.action==='learned'))add(node,'button',node.signal_refs||{});
      else if(node.type==='dual'&&(device.type==='simple'||node._existingType==='switch'))add(node,'switch',node.signal_refs||{});
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
      if(!expected||JSON.stringify(node.signal_refs||{})===JSON.stringify(expected.get(node.id)?.signal_refs||{})){node.signal_refs=clone(fn.signal_refs||{});node.signals=clone(fn.signals||{});}
      if(node.type==='dual'&&target.type==='simple')node.activeSide=fn.on===true?1:0;
    }}
    for(const record of target.savedStates||[]){const fn=canonical.get(record.id);if(fn){record.entity=fn.entity;if(!expected||(record.signal?.id||null)===(expected.get(record.id)?.signal_refs?.press||null)){record.signal_refs=clone(fn.signal_refs||{});record.signal=fn.signals?.press&&fn.signal_refs?.press?{kind:'learned',id:fn.signal_refs.press}:null;}}}
  }
}
