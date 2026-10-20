import assert from 'node:assert/strict';
import {setMaxListeners} from 'node:events';
import {createModalScrollLock} from '../custom_components/ir_pro/frontend/ir-pro-modal-scroll.js';

// Exercise the real lifecycle and event handlers against a DOM-shaped tree,
// including a shadow host and a containing same-origin frame. No CSS snapshots.
setMaxListeners(0);
class InlineStyle {
  constructor(values={}){this.values=new Map(Object.entries(values).map(([key,value])=>[key,{value,priority:''}]));}
  get length(){return this.values.size;}
  item(index){return [...this.values.keys()][index];}
  getPropertyValue(name){return this.values.get(name)?.value||'';}
  getPropertyPriority(name){return this.values.get(name)?.priority||'';}
  setProperty(name,value,priority=''){this.values.set(name,{value,priority});}
  removeProperty(name){const value=this.getPropertyValue(name);this.values.delete(name);return value;}
}
class Element extends EventTarget {
  constructor(document,parent=null,overflow='visible'){
    super();this.nodeType=1;this.ownerDocument=document;this.parentNode=parent;this.children=[];this.style=new InlineStyle();this.overflow=overflow;
    this.scrollTop=0;this.scrollLeft=0;this.clientHeight=100;this.scrollHeight=100;this.clientWidth=100;this.scrollWidth=100;this.open=false;
    if(parent?.children)parent.children.push(this);
  }
  contains(target){for(let node=target;node;node=node.parentNode||node.host)if(node===this)return true;return false;}
  querySelectorAll(){return this.children.flatMap(child=>[child,...child.querySelectorAll()]);}
  querySelector(selector){return selector==='.modal-body'?this.querySelectorAll().find(element=>element.modalBody):null;}
  matches(selector){return selector==='.modal-head h2'?this.neutralHeading===true:selector.includes('input')&&this.editable===true;}
}
function documentTree(frameElement=null){
  const document=new EventTarget();document.nodeType=9;document.selection={isCollapsed:true};document.getSelection=()=>document.selection;
  document.defaultView={frameElement,scrollX:7,scrollY:83,scrollCalls:[],getComputedStyle:element=>({overflowX:element.overflow,overflowY:element.overflow}),scrollTo(x,y){this.scrollX=x;this.scrollY=y;this.scrollCalls.push([x,y]);}};
  document.documentElement=new Element(document,document,'auto');document.body=new Element(document,document.documentElement);document.scrollingElement=document.documentElement;
  document.documentElement.scrollTop=83;document.documentElement.scrollHeight=1400;
  return document;
}
function fixture(){
  const parent=documentTree(),frame=new Element(parent,parent.body),document=documentTree(frame);
  const ha=new Element(document,document.body,'auto');ha.scrollTop=117;ha.scrollHeight=1200;
  const host=new Element(document,ha),shadow={nodeType:11,host,parentNode:null},root=new Element(document,shadow);
  const background=new Element(document,root,'auto');background.scrollTop=31;background.scrollHeight=500;
  const dialog=new Element(document,root),body=new Element(document,dialog,'auto');body.modalBody=true;body.scrollHeight=500;body.scrollTop=100;
  const header=new Element(document,dialog),heading=new Element(document,header);heading.neutralHeading=true;
  const content=new Element(document,body),nested=new Element(document,root),nestedBody=new Element(document,nested,'auto');nestedBody.scrollHeight=300;
  return {parent,frame,document,ha,host,root,background,dialog,body,content,header,heading,nested,nestedBody};
}
function event(type,path,properties={}){
  const result=new Event(type,{cancelable:true});Object.defineProperty(result,'composedPath',{value:()=>path});
  for(const [key,value] of Object.entries(properties))Object.defineProperty(result,key,{value});
  return result;
}
function wheel(document,path,dy,dx=0,properties={}){
  const result=event('wheel',path,{deltaY:dy,deltaX:dx,...properties});document.dispatchEvent(result);return result.defaultPrevented;
}
function close(dialog){dialog.open=false;dialog.dispatchEvent(new Event('close'));}

