"""The real browser factories must satisfy the persisted backend contract."""

from copy import deepcopy
import json
from pathlib import Path
import shutil
import subprocess
import unittest
from uuid import uuid4

from tests.helpers import SOURCE, backend_module, empty_model


ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
BRIDGE = r"""
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
const request=JSON.parse(readFileSync(0,'utf8'));
const root=process.cwd();
const {importModel,exportModel,independentStateEffect,linkedActionEffect}=await import(pathToFileURL(root+'/custom_components/ir_pro/frontend/ir-pro-model.js'));
const {createI18n}=await import(pathToFileURL(root+'/custom_components/ir_pro/frontend/ir-pro-i18n.js'));
if(request.operation==='roundtrip'){
  process.stdout.write(JSON.stringify(exportModel(importModel(request.model))));
}else{
  const source=readFileSync(root+'/custom_components/ir_pro/frontend/ir-pro-controller.js','utf8');
  const definitions=source.slice(source.indexOf('  const copy ='),source.indexOf('  let model=importModel'));
  const entities=source.slice(source.indexOf('  const entitySlug ='),source.indexOf('  function toast('));
  if(!definitions.includes('const newRemote =')||!entities.includes('function ensureModelEntities'))throw Error('Missing real controller factories');
  const locale=createI18n('es');
  const context={uid:randomUUID,independentStateEffect,linkedActionEffect,locale,t:locale.t};
  const optionBinding=source.split('\n').find(line=>line.trimStart().startsWith('const optionBinding ='));
  vm.createContext(context);vm.runInContext(optionBinding+'\n'+definitions+'\n'+entities,context);
  vm.runInContext(`globalThis.remotes=[newRemote('Split uno','air-vent'),newRemote('Split dos','wind'),newRemote('Televisor','tv'),newRemote('Televisor','tv')];`,context);
  context.model={version:1,emitters:[{id:'00000000-0000-4000-8000-000000000001',sourceId:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',name:'IR salón',model:'RM4 mini',devices:context.remotes}]};
  context.emitterFor=id=>context.model.emitters.find(emitter=>emitter.devices.some(device=>device.id===id));
  vm.runInContext('ensureModelEntities();',context);
  process.stdout.write(JSON.stringify(exportModel(context.model)));
}
"""


def browser_model(operation="factories", model=None):
    """Execute maintained frontend code instead of keeping a copied fixture."""
    if NODE is None:
        raise RuntimeError("Node.js is required for the frontend/backend contract tests")
    result = subprocess.run(
        [NODE, "--input-type=module", "-e", BRIDGE],
        input=json.dumps({"operation": operation, "model": model}),
        cwd=ROOT, text=True, encoding="utf-8", capture_output=True, timeout=30, check=True,
    )
    return json.loads(result.stdout)


class TemplateContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.validate = staticmethod(backend_module("validation").validate_model)
        cls.raw = browser_model()

    def checked(self, candidate, current=None, records=None):
        return self.validate(candidate, current or empty_model(), {SOURCE}, records or {}, set())[0]

    def test_real_tv_template_is_independent_and_survives_backend_reload(self):
        stored = self.checked(deepcopy(self.raw))
        tv = stored["emitters"][0]["devices"][2]
        self.assertEqual(tv["studio"]["type"], "simple")
        self.assertEqual(len(tv["functions"]), 17)
        self.assertEqual(sum(fn["type"] == "switch" for fn in tv["functions"]), 1)
        self.assertEqual(sum(fn["type"] == "button" for fn in tv["functions"]), 16)
        self.assertEqual({row["height"] for row in tv["studio"]["rows"]}, {1})
        self.assertFalse(tv["studio"]["savedStates"])
        self.assertFalse(any(row["type"] == "display" for row in tv["studio"]["rows"]))
        self.assertTrue(all("state_effect" not in fn for fn in tv["functions"]))
        nodes = [node for row in tv["studio"]["rows"] for node in row["cells"] if node]
        self.assertTrue(all(node["action"] == "learned" for node in nodes))
        self.assertTrue(all(side["action"] == "learned" for node in nodes for side in node.get("actions", [])))
        digits = [node for node in nodes if node["icon"] == "none"]
        self.assertEqual([node["name"] for node in digits], list("1234567890"))
        self.assertTrue(all(node["showName"] for node in digits))
        self.assertEqual(tv["studio"]["rows"][-1]["cells"], [None, digits[-1], None])
        self.assertTrue({"tv-input", "volume-off"}.issubset({node["icon"] for node in nodes}))
        self.assertTrue(all(not fn["signal_refs"] and not any(fn["signals"].values()) for fn in tv["functions"]))
        restored = self.checked(browser_model("roundtrip", stored), stored)
        self.assertEqual(restored, stored)

    def test_both_air_icons_export_all_eight_independent_swing_options(self):
        stored = self.checked(deepcopy(self.raw))
        for ac in stored["emitters"][0]["devices"][:2]:
            with self.subTest(icon=ac["icon"]):
                studio = ac["studio"]
                self.assertEqual(studio["type"], "stateful")
                self.assertEqual(studio["rows"][0]["type"], "display")
                self.assertEqual(studio["rows"][0]["accent"], "#ffffff")
                self.assertEqual({row["height"] for row in studio["rows"][1:]}, {1})
                fan = studio["rows"][1]["cells"][2]
                self.assertEqual((fan["fanSpeedCount"], fan["fanAuto"]), (5, True))
                swing = studio["rows"][2]["cells"][1]
                self.assertEqual((swing["sendMode"], swing["swingPositionCount"], swing["swingAuto"], swing["swingOff"]), ("independent", 6, True, True))
                effects = [fn for fn in ac["functions"] if "state_effect" in fn]
                self.assertEqual(len(effects), 8)
                self.assertEqual({fn["state_effect"]["swing"] for fn in effects}, {"off", "auto", *(f"position_{n}" for n in range(1, 7))})
                self.assertTrue(all(not fn["signal_refs"] for fn in ac["functions"]))
        restored = self.checked(browser_model("roundtrip", stored), stored)
        self.assertEqual(restored, stored)

    def test_new_templates_have_distinct_ids_entities_and_no_borrowed_signals(self):
        stored = self.checked(deepcopy(self.raw))
        devices = stored["emitters"][0]["devices"]
        self.assertEqual(len({device["id"] for device in devices}), len(devices))
        functions = [fn for device in devices for fn in device["functions"]]
        self.assertEqual(len({fn["key"] for fn in functions}), len(functions))
        self.assertEqual(len({fn["entity"] for fn in functions}), len(functions))
        self.assertTrue(all(not fn["signal_refs"] for fn in functions))
        self.assertTrue(all(fn["on"] is None for fn in functions))

    def test_changing_a_tv_icon_preserves_dual_signals_entities_and_phase(self):
        current = self.checked(deepcopy(self.raw))
        tv = current["emitters"][0]["devices"][2]
        power = next(fn for fn in tv["functions"] if fn["type"] == "switch")
        records = {}
        for signal in ("on", "off"):
            reference = "tv-" + signal
            power["signal_refs"][signal] = reference
            power["signals"][signal] = True
            records[reference] = {"source_id": SOURCE, "device_id": tv["id"], "function_key": power["key"], "signal": signal, "captured": True}
        power["on"] = True
        current = self.checked(current, current, records)
        candidate = browser_model("roundtrip", current)
        tv_candidate = candidate["emitters"][0]["devices"][2]
        tv_candidate["icon"] = "air-vent"
        tv_candidate["name"] = "Pantalla principal"
        result = self.checked(candidate, current, records)
        after = result["emitters"][0]["devices"][2]
        self.assertEqual(after["studio"]["type"], "simple")
        self.assertEqual(after["functions"], current["emitters"][0]["devices"][2]["functions"])
        self.assertEqual(after["studio"]["rows"], current["emitters"][0]["devices"][2]["studio"]["rows"])
        self.assertTrue(next(fn for fn in after["functions"] if fn["type"] == "switch")["on"])

    def test_changing_an_air_icon_preserves_captured_state_and_independent_signals(self):
        previous = self.checked(deepcopy(self.raw))
        candidate = deepcopy(previous)
        ac = candidate["emitters"][0]["devices"][0]
        studio = ac["studio"]
        studio["state"] = {"power": True, "mode": "heat", "temperature": 22,
                           "fan": "speed_5", "swing": "position_2"}
        state_id = str(uuid4())
        ac["functions"].append({
            "key": state_id, "name": "Calor 22", "showName": True, "icon": "remote",
            "color": "#ffffff", "type": "button", "entity": "button.ir_salon_calor_22",
            "signals": {}, "signal_refs": {"press": "state-reference"}, "on": None,
        })
        studio["savedStates"].append({
            "id": state_id, "name": "Calor 22", "settings": {"power": True, "mode": "heat", "temperature": 22,
                                         "fan": "speed_5"},
            "controlled_fields": ["power", "mode", "temperature", "fan"],
        })
        swing = next(fn for fn in ac["functions"] if fn.get("state_effect") == {"swing": "position_2"})
        swing["signal_refs"]["press"] = "swing-reference"
        records = {
            reference: {"source_id": SOURCE, "device_id": ac["id"], "function_key": key,
                        "signal": "press", "captured": True}
            for reference, key in (("state-reference", state_id), ("swing-reference", swing["key"]))
        }
        current = self.checked(browser_model("roundtrip", candidate), previous, records)
        renamed = browser_model("roundtrip", current)
        renamed_ac = renamed["emitters"][0]["devices"][0]
        renamed_ac.update(icon="tv", name="Aire renombrado")
        result = self.checked(renamed, current, records)["emitters"][0]["devices"][0]
        before = current["emitters"][0]["devices"][0]
        self.assertEqual(result["studio"], before["studio"])
        self.assertEqual(result["functions"], before["functions"])
        self.assertEqual(result["studio"]["savedStates"][0]["signal_refs"], {"press": "state-reference"})
        self.assertEqual(next(fn for fn in result["functions"] if fn["key"] == swing["key"])["signal_refs"], {"press": "swing-reference"})


if __name__ == "__main__":
    unittest.main()
