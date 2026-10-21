import {icon} from './ir-pro-icons.js?v=1.0.0';
import {importModel,exportModel,reconcileCanonical,independentStateEffect,linkedActionEffect,actionStateField,controlledStateFields,recordStateFields,projectState,scopedStateKey,stateRecordMatches,findSavedState} from './ir-pro-model.js?v=1.0.0';
import {mountIconPickers} from './ir-pro-pickers.js?v=1.0.0';
import {createModalScrollLock} from './ir-pro-modal-scroll.js?v=1.0.0';
export function mountStudio(root,api,initial,isAdmin,openMenu) {
  const scope=root.getRootNode(),lifecycle=new AbortController();
  let disposed=false,catalog=initial.catalog||[],revision=initial.revision||0,saveQueue=Promise.resolve(true),saveFailed=false,actionError='',signalBusy=false,independentSending=false,operation=0,pendingSaves=0,unsubscribe=null,lastAmbientSnapshot='',deferredEnvelope=null,scrollGeneration=0,inputGeneration=0,lastRenderedRoute='';

  'use strict';
  const app = scope.querySelector('#app');
  const modal = scope.querySelector('#modal');
  const modalBody = scope.querySelector('#modal-body');
  const modalFoot = scope.querySelector('#modal-foot');
  const entityModal = scope.querySelector('#entity-modal');
  const modalScroll = createModalScrollLock(root,lifecycle.signal);
  const $ = (query, scope = root.getRootNode()) => scope.querySelector(query);
  const $$ = (query, scope = root.getRootNode()) => Array.from(scope.querySelectorAll(query));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const glyph = name => name==='auto' ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><text x="12" y="19" text-anchor="middle" font-size="21" font-family="Arial,sans-serif">A</text></svg>' : typeof icon === 'function' ? icon(name) : '';
  const uid = () => {
    if(typeof crypto.randomUUID==='function')return crypto.randomUUID();
    const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  };
  const copy = value => JSON.parse(JSON.stringify(value));
  const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Math.round(Number(value)))) : fallback;
  const modes = [{value:'cool',name:'Frío',icon:'snowflake'},{value:'heat',name:'Calor',icon:'sun'},{value:'dry',name:'Deshumidificar',icon:'droplet'},{value:'fan',name:'Ventilación',icon:'fan'},{value:'auto',name:'Automático',icon:'auto'}];
  const fans = [{value:'auto',name:'Automático'},{value:'low',name:'Velocidad 1'},{value:'medium',name:'Velocidad 2'},{value:'high',name:'Velocidad 3'},{value:'speed_4',name:'Velocidad 4'},{value:'speed_5',name:'Velocidad 5'}];
  const fanChoices = folder => fans.filter((speed,index)=>index===0?folder.fanAuto!==false:index<=clamp(folder.fanSpeedCount,2,5,3));
  const fanDescription = value => 'Ventilador '+(fans.find(speed=>speed.value===value)?.name||value).toLowerCase().replace(/^velocidad /,'');
  const swingStates = [...Array.from({length:6},(_,i)=>({value:'position_'+(i+1),name:'Posición '+(i+1),icon:'swing-position-'+(i+1)})),{value:'auto',name:'Oscilación',icon:'swing'},{value:'off',name:'Desactivado',icon:'swing-off'}];
  const swingValue = state => state.swing===true?'auto':swingStates.some(option=>option.value===state.swing)?state.swing:'off';
  const swingDescription = state => 'Oscilación '+(swingValue(state)==='auto'?'automática':swingValue(state)==='off'?'desactivada':'posición '+swingValue(state).split('_')[1]);
  const swingChoices = folder => swingStates.filter(option=>option.value==='auto'?folder.swingAuto!==false:option.value==='off'?folder.swingOff!==false:Number(option.value.split('_')[1])<=clamp(folder.swingPositionCount,1,6,6));
  const symbols = [{value:'remote',name:'Mando'},{value:'power',name:'Encender'},{value:'power-off',name:'Apagar'},{value:'plus',name:'Más'},{value:'minus',name:'Menos'},{value:'snowflake',name:'Frío'},{value:'sun',name:'Calor'},{value:'droplet',name:'Deshumidificación'},{value:'fan',name:'Ventilador'},{value:'swing',name:'Oscilación'},{value:'wind',name:'Viento'},{value:'thermometer',name:'Temperatura'},{value:'folder',name:'Carpeta'},{value:'settings',name:'Ajustes'},{value:'moon',name:'Noche'},{value:'light',name:'Luz'},{value:'none',name:'Sin icono'}];
  const deviceIcons = [{value:'air-vent',name:'Aire acondicionado (split)'},{value:'wind',name:'Aire acondicionado'},{value:'tv',name:'Televisor'},{value:'remote',name:'Mando'},{value:'fan',name:'Ventilador'},{value:'light',name:'Iluminación'}];
  symbols.push(...[{value:'chevron-up',name:'Flecha arriba'},{value:'chevron-down',name:'Flecha abajo'},{value:'timer',name:'Temporizador'},{value:'timer-off',name:'Cancelar temporizador'},{value:'volume-2',name:'Volumen'},{value:'move-vertical',name:'Movimiento vertical'},{value:'move-horizontal',name:'Movimiento horizontal'},{value:'droplets',name:'Humedad'},{value:'lightbulb',name:'Bombilla'},{value:'zap',name:'Potencia'},{value:'leaf',name:'Ahorro'}]);
  symbols.push({value:'tv-input',name:'Fuente de televisión'},{value:'volume-off',name:'Silencio'});
  const actionOptions = [{value:'learned',name:'Enviar una señal aprendida'},{value:'power_on',name:'Encender'},{value:'power_off',name:'Apagar'},{value:'temp_up',name:'Subir temperatura'},{value:'temp_down',name:'Bajar temperatura'},{value:'set_mode',name:'Seleccionar un modo'},{value:'set_fan',name:'Seleccionar una velocidad'},{value:'set_swing',name:'Seleccionar posición u oscilación'},{value:'swing',name:'Activar o desactivar oscilación'}];
  const actionValueChoices = action => action==='set_mode'?modes:action==='set_fan'?fans:action==='set_swing'?swingStates:null;
  const actionValueLabel = action => action==='set_mode'?'Modo':action==='set_fan'?'Velocidad':'Posición u oscilación';
  const defaultActionValue = action => action==='set_mode'?'cool':['set_fan','set_swing'].includes(action)?'auto':'';
  const button = (name, symbol, action, color, value) => ({id:uid(),name,icon:symbol,action,color:color || '#56c4ed',showName:true,type:'button',value:value || ''});
  const group = (name, symbol, kind) => ({...button(name,symbol,'open_group'),type:'group',group:kind,sendMode:'settings',...(kind==='fan'?{fanSpeedCount:3,fanAuto:true}:kind==='swing'?{swingPositionCount:6,swingAuto:true,swingOff:true}:{}),children:['power_on','power_off','temp_up','temp_down','swing']});
  function officialGroupChoices(folder) {
    if(folder.group==='mode')return modes;
    if(folder.group==='fan')return fanChoices(folder).map(choice=>({...choice,icon:choice.value==='auto'?'auto':'fan-speed-'+clamp(folder.fanSpeedCount,2,5,3)+'-'+fans.indexOf(choice)}));
    return folder.group==='swing'?swingChoices(folder):[];
  }
  function independentChoices(control) {
    if(control.type==='group')return officialGroupChoices(control).map(choice=>({...choice,state_effect:{[control.group]:choice.value}}));
    if(control._existingType==='switch')return [];
    return (control.type==='dual'?control.actions||[]:[control]).flatMap((action,index)=>{
      const effect=linkedActionEffect(action);if(!effect)return [];
      const intent=action.action==='power_on'?'Encender':action.action==='power_off'?'Apagar':actionOptions.find(item=>item.value===action.action)?.name||action.name;
      return [{...action,name:['power_on','power_off'].includes(action.action)?intent:action.name,icon:action.action==='power_on'?'power':action.action==='power_off'?'power-off':action.icon,value:action.action.startsWith('set_')?action.value:action.action,action_index:index,state_effect:effect}];
    });
  }
  function independentActionFor(control,value,index) {
    const choice=independentChoices(control).find(item=>item.value===value&&(index===undefined||item.action_index===index));
    return choice&&(control.independentActions||[]).find(node=>node.value===value&&JSON.stringify(independentStateEffect(node))===JSON.stringify(choice.state_effect)&&(control.type==='group'||node.action_index===(index??0)));
  }
  function ensureIndependentActions(folder) {
    if(folder.sendMode!=='independent')return;
    if(!Array.isArray(folder.independentActions))folder.independentActions=[];
    for(const choice of independentChoices(folder))if(!independentActionFor(folder,choice.value,choice.action_index)){
      const symbol=symbols.some(item=>item.value===choice.icon)?choice.icon:folder.group==='swing'?'swing':folder.group==='fan'?'fan':'remote';
      folder.independentActions.push({...button(choice.name,symbol,'learned',choice.color||folder.color,choice.value),...(choice.action_index===undefined?{}:{action_index:choice.action_index}),state_effect:copy(choice.state_effect)});
    }
  }
  const row = (cells, columns = cells.length || 1) => ({id:uid(),type:'buttons',height:2,columns,cells});
  const displayRow = () => ({id:uid(),type:'display',height:2,width:3,style:'modern',accent:'#f4f6f8',fields:{temperature:true,mode:true,fan:true,swing:true,power:true}});
  const configurationCopy = s => s.power?{power:true,mode:s.mode,temperature:s.temperature,fan:s.fan,swing:swingValue(s)}:{power:false};
  const configurationKey = s => JSON.stringify(s.power?[true,s.mode,['dry','fan'].includes(s.mode)?null:s.temperature,s.fan,swingValue(s)]:[false]);
  const savedStateFor = (d,s=d.state,fields=controlledStateFields(d,s)) => findSavedState(d,s,fields);
  function configurationLabel(s,fields=['power','mode','temperature','fan','swing']) {
    if(fields.includes('power')&&s.power===false)return 'Apagado';
    return [fields.includes('power')?'Encendido':'',fields.includes('mode')?(modes.find(v=>v.value===s.mode)?.name||s.mode):'',fields.includes('temperature')&&!(fields.includes('mode')&&['dry','fan'].includes(s.mode))?s.temperature+' °C':'',fields.includes('fan')?fanDescription(s.fan):'',fields.includes('swing')?swingDescription(s):''].filter(Boolean).join(' · ');
  }
  const ambientFor = d => {
    const emitter=emitterFor(d.id),source=catalog.find(item=>item.id===emitter?.sourceId);
    const result={};for(const kind of ['humidity','temperature']){const reading=source?.ambient?.[kind];if(!reading)continue;const live=api.entity?.(reading.entity_id);result[kind]={state:live?.state??reading.state,unit:live?.attributes?.unit_of_measurement??reading.unit,entityId:reading.entity_id};}return result;
  };
  function ambientScalar(sensor,kind) {
    if(!sensor||sensor.available===false)return null;
    const raw=sensor.state;
    if(typeof raw!=='number'&&typeof raw!=='string')return null;
    if(typeof raw==='string'&&!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim()))return null;
    let value=Number(raw);if(!Number.isFinite(value))return null;
    const unit=String(sensor.unit||'').trim().toUpperCase();
    if(kind==='humidity')return unit==='%'&&value>=0&&value<=100?value:null;
    if(['°F','F'].includes(unit))value=(value-32)*5/9;
    else if(!['°C','C','℃'].includes(unit))return null;
    return value;
  }
  function ambientHTML(sensor,kind) {
    const value=ambientScalar(sensor,kind);if(value===null)return '';
    const label=kind==='humidity'?'Humedad':'Ambiente',unit=kind==='humidity'?'%':'°C';
    const formatted=new Intl.NumberFormat('es-ES',{maximumFractionDigits:1}).format(value)+' '+unit;
    return '<div class="display-ambient" aria-label="'+(kind==='humidity'?'Humedad':'Temperatura ambiente')+': '+esc(formatted)+'" title="'+esc(sensor.entityId||'')+'"><span class="ambient-label">'+glyph(kind==='humidity'?'droplet':'home')+'<span>'+label+'</span></span><span class="ambient-value">'+esc(formatted)+'</span></div>';
  }
  function dualActions(b,d) {
    const defaults=[
      {name:'Apagado',icon:'power-off',color:'#ff8b80',showName:true,action:d.type==='stateful'?'power_on':'learned',value:''},
      {name:'Encendido',icon:'power',color:'#6cd9a2',showName:true,action:d.type==='stateful'?'power_off':'learned',value:''}
    ];
    return defaults.map((fallback,index)=>{
      const side={...fallback,...b.actions?.[index]};
      side.name=String(side.name??fallback.name);
      delete side.text;
      side.color=/^#[0-9a-f]{6}$/i.test(side.color)?side.color:fallback.color;
      side.icon=symbols.some(symbol=>symbol.value===side.icon)?side.icon:fallback.icon;
      side.showName=side.showName!==false;
      if(!actionOptions.some(action=>action.value===side.action)||(d.type!=='stateful'&&side.action!=='learned'))side.action='learned';
      if(actionValueChoices(side.action)&&!actionValueChoices(side.action).some(option=>option.value===side.value))side.value=defaultActionValue(side.action);
      return side;
    });
  }
  function dualPowerLinked(d,b) {
    if(d.type!=='stateful')return false;
    const actions=dualActions(b,d).map(side=>side.action);
    return actions.includes('power_on')&&actions.includes('power_off');
  }
  function dualStateIndex(d,b) {
    if(dualPowerLinked(d,b))return dualActions(b,d).findIndex(side=>side.action===(d.state.power?'power_off':'power_on'));
    return b.activeSide===1?1:0;
  }
  const newRemote = (name, symbol) => {
    const climate = ['air-vent','wind'].includes(symbol);
    const d = {id:uid(),name,icon:symbol,type:climate?'stateful':'simple',state:{power:false,mode:'cool',temperature:24,fan:'auto',swing:'off'},rows:[]};
    const compactRow = (cells, columns = cells.length || 1) => ({...row(cells,columns),height:1});
    if (climate) {
      d.rows = [
        {...displayRow(),height:2,width:3,style:'modern',accent:'#ffffff',fields:{temperature:true,mode:true,fan:true,swing:true,power:true}},
        compactRow([
          {...group('Modo','snowflake','mode'),color:'#f2b636',sendMode:'settings'},
          {...button('Encendido/apagado','power','power_on','#6cd9a2'),type:'dual',sendMode:'settings',activeSide:0,actions:[
            {name:'Apagado',icon:'power-off',color:'#ff8b80',showName:true,action:'power_on',value:''},
            {name:'Encendido',icon:'power',color:'#6cd9a2',showName:true,action:'power_off',value:''}
          ]},
          {...group('Ventilador','fan','fan'),color:'#56c4ed',sendMode:'settings',fanSpeedCount:5,fanAuto:true}
        ]),
        compactRow([
          {...button('Bajar','minus','temp_down','#53eeb3'),sendMode:'settings'},
          {...group('Oscilación','swing','swing'),color:'#c6b5ff',sendMode:'independent',swingPositionCount:6,swingAuto:true,swingOff:true},
          {...button('Subir','plus','temp_up','#53eeb3'),sendMode:'settings'}
        ]),
        compactRow([button('Luz','light','learned','#fff8ad')],1)
      ];
    } else if (symbol === 'tv') {
      const power = {...button('Encender/apagar','power','learned','#6cd9a2'),type:'dual',activeSide:0,actions:[
        {name:'Encender',icon:'power',color:'#6cd9a2',showName:true,action:'learned',value:''},
        {name:'Apagar',icon:'power-off',color:'#ff8b80',showName:true,action:'learned',value:''}
      ]};
      const digit = value => button(String(value),'none','learned','#56c4ed');
      d.rows = [
        compactRow([null,power,null],3),
        compactRow([button('Volumen −','minus','learned','#53eeb3'),button('Silencio','volume-off','learned','#f2b636'),button('Volumen +','plus','learned','#53eeb3')]),
        compactRow([button('Canal −','chevron-down','learned','#56c4ed'),button('Fuente','tv-input','learned','#c6b5ff'),button('Canal +','chevron-up','learned','#56c4ed')]),
        compactRow([digit(1),digit(2),digit(3)]),
        compactRow([digit(4),digit(5),digit(6)]),
        compactRow([digit(7),digit(8),digit(9)]),
        compactRow([null,digit(0),null],3)
      ];
    } else {
      const folder = group('Opciones','folder','custom');
      folder.children = [button('Encender','power','learned','#6cd9a2'),button('Apagar','power-off','learned','#ff8b80')];
      d.rows = [compactRow([button('Encender','power','learned','#6cd9a2'),button('Apagar','power-off','learned','#ff8b80'),folder])];
    }
    for(const layoutRow of d.rows)for(const control of layoutRow.cells||[])if(control)ensureIndependentActions(control);
    return d;
  };

  function validateDevice(d) {
    if (!d || typeof d !== 'object' || typeof d.id !== 'string' || typeof d.name !== 'string' || !Array.isArray(d.rows)) return false;
    if (!['simple','stateful'].includes(d.type)) return false;
    d.state = {...{power:true,mode:'cool',temperature:24,fan:'auto',swing:false},...d.state};
    d.state.power = !!d.state.power; d.state.swing = swingValue(d.state);
    d.state.temperature = clamp(d.state.temperature,18,30,24);
    if (!modes.some(m=>m.value===d.state.mode)) d.state.mode='cool';
    if (!fans.some(f=>f.value===d.state.fan)) d.state.fan='auto';
    if(!Array.isArray(d.savedStates))d.savedStates=[];
    if(d.savedStates.some(record=>!record||typeof record.id!=='string'||typeof record.name!=='string'||!record.settings||!recordStateFields(record)||(recordStateFields(record).includes('power')&&typeof record.settings.power!=='boolean')))return false;
    d.savedStates.forEach(record=>{
      if(!record.signal||record.signal.kind!=='learned'||typeof record.signal.id!=='string')record.signal=null;
    });
    d.icon = deviceIcons.some(i=>i.value===d.icon) ? d.icon : 'remote';
    for (const r of d.rows) {
      if (!r || typeof r.id !== 'string' || !['display','buttons'].includes(r.type)) return false;
      r.height=clamp(r.height,1,4,2);
      if (r.type==='display') {
        r.height=clamp(r.height,2,4,2);
        r.width=clamp(r.width,3,6,3);
        r.style=['lcd','modern'].includes(r.style) ? r.style : 'lcd';
        r.fields={temperature:true,mode:true,fan:true,swing:true,power:true,...r.fields};
      } else {
        r.columns=clamp(r.columns,1,6,1);
        if (!Array.isArray(r.cells)) return false;
        if (r.cells.length>r.columns && r.cells.slice(r.columns).some(Boolean)) return false;
        r.cells=Array.from({length:r.columns},(_,i)=>r.cells[i] || null);
        for (const b of r.cells.filter(Boolean)) {
          if (typeof b.id!=='string' || typeof b.name!=='string') return false;
          b.color=/^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#56c4ed';
          b.showName=b.showName!==false;
          if(b.type==='switch') {
            b.actions=d.type==='stateful'&&['power_on','power_off'].includes(b.action)?dualActions({...b,actions:undefined},d):[{name:'Desactivado',icon:b.icon,color:b.color,showName:b.showName,action:'learned'},{name:'Activado',icon:b.icon,color:b.color,showName:b.showName,action:'learned'}];
            b.activeSide=b.on?1:0;b.type='dual';
          }
          b.type=['group','dual'].includes(b.type) ? b.type : 'button';
          if(d.type==='stateful'&&b.type==='button'&&b.action==='swing'&&b.icon==='wind'){b.type='group';b.group='swing';b.action='open_group';b.icon='swing';}
          if(b.type==='group'&&b.group==='fan'){b.fanSpeedCount=clamp(b.fanSpeedCount,2,5,3);b.fanAuto=b.fanAuto!==false;}
          if(b.type==='group'&&b.group==='swing'){b.swingPositionCount=clamp(b.swingPositionCount,1,6,6);b.swingAuto=b.swingAuto!==false;b.swingOff=b.swingOff!==false;if(b.icon==='wind')b.icon='swing';}
          if(b.type==='group'&&['mode','fan','swing'].includes(b.group))b.sendMode=b.sendMode==='independent'?'independent':'settings';
          if(b.type==='dual'){b.actions=dualActions(b,d);b.activeSide=b.activeSide===1?1:0;}
          if (!symbols.some(i=>i.value===b.icon)) b.icon='remote';
        }
      }
    }
    return true;
  }
  let model=importModel(initial.model||{version:2,emitters:[]}), view='home', editing=false, drag=null, dragGhost=null, touchDrag=null,touchGhost=null,suppressClickUntil=0,toastTimer, modalAbort, viewedSavedStateId=null;
  const landingGhosts=new Set();
  model.emitters.forEach(e=>e.devices.forEach(validateDevice));
  const selected = () => model.emitters.flatMap(e=>e.devices).find(d=>d.id===model.selected);
  const emitterFor = id => model.emitters.find(e=>e.devices.some(d=>d.id===id));
  let confirmedWire=copy(initial.model||{version:2,emitters:[]});
  function persist(afterSave) {
    if(!isAdmin){toast('Necesitas permisos de administrador para editar IR Pro.');return Promise.resolve(false);}
    ensureModelEntities();
    const snapshot=exportModel(model);
    pendingSaves++;
    saveQueue=saveQueue.then(async()=>{
      if(disposed||saveFailed)return false;
      try{
        const identities=new Map(confirmedWire.emitters.flatMap(emitter=>emitter.devices.flatMap(device=>device.functions)).map(fn=>[fn.key,fn]));
        for(const emitter of snapshot.emitters)for(const device of emitter.devices)for(const fn of device.functions){const existing=identities.get(fn.key);if(existing){fn.entity=existing.entity;fn.type=existing.type;}}
        const result=await api.call('save',{model:snapshot,expected_revision:revision});
        if(disposed)return false;
        revision=result.revision;catalog=result.catalog||catalog;confirmedWire=copy(result.model);reconcileCanonical(model,result.model,snapshot);
        if(result.notices?.length)toast(result.notices.join(' '));
        if(afterSave){try{const success=await afterSave();if(success)clearActionError();return success;}catch(error){if(!disposed)handleActionError(error);return false;}}
        return true;
      }catch(error){
        if(disposed)return false;
        saveFailed=true;model=importModel(confirmedWire,model.selected);editing=false;closeModal();render();
        toast((error.message||'No se han podido guardar los cambios.')+' Recarga el panel antes de continuar.');
        return false;
      }
    }).finally(()=>{pendingSaves--;flushDeferredEnvelope();});return saveQueue;
  }
  function queuePhysical(action) {
    pendingSaves++;
    saveQueue=saveQueue.then(async()=>{if(disposed||saveFailed)return false;try{const success=await action();if(success)clearActionError();return success;}catch(error){if(!disposed)handleActionError(error);return false;}}).finally(()=>{pendingSaves--;flushDeferredEnvelope();});
    return saveQueue;
  }
  function queueRequest(action) {
    let resolveRequest,rejectRequest;
    const request=new Promise((resolve,reject)=>{resolveRequest=resolve;rejectRequest=reject;});pendingSaves++;
    saveQueue=saveQueue.then(async()=>{
      if(disposed||saveFailed){rejectRequest(new Error('Recarga el panel antes de continuar.'));return false;}
      try{const result=await action();clearActionError();resolveRequest(result);return true;}catch(error){rejectRequest(error);return false;}
    }).finally(()=>{pendingSaves--;flushDeferredEnvelope();});
    return request;
  }
  function receiveEnvelope(envelope) {
    if(disposed||!envelope?.model)return;
    if(envelope.revision<revision){if(deferredEnvelope===envelope)deferredEnvelope=null;return;}
    catalog=envelope.catalog||catalog;
    refreshAmbientReadings();
    if(JSON.stringify(envelope.model)===JSON.stringify(confirmedWire)){
      if(!pendingSaves){revision=envelope.revision;deferredEnvelope=null;}
      return;
    }
    if(pendingSaves||modal.open||entityModal.open||editing||signalBusy||saveFailed){if(!deferredEnvelope||envelope.revision>=deferredEnvelope.revision)deferredEnvelope=envelope;return;}
    deferredEnvelope=null;
    revision=envelope.revision;confirmedWire=copy(envelope.model);model=importModel(envelope.model,model.selected);model.emitters.forEach(emitter=>emitter.devices.forEach(validateDevice));render();
  }
  function flushDeferredEnvelope() {if(deferredEnvelope&&!disposed&&!pendingSaves&&!modal.open&&!entityModal.open&&!editing&&!signalBusy&&!saveFailed)receiveEnvelope(deferredEnvelope);}
  const entitySlug = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,190) || 'funcion';
  const entityDomain = (d,b) => b._existingType|| (b.type==='dual'&&d.type==='simple'?'switch':b.type==='button'&&(d.type==='simple'||b.action==='learned')?'button':null);
  function automationButtons(d,root) {
    const result=[];
    const visit=b=>{if(!b||typeof b!=='object')return;if(entityDomain(d,b))result.push(b);if(b.type==='group'&&b.group==='custom')(b.children||[]).forEach(visit);(b.independentActions||[]).forEach(visit);};
    if(root)visit(root);else d.rows.filter(r=>r.type==='buttons').forEach(r=>r.cells.forEach(visit));
    return result;
  }
  const allAutomationButtons = () => model.emitters.flatMap(e=>e.devices.flatMap(d=>automationButtons(d)));
  const allEntityRecords = () => model.emitters.flatMap(e=>e.devices.flatMap(d=>automationButtons(d).concat(d.savedStates||[])));
  const proposedEntitySuffix = (d,b) => entitySlug([emitterFor(d.id)?.name,d.name,...Object.keys(independentStateEffect(b)||{}).map(key=>({mode:'modo',fan:'ventilador',swing:'oscilacion'})[key]),b.name].filter(Boolean).join('_'));
  function entityTaken(entity,id,d,root) {
    const previous=getButton(d,root.id)?.button;
    const replaced=new Set(previous?automationButtons(d,previous).map(b=>b.id):[]);
    return allEntityRecords().filter(b=>!replaced.has(b.id)).concat(automationButtons(d,root)).some(b=>b.id!==id&&b.entity===entity);
  }
  function ensureModelEntities() {
    let changed=false;
    const occupied=new Set(allEntityRecords().map(b=>b.entity).filter(Boolean));
    model.emitters.forEach(e=>e.devices.forEach(d=>automationButtons(d).map(b=>({b,domain:entityDomain(d,b)})).concat((d.savedStates||[]).map(b=>({b,domain:'button'}))).forEach(({b,domain})=>{
      if(new RegExp('^'+domain+'\\.[a-z0-9_]{1,240}$').test(b.entity||''))return;
      const stem=domain+'.'+proposedEntitySuffix(d,b);let entity=stem,n=2;
      while(occupied.has(entity))entity=stem+'_'+n++;
      b.entity=entity;occupied.add(entity);changed=true;
    })));
    return changed;
  }
  function toast(message) {
    const element=$('#toast'); if (!element) return;
    element.classList.remove('visible','show');element.classList.add('sr-only');element.hidden=false;element.textContent=message;
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>{element.textContent='';},4000);
  }
  function clearActionError() {if(actionError){actionError='';render();}}
  function handleActionError(error) {
    actionError=error?.message||'No se ha podido enviar la señal. Comprueba el emisor y vuelve a intentarlo.';render();
  }
  function captureScrollPosition(reset=false) {
    const generation=++scrollGeneration,interaction=inputGeneration,positions=[],seen=new Set();
    const remember=element=>{
      if(!element||seen.has(element)||typeof element.scrollTop!=='number')return;seen.add(element);
      if(element.scrollTop||element.scrollLeft||element.scrollHeight>element.clientHeight||element.scrollWidth>element.clientWidth)positions.push({element,top:reset?0:element.scrollTop,left:reset?0:element.scrollLeft});
    };
    let ancestor=root;while(ancestor){remember(ancestor);ancestor=ancestor.parentNode||ancestor.host;}
    remember(root.ownerDocument?.scrollingElement);root.querySelectorAll('*').forEach(remember);
    const restore=()=>{if(disposed||generation!==scrollGeneration||interaction!==inputGeneration)return;for(const {element,top,left} of positions)if(element.isConnected!==false){if(element.scrollTop!==top)element.scrollTop=top;if(element.scrollLeft!==left)element.scrollLeft=left;}};
    return ()=>{restore();requestAnimationFrame(restore);};
  }
  const selectOptions = (items,value) => items.map(item=>'<option value="'+esc(item.value)+'"'+(item.value===value?' selected':'')+'>'+esc(item.name)+'</option>').join('');
  const field = (label,html) => '<label class="field"><span>'+esc(label)+'</span>'+html+'</label>';
  const checkField = (key,label,checked) => '<label class="choice small"><input type="checkbox" name="'+esc(key)+'"'+(checked?' checked':'')+'> '+esc(label)+'</label>';
  function closeModal() {if (modal.open) modal.close();}
  function openNeutralDialog(dialog) {
    const heading=dialog.querySelector('.modal-head h2')||dialog;heading.tabIndex=-1;heading.setAttribute('autofocus','');dialog.setAttribute('autofocus','');
    const restoreScroll=captureScrollPosition();modalScroll.lock(dialog);
    try{dialog.showModal();heading.focus({preventScroll:true});restoreScroll();}catch(error){modalScroll.unlock(dialog);throw error;}
  }
  function showModal(title,body,buttons,setup) {
    if (modal.open) modal.close();
    modalAbort?.abort();modalAbort=new AbortController();
    $('#modal-title').textContent=title;modalBody.innerHTML=body;modalFoot.innerHTML='';
    const modalButtons=buttons || [{label:'Cerrar'}];
    $('#modal-close').hidden=modalButtons.some(config=>config.label==='Cancelar');
    for (const config of modalButtons) {
      const b=document.createElement('button');b.type='button';b.className='btn '+(config.className||'');b.textContent=config.label;
      b.addEventListener('click',async()=>{if(config.run){b.disabled=true;try{await config.run();}catch(error){formError(error.message||'No se ha podido completar la operación.');}finally{if(b.isConnected)b.disabled=false;}}else closeModal();},{signal:modalAbort.signal});modalFoot.appendChild(b);
    }
    openNeutralDialog(modal);setup?.();
  }
  $('#modal-close')?.addEventListener('click',closeModal);
  function bindBackdropClose(dialog) {
    let backdropPress=null;
    const outsideModal=event=>{const r=dialog.getBoundingClientRect();return event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom;};
    dialog.addEventListener('pointerdown',event=>{
    backdropPress=event.isPrimary&&event.button===0&&event.target===dialog&&outsideModal(event)?{id:event.pointerId,x:event.clientX,y:event.clientY,moved:false,released:false}:null;
  },true);
    dialog.addEventListener('pointermove',event=>{
    if(backdropPress?.id===event.pointerId&&Math.hypot(event.clientX-backdropPress.x,event.clientY-backdropPress.y)>8)backdropPress.moved=true;
  },true);
    dialog.addEventListener('pointerup',event=>{
    if(!backdropPress)return;
    if(backdropPress.id!==event.pointerId||backdropPress.moved||event.target!==dialog||!outsideModal(event)||Math.hypot(event.clientX-backdropPress.x,event.clientY-backdropPress.y)>8)backdropPress=null;
    else backdropPress.released=true;
  },true);
    dialog.addEventListener('pointercancel',()=>{backdropPress=null;},true);
    window.addEventListener('blur',()=>{backdropPress=null;},{signal:lifecycle.signal});
    dialog.addEventListener('close',()=>{backdropPress=null;});
    dialog.addEventListener('click',event=>{
    const press=backdropPress;backdropPress=null;
    if(press?.released&&event.target===dialog&&outsideModal(event))dialog.close();
  });
  }
  bindBackdropClose(modal);bindBackdropClose(entityModal);
  modal.addEventListener('close',()=>{if(entityModal.open)entityModal.close();queueMicrotask(flushDeferredEnvelope);});
  entityModal.addEventListener('close',()=>queueMicrotask(flushDeferredEnvelope));
  entityModal.addEventListener('cancel',event=>event.stopPropagation());
  const currentMode = state => modes.find(m=>m.value===state.mode) || modes[0];
  const temperatureAvailable = d => !['dry','fan'].includes(d.state.mode);
  const stateText = d => configurationLabel(d.state,controlledStateFields(d)).replace(/^Encendido(?: · )?/,'');
  function displayAccent(value) {return /^#[0-9a-f]{6}$/i.test(value||'')&&value.toLowerCase()!=='#b9c9b0'?value:'#f4f6f8';}
  function refreshAmbientReadings() {
    if(disposed)return;
    const displays=Array.from(root.querySelectorAll('.display-shell[data-display-device]'));
    const readings=new Map();
    for(const display of displays){const id=display.dataset.displayDevice;if(readings.has(id))continue;const device=model.emitters.flatMap(emitter=>emitter.devices).find(item=>item.id===id);if(!device)continue;const ambient=ambientFor(device);readings.set(id,{humidity:ambientHTML(ambient.humidity,'humidity'),temperature:ambientHTML(ambient.temperature,'temperature')});}
    const snapshot=JSON.stringify(Array.from(readings));if(snapshot===lastAmbientSnapshot)return;lastAmbientSnapshot=snapshot;
    for(const display of displays){const values=readings.get(display.dataset.displayDevice);if(!values)continue;for(const kind of ['humidity','temperature']){const slot=display.querySelector('[data-ambient-kind="'+kind+'"]');if(slot&&slot.innerHTML!==values[kind])slot.innerHTML=values[kind];}const container=display.querySelector('.display-readings'),hasAmbient=!!(values.humidity||values.temperature);if(container){container.classList.toggle('has-ambient',hasAmbient);container.hidden=!hasAmbient&&!display.querySelector('.display-target')?.hasChildNodes();}}
  }
  function displayHTML(d,r,preview=false) {
    const s=d.state,f=r.fields || {},mode=currentMode(s),hasState=d.type==='stateful',temperature=hasState&&temperatureAvailable(d)?s.temperature:'—';
    const power=f.power ? '<span class="chip display-power'+(hasState?(s.power?' power-on':' power-off'):'')+'">'+glyph(hasState?(s.power?'power':'power-off'):'info')+(hasState?(s.power?'Encendido':'Apagado'):'Sin datos vinculados')+'</span>' : '';
    const modePart=f.mode ? '<span class="display-item">'+glyph(hasState?mode.icon:'remote')+'<span>'+esc(hasState?mode.name:'Modo —')+'</span></span>' : '';
    const fansPart=f.fan ? '<span class="display-item">'+glyph('fan')+'<span>'+esc(hasState?(fans.find(v=>v.value===s.fan)?.name || 'Automático'):'Ventilador —')+'</span></span>' : '';
    const swing=swingStates.find(option=>option.value===swingValue(s)),swingLabel=hasState?swingDescription(s):'Oscilación —';
    const swingPart=f.swing&&(!hasState||swing.value!=='off') ? '<span class="display-item" role="img" aria-label="'+esc(swingLabel)+'" title="'+esc(swingLabel)+'">'+glyph(hasState?swing.icon:'swing')+'<span class="display-long">'+esc(swingLabel)+'</span><span class="display-short">'+(hasState?swing.name:'Oscilación —')+'</span></span>' : '';
    const accent=displayAccent(r.accent);
    const width=clamp(r.width,3,6,3),height=clamp(r.height,2,4,2);
    const canEdit=!preview&&editing;
    const readings=ambientFor(d);
    const humidity=ambientHTML(readings.humidity,'humidity'),ambient=ambientHTML(readings.temperature,'temperature');
    const hasAmbient=!!(humidity||ambient);
    const target=f.temperature?'<div class="display-main"><span class="display-value">'+esc(temperature)+'</span><span class="display-unit">°C</span></div><div class="preview-label small">'+(hasState?(temperatureAvailable(d)?'Objetivo':'Sin ajuste'):'Objetivo')+'</div>':'';
    return '<div class="display-shell '+esc(r.style||'lcd')+(s.power?'':' off-state')+(canEdit?' is-editable':'')+'" data-display-device="'+esc(d.id)+'" data-height="'+height+'" data-width="'+width+'" style="--display-accent:'+esc(accent)+';--level:'+height+';--display-width:'+(width*112+(width-1)*12)+'px;--display-height:'+(112+(height-2)*30)+'px">'+
      (canEdit?'<button type="button" class="display-edit-function" data-edit-display="'+esc(r.id)+'" aria-label="Editar función de pantalla"><span class="button-top">Editar función</span></button>':'')+
      '<div class="display-top">'+power+'</div>'+
      '<div class="display-readings'+(hasAmbient?' has-ambient':'')+'"'+(!target&&!hasAmbient?' hidden':'')+'><div class="display-ambient-slot" data-ambient-kind="humidity">'+humidity+'</div><div class="display-target">'+target+'</div><div class="display-ambient-slot" data-ambient-kind="temperature">'+ambient+'</div></div>'+
      '<div class="display-bottom">'+modePart+fansPart+swingPart+'</div></div>';
  }
  function buttonSymbol(d,b,visual=b) {
    if(d.type!=='stateful'||b.type!=='group')return visual.icon;
    if(b.group==='mode')return currentMode(d.state).icon;
    if(b.group==='fan'){
      const level=fans.findIndex(speed=>speed.value===d.state.fan);
      if(level===0)return 'auto';
      if(level>0)return 'fan-speed-'+Math.max(clamp(b.fanSpeedCount,2,5,3),level)+'-'+level;
    }
    if(b.group==='swing')return swingStates.find(option=>option.value===swingValue(d.state))?.icon||visual.icon;
    return visual.icon;
  }
  function buttonHTML(d,b,r,index) {
    if (!b) return editing ? '<button type="button" class="empty-slot" data-add-slot="'+esc(r.id)+'" data-index="'+index+'" data-drop-row="'+esc(r.id)+'" data-drop-index="'+index+'">'+glyph('plus')+'<span>Añadir elemento</span></button>' : '<div class="empty-slot" style="visibility:hidden" aria-hidden="true"></div>';
    const dual=b.type==='dual',visual=dual?dualActions(b,d)[dualStateIndex(d,b)]:b;
    const symbol=buttonSymbol(d,b,visual);
    const stateTitle=d.type==='stateful'&&b.type==='group'?(b.group==='mode'?'Modo: '+currentMode(d.state).name:b.group==='fan'?fanDescription(d.state.fan):b.group==='swing'?swingDescription(d.state):''):'';
    const unavailable=d.type==='stateful'&&b.sendMode!=='independent'&&['temp_up','temp_down'].includes(visual.action)&&!temperatureAvailable(d);
    const pressed=dualPowerLinked(d,b)?d.state.power:dualStateIndex(d,b)===1;
    const visibleText=visual.name;
    const label=dual?b.name+': '+(visibleText||visual.name||actionOptions.find(action=>action.value===visual.action)?.name||'Acción'):b.name;
    return '<button type="button" class="remote-button'+(visual.icon==='none'&&/^\d$/.test(visibleText)?' is-number':'')+(b.type==='group'?' is-group':'')+(dual?' is-dual':'')+(dual&&pressed?' is-on':'')+'" style="--button-color:'+esc(visual.color)+(editing?';touch-action:none;user-select:none':'')+'" data-button="'+esc(b.id)+'" data-drop-row="'+esc(r.id)+'" data-drop-index="'+index+'"'+(editing?' draggable="true"':'')+(dual?' aria-pressed="'+pressed+'"':'')+(unavailable&&!editing?' disabled title="Este modo no permite ajustar la temperatura"':'')+' aria-label="'+esc(label)+'"'+(stateTitle?' title="'+esc(stateTitle)+'"':'')+'>'+
      (editing?'<span class="button-top">'+(b.type==='group'?'Editar carpeta':'Editar función')+'</span>':'')+
      (symbol!=='none'?'<span class="button-symbol">'+glyph(symbol)+'</span>':'')+
      (visual.showName?'<span class="button-label">'+esc(visibleText)+'</span>':'')+
      (b.type==='group'?'<span class="group-indicator" aria-hidden="true">'+glyph('chevron-right')+'</span>':'')+'</button>';
  }
  function rowTools(r,index) {
    const screen=r.type==='display';
    const width=clamp(r.width,3,6,3),height=clamp(r.height,screen?2:1,4,2);
    const widthControl=screen?
      '<div class="stepper"><span>Anchura</span><button class="icon-btn" data-width="'+esc(r.id)+'" data-delta="-1" aria-label="Reducir anchura"'+(width<=3?' disabled':'')+'>'+glyph('minus')+'</button><b>'+(width-2)+'</b><button class="icon-btn" data-width="'+esc(r.id)+'" data-delta="1" aria-label="Aumentar anchura"'+(width>=6?' disabled':'')+'>'+glyph('plus')+'</button></div>':
      '<div class="stepper"><span>Columnas</span><button class="icon-btn" data-columns="'+esc(r.id)+'" data-delta="-1" aria-label="Quitar una columna"'+(r.columns<=1?' disabled':'')+'>'+glyph('minus')+'</button><b>'+r.columns+'</b><button class="icon-btn" data-columns="'+esc(r.id)+'" data-delta="1" aria-label="Añadir una columna"'+(r.columns>=6?' disabled':'')+'>'+glyph('plus')+'</button></div>';
    return '<div class="row-tools"><span class="row-label">'+(screen?'Pantalla':'Fila '+(index+1))+'</span><div class="steppers">'+widthControl+
      '<div class="stepper"><span>Altura</span><button class="icon-btn" data-height="'+esc(r.id)+'" data-delta="-1" aria-label="Reducir altura"'+(height<=(screen?2:1)?' disabled':'')+'>'+glyph('minus')+'</button><b>'+(screen?height-1:height)+'</b><button class="icon-btn" data-height="'+esc(r.id)+'" data-delta="1" aria-label="Aumentar altura"'+(height>=4?' disabled':'')+'>'+glyph('plus')+'</button></div><button class="icon-btn" data-delete-row="'+esc(r.id)+'" aria-label="Eliminar fila">'+glyph('trash')+'</button></div></div>';
  }
  function renderRemote() {
    const d=selected();if(!d){view='home';renderHome();return;}
    const e=emitterFor(d.id);
    app.innerHTML='<div class="remote-header"><div class="remote-navigation"><button class="btn text" data-home>'+glyph('arrow-left')+'Emisores</button><span class="muted remote-emitter">'+esc(e?.name||'')+'</span></div><div class="page-head remote-head"><div class="identity"><div><h1>'+esc(d.name)+'</h1></div></div><div class="page-actions">'+(editing?'<button class="btn text" data-device-settings>'+glyph('pencil')+'Nombre e icono</button>':'')+'<button class="btn'+(editing?' primary':'')+'" data-edit>'+glyph(editing?'check':'settings')+(editing?'Listo':'Editar mando')+'</button></div></div></div>'+
      (editing?'<div class="editor-note">'+glyph('move')+'<span>Arrastra los botones para colocarlos. Pulsa un elemento para editarlo.</span></div>':'')+
      '<div class="remote-canvas'+(editing?' editing':'')+'">'+d.rows.map((r,index)=>'<section class="layout-row'+(editing?' edit-area':'')+'" data-row="'+esc(r.id)+'" data-height="'+r.height+'" style="--level:'+r.height+'">'+(editing?rowTools(r,index):'')+
      (r.type==='display'?'<div class="display-preview">'+displayHTML(d,r)+'</div>':'<div class="row-grid" style="--cols:'+r.columns+';--level:'+r.height+'">'+r.cells.map((b,i)=>buttonHTML(d,b,r,i)).join('')+'</div>')+'</section>').join('')+
      (editing?'<div class="row-add-actions"><button class="btn" data-add-row>'+glyph('add-row')+'Añadir fila</button><button class="btn" data-add-element>'+glyph('plus')+'Añadir función</button></div>':'')+'</div>'+(d.type==='stateful'?stateCapturePanel(d):'');
  }
  function renderHome() {
    app.innerHTML='<div class="page-head"><div class="identity"><div><h1>Emisores</h1><p class="muted">Tus mandos infrarrojos</p></div></div><button class="btn primary" data-add-emitter>'+glyph('plus')+'Añadir emisor</button></div><div class="stack">'+model.emitters.map(e=>'<section class="emitter-card"><div class="emitter-header"><div class="emitter-title">'+glyph('radio')+'<div><h2>'+esc(e.name)+'</h2><span class="muted small">'+esc(e.model)+'</span></div></div><div class="device-actions"><button class="btn text" data-add-device="'+esc(e.id)+'">'+glyph('plus')+'Añadir dispositivo</button><button class="icon-btn" data-emitter-menu="'+esc(e.id)+'" aria-label="Opciones de '+esc(e.name)+'">'+glyph('more')+'</button></div></div><div class="device-list">'+(e.devices.length?e.devices.map(d=>'<div class="device-item"><button class="device-open" data-open="'+esc(d.id)+'"><span class="device-icon">'+glyph(d.icon)+'</span><span class="device-info"><strong>'+esc(d.name)+'</strong><span class="muted small">Mando</span></span></button><button class="icon-btn" data-device-menu="'+esc(d.id)+'" aria-label="Opciones de '+esc(d.name)+'">'+glyph('more')+'</button></div>').join(''):'<p class="muted">Añade tu primer dispositivo.</p>')+'</div></section>').join('')+'</div>';
  }
  function render() {
    if(view!=='home'&&!selected())view='home';
    const route=view+':'+(view==='remote'?model.selected:'');
    const restoreScroll=captureScrollPosition(lastRenderedRoute!==route);lastRenderedRoute=route;
    ensureModelEntities();if(view==='home')renderHome();else renderRemote();
    if(saveFailed&&!app.querySelector('[data-save-failure]'))app.insertAdjacentHTML('afterbegin','<div class="warning" role="alert" data-save-failure><span aria-hidden="true">⚠</span><div><strong>No se han guardado los últimos cambios.</strong><p>Se ha recuperado la última configuración confirmada. Recarga el panel para continuar.</p><button type="button" class="btn" data-refresh-panel>Recargar panel</button></div></div>');
    if(actionError&&!saveFailed)app.insertAdjacentHTML('afterbegin','<p class="action-error" role="alert" data-action-error>'+esc(actionError)+'</p>');
    lastAmbientSnapshot='';refreshAmbientReadings();restoreScroll();queueMicrotask(flushDeferredEnvelope);
  }
  function getButton(d,id) {for(const r of d.rows){const i=r.cells?.findIndex(b=>b?.id===id);if(i>=0)return {row:r,index:i,button:r.cells[i]};}return null;}
  function stateCapturePanel(d) {
    const fields=controlledStateFields(d);
    let record=(d.savedStates||[]).find(item=>item.id===viewedSavedStateId);
    if(record&&!stateRecordMatches(record,d.state,recordStateFields(record))){viewedSavedStateId=null;record=null;}
    record=record||savedStateFor(d);
    const ready=!!record?.signal;
    const status=ready?'Estado aprendido':record?'Sin señal':'Sin aprender';
    return '<section class="state-capture-panel" aria-labelledby="current-state-title"><div class="state-capture-heading"><h2 id="current-state-title">Estado actual</h2><span class="state-status '+(ready?'available':'missing')+'">'+status+'</span></div><p class="state-summary">'+esc(fields.length?configurationLabel(d.state,fields):'Todos los ajustes se controlan por separado.')+'</p>'+
      '<div class="state-capture-actions">'+(record?'<button class="btn primary" data-relearn-state="'+esc(record.id)+'">'+glyph('radio')+(ready?'Reaprender señal':'Aprender señal del mando original')+'</button>'+(ready?'<button class="btn danger" data-clear-state-signal="'+esc(record.id)+'">'+glyph('trash')+'Borrar señal</button>':'')+'<button class="btn danger" data-delete-saved-state="'+esc(record.id)+'">'+glyph('trash')+'Eliminar estado y entidad</button>':fields.length?'<button class="btn primary" data-learn-state>'+glyph('radio')+'Aprender estado</button>':'')+
      '</div>'+(!ready&&fields.length?'<p class="small muted state-capture-hint">'+(record?'La entidad se conserva. Aprende una señal para volver a utilizar este estado.':!fields.includes('power')?'Prepara estos ajustes en el mando original y aprende la señal que los envía.':d.state.power?'Prepara estos mismos ajustes en el mando original y aprende la señal para guardar este estado.':'Aprende la señal de apagar del mando original.')+'</p>':'')+stateTable(d,record)+'</section>';
  }
  function stateTable(d,current) {
    const records=d.savedStates||[];if(!records.length)return '';
    return '<table class="state-table" aria-label="Estados y entidades"><thead><tr><th scope="col">Estado</th><th scope="col">Entidad</th></tr></thead><tbody>'+records.map(record=>{
      const active=record.id===current?.id,label=record.name||configurationLabel(record.settings,recordStateFields(record));
      return '<tr'+(active?' class="is-current"':'')+'><td><button type="button" class="state-table-select" data-view-saved-state="'+esc(record.id)+'"'+(active?' aria-current="true"':'')+' aria-label="Ver estado '+esc(label)+'">'+esc(label)+'</button></td><td><div class="state-table-entity"><code>'+esc(record.entity)+'</code><button type="button" class="icon-btn state-copy" data-copy-state-entity="'+esc(record.id)+'" aria-label="Copiar entidad '+esc(record.entity)+'" title="Copiar entidad">'+glyph('copy')+'</button></div></td></tr>';
    }).join('')+'</tbody></table>'+(isAdmin?'<div class="state-capture-actions"><button type="button" class="btn danger" data-delete-all-states>'+glyph('trash')+'Borrar todos los estados</button></div>':'');
  }
  function proposedStateEntity(d,name,id) {
    const stem='button.'+entitySlug([emitterFor(d.id)?.name,d.name,name].filter(Boolean).join('_'));
    let entity=stem,n=2;
    while(allEntityRecords().some(record=>record.id!==id&&record.entity===entity))entity=stem+'_'+n++;
    return entity;
  }
  function learnState(d,id) {
    if(!isAdmin||saveFailed){toast('No se puede iniciar el aprendizaje. Recarga el panel con permisos de administrador.');return;}
    if(signalBusy){toast('Hay un aprendizaje en curso. Espera a que termine.');return;}
    const existing=id?(d.savedStates||[]).find(record=>record.id===id):savedStateFor(d);
    if(id&&!existing)return;
    const fields=existing?recordStateFields(existing):controlledStateFields(d);
    if(!fields.length){toast('Todos los ajustes se controlan por separado. No hay un estado general que aprender.');return;}
    const settings=existing?copy(existing.settings):projectState(d.state,fields),recordId=existing?.id||uid();
    const initialName=existing?.name||configurationLabel(settings,fields);
    let capture=null;
    const readName=()=>$('#state-record-name').value.trim();
    const readEntity=()=>existing?existing.entity:proposedStateEntity(d,readName(),recordId);
    showModal(existing?'Reaprender señal del estado':'Aprender estado del mando original',
      field('Nombre del estado','<input id="state-record-name" maxlength="120" value="'+esc(initialName)+'">')+
      '<div class="state-entity"><span>Entidad'+(existing?'':' que se guardará')+'</span><code id="state-record-entity">'+esc(existing?.entity||proposedStateEntity(d,initialName,recordId))+'</code></div>'+
      '<p class="small">'+(!fields.includes('power')?'Prepara estos ajustes en el mando original. Apunta al receptor y pulsa la tecla que envía estos ajustes sin cambiar las funciones independientes.':settings.power?'Prepara estos ajustes en el mando original. Con el mando apagado, apunta a '+esc(emitterFor(d.id)?.name||'tu emisor')+' y pulsa Encender para capturar esta configuración completa.':'Apunta el mando original a '+esc(emitterFor(d.id)?.name||'tu emisor')+' y pulsa la tecla de apagar. Solo se guardará el estado Apagado.')+'</p>'+
      '<div class="state-learn-status listening" id="state-learn-status" role="status" aria-live="polite"><span class="state-learn-symbol">'+glyph('radio')+'</span><strong>Preparado para recibir la señal</strong><span>El estado se guardará al recibirla y pulsar «'+(existing?'Guardar señal':'Guardar estado')+'».</span></div>'+
      '<button type="button" class="btn" id="retry-state-capture" hidden>Volver a escuchar</button><button type="button" class="btn" id="test-state-capture" hidden>Probar señal</button><p id="form-error" class="warning" role="alert" hidden></p>',
      [{label:'Cancelar'},{label:existing?'Guardar señal':'Guardar estado',className:'primary',run:async()=>{
        if(!capture){formError('Recibe una señal antes de guardar el estado.');return;}
        const name=readName();if(!name){formError('Escribe un nombre para el estado.');return;}
        d.savedStates=d.savedStates||[];
        const matched=savedStateFor(d,settings,fields);
        if(existing){
          const current=d.savedStates.find(record=>record.id===recordId);
          if(!current){formError('Este estado ya no está guardado.');return;}
          current.name=name;current.signal=copy(capture);current.updatedAt=new Date().toISOString();
        }else if(matched){
          matched.name=name;matched.signal=copy(capture);matched.updatedAt=new Date().toISOString();
        }else{
          d.savedStates.push({id:recordId,name,entity:readEntity(),settings:copy(settings),controlled_fields:[...fields],signal:copy(capture),createdAt:new Date().toISOString()});
        }
        if(await persist()){closeModal();render();toast(existing?'Señal del estado actualizada.':'Estado guardado.');}
      }}],()=>{
        const save=modalFoot.lastElementChild;save.disabled=true;
        $('#state-record-name')?.addEventListener('input',()=>{$('#state-record-entity').textContent=readEntity();},{signal:modalAbort.signal});
        const modalSignal=modalAbort.signal;
        const receive=async()=>{
          if(signalBusy)return;signalBusy=true;const token=++operation;
          const status=$('#state-learn-status'),retry=$('#retry-state-capture'),test=$('#test-state-capture');
          retry.hidden=true;test.hidden=true;save.disabled=true;
          status.classList.remove('available');status.classList.add('listening');status.innerHTML='<span class="state-learn-symbol">'+glyph('radio')+'</span><strong>Escuchando el mando original</strong><span>Apunta al receptor y pulsa '+(!fields.includes('power')?'la tecla correspondiente':settings.power?'Encender':'Apagar')+' en el mando original.</span>';
          try{
            await saveQueue;if(saveFailed)throw new Error('No se han guardado los cambios del mando.');
            const result=await queueRequest(()=>api.call('learn',{source_id:emitterFor(d.id).sourceId,device_id:d.id,function_key:recordId,signal:'press'}));
            if(disposed||modalSignal.aborted||token!==operation)return;
            if(!result.signal_ref||!(result.learned||result.captured))throw new Error('No se ha confirmado la recepción. Vuelve a intentarlo.');
            capture={kind:'learned',id:result.signal_ref,capturedAt:new Date().toISOString()};
            status.innerHTML='<span class="state-learn-symbol">'+glyph('check')+'</span><strong>Señal recibida</strong><span>Puedes guardar el estado directamente.</span>';status.classList.remove('listening');status.classList.add('available');test.hidden=false;save.disabled=false;
          }catch(error){if(!disposed&&!modalSignal.aborted){status.classList.remove('listening');status.innerHTML='<strong>No se ha recibido la señal</strong><span>'+esc(error.message||'Comprueba el receptor y vuelve a intentarlo.')+'</span>';retry.hidden=false;}}
          finally{signalBusy=false;flushDeferredEnvelope();}
        };
        $('#retry-state-capture').addEventListener('click',receive,{signal:modalSignal});
        $('#test-state-capture').addEventListener('click',async()=>{if(!capture)return;try{await queueRequest(()=>api.call('test_signal',{signal_ref:capture.id}));toast('Señal enviada. Comprueba el resultado en el aparato.');}catch(error){formError(error.message||'No se ha podido probar la señal.');}},{signal:modalSignal});
        void receive();
      });
  }
  function clearStateSignal(d,id) {
    const record=(d.savedStates||[]).find(item=>item.id===id);if(!record?.signal)return;
    showModal('Borrar señal aprendida','<p>'+esc(record.name||configurationLabel(record.settings,recordStateFields(record)))+'</p><div class="state-entity"><span>Entidad que se conserva</span><code>'+esc(record.entity)+'</code></div><div class="warning"><span aria-hidden="true">⚠</span><div><strong>Borrado definitivo de la señal.</strong><p>Se conservarán este estado y su entidad. Las automatizaciones que la utilicen dejarán de ejecutar esta función hasta que vuelvas a aprender una señal.</p></div></div>',[
      {label:'Cancelar'},{label:'Borrar señal',className:'danger',run:()=>{record.signal=null;record.signal_refs={};persist();closeModal();render();toast('Señal borrada. El estado y la entidad se conservan.');}}
    ]);
  }
  function deleteSavedState(d,id) {
    const record=(d.savedStates||[]).find(item=>item.id===id);if(!record)return;
    showModal('Eliminar estado y entidad','<p>'+esc(record.name||configurationLabel(record.settings,recordStateFields(record)))+'</p><div class="state-entity"><span>Entidad</span><code>'+esc(record.entity)+'</code></div><div class="warning"><span aria-hidden="true">⚠</span><div><strong>Eliminación definitiva.</strong><p>Se eliminarán este estado, su señal aprendida y su entidad. Las automatizaciones, scripts y paneles que utilicen esta entidad dejarán de ejecutar esta función. Esta acción no se puede deshacer.</p></div></div>',[
      {label:'Cancelar'},{label:'Eliminar estado y entidad',className:'danger',run:()=>{d.savedStates=d.savedStates.filter(item=>item.id!==id);persist();closeModal();render();toast('Estado y entidad eliminados de IR Pro.');}}
    ]);
  }
  function deleteAllSavedStates(d) {
    if(!isAdmin||saveFailed||!(d.savedStates||[]).length)return;
    if(signalBusy||independentSending){toast('Espera a que termine la operación en curso.');return;}
    showModal('Borrar todos los estados','<p>'+esc(d.name)+'</p><div class="warning" role="alert"><span aria-hidden="true">⚠</span><div><strong>Eliminación definitiva.</strong><p>Se eliminarán todos los estados guardados de este mando, sus señales aprendidas y sus entidades. Las automatizaciones, scripts y paneles que utilicen estas entidades dejarán de ejecutar estas funciones. Esta acción no se puede deshacer.</p></div></div><p id="form-error" class="warning" role="alert" hidden></p>',[
      {label:'Cancelar'},{label:'Eliminar estados',className:'danger',run:async()=>{
        try{
          const result=await queueRequest(()=>api.call('delete_saved_states',{device_id:d.id,expected_revision:revision}));
          if(disposed)return;
          if(!result?.model||!Number.isInteger(result.revision))throw new Error('No se ha podido confirmar la eliminación. Recarga el panel para comprobar los estados.');
          revision=result.revision;catalog=result.catalog||catalog;confirmedWire=copy(result.model);
          model=importModel(result.model,model.selected);model.emitters.forEach(emitter=>emitter.devices.forEach(validateDevice));
          viewedSavedStateId=null;closeModal();render();toast('Estados y entidades eliminados.');
        }catch(error){if(!disposed)formError(error.message||'No se han podido eliminar los estados.');}
      }}
    ]);
  }
  function viewSavedState(d,id) {
    const record=(d.savedStates||[]).find(item=>item.id===id);if(!record)return;
    viewedSavedStateId=record.id;
    Object.assign(d.state,projectState(record.settings,recordStateFields(record)));render();
  }
  async function copySavedStateEntity(d,id) {
    const record=(d.savedStates||[]).find(item=>item.id===id);if(!record)return;
    let copied=false;
    try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(record.entity);copied=true;}}catch{}
    if(!copied){
      const focused=scope.activeElement,input=document.createElement('textarea');
      input.value=record.entity;input.setAttribute('aria-hidden','true');input.style.cssText='position:fixed;left:-9999px;top:0;';
      root.appendChild(input);input.select();
      try{copied=document.execCommand('copy');}catch{}
      input.remove();focused?.focus({preventScroll:true});
    }
    toast(copied?'Entidad copiada.':'No se ha podido copiar la entidad.');
  }
  function adoptCommandEnvelope(result,d,sourceId) {
    const emitter=result?.model?.emitters?.find(item=>item.sourceId===sourceId&&item.devices?.some(device=>device.id===d.id));
    const state=emitter?.devices.find(device=>device.id===d.id)?.studio?.state;
    if(!Number.isInteger(result?.revision)||!state||typeof state.power!=='boolean'||!modes.some(option=>option.value===state.mode)||!Number.isInteger(state.temperature)||state.temperature<18||state.temperature>30||!fans.some(option=>option.value===state.fan)||!swingStates.some(option=>option.value===state.swing))throw new Error('No se ha podido confirmar el estado del mando. Recarga el panel antes de continuar.');
    const canonical=importModel(result.model,model.selected);
    if(!canonical.emitters.every(item=>item.devices.every(validateDevice)))throw new Error('No se ha podido confirmar la configuración del mando. Recarga el panel antes de continuar.');
    confirmedWire=copy(result.model);revision=result.revision;catalog=result.catalog||catalog;model=canonical;
    d.state=copy(state);
  }
  async function commitState(d,message,transmit) {
    if(independentSending){toast('Espera a que termine el envío.');return false;}
    const state=copy(d.state),fields=controlledStateFields(d),sourceId=emitterFor(d.id)?.sourceId,locked=transmit&&fields.length>0;
    if(locked)independentSending=true;
    render();
    try{return await persist(async()=>{
      if(!transmit||!fields.length){toast(message);return true;}
      if(!savedStateFor(d,state,fields)?.signal){clearActionError();return false;}
      const result=await api.call('send_state',{device_id:d.id,state,controlled_fields:fields});
      if(disposed)return false;
      adoptCommandEnvelope(result,d,sourceId);render();
      toast('Señal enviada · '+message+' · Estado estimado');return true;
    });}finally{if(locked)independentSending=false;}
  }
  async function execute(d,b) {
    if(b.type==='group'){openGroup(d,b);return false;}
    return executeAction(d,b);
  }
  async function executeIndependent(d,b) {
    if(independentSending){toast('Espera a que termine el envío.');return false;}
    const effect=independentStateEffect(b);
    if(!effect||b.signals?.press!==true||!b.signal_refs?.press){toast('Sin señal. Aprende esta opción al editar la carpeta.');return false;}
    const key=b.id,name=b.name,sourceId=emitterFor(d.id)?.sourceId;
    independentSending=true;
    try{return await queuePhysical(async()=>{
      const result=await api.call('press',{function_key:key});
      if(disposed)return false;
      adoptCommandEnvelope(result,d,sourceId);
      render();toast('Señal enviada · '+name+' · Estado estimado');return true;
    });}finally{independentSending=false;}
  }
  async function executeAction(d,b) {
    if(independentSending){toast('Espera a que termine el envío.');return false;}
    if(signalBusy){toast('Espera a que termine el aprendizaje.');return false;}
    if (b.type==='group') {openGroup(d,b);return false;}
    if (b.type==='dual') {
      const index=dualStateIndex(d,b),linked=dualPowerLinked(d,b),side=dualActions(b,d)[index];
      if(d.type==='stateful'&&b.sendMode==='independent'&&b._existingType!=='switch'){
        const choice=independentChoices(b).find(item=>item.action_index===index),child=choice&&independentActionFor(b,choice.value,index);
        if(!child){toast('Sin señal. Aprende esta acción al editar el botón.');return false;}
        // The backend advances the parent phase atomically with the child press.
        return executeIndependent(d,child);
      }
      if(d.type==='simple'||b._existingType==='switch'){
        return queuePhysical(async()=>{const result=await api.call('press',{function_key:b.id,on:b.activeSide!==1});if(disposed)return false;b.activeSide=result.on?1:0;b.on=result.on;render();toast('Señal enviada · Estado estimado');return true;});
      }
      const sourceId=emitterFor(d.id)?.sourceId,signature=JSON.stringify(dualActions(b,d).map(action=>[action.action,action.value||'']));
      const success=await executeAction(d,{...side,id:b.id,type:'button'});
      if(success&&!linked){
        const currentDevice=model.emitters.find(emitter=>emitter.sourceId===sourceId&&emitter.devices.some(device=>device.id===d.id))?.devices.find(device=>device.id===d.id);
        const locate=node=>{if(node?.id===b.id)return node;if(node?.type==='group'&&node.group==='custom')for(const child of node.children||[]){const found=locate(child);if(found)return found;}};
        const current=currentDevice?.rows.flatMap(row=>row.cells||[]).map(locate).find(Boolean);
        if(current?.type==='dual'&&current._existingType!=='switch'&&current.sendMode!=='independent'&&current.activeSide===index&&JSON.stringify(dualActions(current,currentDevice).map(action=>[action.action,action.value||'']))===signature){current.activeSide=1-index;const saved=await persist();render();return saved;}
      }
      return success;
    }
    if(d.type==='stateful'&&b.sendMode==='independent'&&linkedActionEffect(b)){
      const choice=independentChoices(b)[0],child=choice&&independentActionFor(b,choice.value,0);
      if(!child){toast('Sin señal. Aprende esta acción al editar el botón.');return false;}
      return executeIndependent(d,child);
    }
    if (b.action==='learned') {
      if(independentStateEffect(b))return executeIndependent(d,b);
      return queuePhysical(async()=>{if(!b.id)throw new Error('Esta función no tiene una señal aprendida.');await api.call('press',{function_key:b.id});if(!disposed)toast('Señal enviada · '+b.name);return true;});
    }
    const s=d.state,fields=controlledStateFields(d,{...d.state,power:true}),field=actionStateField(b),separate=field&&!fields.includes(field);
    const separateHint=' · Este ajuste se controla por separado. Configura su señal independiente o vuelve sus controles a Ajustes del mando.';let label='Ajustes actualizados';
    if (b.action==='power_on') {s.power=true;return commitState(d,'Encendido · '+stateText(d)+(separate?separateHint:''),!separate);}
    if (b.action==='power_off') {s.power=false;return commitState(d,'Apagado'+(separate?separateHint:''),!separate);}
    if (b.action==='temp_up'||b.action==='temp_down') {
      if (!temperatureAvailable(d)) {toast('Este modo no permite ajustar la temperatura.');return false;}
      const next=clamp(s.temperature+(b.action==='temp_up'?1:-1),18,30,24);
      if(next===s.temperature){toast('Límite de temperatura: '+s.temperature+' °C.');return false;}s.temperature=next;label='Temperatura '+s.temperature+' °C';
    } else if(b.action==='set_mode' && modes.some(v=>v.value===b.value)){s.mode=b.value;label='Modo '+currentMode(s).name.toLowerCase();}
    else if(b.action==='set_fan' && fans.some(v=>v.value===b.value)){s.fan=b.value;label=fanDescription(s.fan);}
    else if(b.action==='set_swing'&&swingStates.some(option=>option.value===b.value)){s.swing=b.value;label=swingDescription(s);}
    else if(b.action==='swing'){s.swing=swingValue(s)==='auto'?'off':'auto';label=swingDescription(s);}
    else {toast('Esta función todavía no tiene una acción asignada.');return false;}
    return commitState(d,label+(separate?separateHint:!s.power&&fields.includes('power')?' · Preparado para el próximo encendido':''),!separate&&(s.power||!fields.includes('power')));
  }
  function openGroup(d,b) {
    let choices=[];
    const independent=d.type==='stateful'&&b.sendMode==='independent'&&['mode','fan','swing'].includes(b.group);
    if(independent)choices=officialGroupChoices(b).map(choice=>{
      const node=independentActionFor(b,choice.value),ready=node?.signals?.press===true&&!!node.signal_refs?.press;
      return {...choice,...node,icon:choice.icon,action:'learned',selected:(b.group==='swing'?swingValue(d.state):d.state[b.group])===choice.value,unlearned:!ready};
    });
    else if(b.group==='mode') choices=modes.map(v=>({...v,action:'set_mode',selected:d.state.mode===v.value}));
    else if(b.group==='fan') choices=fanChoices(b).map(v=>({...v,icon:v.value==='auto'?'auto':'fan-speed-'+clamp(b.fanSpeedCount,2,5,3)+'-'+fans.indexOf(v),action:'set_fan',selected:d.state.fan===v.value}));
    else if(b.group==='swing') choices=swingChoices(b).map(option=>({...option,action:'set_swing',selected:swingValue(d.state)===option.value}));
    else choices=(b.children || []).map(child=>typeof child==='string'?({value:'',action:child,name:actionOptions.find(v=>v.value===child)?.name || 'Función',icon:({power_on:'power',power_off:'power-off',temp_up:'plus',temp_down:'minus',swing:'swing'})[child] || 'remote'}):child);
    if(!choices.length){toast('Edita esta carpeta para añadir sus botones.');return;}
    showModal(b.name,'<div class="modal-options">'+choices.map((v,i)=>'<button class="option'+(v.selected?' selected':'')+'" data-group-option="'+i+'" aria-label="'+esc(v.name)+(v.unlearned?' · Sin señal':'')+'"'+(typeof v.selected==='boolean'?' aria-pressed="'+v.selected+'"':'')+(v.unlearned?' disabled':'')+'>'+(v.icon==='none'?'':glyph(v.icon || 'fan'))+(v.showName!==false?'<span>'+esc(v.name)+'</span>':'')+(v.unlearned?'<small>Sin señal</small>':'')+'</button>').join('')+'</div>',[{label:'Cancelar'}],()=>{
      $$('[data-group-option]',modalBody).forEach(element=>element.addEventListener('click',()=>{const choice=choices[Number(element.dataset.groupOption)];closeModal();execute(d,{...choice,type:'button',name:choice.name});},{signal:modalAbort.signal}));
    });
  }
  function newDevice(emitterId) {
    const e=model.emitters.find(v=>v.id===emitterId);if(!e)return;
    const hint=()=>{const value=$('#new-device-icon').value;$('#template-description').textContent=['air-vent','wind'].includes(value)?'Incluye pantalla, modos, temperatura, ventilador, oscilación y luz. Podrás editar todos los controles.':value==='tv'?'Incluye encendido y apagado, volumen, canales, fuente y teclado numérico. Podrás editar todos los controles.':'Incluye controles editables para aprender las señales de tu mando.';};
    showModal('Añadir dispositivo',field('Nombre del dispositivo','<input id="new-device-name" maxlength="70" placeholder="Por ejemplo, Televisor salón">')+field('Icono','<select id="new-device-icon">'+selectOptions(deviceIcons,'air-vent')+'</select>')+'<p id="template-description" class="small muted"></p><p class="small muted">'+esc(e.name)+'</p><p id="form-error" class="warning" hidden></p>',[{label:'Cancelar'},{label:'Crear',className:'primary',run:()=>{
      const name=$('#new-device-name').value.trim();if(!name){formError('Escribe un nombre para el dispositivo.');return;}
      const d=newRemote(name,$('#new-device-icon').value);e.devices.push(d);model.selected=d.id;view='remote';editing=false;persist();closeModal();render();toast('Dispositivo creado en IR Pro.');
    }}],()=>{hint();$('#new-device-icon').addEventListener('change',hint,{signal:modalAbort.signal});});
  }

  function formError(message) {const element=$('#form-error');if(element){element.textContent=message;element.hidden=false;}}
  function renameDevice(d) {
    showModal('Nombre e icono',field('Nombre del dispositivo','<input id="rename-device" maxlength="70" value="'+esc(d.name)+'">')+field('Icono','<select id="rename-device-icon">'+selectOptions(deviceIcons,d.icon)+'</select>')+'<p id="form-error" class="warning" hidden></p>',[{label:'Cancelar'},{label:'Guardar',className:'primary',run:()=>{const name=$('#rename-device').value.trim();if(!name){formError('Escribe un nombre.');return;}d.name=name;d.icon=$('#rename-device-icon').value;persist();closeModal();render();toast('Nombre e icono actualizados.');}}]);
  }
  function confirmDelete(title,message,run) {
    showModal(title,'<div class="warning"><span aria-hidden="true">⚠</span><div><strong>Eliminación definitiva.</strong><p>'+esc(message)+' Las automatizaciones, scripts y paneles que utilicen las entidades eliminadas dejarán de ejecutar estas funciones. Esta acción no se puede deshacer.</p></div></div>',[{label:'Cancelar'},{label:'Eliminar',className:'danger',run:async()=>{run();if(await persist()){closeModal();render();toast('Eliminado de IR Pro.');}}}]);
  }
  function duplicateDevice(d) {
    const source=emitterFor(d.id);
    showModal('Duplicar dispositivo',field('Nombre del nuevo dispositivo','<input id="duplicate-name" maxlength="70" value="'+esc(d.name+' copia')+'">')+field('Emisor de destino','<select id="duplicate-emitter">'+selectOptions(model.emitters.map(emitter=>({value:emitter.id,name:emitter.name})),source.id)+'</select>')+'<p class="small muted">Se crearán entidades nuevas. El original conservará sus identificadores y automatizaciones. En otro emisor tendrás que aprender de nuevo las señales.</p><p id="form-error" class="warning" hidden></p>',[{label:'Cancelar'},{label:'Crear duplicado',className:'primary',run:async()=>{
      const name=$('#duplicate-name').value.trim(),destination=model.emitters.find(emitter=>emitter.id===$('#duplicate-emitter').value);if(!name||!destination){formError('Escribe un nombre y selecciona un emisor.');return;}
      const next=copy(d),same=destination.sourceId===source.sourceId;next.id=uid();next.name=name;next._functions=[];
      const rewrite=node=>{if(!node)return;const legacySwitch=node._existingType==='switch';node.id=uid();delete node.entity;delete node._existingType;if(legacySwitch&&next.type==='stateful')node._existingType='switch';node.on=null;node.activeSide=0;if(!same){node.signal_refs={};node.signals={};node.actions?.forEach(side=>delete side.signal);}if(node.type==='group'&&node.group==='custom')(node.children||[]).forEach(rewrite);(node.independentActions||[]).forEach(rewrite);};
      next.rows.forEach(row=>{row.id=uid();(row.cells||[]).forEach(rewrite);});
      (next.savedStates||[]).forEach(record=>{record.id=uid();delete record.entity;if(!same){record.signal=null;record.signal_refs={};}});
      destination.devices.push(next);if(await persist()){closeModal();render();toast(same?'Duplicado creado con entidades nuevas.':'Duplicado creado. Aprende sus señales en el nuevo emisor.');}
    }}]);
  }
  function deviceMenu(id) {
    const d=model.emitters.flatMap(e=>e.devices).find(v=>v.id===id);if(!d)return;
    showModal(d.name,'<div class="modal-options"><button class="option" data-menu-action="edit">'+glyph('settings')+'Editar mando</button><button class="option" data-menu-action="rename">'+glyph('pencil')+'Cambiar nombre e icono</button><button class="option" data-menu-action="duplicate">'+glyph('copy')+'Duplicar dispositivo</button><button class="option" data-menu-action="delete">'+glyph('trash')+'Eliminar dispositivo</button></div>',[{label:'Cerrar'}],()=>{$$('[data-menu-action]',modalBody).forEach(b=>b.addEventListener('click',()=>{closeModal();if(b.dataset.menuAction==='edit'){model.selected=d.id;view='remote';editing=true;persist();render();}else if(b.dataset.menuAction==='rename')renameDevice(d);else if(b.dataset.menuAction==='duplicate')duplicateDevice(d);else confirmDelete('Eliminar dispositivo','Se eliminarán «'+d.name+'» y sus elementos de IR Pro.',()=>{const e=emitterFor(d.id);e.devices=e.devices.filter(v=>v.id!==d.id);if(model.selected===d.id){model.selected=e.devices[0]?.id || '';view='home';editing=false;}});},{signal:modalAbort.signal}));});
  }
  function emitterMenu(id) {
    const e=model.emitters.find(v=>v.id===id);if(!e)return;
    showModal(e.name,'<div class="modal-options"><button class="option" data-emitter-action="rename">'+glyph('pencil')+'Cambiar nombre</button><button class="option" data-emitter-action="delete">'+glyph('trash')+'Eliminar emisor</button></div>',[{label:'Cerrar'}],()=>{$$('[data-emitter-action]',modalBody).forEach(b=>b.addEventListener('click',()=>{closeModal();if(b.dataset.emitterAction==='rename')showModal('Cambiar nombre del emisor',field('Nombre del emisor','<input id="emitter-name" maxlength="70" value="'+esc(e.name)+'">')+'<p id="form-error" class="warning" hidden></p>',[{label:'Cancelar'},{label:'Guardar',className:'primary',run:()=>{const value=$('#emitter-name').value.trim();if(!value){formError('Escribe un nombre.');return;}e.name=value;persist();closeModal();render();}}]);else confirmDelete('Eliminar emisor','Se eliminarán «'+e.name+'» y todos sus mandos de IR Pro.',()=>{model.emitters=model.emitters.filter(v=>v.id!==e.id);view='home';editing=false;});},{signal:modalAbort.signal}));});
  }
  function addEmitter() {
    const sources=catalog.filter(source=>!model.emitters.some(emitter=>emitter.sourceId===source.id));
    let chosen=sources.find(source=>source.available&&source.canLearn)?.id||'';
    showModal('Añadir emisor','<div class="stack">'+(sources.length?sources.map(source=>'<button type="button" class="choice'+(source.id===chosen?' selected':'')+'" data-source="'+esc(source.id)+'"'+(!source.available||!source.canLearn?' disabled':'')+'>'+glyph('radio')+'<strong>'+esc(source.name)+'</strong><span>'+esc(source.model||'Broadlink')+'</span><small>'+esc(source.entity_id)+(source.available?'':' · No disponible')+'</small></button>').join(''):'<p class="muted">No hay emisores disponibles para añadir. Configura un receptor compatible en la integración Broadlink de Home Assistant.</p>')+'</div>',[{label:'Cancelar'},{label:'Siguiente',className:'primary',run:()=>{
      const source=sources.find(item=>item.id===chosen);if(!source){toast('Selecciona un emisor disponible.');return;}
      showModal('Personalizar emisor',field('Nombre del emisor','<input id="emitter-name" maxlength="70" value="'+esc(source.name)+'">')+'<p class="muted small">'+esc(source.model||'Broadlink')+' · '+esc(source.entity_id)+'</p><p id="form-error" class="warning" hidden></p>',[{label:'Cancelar'},{label:'Añadir emisor',className:'primary',run:async()=>{const name=$('#emitter-name').value.trim();if(!name){formError('Escribe un nombre.');return;}model.emitters.push({id:uid(),sourceId:source.id,name,model:source.model||'Broadlink',devices:[]});if(await persist()){closeModal();render();}}}]);
    }}],()=>{$$('[data-source]',modalBody).forEach(button=>button.addEventListener('click',()=>{chosen=button.dataset.source;$$('[data-source]',modalBody).forEach(item=>item.classList.toggle('selected',item===button));},{signal:modalAbort.signal}));modalFoot.lastElementChild.disabled=!chosen;});
  }
  function screenSizeControls(r) {
    return '<div class="display-dimensions">'+[['width','Anchura',3,6,2],['height','Altura',2,4,1]].map(([key,label,min,max,offset])=>{
      const value=clamp(r[key],min,max,min);
      return '<div class="stepper"><span>'+label+'</span><button type="button" data-screen-dimension="'+key+'" data-delta="-1" aria-label="Reducir '+label.toLowerCase()+'"'+(value===min?' disabled':'')+'>'+glyph('minus')+'</button><b data-screen-size="'+key+'">'+(value-offset)+'</b><button type="button" data-screen-dimension="'+key+'" data-delta="1" aria-label="Aumentar '+label.toLowerCase()+'"'+(value===max?' disabled':'')+'>'+glyph('plus')+'</button></div>';
    }).join('')+'</div>';
  }
  function wireScreenSizeControls(draft,preview) {
    $$('[data-screen-dimension]',modalBody).forEach(button=>button.addEventListener('click',()=>{
      const key=button.dataset.screenDimension,min=key==='width'?3:2,max=key==='width'?6:4;
      draft[key]=clamp(clamp(draft[key],min,max,min)+Number(button.dataset.delta),min,max,min);
      $('[data-screen-size="'+key+'"]',modalBody).textContent=draft[key]-(key==='width'?2:1);
      $$('[data-screen-dimension="'+key+'"]',modalBody).forEach(control=>{control.disabled=Number(control.dataset.delta)<0?draft[key]===min:draft[key]===max;});
      preview();
    },{signal:modalAbort.signal}));
  }
  function editDisplay(d,r,isNew=false) {
    const draft=copy(r);
    draft.accent=displayAccent(draft.accent);
    const fields=[['temperature','Temperatura objetivo'],['mode','Modo'],['fan','Ventilador'],['swing','Oscilación'],['power','Encendido / apagado']];
    const preview=()=>{const target=$('#display-live');if(target)target.innerHTML=displayHTML(d,draft,true);};
    showModal(isNew?'Añadir función':'Editar función','<div id="display-live" class="display-preview"></div>'+screenSizeControls(draft)+'<div class="form-grid">'+field('Estilo','<select id="display-style"><option value="lcd"'+(draft.style==='lcd'?' selected':'')+'>Pantalla LCD</option><option value="modern"'+(draft.style==='modern'?' selected':'')+'>Home Assistant</option></select>')+field('Color de la pantalla','<input type="color" id="display-color" value="'+esc(draft.accent||'#f4f6f8')+'">')+'</div><div class="field"><span>Información visible</span><div class="display-edit-fields">'+fields.map(([key,label])=>checkField(key,label,draft.fields[key])).join('')+'</div></div><p id="form-error" class="warning" hidden></p>',[{label:'Cancelar'},{label:isNew?'Añadir pantalla':'Guardar cambios',className:'primary',run:()=>{if(!Object.values(draft.fields).some(Boolean)){formError('Selecciona al menos un dato para la pantalla.');return;}if(isNew)d.rows.unshift(copy(draft));else Object.assign(r,copy(draft));persist();closeModal();render();toast('Pantalla actualizada.');}}],()=>{preview();wireScreenSizeControls(draft,preview);$('#display-style').addEventListener('change',event=>{draft.style=event.target.value;preview();},{signal:modalAbort.signal});$('#display-color').addEventListener('input',event=>{draft.accent=event.target.value;preview();},{signal:modalAbort.signal});$$('input[type=checkbox]',modalBody).forEach(input=>input.addEventListener('change',()=>{draft.fields[input.name]=input.checked;preview();},{signal:modalAbort.signal}));});
  }
  function findEmpty(d) {for(const r of d.rows.filter(v=>v.type==='buttons')){const index=r.cells.indexOf(null);if(index>=0)return {row:r,index};}const r=row([null]);d.rows.push(r);return {row:r,index:0};}
  function chooseElement(d,placement) {
    editButton(d,null,placement,'button');
  }
  function confirmSignalRemoval(label,run) {
    const dialog=document.createElement('dialog');dialog.className='signal-delete-modal';
    dialog.innerHTML='<header class="modal-head"><h2>Borrar señal aprendida</h2></header><div class="modal-body"><p>'+esc(label)+'</p><div class="warning"><span aria-hidden="true">⚠</span><div><strong>Borrado definitivo de la señal.</strong><p>La entidad se conserva. Las automatizaciones que la utilicen dejarán de ejecutar esta función hasta que vuelvas a aprender la señal y guardes los cambios.</p></div></div></div><footer class="modal-foot"><button type="button" class="btn" data-cancel>Cancelar</button><button type="button" class="btn danger" data-confirm>Borrar señal</button></footer>';
    root.appendChild(dialog);dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();dialog.querySelector('[data-confirm]').onclick=()=>{run();dialog.close();};dialog.addEventListener('close',()=>dialog.remove(),{once:true});openNeutralDialog(dialog);
  }
  function editButton(d,original,placement,newType='button') {
    if(signalBusy){toast('Hay un aprendizaje en curso. Espera a que termine antes de editar otra función.');return;}
    const draft=original?copy(original):(newType==='group'?group('Nueva carpeta','folder',d.type==='stateful'?'mode':'custom'):button('Nueva función','remote','learned'));
    const displayDraft=displayRow();
    const allowedActions=d.type==='stateful'?actionOptions:actionOptions.filter(a=>a.value==='learned');
    draft.actions=dualActions(draft,d);
    if(draft._existingType==='switch')draft.actions.forEach(side=>{side.action='learned';side.value='';});
    let previewSide=0;
    draft.group=draft.group || (d.type==='stateful'?'mode':'custom');
    draft.children=(draft.children || ['power_on','power_off']).map(child=>typeof child==='string'?button(actionOptions.find(a=>a.value===child)?.name || 'Función',({power_on:'power',power_off:'power-off',temp_up:'plus',temp_down:'minus',swing:'swing'})[child] || 'remote',d.type==='stateful'?child:'learned'):child);
    const fixedEntities=new Set(automationButtons(d,draft).filter(b=>b.entity).map(b=>b.id));
    const syncDraftEntities=()=>{
      automationButtons(d,draft).forEach(b=>{
        const domain=entityDomain(d,b);
        if(fixedEntities.has(b.id)&&b.entity?.startsWith(domain+'.'))return;
        const suffix=fixedEntities.has(b.id)&&b.entity?.includes('.')?b.entity.split('.').slice(1).join('.'):proposedEntitySuffix(d,b);
        const stem=domain+'.'+suffix;let entity=stem,n=2;
        while(entityTaken(entity,b.id,d,draft))entity=stem+'_'+n++;
        b.entity=entity;
      });
    };
    const entityField=b=>'<section class="entity-field"><span>Entidad</span><div class="entity-value"><code>'+esc(b.entity)+'</code><button type="button" class="icon-btn" data-entity-edit="'+esc(b.id)+'" aria-label="Cambiar nombre de la entidad de '+esc(b.name)+'">'+glyph('pencil')+'</button></div><p class="entity-hint">'+(entityDomain(d,b)==='switch'?'Automatizaciones: switch.turn_on / switch.turn_off.':'Automatizaciones: button.press.')+'</p></section>';
    const sendModeOptions=[{value:'settings',name:'Ajustes del mando'},{value:'independent',name:'Acción independiente'}];
    const sendModeHint='Si algún control de este ajuste es independiente, el ajuste queda fuera del estado general.';
    const renderEntityFields=()=>{
      const prepare=node=>{if(!node)return;ensureIndependentActions(node);if(node.type==='group'&&node.group==='custom')(node.children||[]).forEach(prepare);};prepare(draft);
      const sendTarget=$('#function-send-mode');
      if(sendTarget){
        const eligible=d.type==='stateful'&&['button','dual'].includes(draft.type)&&independentChoices(draft).length;
        sendTarget.innerHTML=eligible?field('Cómo envía la señal','<select id="control-send-mode">'+selectOptions(sendModeOptions,draft.sendMode==='independent'?'independent':'settings')+'</select>')+'<p class="muted small">'+(draft.type==='dual'?'Se aplica a las dos acciones. ':'')+sendModeHint+'</p>':'';
        $('#control-send-mode')?.addEventListener('change',event=>{draft.sendMode=event.target.value;renderEntityFields();},{signal:modalAbort.signal});
      }
      syncDraftEntities();
      const root=$('#function-entity');if(root)root.innerHTML=entityDomain(d,draft)?entityField(draft):'';
      $$('[data-child-entity]',modalBody).forEach(target=>{const child=automationButtons(d,draft).find(b=>b.id===target.dataset.childEntity);target.innerHTML=child?entityField(child):'';});
      $$('[data-entity-edit]',modalBody).forEach(target=>{target.onclick=()=>openEntityEditor(automationButtons(d,draft).find(b=>b.id===target.dataset.entityEdit));});
      renderLearningFields();
    };
    const renderLearningFields=()=>{
      const target=$('#function-learning');if(!target||signalBusy)return;
      const functions=[];
      const visit=node=>{
        if(entityDomain(d,node))functions.push(node);
        if(node.type==='group'&&node.group==='custom')(node.children||[]).forEach(visit);
        else if(node.sendMode==='independent')independentChoices(node).forEach(choice=>{const action=independentActionFor(node,choice.value,choice.action_index);if(action)visit(action);});
      };visit(draft);
      target.innerHTML=functions.length?'<div class="function-signal-list">'+functions.flatMap(node=>(entityDomain(d,node)==='switch'?['on','off']:['press']).map(signal=>{
        const ref=node.signals?.[signal]===true?node.signal_refs?.[signal]:null,label=signal==='press'?node.name:(signal==='on'?'Encender':'Apagar')+' · Acción '+(signal==='on'?'1':'2');
        return '<section class="function-signal-row" data-signal-row="'+esc(node.id+'|'+signal)+'"><strong>'+esc(label)+'</strong>'+(independentStateEffect(node)?entityField(node):'')+'<div class="function-signal-status '+(ref?'available':'missing')+'">'+(ref?'Señal disponible':'Sin señal')+'</div><div class="function-signal-actions"><button type="button" class="btn" data-learn-function="'+esc(node.id)+'" data-signal="'+signal+'">'+glyph('radio')+(ref?'Reaprender señal':'Aprender del mando original')+'</button>'+(ref?'<button type="button" class="btn" data-test-function="'+esc(node.id)+'" data-signal="'+signal+'">Probar señal</button><button type="button" class="btn danger" data-clear-function="'+esc(node.id)+'" data-signal="'+signal+'">Borrar señal</button>':'')+'</div></section>';
      })).join('')+'</div>':'';
      $$('[data-entity-edit]',target).forEach(control=>{control.onclick=()=>openEntityEditor(functions.find(node=>node.id===control.dataset.entityEdit));});
      $$('[data-learn-function]',target).forEach(control=>control.addEventListener('click',async()=>{
        if(signalBusy)return;
        const node=functions.find(item=>item.id===control.dataset.learnFunction),signal=control.dataset.signal;if(!node)return;
        signalBusy=true;const modalSignal=modalAbort.signal,token=++operation,save=modalFoot.lastElementChild;
        save.disabled=true;control.disabled=true;
        const status=control.closest('.function-signal-row').querySelector('.function-signal-status');
        status.className='function-signal-status state-learn-status listening';status.innerHTML='<span class="state-learn-symbol">'+glyph('radio')+'</span><strong>Escuchando el mando original</strong><span>Apunta al receptor y pulsa la tecla de «'+esc(node.name)+'».</span>';
        try{
          await saveQueue;if(saveFailed)throw new Error('Guarda el dispositivo antes de aprender su señal.');
          const result=await queueRequest(()=>api.call('learn',{source_id:emitterFor(d.id).sourceId,device_id:d.id,function_key:node.id,signal}));
          if(disposed||modalSignal.aborted||token!==operation)return;
          if(!result.signal_ref||!(result.learned||result.captured))throw new Error('No se ha confirmado la recepción de la señal.');
          node.signal_refs={...node.signal_refs,[signal]:result.signal_ref};node.signals={...node.signals,[signal]:true};
          status.classList.remove('listening');status.classList.add('available');status.innerHTML='<span class="state-learn-symbol">'+glyph('check')+'</span><strong>Señal recibida</strong><span>Guarda los cambios para asociarla. Probarla es opcional.</span>';
          control.textContent='Reaprender señal';
          if(!control.parentElement.querySelector('[data-test-function]')){
            const test=document.createElement('button');test.type='button';test.className='btn';test.textContent='Probar señal';test.dataset.testFunction=node.id;
            test.addEventListener('click',async()=>{test.disabled=true;try{await queueRequest(()=>api.call('test_signal',{signal_ref:node.signal_refs[signal]}));toast('Señal enviada. Comprueba el resultado en el aparato.');}catch(error){formError(error.message||'No se ha podido probar la señal.');}finally{test.disabled=false;}},{signal:modalSignal});control.parentElement.appendChild(test);
          }
        }catch(error){if(!disposed&&!modalSignal.aborted){status.classList.remove('listening');status.textContent=error.message||'No se ha recibido la señal. Vuelve a intentarlo.';}}
        finally{signalBusy=false;if(!disposed&&!modalSignal.aborted){save.disabled=false;control.disabled=false;}flushDeferredEnvelope();}
      },{signal:modalAbort.signal}));
      $$('[data-test-function]',target).forEach(control=>control.addEventListener('click',async()=>{const node=functions.find(item=>item.id===control.dataset.testFunction),ref=node?.signal_refs?.[control.dataset.signal];if(!ref)return;control.disabled=true;try{await queueRequest(()=>api.call('test_signal',{signal_ref:ref}));toast('Señal enviada. Comprueba el resultado en el aparato.');}catch(error){formError(error.message||'No se ha podido probar la señal.');}finally{control.disabled=false;}},{signal:modalAbort.signal}));
      $$('[data-clear-function]',target).forEach(control=>control.addEventListener('click',()=>{const node=functions.find(item=>item.id===control.dataset.clearFunction);if(node)confirmSignalRemoval(node.name,()=>{delete node.signal_refs[control.dataset.signal];renderLearningFields();});},{signal:modalAbort.signal}));
    };
    const openEntityEditor=b=>{
      if(!b)return;
      if(b._existingType){toast('Este identificador ya está registrado. Puedes cambiarlo desde la configuración de la entidad en Home Assistant.');return;}
      const domain=entityDomain(d,b),input=$('#entity-suffix'),error=$('#entity-error');
      const controller=new AbortController(),signal=controller.signal;
      $('#entity-prefix').textContent=domain+'.';input.value=b.entity.slice(domain.length+1);
      error.hidden=true;input.removeAttribute('aria-invalid');
      $('#entity-warning').hidden=!allAutomationButtons().some(previous=>previous.id===b.id);
      const accept=()=>{
        const suffix=input.value.trim();let message='';
        if(!/^[a-z0-9_]{1,240}$/.test(suffix))message='Usa minúsculas, números y guiones bajos. El nombre no puede estar vacío.';
        else if(entityTaken(domain+'.'+suffix,b.id,d,draft))message='Esa entidad ya está en uso por otra función. Elige otro nombre.';
        if(message){error.textContent=message;error.hidden=false;input.setAttribute('aria-invalid','true');input.focus();return;}
        b.entity=domain+'.'+suffix;fixedEntities.add(b.id);entityModal.close();renderEntityFields();
        $('[data-entity-edit="'+CSS.escape(b.id)+'"]',modalBody)?.focus({preventScroll:true});
      };
      $('#entity-cancel').addEventListener('click',()=>entityModal.close(),{signal});
      $('#entity-accept').addEventListener('click',accept,{signal});
      input.addEventListener('input',()=>{error.hidden=true;input.removeAttribute('aria-invalid');},{signal});
      input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();accept();}},{signal});
      entityModal.addEventListener('close',()=>controller.abort(),{once:true});
      openNeutralDialog(entityModal);
    };
    const preview=()=>{
      const target=$('#button-live');if(!target)return;
      const visual=draft.type==='dual'?draft.actions[previewSide]:draft,symbol=buttonSymbol(d,draft,visual);
      const card='<button type="button" class="remote-button" style="--button-color:'+esc(visual.color)+';width:112px;height:112px" aria-label="Vista previa">'+(symbol!=='none'?'<span class="button-symbol">'+glyph(symbol)+'</span>':'')+(visual.showName?'<span class="button-label">'+esc(visual.name)+'</span>':'')+'</button>';
      target.innerHTML=draft.type==='display'?displayHTML(d,displayDraft,true):draft.type==='dual'?'<div class="dual-preview-wrap"><div class="dual-preview-tabs">'+[0,1].map(index=>'<button type="button" class="btn text'+(index===previewSide?' selected':'')+'" data-preview-side="'+index+'" aria-pressed="'+(index===previewSide)+'">Acción '+(index+1)+'</button>').join('')+'</div>'+card+'</div>':card;
      $$('[data-preview-side]',target).forEach(button=>button.addEventListener('click',()=>{previewSide=Number(button.dataset.previewSide);renderDual();preview();},{signal:modalAbort.signal}));
      renderEntityFields();
    };
    const updateAppearance=()=>{
      const appearance=$('#button-appearance');
      if(!appearance)return;
      appearance.hidden=['display','dual'].includes(draft.type);
      $('#button-name',appearance).closest('label').querySelector('span').textContent='Nombre';
      $('.form-grid',appearance).hidden=draft.type==='dual';
      $('input[name="show-name"]',appearance).closest('label').hidden=draft.type==='dual';
    };
    const renderDual=()=>{
      const target=$('#action-fields');
      target.innerHTML='<div class="dual-action-list">'+draft.actions.map((side,index)=>{
        if(index!==previewSide)return '';
        return '<fieldset class="dual-action-card" aria-labelledby="dual-title-'+index+'"><div class="dual-action-head"><span class="dual-action-number">'+(index+1)+'</span><h3 id="dual-title-'+index+'">Acción '+(index+1)+'</h3></div>'+
        field('Nombre','<input data-dual-index="'+index+'" data-dual-field="name" maxlength="40" value="'+esc(side.name)+'">')+
        '<label class="dual-show-name"><input type="checkbox" data-dual-index="'+index+'" data-dual-field="showName"'+(side.showName?' checked':'')+'>Mostrar texto</label>'+
        '<div class="form-grid">'+field('Icono','<select data-dual-index="'+index+'" data-dual-field="icon">'+selectOptions(symbols,side.icon)+'</select>')+field('Color','<input type="color" data-dual-index="'+index+'" data-dual-field="color" value="'+esc(side.color)+'">')+'</div>'+
        field('Acción al pulsar','<select data-dual-index="'+index+'" data-dual-field="action">'+selectOptions(draft._existingType==='switch'?allowedActions.filter(action=>action.value==='learned'):d.type==='stateful'?allowedActions.filter(action=>action.value!=='learned'):allowedActions,side.action)+'</select>')+
        (actionValueChoices(side.action)?field(actionValueLabel(side.action),'<select data-dual-index="'+index+'" data-dual-field="value">'+selectOptions(actionValueChoices(side.action),side.value||defaultActionValue(side.action))+'</select>'):'')+'</fieldset>';
      }).join('')+'</div><p class="dual-state-hint muted small">'+(dualPowerLinked(d,draft)?'Comparte el estado de encendido con la pantalla. Otro botón de encender o apagar también actualizará su aspecto.':'Alterna entre las dos acciones al pulsarlo.')+'</p>';
      $$('[data-dual-field]',target).forEach(input=>{
        const key=input.dataset.dualField;
        const eventName=input.tagName==='SELECT'||input.type==='checkbox'?'change':'input';
        input.addEventListener(eventName,()=>{
          const side=draft.actions[Number(input.dataset.dualIndex)];
          side[key]=key==='showName'?input.checked:input.value;
          if(key==='action'){
            side.value=defaultActionValue(side.action);
            renderDual();
          }
          preview();
        },{signal:modalAbort.signal});
      });
    };
    const renderChildren=()=>{
      const target=$('#folder-children');if(!target)return;
      const children=draft.children;
      target.innerHTML=children.map((child,index)=>'<div class="child-config">'+field('Nombre','<input data-child-name="'+index+'" value="'+esc(child.name)+'" maxlength="40">')+'<label class="dual-show-name"><input type="checkbox" data-child-show="'+index+'"'+(child.showName!==false?' checked':'')+'>Mostrar texto</label>'+field('Icono','<select data-child-icon="'+index+'">'+selectOptions(symbols,child.icon)+'</select>')+field('Acción','<select data-child-action="'+index+'">'+selectOptions(allowedActions,child.action)+'</select>')+(actionValueChoices(child.action)?field(actionValueLabel(child.action),'<select data-child-value="'+index+'">'+selectOptions(actionValueChoices(child.action),child.value||defaultActionValue(child.action))+'</select>'):'')+(d.type==='stateful'&&independentChoices(child).length?field('Cómo envía la señal','<select data-child-send-mode="'+index+'">'+selectOptions(sendModeOptions,child.sendMode==='independent'?'independent':'settings')+'</select>')+'<p class="muted small">'+sendModeHint+'</p>':'')+'<div data-child-entity="'+esc(child.id)+'"></div><button class="btn text" data-remove-child="'+index+'">'+glyph('trash')+'Quitar botón</button></div>').join('')+'<button class="btn" id="add-folder-child">'+glyph('plus')+'Añadir botón a la carpeta</button>';
      $$('[data-child-name]',target).forEach(input=>input.addEventListener('input',()=>{children[Number(input.dataset.childName)].name=input.value;renderEntityFields();},{signal:modalAbort.signal}));
      $$('[data-child-show]',target).forEach(input=>input.addEventListener('change',()=>children[Number(input.dataset.childShow)].showName=input.checked,{signal:modalAbort.signal}));
      $$('[data-child-icon]',target).forEach(input=>input.addEventListener('change',()=>children[Number(input.dataset.childIcon)].icon=input.value,{signal:modalAbort.signal}));
      $$('[data-child-action]',target).forEach(input=>input.addEventListener('change',()=>{const child=children[Number(input.dataset.childAction)];child.action=input.value;child.value=defaultActionValue(child.action);renderChildren();},{signal:modalAbort.signal}));
      $$('[data-child-value]',target).forEach(input=>input.addEventListener('change',()=>{children[Number(input.dataset.childValue)].value=input.value;renderEntityFields();},{signal:modalAbort.signal}));
      $$('[data-child-send-mode]',target).forEach(input=>input.addEventListener('change',()=>{children[Number(input.dataset.childSendMode)].sendMode=input.value;renderEntityFields();},{signal:modalAbort.signal}));
      $$('[data-remove-child]',target).forEach(input=>input.addEventListener('click',()=>{children.splice(Number(input.dataset.removeChild),1);renderChildren();},{signal:modalAbort.signal}));
      $('#add-folder-child').addEventListener('click',()=>{children.push(button('Nuevo botón','remote','learned'));renderChildren();},{signal:modalAbort.signal});
      renderEntityFields();
    };
    const renderActionFields=()=>{
      const target=$('#action-fields');if(!target)return;
      if(draft.type==='group') {
        const groups=d.type==='stateful'?[{value:'mode',name:'Modos del aire'},{value:'fan',name:'Velocidades del ventilador'},{value:'swing',name:'Posiciones y oscilación'},{value:'custom',name:'Botones personalizados'}]:[{value:'custom',name:'Botones personalizados'}];
        const official=d.type==='stateful'&&['mode','fan','swing'].includes(draft.group);
        draft.sendMode=draft.sendMode==='independent'?'independent':'settings';
        if(draft.group==='fan'){draft.fanSpeedCount=clamp(draft.fanSpeedCount,2,5,3);draft.fanAuto=draft.fanAuto!==false;}
        if(draft.group==='swing'){draft.swingPositionCount=clamp(draft.swingPositionCount,1,6,6);draft.swingAuto=draft.swingAuto!==false;draft.swingOff=draft.swingOff!==false;}
        if(official)ensureIndependentActions(draft);
        target.innerHTML=field('Contenido de la carpeta','<select id="group-kind">'+selectOptions(groups,draft.group)+'</select>')+(official?field('Cómo envía la señal','<select id="group-send-mode">'+selectOptions([{value:'settings',name:'Ajustes del mando'},{value:'independent',name:'Acción independiente'}],draft.sendMode)+'</select>')+'<p class="muted small">'+(draft.sendMode==='independent'?'Cada opción envía su propia señal. Si algún control de este ajuste es independiente, el ajuste queda fuera del estado general.':'Cada opción cambia el ajuste del mando y utiliza la señal del estado completo que corresponda.')+'</p>':'')+(draft.group==='custom'?'<div id="folder-children" class="stack"></div>':draft.group==='fan'?field('Cantidad de velocidades','<select id="fan-speed-count">'+selectOptions([2,3,4,5].map(n=>({value:String(n),name:String(n)})),String(draft.fanSpeedCount))+'</select>')+checkField('fan-auto','Tiene modo automático',draft.fanAuto):draft.group==='swing'?field('Cantidad de posiciones fijas','<select id="swing-position-count">'+selectOptions([1,2,3,4,5,6].map(n=>({value:String(n),name:String(n)})),String(draft.swingPositionCount))+'</select>')+checkField('swing-auto','Tiene oscilación automática',draft.swingAuto)+checkField('swing-off','Permite desactivar la oscilación',draft.swingOff):'<p class="muted small">La carpeta abre una tarjeta centrada con las opciones del mando.</p>');
        $('#group-kind')?.addEventListener('change',event=>{draft.group=event.target.value;if(draft.group==='swing'&&['folder','wind'].includes(draft.icon)){draft.icon='swing';$('#button-icon').value='swing';$('#button-icon').dispatchEvent(new Event('change',{bubbles:true}));}renderActionFields();preview();},{signal:modalAbort.signal});
        $('#group-send-mode')?.addEventListener('change',event=>{draft.sendMode=event.target.value;renderActionFields();},{signal:modalAbort.signal});
        $('#fan-speed-count')?.addEventListener('change',event=>{draft.fanSpeedCount=clamp(event.target.value,2,5,3);renderActionFields();preview();},{signal:modalAbort.signal});
        $('input[name="fan-auto"]',target)?.addEventListener('change',event=>{draft.fanAuto=event.target.checked;renderActionFields();},{signal:modalAbort.signal});
        $('#swing-position-count')?.addEventListener('change',event=>{draft.swingPositionCount=clamp(event.target.value,1,6,6);renderActionFields();},{signal:modalAbort.signal});
        $('input[name="swing-auto"]',target)?.addEventListener('change',event=>{draft.swingAuto=event.target.checked;renderActionFields();},{signal:modalAbort.signal});
        $('input[name="swing-off"]',target)?.addEventListener('change',event=>{draft.swingOff=event.target.checked;renderActionFields();},{signal:modalAbort.signal});
        if(draft.group==='custom')renderChildren();
      } else if(draft.type==='dual') {
        renderDual();
      } else if(draft.type==='display') {
        const fields=[['temperature','Temperatura objetivo'],['mode','Modo'],['fan','Ventilador'],['swing','Oscilación'],['power','Encendido / apagado']];
        target.innerHTML=screenSizeControls(displayDraft)+'<div class="form-grid">'+field('Estilo','<select id="new-display-style"><option value="lcd"'+(displayDraft.style==='lcd'?' selected':'')+'>Pantalla LCD</option><option value="modern"'+(displayDraft.style==='modern'?' selected':'')+'>Home Assistant</option></select>')+field('Color de la pantalla','<input type="color" id="new-display-color" value="'+esc(displayDraft.accent)+'">')+'</div><div class="field"><span>Información visible</span><div class="display-edit-fields">'+fields.map(([key,label])=>checkField(key,label,displayDraft.fields[key])).join('')+'</div></div><p class="muted small">La pantalla muestra los ajustes del mando.</p>';
        wireScreenSizeControls(displayDraft,preview);
        $('#new-display-style').addEventListener('change',event=>{displayDraft.style=event.target.value;preview();},{signal:modalAbort.signal});
        $('#new-display-color').addEventListener('input',event=>{displayDraft.accent=event.target.value;preview();},{signal:modalAbort.signal});
        $$('input[type=checkbox]',target).forEach(input=>input.addEventListener('change',()=>{displayDraft.fields[input.name]=input.checked;preview();},{signal:modalAbort.signal}));
      } else {
        if(!allowedActions.some(action=>action.value===draft.action))draft.action=allowedActions[0].value;
        if(actionValueChoices(draft.action)&&!actionValueChoices(draft.action).some(option=>option.value===draft.value))draft.value=defaultActionValue(draft.action);
        target.innerHTML=field('Acción','<select id="button-action">'+selectOptions(allowedActions,draft.action)+'</select>')+(actionValueChoices(draft.action)?field(actionValueLabel(draft.action),'<select id="action-value">'+selectOptions(actionValueChoices(draft.action),draft.value||defaultActionValue(draft.action))+'</select>'):draft.action==='learned'?'<p class="muted small">Aprende la señal del mando original. Probarla es opcional; puedes guardarla en cuanto se reciba.</p>':'');
        if(original?._existingType&&$('#button-action'))$('#button-action').disabled=true;
        $('#button-action')?.addEventListener('change',event=>{draft.action=event.target.value;draft.value=defaultActionValue(draft.action);renderActionFields();},{signal:modalAbort.signal});
        $('#action-value')?.addEventListener('change',event=>{draft.value=event.target.value;renderEntityFields();},{signal:modalAbort.signal});
      }
      renderEntityFields();
    };
    showModal(original?'Editar función':'Añadir función',field('Tipo de función','<select id="function-type">'+selectOptions([{value:'button',name:'Botón'},{value:'dual',name:'Botón de doble acción'},{value:'group',name:'Carpeta'},{value:'display',name:'Pantalla'}],draft.type)+'</select>')+'<div id="button-live" class="button-live"></div><div id="button-appearance">'+field('Nombre','<input id="button-name" maxlength="40" value="'+esc(draft.name)+'">')+checkField('show-name','Mostrar texto',draft.showName)+'<div class="form-grid">'+field('Icono','<select id="button-icon">'+selectOptions(symbols,draft.icon)+'</select>')+field('Color','<input type="color" id="button-color" value="'+esc(draft.color)+'">')+'</div></div><div id="action-fields"></div><div id="function-send-mode"></div><div id="function-entity"></div><div id="function-learning"></div><p id="form-error" class="warning" hidden></p>',[
      ...(original?[{label:'Eliminar',className:'danger',run:()=>{closeModal();confirmDelete('Eliminar función','Se eliminará «'+original.name+'» de este mando.',()=>{const slot=getButton(d,original.id);if(slot)slot.row.cells[slot.index]=null;});}}]:[]),
      {label:'Cancelar'},{label:'Guardar cambios',className:'primary',run:async()=>{
        draft.name=draft.name.trim();
        if(draft.type==='display') {
          if(!Object.values(displayDraft.fields).some(Boolean)){formError('Selecciona al menos un dato para la pantalla.');return;}
          if(original){const slot=getButton(d,original.id);if(slot)slot.row.cells[slot.index]=null;}
          d.rows.unshift(copy(displayDraft));
        } else {
          if(!draft.name){formError('Escribe un nombre para la función.');return;}
          if(draft.type==='dual') {
            const invalid=draft.actions.findIndex(side=>!side.name.trim()||(!side.showName&&side.icon==='none'));
            if(invalid>=0){previewSide=invalid;renderDual();preview();formError('En Acción '+(invalid+1)+', escribe un nombre y comprueba que se muestre el texto o un icono.');return;}
            draft.actions=dualActions(draft,d);
          } else if(draft.icon==='none'&&!draft.showName){formError('Activa «Mostrar texto» o selecciona un icono para que el botón se vea.');return;}
          if(draft.type==='group'&&draft.group==='custom'&&(!draft.children.length||draft.children.some(child=>!child.name.trim()||(child.showName===false&&child.icon==='none')))){formError('Añade al menos un botón con nombre y comprueba que se muestre el texto o un icono.');return;}
          syncDraftEntities();
          if(automationButtons(d,draft).some(b=>!new RegExp('^'+entityDomain(d,b)+'\\.[a-z0-9_]{1,240}$').test(b.entity||'')||entityTaken(b.entity,b.id,d,draft))){formError('Revisa las entidades: cada función debe tener un identificador válido y único.');return;}
          if(original)Object.assign(original,copy(draft));else{let slot=placement&&d.rows.find(r=>r.id===placement.rowId);if(slot&&slot.type==='buttons'&&!slot.cells[placement.index])slot.cells[placement.index]=copy(draft);else{const empty=findEmpty(d);empty.row.cells[empty.index]=copy(draft);}}
        }
        if(await persist()){closeModal();render();toast('Función guardada.');}
      }}
    ],()=>{
      updateAppearance();preview();renderActionFields();if(original?._existingType)$('#function-type').disabled=true;
      $('#function-type').addEventListener('change',event=>{draft.type=event.target.value;updateAppearance();if(draft.type==='dual'&&(!draft.name.trim()||draft.name==='Nueva función')){draft.name=d.type==='stateful'?'Encendido del aire':'Botón de doble acción';$('#button-name').value=draft.name;}if(draft.type==='group'&&draft.icon==='remote'){draft.icon='folder';$('#button-icon').value='folder';}renderActionFields();preview();},{signal:modalAbort.signal});
      $('#button-name').addEventListener('input',event=>{draft.name=event.target.value;preview();},{signal:modalAbort.signal});
      $('#button-icon').addEventListener('change',event=>{draft.icon=event.target.value;preview();},{signal:modalAbort.signal});
      $('#button-color').addEventListener('input',event=>{draft.color=event.target.value;preview();},{signal:modalAbort.signal});
      $('input[name="show-name"]',modalBody).addEventListener('change',event=>{draft.showName=event.target.checked;preview();},{signal:modalAbort.signal});
    });
  }
  function changeColumns(d,id,delta) {
    const r=d.rows.find(v=>v.id===id);if(!r||r.type!=='buttons')return;const next=clamp(r.columns+delta,1,6,1);if(next===r.columns)return;
    const count=r.cells.filter(Boolean).length;
    if(count>next) {const element=app.querySelector('[data-row="'+CSS.escape(r.id)+'"]');$$('.remote-button',element).forEach(b=>{b.classList.remove('blocked');void b.offsetWidth;b.classList.add('blocked');setTimeout(()=>b.classList.remove('blocked'),1100);});toast('Esta fila tiene '+count+' botones. Mueve o elimina uno antes de reducirla.');return;}
    if(delta<0)r.cells.splice(r.cells.lastIndexOf(null),1);else r.cells.push(null);r.columns=next;persist();render();
  }
  app.addEventListener('click',event=>{
    const target=event.target.closest('button');if(!target||target.disabled)return;
    if(Date.now()<suppressClickUntil){event.preventDefault();return;}
    if(target.hasAttribute('data-refresh-panel')){window.location.reload();return;}
    if(independentSending){toast('Espera a que termine el envío.');return;}
    if(saveFailed&&!target.hasAttribute('data-home')&&!target.dataset.open&&!target.dataset.copyStateEntity){toast('Recarga el panel para continuar con la configuración confirmada.');return;}
    if(!isAdmin&&!target.dataset.open&&!target.dataset.button&&!target.hasAttribute('data-home')&&!target.dataset.viewSavedState&&!target.dataset.copyStateEntity){toast('Necesitas permisos de administrador para editar IR Pro.');return;}
    if(target.hasAttribute('data-home')){view='home';editing=false;render();return;}
    if(target.hasAttribute('data-add-emitter')){addEmitter();return;}
    if(target.dataset.addDevice){newDevice(target.dataset.addDevice);return;}
    if(target.dataset.deviceMenu){deviceMenu(target.dataset.deviceMenu);return;}
    if(target.dataset.emitterMenu){emitterMenu(target.dataset.emitterMenu);return;}
    if(!isAdmin&&!target.dataset.open&&!target.dataset.button&&!target.hasAttribute('data-home')&&!target.dataset.viewSavedState&&!target.dataset.copyStateEntity){toast('Necesitas permisos de administrador para editar IR Pro.');return;}
    if(target.dataset.open){model.selected=target.dataset.open;view='remote';editing=false;render();return;}
    const d=selected();if(!d)return;
    if(target.hasAttribute('data-learn-state')){learnState(d);return;}
    if(target.dataset.relearnState){learnState(d,target.dataset.relearnState);return;}
    if(target.dataset.clearStateSignal){clearStateSignal(d,target.dataset.clearStateSignal);return;}
    if(target.dataset.deleteSavedState){deleteSavedState(d,target.dataset.deleteSavedState);return;}
    if(target.hasAttribute('data-delete-all-states')){deleteAllSavedStates(d);return;}
    if(target.dataset.viewSavedState){viewSavedState(d,target.dataset.viewSavedState);return;}
    if(target.dataset.copyStateEntity){void copySavedStateEntity(d,target.dataset.copyStateEntity);return;}
    if(target.hasAttribute('data-edit')){editing=!editing;render();return;}
    if(target.hasAttribute('data-device-settings')){renameDevice(d);return;}
    if(target.dataset.button){const slot=getButton(d,target.dataset.button);if(slot){if(editing)editButton(d,slot.button);else execute(d,slot.button);}return;}
    if(!editing)return;
    if(target.hasAttribute('data-add-row')){d.rows.push(row([null]));persist();render();toast('Fila añadida · Altura 2.');return;}
    if(target.hasAttribute('data-add-element')){chooseElement(d);return;}
    if(target.hasAttribute('data-add-display')){editDisplay(d,displayRow(),true);return;}
    if(target.dataset.addSlot){chooseElement(d,{rowId:target.dataset.addSlot,index:Number(target.dataset.index)});return;}
    if(target.dataset.editDisplay){const r=d.rows.find(v=>v.id===target.dataset.editDisplay);if(r)editDisplay(d,r);return;}
    if(target.dataset.columns){changeColumns(d,target.dataset.columns,Number(target.dataset.delta));return;}
    if(target.dataset.width){const r=d.rows.find(v=>v.id===target.dataset.width);if(r?.type==='display'){r.width=clamp(clamp(r.width,3,6,3)+Number(target.dataset.delta),3,6,3);persist();render();}return;}
    if(target.dataset.height){const r=d.rows.find(v=>v.id===target.dataset.height);if(r){r.height=clamp(r.height+Number(target.dataset.delta),r.type==='display'?2:1,4,2);persist();render();}return;}
    if(target.dataset.deleteRow){const r=d.rows.find(v=>v.id===target.dataset.deleteRow);if(!r)return;const remove=()=>{d.rows=d.rows.filter(v=>v!==r);};if(r.type==='display'||r.cells.some(Boolean))confirmDelete('Eliminar '+(r.type==='display'?'pantalla':'fila'),'Se eliminará '+(r.type==='display'?'esta pantalla':'la fila y todos sus botones')+' del mando.',remove);else{remove();persist();render();}return;}
  });
  function clearDrag() {$$('.dragging,.drop-target',app).forEach(e=>e.classList.remove('dragging','drop-target'));dragGhost?.remove();dragGhost=null;drag=null;}
  function clearTouchDrag() {
    const active=touchDrag;touchDrag=null;
    try{if(active?.tile.hasPointerCapture(active.pointerId))active.tile.releasePointerCapture(active.pointerId);}catch{}
    touchGhost?.remove();touchGhost=null;$$('.dragging,.drop-target',app).forEach(element=>element.classList.remove('dragging','drop-target'));
  }
  function finishTouchLanding(entry) {
    if(!landingGhosts.delete(entry))return;clearTimeout(entry.timer);entry.animation?.cancel();entry.ghost.remove();if(entry.target.isConnected)entry.target.style.removeProperty('visibility');
  }
  function landTouchGhost(ghost,target) {
    if(!ghost)return;if(!target||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){ghost.remove();return;}
    const from=ghost.getBoundingClientRect(),to=target.getBoundingClientRect();target.style.visibility='hidden';
    const frame=rect=>({left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px',transform:'none'});
    const entry={ghost,target,animation:null,timer:null};landingGhosts.add(entry);
    try{entry.animation=ghost.animate([frame(from),frame(to)],{duration:320,easing:'cubic-bezier(.16,1,.3,1)',fill:'forwards'});entry.timer=setTimeout(()=>finishTouchLanding(entry),460);entry.animation.finished.then(()=>finishTouchLanding(entry),()=>finishTouchLanding(entry));}catch{finishTouchLanding(entry);}
  }
  app.addEventListener('pointerdown',event=>{
    if(!editing||event.pointerType==='mouse'||event.isPrimary===false||modal.open)return;
    const tile=event.target.closest('[data-button]');if(!tile)return;
    clearTouchDrag();const bounds=tile.getBoundingClientRect();touchDrag={pointerId:event.pointerId,tile,key:tile.dataset.button,device:model.selected,x:event.clientX,y:event.clientY,offsetX:event.clientX-bounds.left,offsetY:event.clientY-bounds.top,dragging:false};
  },{signal:lifecycle.signal});
  window.addEventListener('pointermove',event=>{
    const active=touchDrag;if(!active||active.pointerId!==event.pointerId)return;
    if(!active.dragging&&Math.hypot(event.clientX-active.x,event.clientY-active.y)<8)return;
    event.preventDefault();
    if(!active.dragging){
      active.dragging=true;const bounds=active.tile.getBoundingClientRect();touchGhost=active.tile.cloneNode(true);touchGhost.removeAttribute('draggable');touchGhost.removeAttribute('id');touchGhost.removeAttribute('data-button');touchGhost.removeAttribute('data-drop-row');touchGhost.removeAttribute('data-drop-index');touchGhost.setAttribute('aria-hidden','true');touchGhost.inert=true;
      Object.assign(touchGhost.style,{position:'fixed',width:bounds.width+'px',height:bounds.height+'px',zIndex:'100000',pointerEvents:'none',margin:'0',boxSizing:'border-box',boxShadow:'0 12px 36px #0006',opacity:'.96'});root.appendChild(touchGhost);active.tile.classList.add('dragging');try{active.tile.setPointerCapture(event.pointerId);}catch{}
    }
    touchGhost.style.left=(event.clientX-active.offsetX)+'px';touchGhost.style.top=(event.clientY-active.offsetY)+'px';
    const target=scope.elementFromPoint?.(event.clientX,event.clientY)?.closest('[data-drop-row]');
    $$('.drop-target',app).forEach(element=>{if(element!==target)element.classList.remove('drop-target');});if(target&&app.contains(target))target.classList.add('drop-target');
  },{passive:false,signal:lifecycle.signal});
  window.addEventListener('pointerup',event=>{
    const active=touchDrag;if(!active||active.pointerId!==event.pointerId)return;
    if(!active.dragging){clearTouchDrag();return;}
    event.preventDefault();suppressClickUntil=Date.now()+450;
    const ghost=touchGhost;touchGhost=null;
    const target=scope.elementFromPoint?.(event.clientX,event.clientY)?.closest('[data-drop-row]'),device=selected();
    const from=device&&getButton(device,active.key),to=device?.rows.find(row=>row.id===target?.dataset.dropRow),index=Number(target?.dataset.dropIndex);
    const moved=editing&&device?.id===active.device&&from&&to?.type==='buttons'&&Number.isInteger(index)&&index>=0&&index<to.columns;
    if(moved){const other=to.cells[index];to.cells[index]=from.button;from.row.cells[from.index]=other;}
    clearTouchDrag();if(moved){persist();render();toast('Botón colocado.');}
    landTouchGhost(ghost,app.querySelector('[data-button="'+CSS.escape(active.key)+'"]'));
  },{passive:false,signal:lifecycle.signal});
  window.addEventListener('pointercancel',event=>{if(touchDrag?.pointerId===event.pointerId)clearTouchDrag();},{signal:lifecycle.signal});
  window.addEventListener('blur',()=>clearTouchDrag(),{signal:lifecycle.signal});
  app.addEventListener('dragstart',event=>{
    if(touchDrag){event.preventDefault();return;}
    const element=event.target.closest('[data-button]');if(!editing||!element){event.preventDefault();return;}
    drag={device:model.selected,button:element.dataset.button};event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',drag.button);
    dragGhost=element.cloneNode(true);dragGhost.style.cssText+=';position:fixed;left:-1000px;top:-1000px;width:'+element.offsetWidth+'px;height:'+element.offsetHeight+'px;opacity:.9;transform:rotate(2deg);';root.appendChild(dragGhost);event.dataTransfer.setDragImage(dragGhost,event.offsetX,event.offsetY);requestAnimationFrame(()=>element.classList.add('dragging'));
  });
  app.addEventListener('dragover',event=>{
    const target=event.target.closest('[data-drop-row]');if(!editing||!drag||!target)return;event.preventDefault();event.dataTransfer.dropEffect='move';$$('.drop-target',app).forEach(e=>e.classList.remove('drop-target'));target.classList.add('drop-target');
  });
  app.addEventListener('drop',event=>{
    const target=event.target.closest('[data-drop-row]'),d=selected();if(!editing||!drag||!target||drag.device!==d?.id)return;event.preventDefault();
    const from=getButton(d,drag.button),to=d.rows.find(r=>r.id===target.dataset.dropRow),index=Number(target.dataset.dropIndex);
    if(from&&to?.type==='buttons'&&index>=0&&index<to.columns){const moving=from.button;from.row.cells[from.index]=to.cells[index];to.cells[index]=moving;persist();clearDrag();render();const landed=app.querySelector('[data-button="'+CSS.escape(moving.id)+'"]');landed?.animate([{transform:'scale(.94)',opacity:.6},{transform:'scale(1)',opacity:1}],{duration:280,easing:'cubic-bezier(.16,1,.3,1)'});toast('Botón colocado.');}else clearDrag();
  });
  app.addEventListener('dragend',clearDrag);
  for(const event of ['wheel','touchmove','pointerdown','keydown'])window.addEventListener(event,()=>{inputGeneration++;},{capture:true,passive:true,signal:lifecycle.signal});
  scope.querySelector('#sidebar-toggle')?.addEventListener('click',openMenu,{signal:lifecycle.signal});
  mountIconPickers(scope,lifecycle);
  if(api.subscribe)Promise.resolve(api.subscribe(receiveEnvelope)).then(stop=>{if(disposed)stop?.();else unsubscribe=stop;}).catch(()=>{});
  render();
  return {
    hassChanged(){refreshAmbientReadings();},
    dispose(){disposed=true;operation++;unsubscribe?.();modalAbort?.abort();lifecycle.abort();clearTimeout(toastTimer);clearDrag();clearTouchDrag();for(const entry of Array.from(landingGhosts))finishTouchLanding(entry);if(modal.open)modal.close();if(entityModal.open)entityModal.close();}
  };
}