// Opening freezes the public HA ancestor chain, document and frame document,
// plus a separately scrollable background descendant, before native focus runs.
const tree=fixture(),lifecycle=new AbortController(),lock=createModalScrollLock(tree.root,lifecycle.signal);
tree.ha.style.setProperty('overflow-y','auto','important');tree.ha.style.setProperty('scroll-behavior','smooth');tree.ha.style.setProperty('color','red');
tree.ha.style.setProperty('overscroll-behavior-x','contain');
lock.lock(tree.dialog);tree.dialog.open=true;
for(const element of [tree.root,tree.host,tree.ha,tree.document.documentElement,tree.document.body,tree.frame,tree.parent.documentElement,tree.background])assert.equal(element.style.getPropertyValue('overflow'),'hidden');
assert.equal(tree.body.style.getPropertyValue('overflow'),'','The active card remains scrollable');
tree.ha.scrollTop=400;tree.ha.dispatchEvent(new Event('scroll'));assert.equal(tree.ha.scrollTop,117);
tree.background.scrollTop=200;tree.background.dispatchEvent(new Event('scroll'));assert.equal(tree.background.scrollTop,31);
tree.ha.style.setProperty('color','blue'); // An unrelated HA update must survive.

// Wheel events consume space only inside the top card; its edges do not chain.
const path=[tree.content,tree.body,tree.dialog,tree.root];
assert.equal(wheel(tree.document,path,20),false);
tree.body.scrollTop=400;assert.equal(wheel(tree.document,path,20),true);
assert.equal(wheel(tree.document,path,-20),false);
tree.body.scrollTop=0;assert.equal(wheel(tree.document,path,-20),true);
assert.equal(wheel(tree.document,[tree.background,tree.root],20),true);
assert.equal(wheel(tree.parent,[tree.frame,tree.parent.body],20),true);
assert.equal(wheel(tree.document,path,20,0,{ctrlKey:true}),false,'Browser zoom remains available');
const key=event('keydown',path,{key:'ArrowDown'});tree.document.dispatchEvent(key);assert.equal(key.defaultPrevented,false,'Keyboard editing/scrolling is not intercepted');

// Neutral header focus cannot natively reach its sibling scroll body. Page
// navigation targets that body, while controls and editing shortcuts stay native.
const headingPath=[tree.heading,tree.header,tree.dialog,tree.root];
const keyDown=(path,key,properties={})=>{const e=event('keydown',path,{key,...properties});tree.document.dispatchEvent(e);return e.defaultPrevented;};
tree.body.scrollTop=100;assert.equal(keyDown(headingPath,'PageDown'),true);assert.equal(tree.body.scrollTop,187.5);
assert.equal(keyDown(headingPath,'PageUp'),true);assert.equal(tree.body.scrollTop,100);
assert.equal(keyDown(headingPath,'Home'),true);assert.equal(tree.body.scrollTop,0);
assert.equal(keyDown([tree.dialog,tree.root],'End'),true);assert.equal(tree.body.scrollTop,400);
assert.equal(keyDown(headingPath,'PageDown'),true);assert.equal(tree.body.scrollTop,400,'An edge key cannot chain to the background');
for(const key of ['Home','End','PageUp','PageDown',' ','ArrowDown','Escape'])assert.equal(keyDown(path,key),false,'Interactive content keeps '+key);
for(const modifier of ['ctrlKey','altKey','metaKey','shiftKey','isComposing'])assert.equal(keyDown(headingPath,'Home',{[modifier]:true}),false);
tree.document.selection.isCollapsed=false;assert.equal(keyDown(headingPath,'Home'),false);tree.document.selection.isCollapsed=true;
assert.equal(tree.body.scrollTop,400);

