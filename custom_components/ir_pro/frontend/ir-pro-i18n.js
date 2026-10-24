import {messages} from './ir-pro-translations.js?v=1.0.3';

export function normalizeLanguage(language) {
  return typeof language==='string'&&language.trim().toLowerCase().replaceAll('_','-').split('-')[0]==='es'?'es':'en';
}
export const panelLanguage=normalizeLanguage;
export function hassLanguage(hass) {
  return normalizeLanguage(hass?.language||hass?.locale?.language);
}
const serverErrorCodes=new Set(['ambiguous_state','command_failed','busy','invalid_model','invalid_signal','learn_failed','revision_conflict','source_unavailable','storage_error','permission_denied','not_loaded']);
export const isLocalizedServerError=error=>serverErrorCodes.has(error?.code);

export function createI18n(language='en') {
  let active=normalizeLanguage(language);
  const resolve=value=>value&&typeof value==='object'&&!Array.isArray(value)&&(typeof value.message==='string'||typeof value.i18n==='string')?t(value.message||value.i18n,value.params||{}):value;
  const interpolate=(template,params)=>template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g,(token,key)=>Object.hasOwn(params,key)?String(resolve(params[key])):token);
  const t=(source,params={})=>interpolate(messages[active]?.[source]??messages.es?.[source]??source,params);
  function knownMessage(message) {
    if(typeof message!=='string')return null;
    for(const source of Object.keys(messages.es||{}))for(const lang of ['es','en'])if(messages[lang]?.[source]===message)return t(source);
    return null;
  }
  return {
    get language(){return active;},
    setLanguage(value){const next=normalizeLanguage(value),changed=next!==active;active=next;return changed;},
    t,
    number(value,options={}){return new Intl.NumberFormat(active==='es'?'es-ES':'en-US',options).format(value);},
    error(error,fallback='No se ha podido completar la operación.') {
      const message=typeof error==='string'?error:error?.message,translated=knownMessage(message);
      if(translated!==null)return translated;
      if(error?.irProLocalized===true&&isLocalizedServerError(error)&&error.irProLanguage===active&&typeof message==='string'&&message)return message;
      return t(fallback);
    },
  };
}

// Bind only interface text. Names, input values, identifiers and learned data
// never participate in heuristic text replacement.
export function refreshBindings(root,locale) {
  for(const element of root.querySelectorAll('[data-ir-text]')) {
    if(element.matches?.('input,textarea,[contenteditable="true"]'))continue;
    try {const [source,params]=JSON.parse(element.getAttribute('data-ir-text'));const text=locale.t(source,params);if(element.textContent!==text)element.textContent=text;} catch {}
  }
  for(const element of root.querySelectorAll('[data-ir-i18n-aria-label],[data-ir-i18n-title],[data-ir-i18n-placeholder],[data-ir-i18n-label]'))for(const name of ['aria-label','title','placeholder','label']) {
    const binding=element.getAttribute('data-ir-i18n-'+name);if(!binding)continue;
    try {const [source,params]=JSON.parse(binding);const text=locale.t(source,params);if(element.getAttribute(name)!==text)element.setAttribute(name,text);} catch {}
  }
}
