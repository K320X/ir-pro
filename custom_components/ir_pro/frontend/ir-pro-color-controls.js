// Keep the native color picker and its original input events behind a stable swatch.
export function mountColorControls(scope,signal) {
  if(signal?.aborted)return ()=>{};
  const host=scope.host||scope,document=scope.ownerDocument||host.ownerDocument;
  const lifecycle=new AbortController();
  let disposed=false;
  const modality=value=>{if(host.getAttribute('data-input-modality')!==value)host.setAttribute('data-input-modality',value);};
  const update=input=>{
    if(!input?.matches?.('input[type="color"]'))return;
    const wrapper=input.parentElement;
    if(!wrapper?.classList.contains('color-control'))return;
    const value=input.value.toLowerCase();
    if(wrapper.style.getPropertyValue('--selected-color')!==value)wrapper.style.setProperty('--selected-color',value);
    const caption=wrapper.querySelector('.color-control-value');
    if(caption&&caption.textContent!==value.toUpperCase())caption.textContent=value.toUpperCase();
  };
  const enhance=()=>{
    if(disposed)return;
    for(const input of scope.querySelectorAll('input[type="color"]')){
      if(!input.parentElement?.classList.contains('color-control')){
        const wrapper=document.createElement('span');wrapper.className='color-control';
        const swatch=document.createElement('span');swatch.className='color-control-swatch';swatch.setAttribute('aria-hidden','true');
        const caption=document.createElement('span');caption.className='color-control-value';caption.setAttribute('aria-hidden','true');
        input.replaceWith(wrapper);wrapper.append(swatch,caption,input);
      }
      update(input);
    }
  };
  const observer=new MutationObserver(enhance);
  const dispose=()=>{
    if(disposed)return;disposed=true;observer.disconnect();lifecycle.abort();
    signal?.removeEventListener('abort',dispose);
  };
  modality('keyboard');
  scope.addEventListener('pointerdown',()=>modality('pointer'),{capture:true,signal:lifecycle.signal});
  document.addEventListener('keydown',event=>{
    if(['Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','Enter',' '].includes(event.key))modality('keyboard');
  },{capture:true,signal:lifecycle.signal});
  scope.addEventListener('input',event=>update(event.target),{capture:true,signal:lifecycle.signal});
  scope.addEventListener('change',event=>update(event.target),{capture:true,signal:lifecycle.signal});
  observer.observe(scope,{subtree:true,childList:true});
  signal?.addEventListener('abort',dispose,{once:true});
  enhance();
  return dispose;
}