// Touch scroll is allowed in the body, prevented at its edge and outside it,
// while text selection, native inputs and pinch gestures retain their defaults.
const start=(path,y=100)=>tree.document.dispatchEvent(event('touchstart',path,{touches:[{identifier:1,clientX:20,clientY:y}]}));
const move=(path,y=80)=>{const e=event('touchmove',path,{touches:[{identifier:1,clientX:20,clientY:y}]});tree.document.dispatchEvent(e);return e.defaultPrevented;};
tree.body.scrollTop=100;start(path);assert.equal(move(path),false);
tree.body.scrollTop=400;start(path);assert.equal(move(path),true);
start([tree.background]);assert.equal(move([tree.background]),true);
tree.content.editable=true;start(path);assert.equal(move(path),false);tree.content.editable=false;
tree.document.selection.isCollapsed=false;start(path);assert.equal(move(path),false);tree.document.selection.isCollapsed=true;
const pinch=event('touchmove',path,{touches:[{identifier:1,clientX:0,clientY:0},{identifier:2,clientX:30,clientY:30}]});tree.document.dispatchEvent(pinch);assert.equal(pinch.defaultPrevented,false);

// A second dialog keeps every original lock alive. Its close restores the
// outer card as the allowed surface without unlocking Home Assistant.
lock.lock(tree.nested);tree.nested.open=true;
assert.equal(wheel(tree.document,path,10),true);
assert.equal(wheel(tree.document,[tree.nestedBody,tree.nested,tree.root],10),false);
close(tree.nested);assert.equal(tree.ha.style.getPropertyValue('overflow'),'hidden');
tree.body.scrollTop=100;assert.equal(wheel(tree.document,path,10),false);

// Native close is queued. Reopening the same element before that old close
// event arrives must keep the new session locked.
tree.dialog.open=false;lock.lock(tree.dialog);tree.dialog.open=true;tree.dialog.dispatchEvent(new Event('close'));
assert.equal(tree.ha.style.getPropertyValue('overflow'),'hidden');
close(tree.dialog);
assert.equal(tree.ha.style.getPropertyValue('overflow'),'');
assert.equal(tree.ha.style.getPropertyValue('overflow-y'),'auto');assert.equal(tree.ha.style.getPropertyPriority('overflow-y'),'important');
assert.equal(tree.ha.style.getPropertyValue('overscroll-behavior-x'),'contain');assert.equal(tree.ha.style.getPropertyValue('overscroll-behavior'),'');
assert.equal(tree.ha.style.getPropertyValue('scroll-behavior'),'smooth');assert.equal(tree.ha.style.getPropertyValue('color'),'blue');
assert.equal(tree.ha.scrollTop,117);assert.equal(tree.background.scrollTop,31);
assert.deepEqual(tree.document.defaultView.scrollCalls.at(-1),[7,83]);assert.deepEqual(tree.parent.defaultView.scrollCalls.at(-1),[7,83]);
assert.equal(wheel(tree.document,[tree.background],20),false,'Last close removes blocking document handlers');
assert.equal(keyDown(headingPath,'Home'),false,'Last close removes the neutral-focus keyboard fallback');
tree.ha.scrollTop=123;tree.ha.dispatchEvent(new Event('scroll'));assert.equal(tree.ha.scrollTop,123,'Last close removes scroll correction');

// Reopening takes fresh positions; AbortSignal/disposal restore them even if
// native close never fires because the panel was detached during navigation.
lock.lock(tree.dialog);tree.dialog.open=true;tree.ha.scrollTop=999;lifecycle.abort();
assert.equal(tree.ha.style.getPropertyValue('overflow'),'');assert.equal(tree.ha.scrollTop,123);
assert.equal(wheel(tree.document,[tree.background],20),false);
lock.dispose();lock.lock(tree.nested);assert.equal(tree.ha.style.getPropertyValue('overflow'),'');
const aborted=new AbortController();aborted.abort();createModalScrollLock(tree.root,aborted.signal).lock(tree.dialog);assert.equal(tree.root.style.getPropertyValue('overflow'),'');
console.log('Modal scroll lifecycle, nested dialogs, edge gestures and restoration passed.');
