import {template,styles} from './ir-pro-template.js?v=0.1.0b2';
import {mountStudio} from './ir-pro-controller.js?v=0.1.0b2';

class IRProPanel extends HTMLElement {
  constructor(){super();this.attachShadow({mode:'open'});this._hass=null;this._controller=null;this._loading=false;this._generation=0;}
  set hass(value){this._hass=value;if(this._controller)this._controller.hassChanged();else if(this.isConnected)this._load();}
  get hass(){return this._hass;}
  set narrow(value){this.toggleAttribute('narrow',!!value);}
  set panel(value){this._panel=value;}
  connectedCallback(){this._load();}
  disconnectedCallback(){this._generation++;this._loading=false;this._controller?.dispose();this._controller=null;}
  async _load(){
    if(!this._hass||this._loading||this._controller||!this.isConnected)return;
    this._loading=true;const generation=++this._generation;
    this.shadowRoot.innerHTML='<style>:host{display:block;padding:24px;font-family:Roboto,sans-serif;color:var(--primary-text-color)}</style><p role="status">Cargando IR Pro\u2026</p>';
    try{
      const initial=await this._hass.callWS({type:'ir_pro/get'});if(generation!==this._generation||!this.isConnected)return;
      this.shadowRoot.innerHTML='<style>'+styles+'</style>'+template;
      const api={call:(action,data={})=>this._hass.callWS({type:'ir_pro/'+action,...data}),state:entityId=>this._hass.states?.[entityId]?.state,available:entityId=>{const entity=this._hass.states?.[entityId];return !!entity&&!['unavailable','unknown'].includes(entity.state);}};
      this._controller=mountStudio(this.shadowRoot.getElementById('ir-remote-studio'),api,initial,!!this._hass.user?.is_admin,()=>this.dispatchEvent(new CustomEvent('hass-toggle-menu',{bubbles:true,composed:true})));
    }catch(error){if(generation!==this._generation)return;this.shadowRoot.innerHTML='<style>:host{display:block;padding:24px;font-family:Roboto,sans-serif;color:var(--primary-text-color)}button{font:inherit;padding:10px}</style><p id="load-error" role="alert"></p><button type="button">Volver a intentar</button>';this.shadowRoot.getElementById('load-error').textContent=error.message||'No se ha podido conectar con IR Pro.';this.shadowRoot.querySelector('button').addEventListener('click',()=>this._load());}
    finally{if(generation===this._generation)this._loading=false;}
  }
}
if(!customElements.get('ir-pro-panel'))customElements.define('ir-pro-panel',IRProPanel);
