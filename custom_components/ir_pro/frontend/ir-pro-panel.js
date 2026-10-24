import {template,styles} from './ir-pro-theme.js?v=1.0.3';
import {mountStudio} from './ir-pro-controller.js?v=1.0.3';
import {mountColorControls} from './ir-pro-color-controls.js?v=1.0.3';
import {createI18n,hassLanguage,refreshBindings,isLocalizedServerError} from './ir-pro-i18n.js?v=1.0.3';

class IRProPanel extends HTMLElement {
  constructor(){super();this.attachShadow({mode:'open'});this._hass=null;this._controller=null;this._loading=false;this._generation=0;this._viewAbort=null;this._colorControlsDispose=null;this._locale=createI18n('en');this._loadError=null;}
  set hass(value){
    this._hass=value;
    const changed=this._locale.setLanguage(hassLanguage(value));
    if(changed){
      this.shadowRoot.getElementById('ir-remote-studio')?.setAttribute('lang',this._locale.language);
      refreshBindings(this.shadowRoot,this._locale);
      this._controller?.languageChanged();
      if(this._loadError)this._renderLoadError(this._loadError);
    }
    if(this._controller)this._controller.hassChanged();else if(this.isConnected&&!this._loadError)this._load();
  }
  get hass(){return this._hass;}
  set narrow(value){this.toggleAttribute('narrow',!!value);}
  set panel(value){this._panel=value;}
  connectedCallback(){this._load();}
  disconnectedCallback(){this._generation++;this._loading=false;this._controller?.dispose();this._controller=null;this._viewAbort?.abort();this._colorControlsDispose?.();this._colorControlsDispose=null;}
  _renderLoadError(error){
    const message=this.shadowRoot.getElementById('load-error');
    if(message)message.textContent=this._locale.error(error,'No se ha podido conectar con IR Pro.');
    const retry=this.shadowRoot.querySelector('[data-retry-load]');
    if(retry)retry.textContent=this._locale.t('Volver a intentar');
  }
  async _load(){
    if(!this._hass||this._loading||this._controller||!this.isConnected)return;
    this._loading=true;this._loadError=null;const generation=++this._generation;
    this.shadowRoot.innerHTML='<style>:host{display:block;padding:24px;font-family:Roboto,sans-serif;color:var(--primary-text-color)}</style><p role="status" data-ir-text="[&quot;Cargando IR Pro…&quot;,{}]"></p>';
    refreshBindings(this.shadowRoot,this._locale);
    const call=async(action,data={})=>{
      const language=this._locale.language;
      try{return await this._hass.callWS({type:'ir_pro/'+action,...data,language});}
      catch(error){const localized=new Error(error?.message||'');localized.code=error?.code;localized.irProLocalized=isLocalizedServerError(error);localized.irProLanguage=language;throw localized;}
    };
    try{
      const initial=await call('get');if(generation!==this._generation||!this.isConnected)return;
      this.shadowRoot.innerHTML='<style>'+styles+'</style>'+template;
      this.shadowRoot.getElementById('ir-remote-studio').setAttribute('lang',this._locale.language);
      refreshBindings(this.shadowRoot,this._locale);
      this._viewAbort?.abort();this._colorControlsDispose?.();this._viewAbort=new AbortController();this._colorControlsDispose=mountColorControls(this.shadowRoot,this._viewAbort.signal);
      const api={call,subscribe:handler=>this._hass.connection.subscribeMessage(handler,{type:'ir_pro/subscribe',language:this._locale.language}),entity:entityId=>this._hass.states?.[entityId],state:entityId=>this._hass.states?.[entityId]?.state,available:entityId=>{const entity=this._hass.states?.[entityId];return !!entity&&!['unavailable','unknown'].includes(entity.state);}};
      this.shadowRoot.getElementById('ir-pro-version').textContent=initial.version||'1.0.3';
      this._controller=mountStudio(this.shadowRoot.getElementById('ir-remote-studio'),api,initial,!!this._hass.user?.is_admin,()=>this.dispatchEvent(new CustomEvent('hass-toggle-menu',{bubbles:true,composed:true})),this._locale);
    }catch(error){
      if(generation!==this._generation)return;this._viewAbort?.abort();this._colorControlsDispose?.();this._colorControlsDispose=null;this._loadError=error;
      this.shadowRoot.innerHTML='<style>:host{display:block;padding:24px;font-family:Roboto,sans-serif;color:var(--primary-text-color)}button{font:inherit;padding:10px}</style><p id="load-error" role="alert"></p><button type="button" data-retry-load></button>';
      this._renderLoadError(error);this.shadowRoot.querySelector('[data-retry-load]').addEventListener('click',()=>this._load());
    }
    finally{if(generation===this._generation)this._loading=false;}
  }
}
if(!customElements.get('ir-pro-panel'))customElements.define('ir-pro-panel',IRProPanel);
