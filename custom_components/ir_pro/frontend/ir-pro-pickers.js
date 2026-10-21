import {icon} from './ir-pro-icons.js?v=0.2.0b8';
export function mountIconPickers(scope,lifecycle) {
  'use strict';
  // Keep native selects as the model-facing source; the visible picker adds SVG previews.
  const host=scope.querySelector('#modal-body');
  if(!host)return;
  const selector='select#button-icon,select#new-device-icon,select#rename-device-icon,select[data-dual-field="icon"],select[data-child-icon]';
  const instances=new Set(), mounted=new WeakMap();
  let active=null, serial=0, queued=false;
  const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const preview=value=>value==='none'?'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8"/><path d="m6.5 6.5 11 11"/></svg>':typeof icon==='function'?icon(value):'';

  function closePicker(instance=active) {
    if(!instance)return;
    instance.list.hidden=true;
    instance.trigger.setAttribute('aria-expanded','false');
    instance.trigger.removeAttribute('aria-activedescendant');
    instance.wrapper.classList.remove('is-open');
    if(active===instance)active=null;
  }
  function positionPicker(instance) {
    const bounds=host.getBoundingClientRect(), anchor=instance.trigger.getBoundingClientRect();
    const below=Math.max(44,bounds.bottom-anchor.bottom-9),above=Math.max(44,anchor.top-bounds.top-9);
    const upward=below<160&&above>below;
    instance.wrapper.classList.toggle('opens-up',upward);
    instance.list.style.maxHeight=Math.min(286,upward?above:below)+'px';
  }
  function highlight(instance,index) {
    const choices=Array.from(instance.select.options);
    if(!choices.length)return;
    index=Math.max(0,Math.min(choices.length-1,index));
    instance.highlighted=index;
    Array.from(instance.list.children).forEach((item,i)=>item.classList.toggle('is-highlighted',i===index));
    const current=instance.list.children[index];
    instance.trigger.setAttribute('aria-activedescendant',current.id);
    const top=current.offsetTop,bottom=top+current.offsetHeight;
    if(top<instance.list.scrollTop)instance.list.scrollTop=top;
    else if(bottom>instance.list.scrollTop+instance.list.clientHeight)instance.list.scrollTop=bottom-instance.list.clientHeight;
  }
  function openPicker(instance) {
    if(instance.select.disabled)return;
    if(active&&active!==instance)closePicker(active);
    syncPicker(instance);
    active=instance;
    instance.list.hidden=false;
    instance.wrapper.classList.add('is-open');
    instance.trigger.setAttribute('aria-expanded','true');
    positionPicker(instance);
    highlight(instance,Math.max(0,instance.select.selectedIndex));
  }
  function choose(instance,index) {
    const option=instance.select.options[index];
    if(!option||option.disabled)return;
    instance.select.value=option.value;
    closePicker(instance);
    // These events reach the existing draft/preview handlers, including folder and dual controls.
    instance.select.dispatchEvent(new Event('input',{bubbles:true}));
    instance.select.dispatchEvent(new Event('change',{bubbles:true}));
    syncPicker(instance);
    instance.trigger.focus({preventScroll:true});
  }
  function syncPicker(instance) {
    const choices=Array.from(instance.select.options);
    const signature=JSON.stringify(choices.map(option=>[option.value,option.textContent,option.disabled]));
    if(signature!==instance.signature) {
      instance.signature=signature;
      instance.list.innerHTML=choices.map((option,index)=>'<div class="ir-icon-option" id="'+instance.id+'-option-'+index+'" role="option" data-icon-option="'+index+'" aria-selected="false"'+(option.disabled?' aria-disabled="true"':'')+'><span class="ir-icon-preview">'+preview(option.value)+'</span><span>'+escape(option.textContent)+'</span></div>').join('');
    }
    const value=instance.select.value,current=choices[instance.select.selectedIndex];
    if(instance.value!==value||instance.label!==current?.textContent) {
      instance.value=value;instance.label=current?.textContent;
      instance.trigger.innerHTML='<span class="ir-icon-preview">'+preview(value)+'</span><span class="ir-icon-selected-label">'+escape(current?.textContent||'Seleccionar icono')+'</span><svg class="ir-icon-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
      Array.from(instance.list.children).forEach((item,index)=>item.setAttribute('aria-selected',String(index===instance.select.selectedIndex)));
    }
    instance.trigger.disabled=instance.select.disabled;
  }
  function mount(select) {
    const id='ir-icon-picker-'+(++serial),wrapper=document.createElement('div'),trigger=document.createElement('button'),list=document.createElement('div');
    wrapper.className='ir-icon-picker';trigger.className='ir-icon-picker-trigger';trigger.type='button';trigger.id=id;
    trigger.setAttribute('role','combobox');trigger.setAttribute('aria-label','Icono');trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',id+'-list');
    list.className='ir-icon-list';list.id=id+'-list';list.setAttribute('role','listbox');list.setAttribute('aria-label','Iconos');list.hidden=true;
    select.hidden=true;select.setAttribute('aria-hidden','true');select.tabIndex=-1;
    select.insertAdjacentElement('afterend',wrapper);wrapper.append(trigger,list);
    const instance={select,wrapper,trigger,list,id,signature:null,value:null,highlighted:0,typed:'',typedAt:0};
    mounted.set(select,instance);instances.add(instance);syncPicker(instance);
    trigger.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();active===instance?closePicker(instance):openPicker(instance);});
    list.addEventListener('pointerdown',event=>event.preventDefault());
    list.addEventListener('click',event=>{const option=event.target.closest('[data-icon-option]');if(!option)return;event.preventDefault();event.stopPropagation();choose(instance,Number(option.dataset.iconOption));});
    trigger.addEventListener('keydown',event=>{
      const options=Array.from(select.options);
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
        event.preventDefault();
        const wasOpen=active===instance;if(!wasOpen)openPicker(instance);
        let next=event.key==='Home'?0:event.key==='End'?options.length-1:wasOpen?instance.highlighted+(event.key==='ArrowDown'?1:-1):select.selectedIndex;
        const direction=event.key==='ArrowUp'||event.key==='End'?-1:1;
        while(options[next]?.disabled)next+=direction;
        highlight(instance,next);
      } else if(event.key==='Enter'||event.key===' ') {
        event.preventDefault();active===instance?choose(instance,instance.highlighted):openPicker(instance);
      } else if(event.key==='Escape'&&active===instance) {
        event.preventDefault();event.stopPropagation();closePicker(instance);
      } else if(event.key==='Tab')closePicker(instance);
      else if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey) {
        event.preventDefault();if(active!==instance)openPicker(instance);
        const now=Date.now();instance.typed=now-instance.typedAt<700?instance.typed+event.key:event.key;instance.typedAt=now;
        const normalize=text=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es');
        const query=normalize(instance.typed),index=options.findIndex(option=>!option.disabled&&normalize(option.textContent.trim()).startsWith(query));
        if(index>=0)highlight(instance,index);
      }
    });
  }
  function reconcile() {
    queued=false;
    instances.forEach(instance=>{if(!instance.select.isConnected){closePicker(instance);instances.delete(instance);}else syncPicker(instance);});
    host.querySelectorAll(selector).forEach(select=>{if(!mounted.has(select))mount(select);});
    if(active)positionPicker(active);
  }
  function schedule() {if(!queued){queued=true;queueMicrotask(reconcile);}}
  // Rendering a function swaps sections; observe only real form changes, not our own preview DOM.
  const observer=new MutationObserver(changes=>{if(changes.some(change=>!change.target.closest?.('.ir-icon-picker')))schedule();});observer.observe(host,{childList:true,subtree:true,attributes:true,attributeFilter:['selected','disabled','value']});lifecycle.signal.addEventListener('abort',()=>{observer.disconnect();closePicker();},{once:true});
  host.addEventListener('input',schedule);host.addEventListener('change',schedule);
  scope.addEventListener('pointerdown',event=>{if(active&&!active.wrapper.contains(event.target))closePicker(active);},{capture:true,signal:lifecycle.signal});
  scope.addEventListener('focusin',event=>{if(active&&!active.wrapper.contains(event.target))closePicker(active);});
  scope.querySelector('#modal')?.addEventListener('close',()=>closePicker());
  host.addEventListener('scroll',()=>{if(active)positionPicker(active);},{passive:true,signal:lifecycle.signal});
  window.addEventListener('resize',()=>{if(active)positionPicker(active);},{passive:true,signal:lifecycle.signal});
  reconcile();
}
