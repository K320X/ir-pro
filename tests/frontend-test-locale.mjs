import {createI18n} from '../custom_components/ir_pro/frontend/ir-pro-i18n.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../custom_components/ir_pro/frontend/ir-pro-controller.js',import.meta.url),'utf8');
const helpers=['esc','t','binding','h','attr','bindText','numberHTML','errorBinding','errorHTML','bindError','optionBinding','configurationHTML'].map(name=>source.split('\n').find(line=>line.trimStart().startsWith('const '+name+' ='))).filter(Boolean).join('\n').replace('const optionBinding =','globalThis.optionBinding =').replace('const configurationHTML =','globalThis.configurationHTML =');

// Bind production translation/formatting in VM-extracted controller tests.
// Spanish preserves the existing behavioral fixtures; explicit language tests
// use this same helper with another locale instead of replacing translations.
export function withLocale(scope,language='es'){
 const locale=scope.locale||createI18n(language);
 Object.assign(scope,{locale});
 vm.createContext(scope);vm.runInContext(helpers,scope);
 return scope;
}
