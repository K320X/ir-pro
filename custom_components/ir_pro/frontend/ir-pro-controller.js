export function mountStudio(root, api, initial, isAdmin, openMenu) {
  const scope=root.getRootNode(), lifecycle=new AbortController(), observers=[];
  const listen=(target,event,handler,options={})=>target.addEventListener(event,handler,{...options,signal:lifecycle.signal});
  const q = selector => root.querySelector(selector);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const functionIcons = new Set(['droplets','power','snowflake','fan','volume-2','sun','lightbulb','chevron-up','chevron-down','move-vertical','move-horizontal','settings','timer','timer-off','thermometer','wind','zap','leaf','moon','none']);
  const deviceIcons = new Set(['air-vent','tv','fan','remote']);
  let catalog=initial.catalog||[];
  const base={version:2,emitters:[]};
  let model=structuredClone(initial.model||base), route={screen:'home',emitterId:null,deviceId:null}, selected=null, draft=null, fresh=false, listening=null, candidate=null, revision=initial.revision||0, serial=0, modalStep=1, deleteId=null, editMode=false, functionContext=null, creatingEmitterId=null, deletingDevice=null, editingEmitterId=null, renamingDevice=null, movingFunction=null, dragContext=null, pointerContext=null, dragPreview=null, suppressFunctionClickUntil=0;
  const dialogIds=['#ir-add-dialog','#ir-delete-dialog','#ir-device-dialog','#ir-delete-device-dialog','#ir-function-dialog','#ir-delete-function-dialog','#ir-entity-dialog','#ir-rename-emitter-dialog','#ir-rename-remote-dialog','#ir-transfer-dialog'];
  let deletingFunction=null,transferringDevice=null;
  let pendingEntity=null,entityCustomized=false,entityAutoMessage='';
  let iconOptionsBuilt=false;
  let learningRequest=null;
  let disposed=false,saving=false,confirmedModel=structuredClone(model),signalBusy=false,candidateSignals={},lastRelevantState="";
  const drafts=new Map(), selections=new Map();
  const landingPreviews=new Set();
  const columnRejectionEffects=new Map();
  const observedGrids=new Set(),gridWidths=new WeakMap();
  let rowGeometryObserver=null;
  const uid=()=>{if(typeof crypto.randomUUID==='function')return crypto.randomUUID();const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0'));return hex.slice(0,4).join('')+'-'+hex.slice(4,6).join('')+'-'+hex.slice(6,8).join('')+'-'+hex.slice(8,10).join('')+'-'+hex.slice(10).join('');};
  const slug=text=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')||'funcion';
  const getEmitter=()=>model.emitters.find(e=>e.id===route.emitterId);
  const getDevice=()=>getEmitter()?.devices.find(d=>d.id===route.deviceId);
  const allFunctions=()=>model.emitters.flatMap(e=>e.devices.flatMap(d=>d.functions));
  const entityInUse=(entity,excludeKey=null)=>allFunctions().some(f=>f.key!==excludeKey&&f.entity===entity);
  function uniqueEntity(type,suffix,excludeKey=null){
    const stem=type+'.'+suffix;let entity=stem,n=2;while(entityInUse(entity,excludeKey))entity=stem+'_'+n++;
    return {entity,adjusted:entity!==stem};
  }
  const ready=f=>f.type==='switch'?!!(f.signals.on&&f.signals.off):!!f.signals.press;
  const functionCount=n=>n+' '+(n===1?'funci\u00f3n':'funciones');
  const cacheKey=()=>route.deviceId+'|'+(selected||'new');
  const iconMap={"power": "power", "air-vent": "air-conditioner", "tv": "television", "fan": "fan", "remote": "remote", "droplets": "water-percent", "snowflake": "snowflake", "volume-2": "volume-high", "sun": "white-balance-sunny", "lightbulb": "lightbulb", "chevron-up": "chevron-up", "chevron-down": "chevron-down", "move-vertical": "arrow-up-down", "move-horizontal": "arrow-left-right", "settings": "cog", "timer": "timer-outline", "timer-off": "timer-off-outline", "thermometer": "thermometer", "wind": "weather-windy", "zap": "lightning-bolt", "leaf": "leaf", "moon": "weather-night", "plus": "plus", "minus": "minus", "x": "close", "pencil": "pencil", "trash-2": "delete", "copy": "content-copy", "radio": "access-point", "scan-line": "remote", "check": "check", "arrow-left": "arrow-left", "ellipsis-vertical": "dots-vertical", "rows-3": "table-row-plus-after", "move": "cursor-move", "type": "format-text", "menu": "menu"};
  const glyph=name=>'<ha-icon icon="mdi:'+escape(iconMap[name]||name)+'" aria-hidden="true"></ha-icon>';
  function refreshIcons(){}
  const iconChoices=()=>Array.from(q('#ir-button-icon').options).filter(option=>functionIcons.has(option.value));
  const insideIconSelector=event=>event.composedPath?.().some(node=>node?.classList?.contains('ir-icon-selector'))||!!event.target.closest?.('.ir-icon-selector');
  function ensureIconOptions(){
    if(iconOptionsBuilt)return;
    q('#ir-icon-options').innerHTML=iconChoices().map(option=>'<button type="button" class="ir-icon-option cursor-interaction" id="ir-icon-option-'+escape(option.value)+'" role="option" data-icon-option="'+escape(option.value)+'" aria-selected="false" tabindex="-1"'+(option.disabled?' disabled':'')+'><span class="ir-icon-option-symbol">'+glyph(option.value==='none'?'type':option.value)+'</span><span class="ir-icon-option-label">'+escape(option.label||option.textContent)+'</span><span class="ir-icon-option-check" hidden>'+glyph('check')+'</span></button>').join('');
    iconOptionsBuilt=true;
  }
  function syncIconPicker(){
    ensureIconOptions();const value=q('#ir-button-icon').value,option=iconChoices().find(item=>item.value===value),list=q('#ir-icon-options');
    q('#ir-icon-value').innerHTML='<span class="ir-icon-option-symbol">'+glyph(value==='none'?'type':value)+'</span><span class="ir-icon-option-label">'+escape(option?.label||option?.textContent||'Icono')+'</span>';
    const focused=!list.hidden&&list.contains(scope.activeElement)?scope.activeElement.closest('[data-icon-option]'):null;
    list.querySelectorAll('[data-icon-option]').forEach(button=>{const selected=button.dataset.iconOption===value;button.setAttribute('aria-selected',String(selected));button.tabIndex=(focused?button===focused:selected)?0:-1;button.querySelector('.ir-icon-option-check').hidden=!selected;});
  }
  function closeIconPicker(returnFocus=false){
    const list=q('#ir-icon-options'),picker=q('#ir-icon-picker');if(!list||!picker)return;
    list.hidden=true;list.classList.remove('ir-icon-options-up');picker.setAttribute('aria-expanded','false');
    if(returnFocus&&q('#ir-function-dialog').open&&!q('#ir-entity-dialog').open)picker.focus();
  }
  function positionIconOptions(){
    const list=q('#ir-icon-options');if(!list||list.hidden)return;
    const picker=q('#ir-icon-picker').getBoundingClientRect(),dialog=q('#ir-function-dialog').getBoundingClientRect(),viewport=window.visualViewport;
    const top=Math.max((viewport?.offsetTop||0)+8,dialog.top+8),bottom=Math.min((viewport?.offsetTop||0)+(viewport?.height||window.innerHeight||document.documentElement.clientHeight)-8,dialog.bottom-8);
    const below=Math.max(0,bottom-picker.bottom-6),above=Math.max(0,picker.top-top-6),up=below<Math.min(270,list.scrollHeight)&&above>below;
    list.classList.toggle('ir-icon-options-up',up);list.style.maxHeight=Math.max(1,Math.floor(Math.min(270,up?above:below)))+'px';
  }
  function focusIconOption(button){
    if(!button)return;const list=q('#ir-icon-options');list.querySelectorAll('[data-icon-option]').forEach(option=>option.tabIndex=option===button?0:-1);
    button.focus();button.scrollIntoView({block:'nearest',inline:'nearest'});positionIconOptions();
  }
  function openIconPicker(){
    if(!draft||!q('#ir-function-dialog').open||q('#ir-entity-dialog').open||q('#ir-delete-function-dialog').open)return;
    syncIconPicker();const list=q('#ir-icon-options');list.hidden=false;q('#ir-icon-picker').setAttribute('aria-expanded','true');positionIconOptions();refreshIcons();
    focusIconOption(list.querySelector('[aria-selected="true"]:not(:disabled)')||list.querySelector('[data-icon-option]:not(:disabled)'));
  }
  function chooseIcon(value){
    if(!draft||q('#ir-icon-options').hidden||!iconChoices().some(option=>option.value===value&&!option.disabled))return;
    q('#ir-button-icon').value=value;updatePreview();closeIconPicker(true);
  }
  const columnCount=value=>Number.isFinite(Number(value))?Math.max(1,Math.min(6,Math.floor(Number(value)))):1;
  const rowHeight=value=>{let level=Number(value);if(!Number.isFinite(level))return 2;if(level>4)level=Math.round(level/80);return Math.max(1,Math.min(4,Math.round(level)));};
  const newRow=()=>({id:uid(),columns:1,height:2,cells:[null]});
  function emptySlot(device,excludedRowId=null){
    for(const row of device.layout.rows){if(row.id===excludedRowId)continue;const index=row.cells.indexOf(null);if(index!==-1)return {rowId:row.id,cellIndex:index};}
    return null;
  }
  function ensureEmptySlot(device,excludedRowId=null){
    const available=emptySlot(device,excludedRowId);if(available)return available;
    const row=newRow();device.layout.rows.push(row);return {rowId:row.id,cellIndex:0};
  }
  function layoutRow(device,id){return device?.layout?.rows.find(row=>row.id===id);}
  // Layout is optional in version 2. Repair only its placement metadata; never
  // reject or remove valid function definitions because a saved layout is old.
  function normalizeDeviceLayout(device){
    const keys=new Set(device.functions.map(f=>f.key)),placed=new Set(),rowIds=new Set(),pending=[];
    const rows=[];
    const currentScale=device.layout?.heightScale==='square-at-two';
    const previous=Array.isArray(device.layout?.rows)?device.layout.rows:[];
    for(const source of previous){
      if(!source||typeof source!=='object')continue;
      let id=typeof source.id==='string'&&source.id&&!rowIds.has(source.id)?source.id:uid();rowIds.add(id);
      const columns=columnCount(source.columns),height=source.height==null||!Number.isFinite(Number(source.height))?2:Math.min(4,rowHeight(source.height)+(currentScale?0:1));
      const row={id,columns,height,cells:Array(columns).fill(null)};
      if(Array.isArray(source.cells))source.cells.forEach((key,index)=>{
        if(typeof key!=='string'||!keys.has(key)||placed.has(key))return;placed.add(key);
        if(index<columns)row.cells[index]=key;else pending.push(key);
      });
      rows.push(row);
    }
    if(!rows.length)rows.push(newRow());
    device.layout={heightScale:'square-at-two',rows};
    for(const f of device.functions)if(!placed.has(f.key)){placed.add(f.key);pending.push(f.key);}
    for(const key of pending){const spot=ensureEmptySlot(device);layoutRow(device,spot.rowId).cells[spot.cellIndex]=key;}
    return device.layout;
  }
  function normalizeModelLayouts(value){for(const emitter of value.emitters)for(const device of emitter.devices)normalizeDeviceLayout(device);return value;}
  function functionSlot(device,key){
    for(const row of device.layout.rows){const index=row.cells.indexOf(key);if(index!==-1)return {rowId:row.id,cellIndex:index};}return null;
  }
  function pulseCommand(key){
    if(editMode)return;const tile=Array.from(q('#ir-buttons').querySelectorAll('[data-function-key]')).find(node=>node.dataset.functionKey===key);if(!tile)return;
    tile.classList.add('ir-pressed');tile.addEventListener('animationend',()=>tile.classList.remove('ir-pressed'),{once:true});
    setTimeout(()=>tile.classList.remove('ir-pressed'),650);
  }
  function focusFunctionButton(key){Array.from(q('#ir-buttons').querySelectorAll('button[data-function]')).find(node=>node.dataset.function===key)?.focus();}
  function releasePointer(context){try{if(context?.handle.hasPointerCapture(context.pointerId))context.handle.releasePointerCapture(context.pointerId);}catch{}}
  function finishLanding(entry,restoreFocus=false){
    if(!landingPreviews.delete(entry))return;clearTimeout(entry.timer);
    try{entry.animation?.cancel();}catch{}
    entry.target.classList.remove('ir-landing');entry.preview.remove();
    if(restoreFocus&&route.screen==='editor'&&route.deviceId===entry.deviceId&&entry.target.isConnected&&scope.activeElement===document.body)focusFunctionButton(entry.key);
  }
  function clearLandingPreviews(){for(const entry of Array.from(landingPreviews))finishLanding(entry);}
  function startLanding(preview,key,deviceId){
    const target=Array.from(q('#ir-buttons').querySelectorAll('[data-function-key]')).find(node=>node.dataset.functionKey===key),element=preview.element;
    if(!target||route.deviceId!==deviceId||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches||typeof element.animate!=='function'){element.remove();return;}
    const from=element.getBoundingClientRect(),to=target.getBoundingClientRect();
    if(!to.width||!to.height){element.remove();return;}
    const frame=rect=>({left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});
    Object.assign(element.style,frame(from));target.classList.add('ir-landing');
    const entry={preview:element,target,deviceId,key,animation:null,timer:null};landingPreviews.add(entry);
    try{
      entry.animation=element.animate([frame(from),frame(to)],{duration:280,easing:'cubic-bezier(.16,1,.3,1)',fill:'forwards'});
      entry.timer=setTimeout(()=>finishLanding(entry,true),420);
      entry.animation.finished.then(()=>finishLanding(entry,true),()=>finishLanding(entry,true)).catch(()=>{});
    }catch{finishLanding(entry,true);}
  }
  function clearDragPreview(){dragPreview?.element.remove();dragPreview=null;q('#ir-buttons').querySelectorAll('.ir-drag-source').forEach(tile=>tile.classList.remove('ir-drag-source'));}
  function positionDragPreview(x,y){if(!dragPreview)return;dragPreview.element.style.left=(x-dragPreview.offsetX)+'px';dragPreview.element.style.top=(y-dragPreview.offsetY)+'px';}
  function createDragPreview(tile,x,y){
    clearLandingPreviews();clearDragPreview();const rect=tile.getBoundingClientRect(),element=tile.cloneNode(true);
    for(const node of [element,...element.querySelectorAll('*')]){
      node.removeAttribute('id');node.removeAttribute('draggable');node.removeAttribute('autofocus');
      node.removeAttribute('data-function-key');node.removeAttribute('data-function');
      node.removeAttribute('tabindex');
    }
    element.classList.remove('ir-moving','ir-drag-source','ir-selected','ir-pressed');element.classList.add('ir-drag-preview');element.setAttribute('aria-hidden','true');element.inert=true;
    Object.assign(element.style,{position:'fixed',zIndex:'10000',pointerEvents:'none',width:rect.width+'px',height:rect.height+'px',boxSizing:'border-box',margin:'0',animation:'none',transform:'none'});
    const computed=getComputedStyle(tile);for(const property of ['--ir-row-height','--ir-button-accent'])element.style.setProperty(property,computed.getPropertyValue(property));
    dragPreview={element,offsetX:Math.max(0,Math.min(rect.width,x-rect.left)),offsetY:Math.max(0,Math.min(rect.height,y-rect.top))};root.appendChild(element);positionDragPreview(x,y);return dragPreview;
  }
  function resetMoving(){const pointer=pointerContext;pointerContext=null;releasePointer(pointer);clearColumnRejections();clearLandingPreviews();clearDragPreview();movingFunction=null;dragContext=null;if(suppressFunctionClickUntil===Infinity)suppressFunctionClickUntil=Date.now()+500;q('#ir-buttons').querySelectorAll('.ir-drop-target,.ir-moving').forEach(cell=>cell.classList.remove('ir-drop-target','ir-moving'));}
  function gridCellAt(x,y){const cell=scope.elementFromPoint(x,y)?.closest('[data-grid-target-row]');return cell&&q('#ir-buttons').contains(cell)?cell:null;}
  function highlightGridCell(cell){q('#ir-buttons').querySelectorAll('.ir-drop-target').forEach(node=>{if(node!==cell)node.classList.remove('ir-drop-target');});cell?.classList.add('ir-drop-target');}
  function moveFunctionTo(rowId,cellIndex){
    const device=getDevice();if(!editMode||!device||!movingFunction)return false;normalizeDeviceLayout(device);
    const from=functionSlot(device,movingFunction),target=layoutRow(device,rowId),index=Number(cellIndex);
    if(!from||!target||!Number.isInteger(index)||index<0||index>=target.columns)return false;
    const key=movingFunction,other=target.cells[index];
    if(from.rowId!==rowId||from.cellIndex!==index){layoutRow(device,from.rowId).cells[from.cellIndex]=other;target.cells[index]=key;}
    const preview=dragPreview;dragPreview=null;resetMoving();renderRemote();refreshIcons();persist();feedback(other&&other!==key?'Funciones intercambiadas.':'Funci\u00f3n colocada.');focusFunctionButton(key);
    if(preview)startLanding(preview,key,device.id);return true;
  }
  function clearColumnRejection(element){
    const effect=columnRejectionEffects.get(element);if(!effect)return;columnRejectionEffects.delete(element);
    clearTimeout(effect.timer);element.removeEventListener('animationend',effect.onEnd);element.classList.remove(effect.className);
  }
  function clearColumnRejections(){for(const element of Array.from(columnRejectionEffects.keys()))clearColumnRejection(element);}
  function pulseColumnRejection(element,className){
    clearColumnRejection(element);element.classList.remove(className);void element.offsetWidth;element.classList.add(className);
    const onEnd=event=>{if(event.target===element&&event.animationName==='ir-column-alert')clearColumnRejection(element);};
    const timer=setTimeout(()=>clearColumnRejection(element),1900);columnRejectionEffects.set(element,{className,onEnd,timer});element.addEventListener('animationend',onEnd);
  }
  function rejectColumnReduction(row,next,count){
    const blockers=new Set(row.cells.slice(next).filter(Boolean)),container=q('#ir-buttons');
    container.querySelectorAll('.ir-command[data-function-key]').forEach(tile=>{if(blockers.has(tile.dataset.functionKey))pulseColumnRejection(tile,'ir-column-blocked');});
    container.querySelectorAll('[data-columns-delta]').forEach(button=>{if(button.dataset.rowId===row.id&&Number(button.dataset.columnsDelta)===-1)pulseColumnRejection(button,'ir-column-rejected');});
    feedback('No puedes reducir a '+next+' '+(next===1?'columna':'columnas')+': esta fila tiene '+count+' '+(count===1?'funci\u00f3n':'funciones')+'. Mueve o elimina una funci\u00f3n antes de reducir.');
  }
  function changeRowColumns(id,delta){
    const device=getDevice();if(!editMode||!device||![-1,1].includes(delta))return;
    const row=layoutRow(device,id);if(!row||!Array.isArray(row.cells))return;const next=columnCount(row.columns+delta);if(next===row.columns)return;
    const lastEmpty=row.cells.lastIndexOf(null),count=row.cells.filter(Boolean).length;
    if(delta<0&&(count>next||lastEmpty<0)){rejectColumnReduction(row,next,count);return;}
    resetMoving();if(delta<0)row.cells.splice(lastEmpty,1);else while(row.cells.length<next)row.cells.push(null);row.columns=next;
    renderRemote();refreshIcons();persist();feedback('Columnas actualizadas.');
    const controls=Array.from(q('#ir-buttons').querySelectorAll('[data-columns-delta]')).filter(button=>button.dataset.rowId===id);
    (controls.find(button=>Number(button.dataset.columnsDelta)===delta&&!button.disabled)||controls.find(button=>!button.disabled))?.focus();
  }
  function syncRowGeometry(grid){
    const row=grid.closest('.ir-layout-row');if(!row)return;
    const computed=getComputedStyle(grid),available=grid.clientWidth;if(!Number.isFinite(available)||available<=0)return;
    const columns=columnCount(Number.parseFloat(computed.getPropertyValue('--ir-display-columns'))||Number.parseFloat(computed.getPropertyValue('--ir-columns'))||grid.dataset.columns);
    const gap=Number.parseFloat(computed.columnGap)||0;
    const width=Math.max(1,Math.min(112,(available-gap*(columns-1))/columns)),cellWidth=(Math.round(width*100)/100)+'px';
    if(grid.style.getPropertyValue('--ir-cell-width')!==cellWidth)grid.style.setProperty('--ir-cell-width',cellWidth);
    const level=rowHeight(grid.style.getPropertyValue('--ir-height-level'));
    const height=(Math.round(Math.max(1,width+30*(level-2))*100)/100)+'px';
    for(const element of [row,grid])if(element.style.getPropertyValue('--ir-row-height')!==height)element.style.setProperty('--ir-row-height',height);
  }
  function observeRowGeometry(){
    if(!rowGeometryObserver&&typeof ResizeObserver!=='undefined')rowGeometryObserver=new ResizeObserver(entries=>{
      for(const entry of entries){
        if(!observedGrids.has(entry.target))continue;const box=entry.borderBoxSize,width=(Array.isArray(box)?box[0]:box)?.inlineSize??entry.contentRect.width;
        if(gridWidths.has(entry.target)&&Math.abs(gridWidths.get(entry.target)-width)<0.1)continue;gridWidths.set(entry.target,width);syncRowGeometry(entry.target);
      }
    });
    rowGeometryObserver?.disconnect();observedGrids.clear();
    for(const grid of q('#ir-buttons').querySelectorAll('.ir-row-grid')){observedGrids.add(grid);syncRowGeometry(grid);rowGeometryObserver?.observe(grid);}
  }
  function changeRowHeight(id,delta){
    const device=getDevice();if(!editMode||!device||![-1,1].includes(delta))return;normalizeDeviceLayout(device);
    const row=layoutRow(device,id);if(!row)return;const level=Math.max(1,Math.min(4,row.height+delta));if(level===row.height)return;clearLandingPreviews();row.height=level;
    const element=Array.from(q('#ir-buttons').querySelectorAll('.ir-layout-row')).find(node=>node.dataset.rowId===id),grid=element?.querySelector('.ir-row-grid');
    if(element&&grid){
      for(const node of [element,grid])node.style.setProperty('--ir-height-level',String(level));
      const output=element.querySelector('.ir-row-height-value');if(output)output.textContent=String(level);
      const buttons=Array.from(element.querySelectorAll('[data-height-delta]'));for(const button of buttons)button.disabled=Number(button.dataset.heightDelta)<0?level===1:level===4;
      syncRowGeometry(grid);(buttons.find(button=>Number(button.dataset.heightDelta)===delta&&!button.disabled)||buttons.find(button=>!button.disabled))?.focus();
    }
    persist();
  }
  function removeLayoutRow(id){
    const device=getDevice();if(!editMode||!device)return;normalizeDeviceLayout(device);
    const row=layoutRow(device,id);if(!row||device.layout.rows.length===1||row.cells.some(Boolean))return;
    device.layout.rows=device.layout.rows.filter(item=>item.id!==id);renderRemote();refreshIcons();persist();feedback('Fila vac\u00eda eliminada.');
  }
  function validFunction(f){return f&&typeof f.key==='string'&&typeof f.name==='string'&&(f.showName===undefined||typeof f.showName==='boolean')&&functionIcons.has(f.icon)&&/^#[a-f0-9]{6}$/i.test(f.color)&&['button','switch'].includes(f.type)&&typeof f.entity==='string'&&new RegExp('^'+f.type+'\\.[a-z0-9_]+$').test(f.entity)&&f.signals&&['press','on','off'].every(k=>f.signals[k]===undefined||typeof f.signals[k]==='boolean');}
  function validModel(x){
    if(!x||x.version!==2||!Array.isArray(x.emitters)||x.emitters.length>12)return false;
    const ids=new Set(), sources=new Set(), entities=new Set();
    const unique=id=>typeof id==='string'&&!ids.has(id)&&(ids.add(id),true);
    return x.emitters.every(e=>e&&unique(e.id)&&typeof e.name==='string'&&typeof e.model==='string'&&catalog.some(s=>s.id===e.sourceId)&&!sources.has(e.sourceId)&&(sources.add(e.sourceId),true)&&Array.isArray(e.devices)&&e.devices.every(d=>d&&unique(d.id)&&typeof d.name==='string'&&deviceIcons.has(d.icon)&&Array.isArray(d.functions)&&d.functions.every(f=>validFunction(f)&&unique(f.key)&&!entities.has(f.entity)&&(entities.add(f.entity),true))));
  }
  function currentSwitchState(f){const state=api.state?.(f.entity);return state==='on'?true:state==='off'?false:(f.on??null);}
  function relevantState(){return JSON.stringify([catalog.map(item=>[item.id,sourceAvailable(item.id)]),allFunctions().filter(f=>f.type==='switch').map(f=>[f.key,currentSwitchState(f)])]);}
  function sourceAvailable(sourceId){const item=catalog.find(item=>item.id===sourceId);return !!item&&item.available!==false&&api.available(item.entity_id);}
  function globalError(message){q('#ir-global-error').textContent=message;q('#ir-global-error').hidden=!message;}
  function repairRoute(){if(route.screen==='editor'&&!getDevice())route={screen:'home',emitterId:null,deviceId:null};}
  function applyEnvelope(envelope){model=normalizeModelLayouts(structuredClone(envelope.model));catalog=envelope.catalog||catalog;revision=envelope.revision;confirmedModel=structuredClone(model);repairRoute();}
  async function persist(){
    if(saving||disposed)return false;
    if(!isAdmin){model=structuredClone(confirmedModel);render();globalError('Solo los administradores pueden cambiar la configuraci\u00f3n.');return false;}
    normalizeModelLayouts(model);const proposal=structuredClone(model);saving=true;root.inert=true;q('#ir-busy-status').textContent='Guardando\u2026';
    try{const envelope=await api.call('save',{model:proposal,expected_revision:revision});if(disposed)return false;applyEnvelope(envelope);globalError('');render();if(envelope.notices?.length)flowFeedback(envelope.notices.join(' '));return true;}
    catch(error){if(disposed)return false;model=structuredClone(confirmedModel);if(error.code==='revision_conflict'){try{applyEnvelope(await api.call('get'));}catch{}}repairRoute();render();globalError(error.code==='revision_conflict'?'La configuraci\u00f3n cambi\u00f3 desde otra sesi\u00f3n. Tu cambio no se ha guardado; revisa los datos actualizados y vuelve a intentarlo.':(error.message||'No se ha podido guardar. Se conserva la configuraci\u00f3n anterior.'));return false;}
    finally{saving=false;root.inert=false;q('#ir-busy-status').textContent='';}
  }
  normalizeModelLayouts(model);confirmedModel=structuredClone(model);
  function feedback(text){if(q('#ir-function-dialog').open){q('#ir-function-message').textContent=text;return;}q('#ir-feedback').textContent=text;}
  function functionError(text){q('#ir-function-error').textContent=text;q('#ir-function-error').hidden=false;}
  function flowFeedback(text){q('#ir-flow-feedback').textContent=text;}
  function clearEntityError(){q('#ir-entity-error').textContent='';q('#ir-entity-error').hidden=true;q('#ir-entity-name').setAttribute('aria-invalid','false');q('#ir-entity-name').classList.remove('ir-invalid');}
  function entityError(message){q('#ir-entity-error').textContent=message;q('#ir-entity-error').hidden=false;q('#ir-entity-name').setAttribute('aria-invalid','true');q('#ir-entity-name').classList.add('ir-invalid');q('#ir-entity-name').focus();}
  function closeEntityEditor(){pendingEntity=null;if(q('#ir-entity-dialog').open)q('#ir-entity-dialog').close();clearEntityError();}
  function updateDraftEntity(){
    if(!draft)return;
    let message='';
    if(fresh&&!entityCustomized){
      const emitter=getEmitter(),device=getDevice(),proposal=uniqueEntity(draft.type,slug((emitter?.name||'')+'_'+(device?.name||'')+'_'+draft.name));
      draft.entity=proposal.entity;if(proposal.adjusted)message='Se ha propuesto \u00ab'+proposal.entity+'\u00bb para evitar una entidad duplicada.';
    }else if(fresh){
      draft.entity=draft.type+'.'+draft.entity.slice(draft.entity.indexOf('.')+1);
    }
    q('#ir-entity-id').textContent=draft.entity;q('#ir-automation-action').textContent=draft.type==='switch'?'En una automatizaci\u00f3n, usa las acciones Encender o Apagar sobre esta entidad. El estado es estimado.':'En una automatizaci\u00f3n, selecciona la acci\u00f3n Pulsar y esta entidad.';
    const feedbackNode=q('#ir-function-message');
    if(message)feedbackNode.textContent=message;else if(entityAutoMessage&&feedbackNode.textContent===entityAutoMessage)feedbackNode.textContent='';
    entityAutoMessage=message;
  }
  function openEntityEditor(){
    if(!fresh||!draft||!functionContext||!q('#ir-function-dialog').open||q('#ir-entity-dialog').open||q('#ir-delete-function-dialog').open)return;
    closeIconPicker();updatePreview();pendingEntity={draft,context:functionContext,type:draft.type};
    q('#ir-entity-title').textContent='Cambiar nombre de la entidad';q('#ir-entity-prefix').textContent=draft.type+'.';q('#ir-entity-name').value=draft.entity.slice(draft.entity.indexOf('.')+1);clearEntityError();
    q('#ir-entity-dialog').showModal();syncDialogLayout();q('#ir-entity-name').focus();q('#ir-entity-name').select();
  }
  function acceptEntity(){
    if(!q('#ir-entity-dialog').open||!pendingEntity||pendingEntity.draft!==draft||pendingEntity.context!==functionContext||!q('#ir-function-dialog').open){closeEntityEditor();return;}
    const suffix=q('#ir-entity-name').value.trim();
    if(!/^[a-z0-9_]+$/.test(suffix)){entityError('Usa letras min\u00fasculas, n\u00fameros o guiones bajos. El nombre no puede estar vac\u00edo.');return;}
    const entity=draft.type+'.'+suffix;
    if(entityInUse(entity,fresh?null:selected)){entityError('Esa entidad ya est\u00e1 en uso por otra funci\u00f3n. Elige otro nombre.');return;}
    draft.entity=entity;entityCustomized=true;entityAutoMessage='';closeEntityEditor();updatePreview();feedback('Entidad preparada. Guarda la funci\u00f3n para confirmar el cambio.');
  }
  function syncDialogLayout(){
    const open=dialogIds.map(id=>q(id)).filter(dialog=>dialog.open);root.classList.toggle('ir-dialog-open',!!open.length);
  }
  function setDraft(){
    cancelLearning();closeDeleteFunctionDialog();
    const stored=getDevice()?.functions.find(f=>f.key===selected);fresh=!stored;
    draft=drafts.has(cacheKey())?structuredClone(drafts.get(cacheKey())):stored?structuredClone(stored):{key:uid(),name:'',showName:true,icon:'power',color:'#238fc4',type:'button',entity:'',signals:{},signal_refs:{},on:null};
    candidateSignals={};closeIconPicker();closeEntityEditor();entityCustomized=!!stored;entityAutoMessage='';delete draft.pendingEntity;renderEditor();
  }
  function go(next){
    cancelLearning();closeDeleteFunctionDialog();closeIconPicker();closeEntityEditor();if(q('#ir-function-dialog').open)closeFunctionEditor();if(q('#ir-rename-remote-dialog').open)q('#ir-rename-remote-dialog').close();if(q('#ir-transfer-dialog').open)q('#ir-transfer-dialog').close();closeMenus();resetMoving();route=next;editMode=false;selected=null;draft=null;flowFeedback('');q('#ir-feedback').textContent='';
    render();
  }
  function goHome(){go({screen:'home',emitterId:null,deviceId:null});}
  function openDevice(emitterId,deviceId){go({screen:'editor',emitterId,deviceId});}
  function openDeviceDialog(emitterId){
    if(!isAdmin)return;
    const e=model.emitters.find(x=>x.id===emitterId);if(!e)return;creatingEmitterId=e.id;q('#ir-device-name').value='';q('#ir-device-icon').value='air-vent';q('#ir-device-emitter').textContent='Emisor: '+e.name;q('#ir-device-error').hidden=true;q('#ir-device-dialog').showModal();syncDialogLayout();q('#ir-device-name').focus();
  }
  function openRenameEmitter(id){const e=model.emitters.find(x=>x.id===id);if(!e||!isAdmin)return;editingEmitterId=id;q('#ir-emitter-name').value=e.name;q('#ir-rename-emitter-error').hidden=true;q('#ir-rename-emitter-dialog').showModal();syncDialogLayout();q('#ir-emitter-name').focus();}
  function openRenameDevice(emitterId,deviceId){const device=model.emitters.find(e=>e.id===emitterId)?.devices.find(d=>d.id===deviceId);if(!device||!isAdmin)return;renamingDevice={emitterId,deviceId};q('#ir-rename-remote-input').value=device.name;q('#ir-rename-remote-icon').value=device.icon;q('#ir-rename-remote-error').hidden=true;q('#ir-rename-remote-dialog').showModal();syncDialogLayout();q('#ir-rename-remote-input').focus();}
  function buildDeviceTransfer(source,target,name){
    const copy=structuredClone(source);
    copy.name=name;
      const ids=new Set(model.emitters.flatMap(e=>[e.id,...e.devices.flatMap(d=>[d.id,...d.functions.map(f=>f.key),...(d.layout?.rows||[]).map(row=>row.id)])]));
      const nextId=()=>{let id;do{id=uid();}while(ids.has(id));ids.add(id);return id;};
      const keys=new Map();copy.id=nextId();
      const sameSource=model.emitters.find(e=>e.devices.some(d=>d.id===source.id))?.sourceId===target.sourceId;
      copy.functions.forEach(f=>{const key=nextId();keys.set(f.key,key);f.key=key;f.on=null;if(!sameSource){f.signals={};f.signal_refs={};}});
      if(copy.layout)copy.layout.rows=copy.layout.rows.map(row=>({...row,id:nextId(),cells:row.cells.map(key=>key===null?null:keys.get(key)||null)}));
      const used=new Set(allFunctions().map(f=>f.entity));
      copy.functions.forEach(f=>{
        const stem=f.type+'.'+slug(target.name+'_'+name+'_'+f.name);let entity=stem,n=2;
        while(used.has(entity))entity=stem+'_'+n++;
        used.add(entity);f.entity=entity;
      });
    normalizeDeviceLayout(copy);
    return {device:copy,changes:source.functions.map((f,index)=>({name:f.name,from:f.entity,to:copy.functions[index].entity}))};
  }
  function transferSelection(){
    const context=transferringDevice,emitter=model.emitters.find(e=>e.id===context?.emitterId),source=emitter?.devices.find(d=>d.id===context?.deviceId);
    const target=model.emitters.find(e=>e.id===q('#ir-transfer-emitter').value),name=q('#ir-transfer-name').value.trim();
    if(!context||!source)return {error:'El dispositivo ya no est\u00e1 disponible.'};
    if(!target)return {error:'Selecciona un emisor de destino.'};
    if(!name)return {error:'Escribe un nombre para el dispositivo.'};
    return {context,emitter,source,target,...buildDeviceTransfer(source,target,name)};
  }
  function renderTransferPreview(){
    if(!transferringDevice)return;
    const plan=transferSelection();
    q('#ir-transfer-error').hidden=true;q('#ir-confirm-transfer').disabled=!!plan.error;
    q('#ir-transfer-entities').hidden=!!plan.error||!plan.changes.length;
    q('#ir-transfer-preview').innerHTML=plan.error?'':plan.changes.map(change=>'<div class="ir-transfer-entity"><span>'+escape(change.name)+'</span><code>Nueva: '+escape(change.to)+'</code></div>').join('');
    q('#ir-transfer-hint').textContent='La copia tendr\u00e1 sus propias entidades. El dispositivo original conservar\u00e1 las suyas y sus automatizaciones.';
    const sourceEmitter=model.emitters.find(e=>e.id===transferringDevice.emitterId);q('#ir-transfer-signals').textContent=plan.target?.sourceId===sourceEmitter?.sourceId?'La copia conserva las se\u00f1ales del mismo emisor. Si el aparato f\u00edsico es distinto, vuelve a aprenderlas.':'En este emisor tendr\u00e1s que aprender y probar las se\u00f1ales de la copia. El dise\u00f1o y los botones se conservan.';
  }
  function openTransferDevice(emitterId,deviceId){
    if(!isAdmin)return;
    const emitter=model.emitters.find(e=>e.id===emitterId),source=emitter?.devices.find(d=>d.id===deviceId);if(!source)return;
    const targets=model.emitters;
    transferringDevice={emitterId,deviceId};
    q('#ir-transfer-source').textContent=source.name+' \u00b7 '+emitter.name;
    q('#ir-transfer-emitter').innerHTML=targets.map(e=>'<option value="'+escape(e.id)+'">'+escape(e.name)+'</option>').join('');
    q('#ir-transfer-emitter').value=emitter.id;
    let name=source.name+' (copia)',n=2;while(emitter.devices.some(d=>d.name===name))name=source.name+' (copia '+(n++)+')';
    q('#ir-transfer-name').value=name;
    renderTransferPreview();q('#ir-transfer-dialog').showModal();syncDialogLayout();q('#ir-transfer-name').focus();
  }
  function confirmDeviceTransfer(){
    if(!q('#ir-transfer-dialog').open)return;const plan=transferSelection();
    if(plan.error){q('#ir-transfer-error').textContent=plan.error;q('#ir-transfer-error').hidden=false;return;}
    const next=structuredClone(model),target=next.emitters.find(e=>e.id===plan.target.id);
    target.devices.push(plan.device);
    if(!validModel(next)){q('#ir-transfer-error').textContent='No se pudo completar el cambio. El dispositivo original se conserva.';q('#ir-transfer-error').hidden=false;return;}
    const destination=plan.target.name;
    model=normalizeModelLayouts(next);q('#ir-transfer-dialog').close();goHome();persist();flowFeedback('Dispositivo duplicado en '+destination+'.');
  }
  function closeMenus(returnFocus=false){
    let trigger=null;root.querySelectorAll('[data-menu-toggle]').forEach(button=>{if(button.getAttribute('aria-expanded')==='true')trigger=button;button.setAttribute('aria-expanded','false');});root.querySelectorAll('.ir-context-menu').forEach(menu=>{menu.hidden=true;menu.classList.remove('ir-menu-up');});if(returnFocus)trigger?.focus();
  }
  function toggleMenu(button){
    const wasOpen=button.getAttribute('aria-expanded')==='true';closeMenus();if(wasOpen)return;const menu=scope.getElementById(button.dataset.menuToggle);if(!menu||!root.contains(menu))return;menu.hidden=false;button.setAttribute('aria-expanded','true');const box=menu.getBoundingClientRect(),source=button.getBoundingClientRect(),space=root.getBoundingClientRect().bottom-source.bottom;if(space<box.height+10&&source.top-root.getBoundingClientRect().top>box.height+10)menu.classList.add('ir-menu-up');menu.querySelector('button:not(:disabled)')?.focus();
  }
  function contextMenu(kind,id,name,emitterId){
    if(!isAdmin)return "";
    const menuId='ir-menu-'+kind+'-'+id;const item=(label,icon,attrs,danger=false)=>'<button type="button" role="menuitem" class="'+(danger?'ir-danger-action ':'')+'cursor-interaction" '+attrs+'>'+glyph(icon)+label+'</button>';
    const actions=kind==='emitter'?item('Cambiar nombre','pencil','data-rename-emitter="'+escape(id)+'"')+item('Eliminar emisor','trash-2','data-delete-emitter="'+escape(id)+'"',true):item('Editar mando','settings','data-edit-device="'+escape(id)+'" data-emitter="'+escape(emitterId)+'"')+item('Cambiar nombre','pencil','data-rename-device="'+escape(id)+'" data-emitter="'+escape(emitterId)+'"')+item('Duplicar dispositivo','copy','data-duplicate-device="'+escape(id)+'" data-emitter="'+escape(emitterId)+'"')+item('Eliminar dispositivo','trash-2','data-delete-device="'+escape(id)+'" data-emitter="'+escape(emitterId)+'"',true);
    return '<div class="ir-menu-wrap"><button type="button" class="ir-icon-action cursor-interaction" data-menu-toggle="'+escape(menuId)+'" aria-controls="'+escape(menuId)+'" aria-haspopup="menu" aria-expanded="false" aria-label="Opciones '+(kind==='emitter'?'del emisor ':'del dispositivo ')+escape(name)+'">'+glyph('ellipsis-vertical')+'</button><div id="'+escape(menuId)+'" class="ir-context-menu" role="menu" aria-label="Opciones de '+escape(name)+'" hidden>'+actions+'</div></div>';
  }
  function openFunctionEditor(key,placement=null){
    if(!isAdmin)return;
    const device=getDevice();if(!device||q('#ir-function-dialog').open)return;normalizeDeviceLayout(device);
    if(key&&!device.functions.some(f=>f.key===key))return;
    let createdRowId=null;
    if(!key){
      const row=placement&&layoutRow(device,placement.rowId),index=Number(placement?.cellIndex);
      if(!row||!Number.isInteger(index)||index<0||index>=row.columns||row.cells[index]!==null){
        placement=emptySlot(device);if(!placement){const created=newRow();device.layout.rows.push(created);createdRowId=created.id;placement={rowId:created.id,cellIndex:0};}
      }
      else placement={rowId:row.id,cellIndex:index};
    }
    resetMoving();selected=key;editMode=true;functionContext={emitterId:route.emitterId,deviceId:route.deviceId,cacheKey:cacheKey(),placement:key?null:placement,createdRowId};setDraft();q('#ir-function-dialog').showModal();renderRemote();refreshIcons();syncDialogLayout();q('#ir-button-name').focus();
  }
  function finishFunctionEditor(){
    cancelLearning();closeDeleteFunctionDialog();closeIconPicker();closeEntityEditor();
    if(functionContext?.createdRowId){const device=model.emitters.find(e=>e.id===functionContext.emitterId)?.devices.find(d=>d.id===functionContext.deviceId),row=layoutRow(device,functionContext.createdRowId);if(device&&row&&!row.cells.some(Boolean)&&device.layout.rows.length>1)device.layout.rows=device.layout.rows.filter(item=>item.id!==row.id);}
    if(functionContext)drafts.delete(functionContext.cacheKey);functionContext=null;selected=null;draft=null;listening=null;entityCustomized=false;entityAutoMessage='';
    if(route.screen==='editor'&&getDevice()){renderRemote();refreshIcons();}syncDialogLayout();
  }
  function closeFunctionEditor(){closeDeleteFunctionDialog();closeIconPicker();closeEntityEditor();if(q('#ir-function-dialog').open)q('#ir-function-dialog').close();finishFunctionEditor();}
  function closeDeleteFunctionDialog(returnFocus=false){
    deletingFunction=null;if(q('#ir-delete-function-dialog').open)q('#ir-delete-function-dialog').close();
    if(returnFocus&&q('#ir-function-dialog').open)q('#ir-delete-function').focus();
  }
  function openDeleteFunctionDialog(){
    if(fresh||!selected||!functionContext||!q('#ir-function-dialog').open||q('#ir-delete-function-dialog').open)return;
    const device=model.emitters.find(e=>e.id===functionContext.emitterId)?.devices.find(d=>d.id===functionContext.deviceId),stored=device?.functions.find(f=>f.key===selected);
    if(!stored){functionError('La funci\u00f3n ya no est\u00e1 disponible.');return;}
    cancelLearning();renderLearning();closeIconPicker();closeEntityEditor();deletingFunction={emitterId:functionContext.emitterId,deviceId:functionContext.deviceId,key:stored.key,context:functionContext};
    q('#ir-delete-function-description').textContent='Se eliminar\u00e1 \u00ab'+stored.name+'\u00bb.';q('#ir-delete-function-entity').textContent=stored.entity;
    q('#ir-delete-function-dialog').showModal();syncDialogLayout();q('#ir-cancel-delete-function').focus();
  }
  function confirmDeleteFunction(){
    const context=deletingFunction;
    if(!q('#ir-delete-function-dialog').open||!context||context.context!==functionContext||context.key!==selected||!q('#ir-function-dialog').open){closeDeleteFunctionDialog();return;}
    const device=model.emitters.find(e=>e.id===context.emitterId)?.devices.find(d=>d.id===context.deviceId),index=device?.functions.findIndex(f=>f.key===context.key);
    if(!device||index<0){closeDeleteFunctionDialog();functionError('La funci\u00f3n ya no est\u00e1 disponible.');return;}
    normalizeDeviceLayout(device);const stored=device.functions[index],placement=functionSlot(device,stored.key);
    device.functions.splice(index,1);if(placement)layoutRow(device,placement.rowId).cells[placement.cellIndex]=null;
    drafts.delete(device.id+'|'+stored.key);if(selections.get(device.id)===stored.key)selections.delete(device.id);
    closeDeleteFunctionDialog();closeFunctionEditor();render();feedback('Funci\u00f3n eliminada.');persist();
  }
  function openDeleteDevice(emitterId,deviceId){
    const e=model.emitters.find(x=>x.id===emitterId),d=e?.devices.find(x=>x.id===deviceId);if(!e||!d)return;deletingDevice={emitterId,deviceId};q('#ir-delete-device-description').textContent='Se eliminar\u00e1 \u00ab'+d.name+'\u00bb y '+functionCount(d.functions.length)+' de \u00ab'+e.name+'\u00bb.';q('#ir-delete-device-dialog').showModal();syncDialogLayout();q('#ir-cancel-delete-device').focus();
  }
  function renderHome(){
    q('#ir-emitter-tree').innerHTML=model.emitters.length?model.emitters.map(e=>
      '<article class="ir-emitter-group"><div class="ir-emitter-group-head">'+
      '<div class="ir-emitter-summary"><span class="ir-source-symbol">'+glyph('radio')+'</span><span><strong>'+escape(e.name)+'</strong><span class="ir-muted">'+escape(e.model)+(sourceAvailable(e.sourceId)?'':' \u00b7 Sin conexi\u00f3n')+' \u00b7 '+e.devices.length+' dispositivo'+(e.devices.length===1?'':'s')+'</span></span></div>'+
      '<button type="button" class="ir-text-action cursor-interaction" data-new-device="'+escape(e.id)+'">'+glyph('plus')+'A\u00f1adir dispositivo</button>'+
      contextMenu('emitter',e.id,e.name)+'</div>'+
      (e.devices.length?'<div class="ir-children">'+e.devices.map(d=>'<div class="ir-child-row"><button type="button" class="ir-child-device cursor-interaction" data-open-device="'+escape(d.id)+'" data-emitter="'+escape(e.id)+'" aria-label="Abrir mando '+escape(d.name)+'">'+glyph(d.icon)+'<span class="ir-child-text"><strong>'+escape(d.name)+'</strong><span class="ir-muted">'+functionCount(d.functions.length)+'</span></span></button>'+contextMenu('device',d.id,d.name,e.id)+'</div>').join('')+'</div>':'<div class="ir-empty">Sin dispositivos.</div>')+'</article>'
    ).join(''):'<div class="ir-empty">No hay emisores.</div>';
  }
  function renderPicker(){
    q('#ir-available-emitters').innerHTML=catalog.length?catalog.map(c=>{const added=model.emitters.some(e=>e.sourceId===c.id);return '<label class="ir-source-option cursor-interaction"><input type="radio" name="ir-emitter-source" value="'+c.id+'" '+(candidate===c.id?'checked ':'')+(added||!c.available?'disabled ':'')+'aria-label="'+escape(c.name)+'"><span class="ir-option-text"><strong>'+escape(c.name)+'</strong><span class="ir-muted">'+escape(c.model)+'</span></span><span class="ir-option-state">'+(added?'Ya a\u00f1adido':c.available?'Disponible':'Sin conexi\u00f3n')+'</span></label>';}).join(''):'<p class="ir-empty">No hay emisores Broadlink compatibles. A\u00f1ade el dispositivo en Configuraci\u00f3n \u2192 Dispositivos y servicios.</p>';
    renderAddStep();
  }
  function renderAddStep(){
    q('#ir-picker').hidden=modalStep!==1;q('#ir-emitter-setup').hidden=modalStep!==2;
    q('#ir-previous-emitter').hidden=modalStep!==2;q('#ir-next-emitter').hidden=modalStep!==1;q('#ir-confirm-emitter').hidden=modalStep!==2;
    q('#ir-next-emitter').disabled=!candidate||model.emitters.some(e=>e.sourceId===candidate);
    q('#ir-add-dialog-title').textContent=modalStep===1?'A\u00f1adir emisor':'Personalizar emisor';
    q('#ir-add-dialog-step').textContent=modalStep===1?'Paso 1 de 2 \u00b7 Seleccionar emisor':'Paso 2 de 2 \u00b7 Nombre del emisor';
    const c=catalog.find(s=>s.id===candidate);q('#ir-selected-source').innerHTML=c?'<span class="ir-source-symbol">'+glyph('radio')+'</span><span class="ir-option-text"><strong>'+escape(c.name)+'</strong><span class="ir-muted">'+escape(c.model)+'</span></span>':'';
    q('#ir-add-error').hidden=true;refreshIcons();
  }
  function openAddDialog(){
    if(!isAdmin)return;
    candidate=null;modalStep=1;q('#ir-emitter-alias').value='';renderPicker();root.classList.add('ir-dialog-open');q('#ir-add-dialog').showModal();q('#ir-available-emitters input:not(:disabled)')?.focus();
  }
  function addError(message){q('#ir-add-error').textContent=message;q('#ir-add-error').hidden=false;}
  function openDeleteDialog(id){
    const e=model.emitters.find(x=>x.id===id);if(!e)return;deleteId=id;
    const n=e.devices.length, f=e.devices.reduce((sum,d)=>sum+d.functions.length,0);
    q('#ir-delete-description').textContent='Se eliminar\u00e1 \u00ab'+e.name+'\u00bb con '+n+' dispositivo'+(n===1?'':'s')+' y '+functionCount(f)+'.';
    root.classList.add('ir-dialog-open');q('#ir-delete-dialog').showModal();q('#ir-cancel-delete').focus();
  }
  function renderRemote(){
    clearColumnRejections();clearLandingPreviews();const d=getDevice();if(!d)return;normalizeDeviceLayout(d);
    q('#ir-remote-title').textContent=d.name;q('#ir-remote-subtitle').textContent=getEmitter()?.name||'';
    q('#ir-toggle-edit').innerHTML=editMode?glyph('check')+'Finalizar edici\u00f3n':glyph('settings')+'Editar mando';q('#ir-toggle-edit').setAttribute('aria-pressed',String(editMode));q('#ir-rename-remote').hidden=!editMode;q('#ir-add-button').hidden=!editMode;if(q('#ir-add-row'))q('#ir-add-row').hidden=!editMode;
    const container=q('#ir-buttons');container.classList.toggle('ir-editing',editMode);container.classList.toggle('ir-placing',!!movingFunction);
    const functions=new Map(d.functions.map(f=>[f.key,f]));
    container.innerHTML=d.layout.rows.map((row,rowIndex)=>{
      const rowAttrs=' data-row-id="'+escape(row.id)+'"';
      const controls=editMode?'<div class="ir-row-controls"><strong class="ir-row-label">Fila '+(rowIndex+1)+'</strong><div class="ir-column-stepper"><span>Columnas</span><button type="button" class="ir-icon-action cursor-interaction" data-columns-delta="-1"'+rowAttrs+' aria-label="Reducir columnas de la fila '+(rowIndex+1)+'" '+(row.columns===1?'disabled':'')+'>'+glyph('minus')+'</button><span class="ir-column-count" aria-live="polite">'+row.columns+'</span><button type="button" class="ir-icon-action cursor-interaction" data-columns-delta="1"'+rowAttrs+' aria-label="A\u00f1adir columna a la fila '+(rowIndex+1)+'" '+(row.columns===6?'disabled':'')+'>'+glyph('plus')+'</button></div><div class="ir-row-height-control"><span>Altura</span><div class="ir-height-stepper"><button type="button" class="ir-icon-action cursor-interaction" data-height-delta="-1"'+rowAttrs+' aria-label="Reducir altura de la fila '+(rowIndex+1)+'" '+(row.height===1?'disabled':'')+'>'+glyph('minus')+'</button><span class="ir-row-height-value" aria-live="polite">'+row.height+'</span><button type="button" class="ir-icon-action cursor-interaction" data-height-delta="1"'+rowAttrs+' aria-label="Aumentar altura de la fila '+(rowIndex+1)+'" '+(row.height===4?'disabled':'')+'>'+glyph('plus')+'</button></div></div><button type="button" class="ir-icon-action ir-danger-action cursor-interaction" data-remove-row="'+escape(row.id)+'" aria-label="Eliminar fila '+(rowIndex+1)+'" '+(d.layout.rows.length===1||row.cells.some(Boolean)?'disabled':'')+'>'+glyph('trash-2')+'</button></div>':'';
      const cells=row.cells.map((key,cellIndex)=>{
        const cellAttrs=rowAttrs+' data-cell-index="'+cellIndex+'" data-grid-target-row="'+escape(row.id)+'" data-grid-target-cell="'+cellIndex+'"';
        const f=functions.get(key);
        if(!f)return '<div class="ir-grid-cell ir-cell-empty"'+cellAttrs+(editMode?'':' aria-hidden="true" style="visibility:hidden"')+'>'+(editMode?'<button type="button" class="ir-empty-cell cursor-interaction" data-place-row="'+escape(row.id)+'" data-place-cell="'+cellIndex+'" aria-label="'+(movingFunction?'Colocar funci\u00f3n':'A\u00f1adir funci\u00f3n')+' en fila '+(rowIndex+1)+', columna '+(cellIndex+1)+'">'+glyph(movingFunction?'move':'plus')+'<span>'+(movingFunction?'Colocar aqu\u00ed':'A\u00f1adir funci\u00f3n')+'</span></button>':'')+'</div>';
        const moving=movingFunction===f.key;
        const showName=f.icon==='none'||f.showName!==false;
        const classes='ir-command'+(f.icon==='none'?' ir-text-only':'')+(!showName?' ir-icon-only':'')+(editMode&&q('#ir-function-dialog').open&&f.key===selected?' ir-selected':'')+(moving?' ir-moving':'');
        return '<div class="ir-grid-cell"'+cellAttrs+'><div class="'+classes+'" data-function-key="'+escape(f.key)+'" '+(editMode?'draggable="true" ':'')+'style="--ir-button-accent:'+f.color+'"><button type="button" class="ir-command-main cursor-interaction" data-function="'+escape(f.key)+'" aria-label="'+escape(editMode?(movingFunction?'Colocar aqu\u00ed e intercambiar con '+f.name:'Editar '+f.name):f.name)+'" '+(editMode?'aria-keyshortcuts="Space Enter" ':'')+(!editMode&&(!ready(f)||!sourceAvailable(getEmitter()?.sourceId))?'disabled':'')+'>'+(f.icon==='none'?'':'<span class="ir-glyph">'+glyph(f.icon)+'</span>')+(showName?'<span>'+escape(f.name)+'</span>':'')+'</button><div class="ir-command-meta">'+(editMode?(moving?'Elige un destino':'Editar funci\u00f3n'):!ready(f)?'Sin se\u00f1al':f.type==='switch'?'Estado estimado \u00b7 '+(currentSwitchState(f)===null?'desconocido':currentSwitchState(f)?'encendido':'apagado'):'Bot\u00f3n de una pulsaci\u00f3n')+'</div></div></div>';
      }).join('');
      return '<section class="ir-layout-row"'+rowAttrs+' style="--ir-height-level:'+row.height+'">'+controls+'<div class="ir-row-grid" data-columns="'+row.columns+'" style="--ir-columns:'+row.columns+';--ir-height-level:'+row.height+'">'+cells+'</div></section>';
    }).join('');
    observeRowGeometry();
  }
  function render(){
    q('#ir-home').hidden=route.screen!=='home';q('#ir-editor-screen').hidden=route.screen!=='editor';
    root.classList.toggle('ir-readonly',!isAdmin);q('#ir-readonly').hidden=isAdmin;q('#ir-add-emitter').hidden=!isAdmin;q('#ir-toggle-edit').hidden=!isAdmin;if(route.screen==='home')renderHome();if(q('#ir-add-dialog').open)renderPicker();
    if(route.screen==='editor')renderRemote();refreshIcons();
  }
  function renderEditor(){
    q('#ir-editor-title').textContent=fresh?'Nueva funci\u00f3n':'Editar funci\u00f3n';q('#ir-save').textContent=fresh?'Crear funci\u00f3n':'Guardar cambios';
    q('#ir-delete-function').hidden=fresh;q('#ir-edit-entity').hidden=!fresh;
    q('#ir-function-error').hidden=true;q('#ir-function-message').textContent='';q('#ir-automation').hidden=false;
    q('#ir-button-name').value=draft.name;q('#ir-show-name').checked=draft.showName!==false;q('#ir-button-icon').value=draft.icon;q('#ir-button-color').value=draft.color;q('#ir-button-type').value=draft.type;q('#ir-type-label').hidden=!fresh;q('#ir-button-type').disabled=!fresh;updatePreview();renderLearning();
  }
  function updatePreview(){
    if(!draft)return;draft.name=q('#ir-button-name').value;draft.icon=q('#ir-button-icon').value;draft.color=q('#ir-button-color').value;
    const showName=q('#ir-show-name'),textOnly=draft.icon==='none';showName.disabled=textOnly;if(textOnly)showName.checked=true;draft.showName=showName.checked;q('#ir-name-visibility-hint').hidden=!textOnly;
    const preview=q('#ir-preview');preview.style.setProperty('--ir-button-accent',draft.color);preview.classList.toggle('ir-text-only',textOnly);preview.classList.toggle('ir-icon-only',!draft.showName);preview.setAttribute('aria-label',draft.name||'Vista previa del bot\u00f3n');
    preview.innerHTML=(textOnly?'':'<span class="ir-glyph">'+glyph(draft.icon)+'</span>')+(draft.showName?'<span>'+escape(draft.name||'Nombre de la funci\u00f3n')+'</span>':'');
    updateDraftEntity();syncIconPicker();refreshIcons();
  }
  function cancelLearning(){if(learningRequest)learningRequest.cancelled=true;learningRequest=null;listening=null;}
  const sameContext=request=>!disposed&&request.context===functionContext&&request.draft===draft&&q('#ir-function-dialog').open;
  async function startLearning(key){
    if(!isAdmin||!draft||!functionContext||!q('#ir-function-dialog').open||signalBusy||listening||!((draft.type==='switch'?['on','off']:['press']).includes(key)))return;
    const emitter=getEmitter(),source=catalog.find(item=>item.id===emitter?.sourceId);
    if(!sourceAvailable(emitter?.sourceId)){functionError('El emisor est\u00e1 sin conexi\u00f3n.');return;}
    if(!source?.canLearn){functionError('Este emisor no admite aprendizaje.');return;}
    cancelLearning();const request={draft,context:functionContext,key,cancelled:false};learningRequest=request;listening=key;renderLearning();
    try{const result=await api.call('learn',{source_id:emitter.sourceId,device_id:functionContext.deviceId,function_key:draft.key,signal:key});if(!sameContext(request)||request.cancelled)return;if(!result.signal_ref)throw new Error('No se ha recibido una referencia de se\u00f1al.');candidateSignals[key]={ref:result.signal_ref,tested:false};feedback('Se\u00f1al preparada. Prueba la orden y confirma si ha respondido el aparato.');}
    catch(error){if(sameContext(request)&&!request.cancelled)functionError(error.message||'No se pudo aprender la se\u00f1al. Vuelve a intentarlo.');}
    finally{if(learningRequest===request){learningRequest=null;listening=null;if(sameContext(request))renderLearning();}}
  }
  async function testSignal(key){
    const candidate=candidateSignals[key];if(!candidate||signalBusy||listening)return;const request={context:functionContext,draft};signalBusy=true;renderLearning();
    try{await api.call('test_signal',{signal_ref:candidate.ref});if(!sameContext(request))return;candidate.tested=true;feedback('Orden enviada. Comprueba el aparato antes de confirmar.');}
    catch(error){if(sameContext(request))functionError(error.message||'No se pudo enviar la prueba.');}
    finally{signalBusy=false;if(sameContext(request))renderLearning();}
  }
  async function confirmSignal(key){
    const candidate=candidateSignals[key];if(!candidate?.tested||signalBusy||listening)return;const request={context:functionContext,draft};signalBusy=true;renderLearning();
    try{const result=await api.call('confirm_signal',{signal_ref:candidate.ref});if(!sameContext(request))return;if(!result.verified)throw new Error('La se\u00f1al no se ha verificado.');draft.signal_refs??={};draft.signal_refs[key]=candidate.ref;draft.signals[key]=true;delete candidateSignals[key];feedback('Se\u00f1al confirmada. Guarda la funci\u00f3n para conservarla.');}
    catch(error){if(sameContext(request))functionError(error.message||'No se pudo confirmar la se\u00f1al.');}
    finally{signalBusy=false;if(sameContext(request))renderLearning();}
  }
  function renderLearning(){
    if(!draft)return;const state=q('#ir-signal-status');state.dataset.state=ready(draft)?'ready':'pending';state.textContent=ready(draft)?'Se\u00f1al guardada':draft.type==='switch'?'Necesita dos se\u00f1ales':'Sin se\u00f1al';q('#ir-learning-stage').hidden=!listening;q('#ir-learning-controls').hidden=!!listening;
    const channels=draft.type==='switch'?[['on','Encendido'],['off','Apagado']]:[['press','Pulsaci\u00f3n']];
    q('#ir-learning-controls').innerHTML=channels.map(([key,label])=>{const candidate=candidateSignals[key],verified=!!draft.signals[key],disabled=signalBusy?' disabled':'';return '<div class="ir-signal-row"><strong>'+label+'</strong><span class="ir-muted"> \u00b7 '+(verified?'Se\u00f1al guardada':'Sin se\u00f1al')+'</span><div class="ir-signal-actions"><button type="button" class="ir-action" data-learn="'+key+'"'+disabled+'>'+glyph('scan-line')+(verified?'Volver a aprender':'Aprender del mando original')+'</button>'+(candidate?'<button type="button" class="ir-action ir-primary" data-test-signal="'+key+'"'+disabled+'>Probar se\u00f1al</button>':'')+'</div>'+(candidate?.tested?'<div class="ir-confirm-test"><p>\u00bfHa respondido correctamente el aparato?</p><button type="button" class="ir-action ir-primary" data-confirm-signal="'+key+'"'+disabled+'>S\u00ed, ha funcionado</button><button type="button" class="ir-text-action" data-retry-signal="'+key+'"'+disabled+'>No, volver a aprender</button></div>':'')+(candidate&&verified?'<p class="ir-control-hint">La se\u00f1al anterior se conserva hasta confirmar y guardar la nueva.</p>':'')+'</div>';}).join('')+(draft.type==='switch'?'<p class="ir-control-hint">Aprende dos \u00f3rdenes independientes de encendido y apagado. El estado ser\u00e1 estimado.</p>':'')+(false?'<p class="ir-control-hint">Algunos mandos de aire acondicionado transmiten tambi\u00e9n el modo, la temperatura y la ventilaci\u00f3n. La se\u00f1al aprendida puede recuperar todos esos ajustes.</p>':'');
    q('#ir-learning-title').textContent='Esperando la se\u00f1al'+(listening==='on'?' de encendido':listening==='off'?' de apagado':'')+'\u2026';
  }
  async function pressFunction(key){
    const f=getDevice()?.functions.find(f=>f.key===key);if(!f||!ready(f)||!sourceAvailable(getEmitter()?.sourceId)||saving)return;
    saving=true;root.inert=true;q('#ir-busy-status').textContent='Enviando\u2026';
    try{await api.call('press',{function_key:key});if(disposed)return;applyEnvelope(await api.call('get'));render();pulseCommand(key);feedback('Orden enviada.');globalError('');}
    catch(error){if(!disposed)globalError(error.message||'No se ha podido enviar la orden.');}
    finally{saving=false;root.inert=false;q('#ir-busy-status').textContent='';}
  }
  root.addEventListener('click',event=>{
    if(saving)return;
    const t=event.target.closest('button');
    if(!t){
      const tile=event.target.closest('.ir-command[data-function-key]');
      if(editMode&&tile&&q('#ir-buttons').contains(tile)&&Date.now()>=suppressFunctionClickUntil){
        const cell=tile.closest('[data-grid-target-row]');if(movingFunction&&cell)moveFunctionTo(cell.dataset.gridTargetRow,Number(cell.dataset.gridTargetCell));else openFunctionEditor(tile.dataset.functionKey);
      }
      return;
    }
    if(t.hasAttribute('data-icon-option')){chooseIcon(t.dataset.iconOption);return;}
    if(t.dataset.menuToggle){toggleMenu(t);return;}
    if(t.closest('.ir-context-menu'))closeMenus(true);
    if(t.dataset.renameEmitter){openRenameEmitter(t.dataset.renameEmitter);return;}
    if(t.dataset.renameDevice){openRenameDevice(t.dataset.emitter,t.dataset.renameDevice);return;}
    if(t.dataset.duplicateDevice){openTransferDevice(t.dataset.emitter,t.dataset.duplicateDevice);return;}
    if(t.dataset.deleteEmitter){openDeleteDialog(t.dataset.deleteEmitter);return;}
    if(t.dataset.deleteDevice){openDeleteDevice(t.dataset.emitter,t.dataset.deleteDevice);return;}
    if(t.hasAttribute('data-home')){go({screen:'home',emitterId:null,deviceId:null});return;}
    if(t.dataset.newDevice){openDeviceDialog(t.dataset.newDevice);return;}
    if(t.dataset.openDevice){openDevice(t.dataset.emitter,t.dataset.openDevice);return;}
    if(t.dataset.editDevice){openDevice(t.dataset.emitter,t.dataset.editDevice);editMode=true;renderRemote();refreshIcons();return;}
    if(t.hasAttribute('data-columns-delta')){changeRowColumns(t.dataset.rowId,Number(t.dataset.columnsDelta));return;}
    if(t.hasAttribute('data-height-delta')){changeRowHeight(t.dataset.rowId,Number(t.dataset.heightDelta));return;}
    if(t.hasAttribute('data-remove-row')){removeLayoutRow(t.dataset.removeRow);return;}
    if(t.hasAttribute('data-place-row')){
      if(!editMode||Date.now()<suppressFunctionClickUntil)return;
      if(movingFunction)moveFunctionTo(t.dataset.placeRow,Number(t.dataset.placeCell));else openFunctionEditor(null,{rowId:t.dataset.placeRow,cellIndex:Number(t.dataset.placeCell)});return;
    }
    if(t.dataset.function){
      if(Date.now()<suppressFunctionClickUntil)return;
      if(editMode){
        if(movingFunction){const cell=t.closest('[data-grid-target-row]');if(cell)moveFunctionTo(cell.dataset.gridTargetRow,Number(cell.dataset.gridTargetCell));}
        else openFunctionEditor(t.dataset.function);return;
      }
      pressFunction(t.dataset.function);return;
    }
    if(t.dataset.learn)startLearning(t.dataset.learn);
    if(t.dataset.testSignal)testSignal(t.dataset.testSignal);
    if(t.dataset.confirmSignal)confirmSignal(t.dataset.confirmSignal);
    if(t.dataset.retrySignal)startLearning(t.dataset.retrySignal);
  });
  root.addEventListener('pointerdown',event=>{
    const tile=event.target.closest('.ir-command[data-function-key]'),device=getDevice();
    if(!tile||!q('#ir-buttons').contains(tile)||!editMode||!device||q('#ir-function-dialog').open||event.button!==0||event.isPrimary===false||pointerContext)return;
    clearLandingPreviews();const handle=event.target.closest('button')||tile;
    pointerContext={handle,tile,pointerId:event.pointerId,deviceId:device.id,key:tile.dataset.functionKey,x:event.clientX,y:event.clientY,active:false};
    try{handle.setPointerCapture(event.pointerId);}catch{}
  });
  root.addEventListener('pointermove',event=>{
    const pointer=pointerContext;if(!pointer||pointer.pointerId!==event.pointerId||!editMode||pointer.deviceId!==route.deviceId)return;
    if(!pointer.active&&Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)<6)return;
    event.preventDefault();
    if(!pointer.active){createDragPreview(pointer.tile,pointer.x,pointer.y);pointer.tile.classList.add('ir-moving','ir-drag-source');}
    pointer.active=true;movingFunction=pointer.key;suppressFunctionClickUntil=Infinity;positionDragPreview(event.clientX,event.clientY);
    highlightGridCell(gridCellAt(event.clientX,event.clientY));
  },{passive:false});
  root.addEventListener('pointerup',event=>{
    const pointer=pointerContext;if(!pointer||pointer.pointerId!==event.pointerId)return;pointerContext=null;releasePointer(pointer);
    if(!pointer.active)return;event.preventDefault();event.stopPropagation();suppressFunctionClickUntil=Date.now()+500;
    positionDragPreview(event.clientX,event.clientY);const cell=gridCellAt(event.clientX,event.clientY);
    if(editMode&&pointer.deviceId===route.deviceId&&cell){movingFunction=pointer.key;if(moveFunctionTo(cell.dataset.gridTargetRow,Number(cell.dataset.gridTargetCell)))return;}
    resetMoving();if(route.screen==='editor'&&getDevice()){renderRemote();refreshIcons();feedback('Movimiento cancelado.');}
  });
  root.addEventListener('pointercancel',event=>{
    if(!pointerContext||pointerContext.pointerId!==event.pointerId)return;resetMoving();
    if(route.screen==='editor'&&getDevice()){renderRemote();refreshIcons();}
  });
  root.addEventListener('dragstart',event=>{
    // Pointer gestures use the capture-based path above, so native DnD cannot
    // steal the pointer mid-gesture. Synthetic/native-only drag events retain
    // the HTML5 path, and a tap still falls through to the click-to-move path.
    if(pointerContext){event.preventDefault();return;}
    const tile=event.target.closest('.ir-command[data-function-key]'),device=getDevice();
    if(!tile||!q('#ir-buttons').contains(tile)||!editMode||!device||q('#ir-function-dialog').open||!event.dataTransfer){event.preventDefault();return;}
    const key=tile.dataset.functionKey;if(!device.functions.some(f=>f.key===key)){event.preventDefault();return;}
    movingFunction=key;dragContext={deviceId:device.id,key};suppressFunctionClickUntil=Infinity;
    const preview=createDragPreview(tile,event.clientX,event.clientY);event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',key);
    event.dataTransfer.setDragImage(preview.element,preview.offsetX,preview.offsetY);tile.classList.add('ir-moving','ir-drag-source');
  });
  root.addEventListener('drag',event=>{if(dragContext&&(event.clientX||event.clientY))positionDragPreview(event.clientX,event.clientY);});
  root.addEventListener('dragover',event=>{
    if(!editMode||!dragContext||dragContext.deviceId!==route.deviceId)return;const cell=event.target.closest('[data-grid-target-row]');if(!cell||!q('#ir-buttons').contains(cell))return;
    event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='move';
    highlightGridCell(cell);
  });
  root.addEventListener('dragleave',event=>{const cell=event.target.closest('[data-grid-target-row]');if(cell&&!cell.contains(event.relatedTarget))cell.classList.remove('ir-drop-target');});
  root.addEventListener('drop',event=>{
    if(!editMode||!dragContext||dragContext.deviceId!==route.deviceId)return;const cell=event.target.closest('[data-grid-target-row]');if(!cell||!q('#ir-buttons').contains(cell))return;
    event.preventDefault();event.stopPropagation();movingFunction=dragContext.key;suppressFunctionClickUntil=Date.now()+500;positionDragPreview(event.clientX,event.clientY);
    moveFunctionTo(cell.dataset.gridTargetRow,Number(cell.dataset.gridTargetCell));dragContext=null;
  });
  root.addEventListener('dragend',()=>{
    if(!dragContext)return;resetMoving();suppressFunctionClickUntil=Date.now()+500;
    if(route.screen==='editor'&&getDevice()){renderRemote();refreshIcons();}
  });
  root.addEventListener('change',event=>{if(event.target.name!=='ir-emitter-source')return;const id=event.target.value,c=catalog.find(x=>x.id===id);if(!c||!c.available||model.emitters.some(e=>e.sourceId===id))return;if(candidate!==id)q('#ir-emitter-alias').value=c.name;candidate=id;renderAddStep();});
  q('#ir-add-emitter').addEventListener('click',openAddDialog);
  q('#ir-sidebar-toggle').addEventListener('click',openMenu);
  q('#ir-refresh').addEventListener('click',reload);
  q('#ir-copy-entity').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(draft?.entity||'');feedback('Entidad copiada.');}catch{feedback('Selecciona y copia la entidad mostrada.');}});
  q('#ir-next-emitter').addEventListener('click',()=>{if(!candidate||model.emitters.some(e=>e.sourceId===candidate))return;modalStep=2;renderAddStep();q('#ir-emitter-alias').focus();});
  q('#ir-previous-emitter').addEventListener('click',()=>{modalStep=1;renderAddStep();q('#ir-available-emitters input:checked')?.focus();});
  q('#ir-confirm-emitter').addEventListener('click',()=>{
    if(!q('#ir-add-dialog').open||modalStep!==2)return;
    const c=catalog.find(x=>x.id===candidate),name=q('#ir-emitter-alias').value.trim();if(!c||!c.available||!name){addError('Escribe un nombre para el emisor.');return;}if(model.emitters.some(e=>e.sourceId===c.id)){addError('Este emisor ya est\u00e1 a\u00f1adido.');return;}
    model.emitters.push({id:uid(),sourceId:c.id,name,model:c.model||'Broadlink',devices:[]});q('#ir-add-dialog').close();go({screen:'home',emitterId:null,deviceId:null});persist();flowFeedback('Emisor a\u00f1adido.');
  });
  ['#ir-cancel-emitter','#ir-close-add'].forEach(s=>q(s).addEventListener('click',()=>q('#ir-add-dialog').close()));
  q('#ir-emitter-alias').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();q('#ir-confirm-emitter').click();}});
  ['#ir-cancel-delete','#ir-close-delete'].forEach(s=>q(s).addEventListener('click',()=>q('#ir-delete-dialog').close()));
  q('#ir-confirm-delete').addEventListener('click',()=>{
    if(!q('#ir-delete-dialog').open)return;const index=model.emitters.findIndex(e=>e.id===deleteId);if(index<0){q('#ir-delete-dialog').close();return;}
    const e=model.emitters[index];if(functionContext?.emitterId===e.id)closeFunctionEditor();
    e.devices.forEach(d=>{selections.delete(d.id);for(const key of drafts.keys())if(key.startsWith(d.id+'|'))drafts.delete(key);});
    model.emitters.splice(index,1);q('#ir-delete-dialog').close();go({screen:'home',emitterId:null,deviceId:null});persist();selected=null;draft=null;
  });
  dialogIds.forEach(s=>q(s).addEventListener('close',()=>{if(s==='#ir-add-dialog'){candidate=null;modalStep=1;}if(s==='#ir-delete-dialog')deleteId=null;if(s==='#ir-device-dialog')creatingEmitterId=null;if(s==='#ir-delete-device-dialog')deletingDevice=null;if(s==='#ir-function-dialog')finishFunctionEditor();if(s==='#ir-delete-function-dialog')deletingFunction=null;if(s==='#ir-entity-dialog')pendingEntity=null;if(s==='#ir-rename-emitter-dialog')editingEmitterId=null;if(s==='#ir-rename-remote-dialog')renamingDevice=null;syncDialogLayout();}));
  if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(syncDialogLayout);observers.push(observer);dialogIds.forEach(s=>observer.observe(q(s)));}
  ['#ir-cancel-transfer','#ir-close-transfer'].forEach(s=>q(s).addEventListener('click',()=>q('#ir-transfer-dialog').close()));
  q('#ir-transfer-dialog').addEventListener('close',()=>{transferringDevice=null;syncDialogLayout();});
  q('#ir-transfer-emitter').addEventListener('change',renderTransferPreview);
  q('#ir-transfer-name').addEventListener('input',renderTransferPreview);
  q('#ir-transfer-name').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();q('#ir-confirm-transfer').click();}});
  q('#ir-confirm-transfer').addEventListener('click',confirmDeviceTransfer);
  ['#ir-cancel-device','#ir-close-device'].forEach(s=>q(s).addEventListener('click',()=>q('#ir-device-dialog').close()));
  q('#ir-confirm-device').addEventListener('click',()=>{
    if(!q('#ir-device-dialog').open)return;const e=model.emitters.find(x=>x.id===creatingEmitterId),name=q('#ir-device-name').value.trim();
    if(!e||!name){q('#ir-device-error').textContent=e?'Escribe el nombre del dispositivo.':'El emisor ya no est\u00e1 disponible.';q('#ir-device-error').hidden=false;return;}
    e.devices.push({id:uid(),name,icon:q('#ir-device-icon').value,functions:[]});q('#ir-device-dialog').close();goHome();persist();flowFeedback('Dispositivo creado.');
  });
  q('#ir-device-name').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();q('#ir-confirm-device').click();}});
  ['#ir-cancel-delete-device','#ir-close-delete-device'].forEach(s=>q(s).addEventListener('click',()=>q('#ir-delete-device-dialog').close()));
  q('#ir-confirm-delete-device').addEventListener('click',()=>{
    if(!q('#ir-delete-device-dialog').open||!deletingDevice)return;const e=model.emitters.find(x=>x.id===deletingDevice.emitterId),index=e?.devices.findIndex(x=>x.id===deletingDevice.deviceId);
    if(!e||index<0){q('#ir-delete-device-dialog').close();return;}const d=e.devices[index];if(functionContext?.deviceId===d.id)closeFunctionEditor();
    selections.delete(d.id);for(const key of drafts.keys())if(key.startsWith(d.id+'|'))drafts.delete(key);e.devices.splice(index,1);q('#ir-delete-device-dialog').close();goHome();persist();
  });
  q('#ir-back-devices').addEventListener('click',goHome);
  q('#ir-toggle-edit').addEventListener('click',()=>{if(route.screen!=='editor')return;editMode=!editMode;resetMoving();q('#ir-feedback').textContent='';if(!editMode){cancelLearning();selected=null;draft=null;}renderRemote();refreshIcons();});
  q('#ir-add-button').addEventListener('click',()=>openFunctionEditor(null));
  q('#ir-add-row').addEventListener('click',()=>{
    const device=getDevice();if(!editMode||!device)return;normalizeDeviceLayout(device);const row=newRow();device.layout.rows.push(row);renderRemote();refreshIcons();persist();
    Array.from(q('#ir-buttons').querySelectorAll('[data-place-row]')).find(button=>button.dataset.placeRow===row.id)?.focus();feedback('Fila a\u00f1adida.');
  });
  ['#ir-cancel-function','#ir-close-function'].forEach(s=>q(s).addEventListener('click',closeFunctionEditor));
  q('#ir-delete-function').addEventListener('click',openDeleteFunctionDialog);
  ['#ir-close-delete-function','#ir-cancel-delete-function'].forEach(s=>q(s).addEventListener('click',()=>closeDeleteFunctionDialog(true)));
  q('#ir-confirm-delete-function').addEventListener('click',confirmDeleteFunction);
  q('#ir-delete-function-dialog').addEventListener('cancel',event=>{event.preventDefault();event.stopPropagation();closeDeleteFunctionDialog(true);});
  q('#ir-edit-entity').addEventListener('click',openEntityEditor);
  ['#ir-close-entity','#ir-cancel-entity'].forEach(s=>q(s).addEventListener('click',closeEntityEditor));
  q('#ir-accept-entity').addEventListener('click',acceptEntity);
  q('#ir-entity-dialog').addEventListener('cancel',event=>{event.preventDefault();event.stopPropagation();closeEntityEditor();});
  q('#ir-entity-name').addEventListener('input',clearEntityError);
  q('#ir-entity-name').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();acceptEntity();}});
  q('#ir-icon-picker').addEventListener('click',()=>{if(q('#ir-icon-options').hidden)openIconPicker();else closeIconPicker();});
  q('#ir-icon-picker').addEventListener('keydown',event=>{
    if(!['ArrowDown','ArrowUp','Enter',' ','Escape'].includes(event.key)&&event.code!=='Space')return;
    if(event.key==='Escape'&&q('#ir-icon-options').hidden)return;
    event.preventDefault();event.stopPropagation();if(event.repeat)return;
    if(event.key==='Escape'){closeIconPicker(true);return;}
    if(event.key==='ArrowDown'||event.key==='ArrowUp')openIconPicker();
    else if(q('#ir-icon-options').hidden)openIconPicker();else closeIconPicker(true);
  });
  q('#ir-icon-options').addEventListener('keydown',event=>{
    const button=event.target.closest('[data-icon-option]');if(!button||q('#ir-icon-options').hidden)return;
    if(event.key==='Tab'){setTimeout(()=>closeIconPicker(),0);return;}
    if(!['ArrowDown','ArrowUp','Home','End','Enter',' ','Escape'].includes(event.key)&&event.code!=='Space')return;
    event.preventDefault();event.stopPropagation();if(event.key==='Escape'){closeIconPicker(true);return;}
    if(event.key==='Enter'||event.key===' '||event.code==='Space'){if(!event.repeat)chooseIcon(button.dataset.iconOption);return;}
    const options=Array.from(q('#ir-icon-options').querySelectorAll('[data-icon-option]:not(:disabled)')),index=options.indexOf(button);
    const next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;
    focusIconOption(options[next]);
  });
  q('#ir-cancel-learn').addEventListener('click',()=>{cancelLearning();renderLearning();feedback('Aprendizaje cancelado.');});
  ['#ir-button-name','#ir-button-icon','#ir-button-color'].forEach(selector=>q(selector).addEventListener('input',updatePreview));
  ['input','change'].forEach(type=>q('#ir-show-name').addEventListener(type,updatePreview));
  q('#ir-button-type').addEventListener('change',()=>{if(!draft)return;cancelLearning();draft.type=q('#ir-button-type').value;draft.signals={};draft.signal_refs={};candidateSignals={};updatePreview();renderLearning();});
  q('#ir-save').addEventListener('click',()=>{
    if(!q('#ir-function-dialog').open||q('#ir-entity-dialog').open||q('#ir-delete-function-dialog').open||!draft)return;if(listening||signalBusy){functionError('Termina o cancela el aprendizaje antes de guardar.');return;}updatePreview();draft.name=draft.name.trim();if(!draft.name){functionError('Escribe un nombre para la funci\u00f3n.');return;}
    const context=functionContext,device=context&&model.emitters.find(e=>e.id===context.emitterId)?.devices.find(d=>d.id===context.deviceId);
    if(!device||device.id!==route.deviceId){functionError('El dispositivo ya no est\u00e1 disponible.');return;}
    const index=fresh?-1:device.functions.findIndex(f=>f.key===selected);
    if(!fresh&&index<0){functionError('Esta funci\u00f3n ya no est\u00e1 disponible.');return;}
    if(!new RegExp('^'+draft.type+'\\.[a-z0-9_]+$').test(draft.entity)){functionError('Edita la entidad y usa letras min\u00fasculas, n\u00fameros o guiones bajos.');return;}
    if(entityInUse(draft.entity,fresh?null:selected)){functionError('Esa entidad ya est\u00e1 en uso. Edita la entidad antes de guardar.');return;}
    const oldCache=cacheKey(),changed=!fresh&&draft.entity!==device.functions[index].entity;
    normalizeDeviceLayout(device);delete draft.pendingEntity;
    if(fresh){
      let spot=context.placement;const row=spot&&layoutRow(device,spot.rowId);if(!row||row.cells[spot.cellIndex]!==null)spot=ensureEmptySlot(device);
      device.functions.push(structuredClone(draft));layoutRow(device,spot.rowId).cells[spot.cellIndex]=draft.key;
    }
    else device.functions[index]=structuredClone(draft);
    const message=changed?'Entidad actualizada. Revisa las automatizaciones que usen la anterior.':'Funci\u00f3n guardada.';drafts.delete(oldCache);closeFunctionEditor();feedback(message);persist();
  });
  ['#ir-close-rename-emitter','#ir-cancel-rename-emitter'].forEach(s=>q(s).addEventListener('click',()=>q('#ir-rename-emitter-dialog').close()));
  q('#ir-save-emitter-name').addEventListener('click',()=>{if(!q('#ir-rename-emitter-dialog').open)return;const e=model.emitters.find(x=>x.id===editingEmitterId),name=q('#ir-emitter-name').value.trim();if(!e||!name){q('#ir-rename-emitter-error').textContent=e?'Escribe un nombre para el emisor.':'El emisor ya no est\u00e1 disponible.';q('#ir-rename-emitter-error').hidden=false;return;}e.name=name;q('#ir-rename-emitter-dialog').close();goHome();persist();flowFeedback('Nombre actualizado.');});
  q('#ir-emitter-name').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();q('#ir-save-emitter-name').click();}});
  q('#ir-rename-remote').addEventListener('click',()=>{if(!editMode||route.screen!=='editor')return;openRenameDevice(route.emitterId,route.deviceId);});
  ['#ir-close-rename-remote','#ir-cancel-rename-remote'].forEach(s=>q(s).addEventListener('click',()=>q('#ir-rename-remote-dialog').close()));
  q('#ir-save-remote-name').addEventListener('click',()=>{if(!q('#ir-rename-remote-dialog').open||!renamingDevice)return;const device=model.emitters.find(e=>e.id===renamingDevice.emitterId)?.devices.find(d=>d.id===renamingDevice.deviceId),name=q('#ir-rename-remote-input').value.trim(),icon=q('#ir-rename-remote-icon').value;if(!device||!name||!deviceIcons.has(icon)){q('#ir-rename-remote-error').textContent=!device?'El dispositivo ya no est\u00e1 disponible.':!name?'Escribe un nombre para el dispositivo.':'Selecciona un icono para el dispositivo.';q('#ir-rename-remote-error').hidden=false;return;}device.name=name;device.icon=icon;q('#ir-rename-remote-dialog').close();render();const message='Dispositivo actualizado.';if(route.screen==='home')flowFeedback(message);else feedback(message);persist();});
  q('#ir-rename-remote-input').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();q('#ir-save-remote-name').click();}});
  root.querySelectorAll('form').forEach(form=>form.addEventListener('submit',event=>{event.preventDefault();if(form.id==='ir-button-form')q('#ir-save').click();else if(form.closest('#ir-entity-dialog'))acceptEntity();else form.querySelector('button[type="button"]')?.click();}));
  q('#ir-button-name').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();q('#ir-save').click();}});
  listen(scope,'click',event=>{if(!event.target.closest('.ir-menu-wrap'))closeMenus();if(!insideIconSelector(event))closeIconPicker();});
  listen(scope,'focusin',event=>{if(!insideIconSelector(event))closeIconPicker();});
  listen(scope,'keydown',event=>{
    if(event.key!=='Escape'||event.defaultPrevented||!landingPreviews.size)return;event.preventDefault();
    const entry=Array.from(landingPreviews)[0];clearLandingPreviews();if(route.screen==='editor'&&route.deviceId===entry.deviceId)focusFunctionButton(entry.key);
  });
  root.addEventListener('focusin',event=>{if(!event.target.closest('.ir-menu-wrap'))closeMenus();});
  root.addEventListener('keydown',event=>{
    const functionButton=event.target.closest('button[data-function]');
    if((event.key===' '||event.code==='Space')&&editMode&&route.screen==='editor'&&functionButton&&q('#ir-buttons').contains(functionButton)&&!dialogIds.some(id=>q(id).open)){
      event.preventDefault();if(event.repeat||Date.now()<suppressFunctionClickUntil)return;const key=functionButton.dataset.function;
      if(movingFunction&&movingFunction!==key){const cell=functionButton.closest('[data-grid-target-row]');if(cell)moveFunctionTo(cell.dataset.gridTargetRow,Number(cell.dataset.gridTargetCell));return;}
      const wasMoving=movingFunction===key;resetMoving();movingFunction=wasMoving?null:key;renderRemote();refreshIcons();focusFunctionButton(key);
      feedback(movingFunction?'Selecciona un destino.':'Movimiento cancelado.');return;
    }
    if(event.key==='Escape'&&(movingFunction||landingPreviews.size)&&!q('#ir-function-dialog').open){event.preventDefault();const key=movingFunction||Array.from(landingPreviews)[0]?.key;resetMoving();renderRemote();refreshIcons();if(key)focusFunctionButton(key);feedback('Movimiento cancelado.');return;}
    const wrap=event.target.closest('.ir-menu-wrap'),menu=wrap?.querySelector('.ir-context-menu');if(!menu||menu.hidden)return;if(event.key==='Escape'){event.preventDefault();closeMenus(true);return;}if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();const items=Array.from(menu.querySelectorAll('button:not(:disabled)')),index=items.indexOf(scope.activeElement);const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus();
  });
  listen(window,'resize',()=>{clearLandingPreviews();for(const grid of observedGrids)syncRowGeometry(grid);positionIconOptions();});
  listen(window,'scroll',()=>{clearLandingPreviews();positionIconOptions();},{capture:true,passive:true});
  render();
  async function reload(){
    if(saving||disposed)return;root.inert=true;q('#ir-busy-status').textContent='Actualizando\u2026';
    try{const envelope=await api.call('get');if(disposed)return;dialogIds.forEach(id=>{if(q(id).open)q(id).close();});applyEnvelope(envelope);editMode=false;render();globalError('');}
    catch(error){if(!disposed)globalError(error.message||'No se pudo actualizar.');}
    finally{root.inert=false;q('#ir-busy-status').textContent='';}
  }
  return {reload,hassChanged(){const signature=relevantState();if(signature===lastRelevantState)return;lastRelevantState=signature;if(disposed||saving||pointerContext||dialogIds.some(id=>q(id).open)||root.querySelector('.ir-context-menu:not([hidden])'))return;if(route.screen==='editor'){renderRemote();refreshIcons();}else renderHome();},dispose(){disposed=true;cancelLearning();resetMoving();lifecycle.abort();rowGeometryObserver?.disconnect();for(const observer of observers)observer.disconnect();dialogIds.forEach(id=>{if(q(id)?.open)q(id).close();});}};
}
