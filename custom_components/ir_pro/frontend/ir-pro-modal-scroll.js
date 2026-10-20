// Native dialogs make the background inert, but do not freeze its scroll roots.
export function createModalScrollLock(root,signal) {
  const active=new Set(),watched=new WeakSet(),snapshots=new Map(),windows=new Map();
  const lifetime=new AbortController();
  const owned=['overflow','overflow-x','overflow-y','overscroll-behavior','overscroll-behavior-x','overscroll-behavior-y','scroll-behavior'];
  let session=null,disposed=false,restoring=false,touch=null;
  const topDialog=()=>Array.from(active).at(-1);
  const inside=(element,dialog)=>element===dialog||dialog?.contains?.(element);
  const styleOf=element=>element.ownerDocument?.defaultView?.getComputedStyle?.(element);
  function remember(element) {
    if(!element?.style||snapshots.has(element)||Array.from(active).some(dialog=>inside(element,dialog)))return;
    const declarations=[];
    for(let i=0;i<element.style.length;i++){
      const name=element.style.item(i);
      if(owned.includes(name))declarations.push([name,element.style.getPropertyValue(name),element.style.getPropertyPriority(name)]);
    }
    const snapshot={element,declarations,top:element.scrollTop,left:element.scrollLeft};snapshots.set(element,snapshot);
    element.style.setProperty('overflow','hidden','important');
    element.style.setProperty('overscroll-behavior','none','important');
    element.style.setProperty('scroll-behavior','auto','important');
    element.addEventListener('scroll',()=>{
      if(restoring||!active.size)return;
      if(element.scrollTop!==snapshot.top)element.scrollTop=snapshot.top;
      if(element.scrollLeft!==snapshot.left)element.scrollLeft=snapshot.left;
    },{signal:session.signal});
  }
  function prevent(event) {if(event.cancelable)event.preventDefault();}
  function pathOf(event) {
    if(event.composedPath)return event.composedPath();
    const path=[];let node=event.target;while(node){path.push(node);node=node.parentNode||node.host;}return path;
  }
  function canConsume(path,dialog,dx,dy) {
    for(const element of path){
      if(element?.nodeType!==1)continue;
      const style=styleOf(element);
      if(/auto|scroll|overlay/.test(style?.overflowY||'')&&element.scrollHeight>element.clientHeight+1&&
        (dy<0?element.scrollTop>0:dy>0&&element.scrollTop+element.clientHeight<element.scrollHeight-1))return true;
      if(/auto|scroll|overlay/.test(style?.overflowX||'')&&element.scrollWidth>element.clientWidth+1&&
        (dx<0?element.scrollLeft>0:dx>0&&element.scrollLeft+element.clientWidth<element.scrollWidth-1))return true;
      if(element===dialog)break;
    }
    return false;
  }
  function wheel(event) {
    if(event.ctrlKey)return; // Keep browser zoom available.
    const dialog=topDialog(),path=pathOf(event);
    if(!path.includes(dialog)||!canConsume(path,dialog,event.deltaX,event.deltaY))prevent(event);
  }
  function keyDown(event) {
    if(event.defaultPrevented||event.isComposing||event.ctrlKey||event.altKey||event.metaKey||event.shiftKey||
      !['PageUp','PageDown','Home','End'].includes(event.key))return;
    const dialog=topDialog(),path=pathOf(event),target=path.find(element=>element?.nodeType===1);
    // Neutral focus is in the header, a sibling of the scrollable card body.
    // Inputs, menus and buttons retain every native keyboard interaction.
    if(!path.includes(dialog)||(target!==dialog&&!target?.matches?.('.modal-head h2'))||
      dialog.ownerDocument?.getSelection?.()?.isCollapsed===false)return;
    const body=dialog.querySelector?.('.modal-body'),style=body&&styleOf(body);
    if(!body||!/auto|scroll|overlay/.test(style?.overflowY||''))return;
    const max=Math.max(0,body.scrollHeight-body.clientHeight),step=Math.max(40,body.clientHeight*.875);
    const next=event.key==='Home'?0:event.key==='End'?max:body.scrollTop+(event.key==='PageUp'?-step:step);
    body.scrollTop=Math.max(0,Math.min(max,next));prevent(event);
  }
  function touchStart(event) {
    const point=event.touches?.length===1?event.touches[0]:null;
    touch=point?{id:point.identifier,x:point.clientX,y:point.clientY}:null;
  }
  function touchMove(event) {
    if(!touch||event.touches?.length!==1)return; // Do not interfere with pinch zoom.
    const point=Array.from(event.touches).find(item=>item.identifier===touch.id);if(!point)return;
    const dx=touch.x-point.clientX,dy=touch.y-point.clientY;touch={id:touch.id,x:point.clientX,y:point.clientY};
    const dialog=topDialog(),path=pathOf(event);
    if(!path.includes(dialog)){prevent(event);return;}
    // Preserve selection handles, native controls and caret interaction.
    if(path.some(element=>element?.matches?.('input,textarea,select,[contenteditable="true"]'))||
      dialog.ownerDocument?.getSelection?.()?.isCollapsed===false)return;
    if(!canConsume(path,dialog,dx,dy))prevent(event);
  }
  function attachDocument(document) {
    const window=document?.defaultView;if(!window||windows.has(window))return;
    windows.set(window,{x:window.scrollX,y:window.scrollY});
    document.addEventListener('wheel',wheel,{capture:true,passive:false,signal:session.signal});
    document.addEventListener('keydown',keyDown,{capture:true,signal:session.signal});
    document.addEventListener('touchstart',touchStart,{capture:true,passive:true,signal:session.signal});
    document.addEventListener('touchmove',touchMove,{capture:true,passive:false,signal:session.signal});
    document.addEventListener('touchend',()=>{touch=null;},{capture:true,passive:true,signal:session.signal});
    document.addEventListener('touchcancel',()=>{touch=null;},{capture:true,passive:true,signal:session.signal});
    remember(document.documentElement);remember(document.body);remember(document.scrollingElement);
  }
  function ancestors(start) {
    const seen=new Set();let node=start;
    while(node&&!seen.has(node)){
      seen.add(node);
      if(node.nodeType===9){
        attachDocument(node);
        // Same-origin frame ancestors are public DOM. Cross-origin access stops here.
        try{node=node.defaultView?.frameElement;}catch{node=null;}
        continue;
      }
      remember(node);
      node=node.parentNode||node.host;
    }
  }
  function restore() {
    session?.abort();session=null;touch=null;restoring=true;
    for(const {element,declarations} of snapshots.values()){
      for(const name of owned)if(name!=='scroll-behavior')element.style.removeProperty(name);
      for(const [name,value,priority] of declarations)if(name!=='scroll-behavior')element.style.setProperty(name,value,priority);
    }
    for(const {element,top,left} of snapshots.values()){element.scrollTop=top;element.scrollLeft=left;}
    for(const [window,{x,y}] of windows){try{window.scrollTo(x,y);}catch{}}
    for(const {element,declarations} of snapshots.values()){
      element.style.removeProperty('scroll-behavior');
      for(const [name,value,priority] of declarations)if(name==='scroll-behavior')element.style.setProperty(name,value,priority);
    }
    snapshots.clear();windows.clear();restoring=false;
  }
  function lock(dialog) {
    if(disposed||!dialog||active.has(dialog))return;
    active.add(dialog);session||=new AbortController();
    if(!watched.has(dialog)){
      watched.add(dialog);
      dialog.addEventListener('close',()=>{if(!dialog.open)unlock(dialog);},{signal:lifetime.signal});
    }
    ancestors(root);ancestors(dialog.parentNode||dialog.getRootNode?.());
    // Freeze scrollable background descendants as well as the HA ancestor chain.
    for(const element of root.querySelectorAll?.('*')||[]){
      if(Array.from(active).some(card=>inside(element,card)))continue;
      const style=styleOf(element);
      if((/auto|scroll|overlay/.test(style?.overflowY||'')&&element.scrollHeight>element.clientHeight)||
        (/auto|scroll|overlay/.test(style?.overflowX||'')&&element.scrollWidth>element.clientWidth))remember(element);
    }
  }
  function unlock(dialog) {if(active.delete(dialog)&&!active.size)restore();}
  function dispose() {
    if(disposed)return;disposed=true;active.clear();restore();lifetime.abort();signal?.removeEventListener('abort',dispose);
  }
  if(signal?.aborted)disposed=true;else signal?.addEventListener('abort',dispose,{once:true});
  return {lock,unlock,dispose};
}
