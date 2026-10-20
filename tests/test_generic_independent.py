"""Every visible independent action owns its setting, including relative ones."""

import asyncio
from copy import deepcopy
from types import SimpleNamespace
import unittest

from tests.ha_fakes import FakeHass, fake_ha_modules
from tests.helpers import DEVICE, FUNCTION, REF, SOURCE, backend_module, empty_model, get_function, signal_fixture
from tests.test_controlled_states import scoped_fixture
from tests.test_studio import get_studio, settings


def generic_fixture(action="temp_up", effect=None):
    effect = {"temperature_delta": 1} if effect is None else effect
    model = scoped_fixture()
    studio = get_studio(model)
    studio["savedStates"] = []
    get_function(model).update(state_effect=deepcopy(effect), signal_refs={"press": REF})
    child = {"id": FUNCTION, "type": "button", "action": "learned", "name": "Independiente",
             "icon": "power", "color": "#56c4ed", "value": backend_module("studio").state_effect_identity(effect),
             "state_effect": deepcopy(effect), "action_index": 0}
    studio["rows"][1]["cells"][0] = {
        "id": "direct-control", "type": "button", "action": action, "value": "",
        "name": "Control", "icon": "power", "color": "#56c4ed", "sendMode": "independent",
        "independentActions": [child],
    }
    return model


class GenericIndependentValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = backend_module("studio")
        cls.validate = staticmethod(backend_module("validation").validate_model)
        cls.error = backend_module("errors").IRProError

    def check(self, model, current=None):
        return self.validate(model, current or empty_model(), {SOURCE}, {REF: signal_fixture(captured=True)}, set())[0]

    def test_new_effect_variants_are_strict_single_change(self):
        for effect in ({"power": True}, {"power": False}, {"temperature_delta": 1}, {"temperature_delta": -1}, {"swing_toggle": True}):
            self.assertEqual(self.module.validate_state_effect(effect), effect)
        for effect in ({"power": 1}, {"power": "on"}, {"temperature_delta": True}, {"temperature_delta": 1.0},
                       {"temperature_delta": 0}, {"temperature_delta": 2}, {"swing_toggle": False},
                       {"swing_toggle": 1}, {"power": True, "temperature_delta": 1}):
            with self.subTest(effect=effect), self.assertRaises(self.error):
                self.module.validate_state_effect(effect)

    def test_direct_dual_custom_and_hidden_controls_have_consistent_scope(self):
        studio = {"rows": [{"cells": [
            {"type": "button", "action": "temp_up", "sendMode": "independent"},
            {"type": "button", "action": "temp_down", "sendMode": "settings"},
            {"type": "dual", "sendMode": "independent", "actions": [{"action": "power_on"}, {"action": "power_off"}]},
            {"type": "group", "group": "custom", "children": [{"type": "button", "sendMode": "independent", "action": "set_fan"}]},
            {"type": "button", "action": "learned", "sendMode": "independent", "state_effect": {"mode": "heat"},
             "independentActions": [{"type": "button", "action": "set_swing", "sendMode": "independent"}]},
        ]}]}
        self.assertEqual(self.module.active_controlled_fields(studio, False), ["mode", "swing"])
        self.assertEqual(self.module.active_controlled_fields(studio, True), ["mode", "swing"])
        studio["rows"][0]["cells"][2]["sendMode"] = "settings"
        self.assertEqual(self.module.active_controlled_fields(studio, False), ["power"])
        # Changing one node never rewrites its sibling's selector.
        self.assertEqual(studio["rows"][0]["cells"][1]["sendMode"], "settings")

    def test_masks_without_power_project_and_match_without_off_collapse(self):
        fields = ["mode", "temperature", "fan"]
        projected = self.module.project_configuration(settings(power=False), fields)
        self.assertEqual(projected, {"mode": "heat", "temperature": 22, "fan": "high"})
        self.assertEqual(self.module.scoped_configuration_key(settings(power=False), fields),
                         self.module.scoped_configuration_key(settings(power=True), fields))
        self.assertNotEqual(self.module.scoped_configuration_key(settings(temperature=23), fields),
                            self.module.scoped_configuration_key(settings(temperature=22), fields))
        self.assertEqual(self.module.record_fields({"settings": projected, "controlled_fields": fields}), fields)
        with self.assertRaises(self.error):
            self.module.project_configuration(settings(), [])

    def test_direct_selector_and_action_index_survive_old_client_omission(self):
        current = self.check(generic_fixture())
        candidate = deepcopy(current)
        control = get_studio(candidate)["rows"][1]["cells"][0]
        control.pop("sendMode")
        control["independentActions"][0].pop("action_index")
        get_function(candidate).pop("state_effect")
        self.assertEqual(self.check(candidate, current), current)
        child = control["independentActions"][0]
        child["action_index"] = True
        with self.assertRaises(self.error):
            self.check(candidate, current)
        child["action_index"] = 1
        with self.assertRaises(self.error):
            self.check(candidate, current)

    def test_dual_identical_actions_have_distinct_stable_captures(self):
        model = generic_fixture("power_on", {"power": True})
        control = get_studio(model)["rows"][1]["cells"][0]
        control.update(type="dual", actions=[
            {"name": "Acción uno", "icon": "power", "color": "#56c4ed", "action": "power_on"},
            {"name": "Acción dos", "icon": "power", "color": "#56c4ed", "action": "power_on"},
        ])
        duplicate = deepcopy(get_function(model))
        duplicate.update(key="second-action", entity="button.second_action")
        model["emitters"][0]["devices"][0]["functions"].append(duplicate)
        model["emitters"][0]["devices"][0]["layout"]["rows"].append({"id": "second-layout", "columns": 1, "height": 2, "cells": ["second-action"]})
        child = deepcopy(control["independentActions"][0])
        child.update(id="second-action", action_index=1)
        control["independentActions"].append(child)
        stored = self.check(model)
        self.assertEqual([child["action_index"] for child in get_studio(stored)["rows"][1]["cells"][0]["independentActions"]], [0, 1])
        self.assertEqual(len(stored["emitters"][0]["devices"][0]["functions"]), 2)


class GenericIndependentManagerTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        with fake_ha_modules():
            module = backend_module("manager")
            cls.manager_class = module.IRProManager
            cls.error = module.IRProError

    async def prepare(self, model):
        hass = FakeHass()
        manager = self.manager_class(hass, SimpleNamespace(entry_id="ir_pro_entry"))
        for function in model["emitters"][0]["devices"][0]["functions"]:
            for reference in function["signal_refs"].values():
                manager.signals.setdefault(reference, signal_fixture(function_key=function["key"], command=reference, captured=True))
        await manager.async_save_model(model, 0)
        return manager, hass

    async def test_power_changes_only_power_after_success(self):
        for power in (True, False):
            manager, hass = await self.prepare(generic_fixture("power_on" if power else "power_off", {"power": power}))
            before = deepcopy(get_studio(manager.model)["state"])
            seen = []

            async def during_send(*_args):
                seen.append(deepcopy(get_studio(manager.model)["state"]))

            hass.services.hook = during_send
            await manager.async_press(FUNCTION)
            self.assertEqual(seen, [before])
            self.assertEqual(get_studio(manager.model)["state"], {**before, "power": power})
            self.assertEqual(len(hass.services.calls), 1)

    async def test_temperature_deltas_clamp_only_after_successful_send(self):
        for temperature, delta, expected in ((29, 1, 30), (30, 1, 30), (19, -1, 18), (18, -1, 18)):
            model = generic_fixture("temp_up" if delta > 0 else "temp_down", {"temperature_delta": delta})
            get_studio(model)["state"]["temperature"] = temperature
            manager, hass = await self.prepare(model)
            before = deepcopy(get_studio(manager.model)["state"])
            await manager.async_press(FUNCTION)
            self.assertEqual(get_studio(manager.model)["state"], {**before, "temperature": expected})
            self.assertEqual(len(hass.services.calls), 1)

    async def test_toggle_is_relative_to_current_estimate_after_send(self):
        for position, expected in (("off", "auto"), ("auto", "off"), ("position_3", "auto")):
            model = generic_fixture("swing", {"swing_toggle": True})
            get_studio(model)["state"]["swing"] = position
            manager, _ = await self.prepare(model)
            before = deepcopy(get_studio(manager.model)["state"])
            await manager.async_press(FUNCTION)
            self.assertEqual(get_studio(manager.model)["state"], {**before, "swing": expected})

    async def test_delta_failure_and_inflight_delete_preserve_other_settings(self):
        manager, hass = await self.prepare(generic_fixture())
        before = deepcopy(get_studio(manager.model)["state"])

        async def fail(*_args):
            raise RuntimeError("Unavailable")

        hass.services.hook = fail
        with self.assertRaises(self.error):
            await manager.async_press(FUNCTION)
        self.assertEqual(get_studio(manager.model)["state"], before)
        started, release = asyncio.Event(), asyncio.Event()

        async def wait(*_args):
            started.set()
            await release.wait()

        hass.services.hook = wait
        task = asyncio.create_task(manager.async_press(FUNCTION))
        await asyncio.wait_for(started.wait(), 1)
        candidate = manager.envelope()["model"]
        device = candidate["emitters"][0]["devices"][0]
        device["functions"] = []
        for row in device["layout"]["rows"]:
            row["cells"] = [None for _ in row["cells"]]
        get_studio(candidate)["rows"][1]["cells"][0]["independentActions"] = []
        await manager.async_save_model(candidate, manager.revision)
        release.set()
        await task
        self.assertEqual(get_studio(manager.model)["state"], before)
        self.assertIsNone(manager.find_function(FUNCTION))

    async def test_aggregate_without_power_matches_on_or_off_and_preserves_power(self):
        model = generic_fixture("power_on", {"power": True})
        device = model["emitters"][0]["devices"][0]
        capture = deepcopy(get_function(model))
        capture.update(key="combined-state", entity="button.combined_state")
        capture.pop("state_effect")
        device["functions"].append(capture)
        device["layout"]["rows"].append({"id": "combined-layout", "columns": 1, "height": 2, "cells": ["combined-state"]})
        get_studio(model)["savedStates"] = [{"id": "combined-state", "name": "Calor22", "controlled_fields": ["mode", "temperature", "fan"],
                                             "settings": {"mode": "heat", "temperature": 22, "fan": "high"}}]
        manager, hass = await self.prepare(model)
        before = deepcopy(get_studio(manager.model)["state"])
        for power in (True, False):
            await manager.async_send_state(DEVICE, settings(power=power), controlled_fields=["mode", "temperature", "fan"])
            self.assertEqual(get_studio(manager.model)["state"], {**before, "mode": "heat", "temperature": 22, "fan": "high"})
        self.assertEqual(len(hass.services.calls), 2)

    async def test_all_independent_leaves_no_aggregate_capture_or_transmission(self):
        model = generic_fixture("power_on", {"power": True})
        cells = get_studio(model)["rows"][1]["cells"]
        cells[1]["sendMode"] = "independent"
        get_studio(model)["rows"].append({"id": "extra-controls", "type": "buttons", "columns": 2, "height": 2, "cells": [
            {"id": "temperature-control", "type": "button", "action": "temp_up", "sendMode": "independent", "name": "Subir", "icon": "plus", "color": "#56c4ed"},
            {"id": "mode-control", "type": "group", "group": "mode", "sendMode": "independent", "name": "Modo", "icon": "snowflake", "color": "#56c4ed", "action": "open_group"},
        ]})
        manager, hass = await self.prepare(model)
        self.assertEqual(backend_module("studio").active_controlled_fields(get_studio(manager.model), False), [])
        with self.assertRaises(self.error):
            await manager.async_send_state(DEVICE, settings(), controlled_fields=[])
        self.assertEqual(hass.services.calls, [])

    async def test_dual_phase_changes_after_success_and_survives_reload(self):
        model = generic_fixture()
        control = get_studio(model)["rows"][1]["cells"][0]
        control.update(type="dual", activeSide=0, actions=[
            {"name": "Subir", "action": "temp_up", "icon": "plus", "color": "#56c4ed"},
            {"name": "Bajar", "action": "temp_down", "icon": "minus", "color": "#56c4ed"},
        ])
        second = deepcopy(get_function(model))
        second.update(key="second-action", entity="button.second_action", state_effect={"temperature_delta": -1}, signal_refs={"press": "second-reference"})
        model["emitters"][0]["devices"][0]["functions"].append(second)
        model["emitters"][0]["devices"][0]["layout"]["rows"].append({"id": "second-layout", "columns": 1, "height": 2, "cells": ["second-action"]})
        child = deepcopy(control["independentActions"][0])
        child.update(id="second-action", action_index=1, value="temp_down", state_effect={"temperature_delta": -1})
        control["independentActions"].append(child)
        manager, hass = await self.prepare(model)
        before = deepcopy(manager.model)

        async def fail(*_args):
            raise RuntimeError("Unavailable")

        hass.services.hook = fail
        with self.assertRaises(self.error):
            await manager.async_press(FUNCTION)
        self.assertEqual(manager.model, before)
        hass.services.hook = None
        await manager.async_press(FUNCTION)
        self.assertEqual(get_studio(manager.model)["rows"][1]["cells"][0]["activeSide"], 1)
        self.assertEqual(get_studio(manager.model)["state"]["temperature"], 27)
        restored = self.manager_class(hass, SimpleNamespace(entry_id="ir_pro_entry"))
        await restored.async_load()
        self.assertEqual(get_studio(restored.model)["rows"][1]["cells"][0]["activeSide"], 1)
        await restored.async_press("second-action")
        self.assertEqual(get_studio(restored.model)["rows"][1]["cells"][0]["activeSide"], 0)
        self.assertEqual(get_studio(restored.model)["state"]["temperature"], 26)


if __name__ == "__main__":
    unittest.main()
