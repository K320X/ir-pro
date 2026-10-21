"""Mixed dual sides are ordinary learned buttons, without climate side effects."""

import asyncio
from copy import deepcopy
from types import SimpleNamespace
import unittest

from tests.ha_fakes import FakeHass, fake_ha_modules
from tests.helpers import DEVICE, FUNCTION, REF, SOURCE, backend_module, empty_model, get_function, model_fixture, signal_fixture
from tests.test_studio import get_studio, settings


def mixed_fixture(index=0, *, nested=False):
    model = model_fixture()
    device = model["emitters"][0]["devices"][0]
    get_function(model).update(name="Señal independiente", signal_refs={"press": REF})
    actions = [
        {"name": "Señal independiente", "icon": "power", "color": "#56c4ed", "action": "learned", "value": ""},
        {"name": "Ventilador alto", "icon": "fan", "color": "#56c4ed", "action": "set_fan", "value": "high"},
    ]
    if index == 1:
        actions.reverse()
    control = {"id": "mixed-control", "type": "dual", "action": "learned", "value": "",
               "name": "Botón mixto", "icon": "power", "color": "#56c4ed", "activeSide": 0,
               "actions": actions, "sendMode": "settings", "learnedActions": [
                   {"id": FUNCTION, "type": "button", "action": "learned", "value": "",
                    "name": "Stale caption", "icon": "remote", "color": "#ffffff", "action_index": index,
                    "entity": "button.forged", "signal_refs": {"press": "forged"}, "signals": {"press": False}},
               ]}
    if nested:
        control = {"id": "custom-folder", "type": "group", "group": "custom", "action": "open_group",
                   "name": "Opciones", "icon": "folder", "color": "#56c4ed", "children": [control]}
    device["studio"] = {"type": "stateful", "state": settings(power=False), "savedStates": [], "rows": [
        {"id": "mixed-row", "type": "buttons", "columns": 1, "height": 1, "cells": [control]},
    ]}
    return model


def mixed_control(model):
    control = get_studio(model)["rows"][0]["cells"][0]
    return control["children"][0] if control["type"] == "group" else control


class MixedDualValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.validate = staticmethod(backend_module("validation").validate_model)
        cls.module = backend_module("studio")
        cls.error = backend_module("errors").IRProError

    def check(self, model, current=None):
        return self.validate(model, current or empty_model(), {SOURCE}, {REF: signal_fixture(captured=True)}, set())[0]

    def test_mixed_sides_sync_identity_and_signal_from_real_button(self):
        for index in (0, 1):
            for nested in (False, True):
                with self.subTest(index=index, nested=nested):
                    model = mixed_fixture(index, nested=nested)
                    stored = self.check(model)
                    child = mixed_control(stored)["learnedActions"][0]
                    function = get_function(stored)
                    self.assertEqual(child["entity"], function["entity"])
                    self.assertEqual(child["name"], function["name"])
                    self.assertEqual(child["signal_refs"], {"press": REF})
                    self.assertEqual(child["signals"], {"press": True})
                    self.assertNotIn("state_effect", child)
                    self.assertNotIn("state_effect", function)
                    owner = self.module.learned_action_owner(get_studio(stored), FUNCTION)
                    self.assertEqual((owner[0]["id"], owner[1]["action_index"]), ("mixed-control", index))
                    self.assertIsNone(self.module.independent_action_owner(get_studio(stored), FUNCTION))
                    self.assertEqual(self.module.active_controlled_fields(get_studio(stored), True), list(self.module.CONTROLLED_FIELDS))
                    self.assertEqual(self.check(stored, stored), stored)

    def test_old_client_omission_retains_children_and_immutable_index(self):
        current = self.check(mixed_fixture())
        candidate = deepcopy(current)
        mixed_control(candidate).pop("learnedActions")
        self.assertEqual(self.check(candidate, current), current)
        candidate = deepcopy(current)
        mixed_control(candidate)["learnedActions"][0].pop("action_index")
        self.assertEqual(self.check(candidate, current), current)
        mixed_control(candidate)["actions"].reverse()
        mixed_control(candidate)["learnedActions"][0]["action_index"] = 1
        with self.assertRaises(self.error):
            self.check(candidate, current)

    def test_invalid_children_and_missing_coverage_are_rejected(self):
        for mutation in (
            lambda node: node.update(learnedActions=[]),
            lambda node: node.update(learnedActions={}),
            lambda node: node["learnedActions"][0].pop("action_index"),
            lambda node: node["learnedActions"][0].update(action_index=True),
            lambda node: node["learnedActions"][0].update(action_index="0"),
            lambda node: node["learnedActions"][0].update(action_index=2),
            lambda node: node["learnedActions"][0].update(action_index=1),
            lambda node: node["learnedActions"][0].update(state_effect={"power": True}),
            lambda node: node["learnedActions"][0].update(type="dual", actions=deepcopy(node["actions"])),
            lambda node: node["learnedActions"][0].update(action="set_fan", value="high"),
            lambda node: node.update(type="button"),
            lambda node: node["actions"][1].update(action="learned", value=""),
        ):
            model = mixed_fixture()
            mutation(mixed_control(model))
            with self.subTest(node=mixed_control(model)), self.assertRaises(self.error):
                self.check(model)

    def test_duplicate_indices_and_canonical_state_effect_are_rejected(self):
        model = mixed_fixture()
        device = model["emitters"][0]["devices"][0]
        second = deepcopy(get_function(model))
        second.update(key="another-learned-side", entity="button.another_learned_side")
        device["functions"].append(second)
        device["layout"]["rows"][0]["cells"][1] = second["key"]
        duplicate = deepcopy(mixed_control(model)["learnedActions"][0])
        duplicate["id"] = second["key"]
        mixed_control(model)["learnedActions"].append(duplicate)
        with self.assertRaises(self.error):
            self.check(model)
        model = mixed_fixture()
        get_function(model)["state_effect"] = {"power": True}
        with self.assertRaises(self.error):
            self.check(model)

    def test_switch_parent_cannot_add_separate_learned_children(self):
        model = mixed_fixture()
        device = model["emitters"][0]["devices"][0]
        switch = deepcopy(get_function(model))
        switch.update(key="mixed-control", type="switch", entity="switch.power", signal_refs={})
        device["functions"].append(switch)
        device["layout"]["rows"][0]["cells"][1] = switch["key"]
        with self.assertRaises(self.error):
            self.check(model)

    def test_two_learned_sides_keep_switch_in_both_profiles(self):
        for profile in ("simple", "stateful"):
            model = mixed_fixture()
            function = get_function(model)
            function.update(key="mixed-control", type="switch", entity="switch.power", signal_refs={})
            model["emitters"][0]["devices"][0]["layout"]["rows"][0]["cells"][0] = "mixed-control"
            studio = get_studio(model)
            studio["type"] = profile
            control = mixed_control(model)
            control.pop("learnedActions")
            control["actions"][1].update(action="learned", value="")
            stored = self.check(model)
            self.assertEqual(len(stored["emitters"][0]["devices"][0]["functions"]), 1)
            self.assertEqual(get_function(stored)["type"], "switch")
            self.assertNotIn("learnedActions", mixed_control(stored))


class MixedDualManagerTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        with fake_ha_modules():
            module = backend_module("manager")
            cls.manager_class = module.IRProManager
            cls.error = module.IRProError

    async def prepare(self, index=0, nested=False):
        hass = FakeHass()
        manager = self.manager_class(hass, SimpleNamespace(entry_id="ir_pro_entry"))
        manager.signals[REF] = signal_fixture(captured=True)
        await manager.async_save_model(mixed_fixture(index, nested=nested), 0)
        return manager, hass

    async def test_direct_automation_press_advances_only_own_phase_after_success(self):
        for index, nested in ((0, False), (1, True)):
            manager, hass = await self.prepare(index, nested)
            before = deepcopy(get_studio(manager.model)["state"])
            phases = []

            async def during_send(*_args):
                phases.append(mixed_control(manager.model)["activeSide"])

            hass.services.hook = during_send
            result = await manager.async_press(FUNCTION)
            self.assertEqual(phases, [0])
            self.assertEqual(mixed_control(manager.model)["activeSide"], 1 - index)
            self.assertEqual(get_studio(manager.model)["state"], before)
            self.assertEqual(get_function(manager.model)["signal_refs"], {"press": REF})
            self.assertEqual(result["model"], manager.envelope()["model"])
            self.assertIsNone(result["on"])
            self.assertEqual(hass.services.calls[0][1], "send_command")
            self.assertEqual(len(hass.services.calls), 1)
            restored = self.manager_class(hass, SimpleNamespace(entry_id="ir_pro_entry"))
            await restored.async_load()
            self.assertEqual(mixed_control(restored.model)["activeSide"], 1 - index)
            self.assertEqual(get_studio(restored.model)["state"], before)
            self.assertEqual(len(hass.services.calls), 1)

    async def test_failed_send_and_failed_phase_write_do_not_advance(self):
        manager, hass = await self.prepare()
        before = deepcopy(manager.envelope())
        before_storage = deepcopy(hass.storage)

        async def fail(*_args):
            raise RuntimeError("Unavailable")

        hass.services.hook = fail
        with self.assertRaises(self.error):
            await manager.async_press(FUNCTION)
        self.assertEqual(manager.envelope(), before)
        self.assertEqual(hass.storage, before_storage)
        hass.services.hook = None
        hass.fail_save = True
        with self.assertRaises(self.error):
            await manager.async_press(FUNCTION)
        self.assertEqual(manager.envelope(), before)
        self.assertEqual(hass.storage, before_storage)

    async def test_inflight_replacement_and_reconfiguration_do_not_advance(self):
        for change in ("owner", "action", "phase", "delete", "reference"):
            with self.subTest(change=change):
                manager, hass = await self.prepare()
                started, release = asyncio.Event(), asyncio.Event()

                async def wait(*_args):
                    started.set()
                    await release.wait()

                hass.services.hook = wait
                task = asyncio.create_task(manager.async_press(FUNCTION))
                await asyncio.wait_for(started.wait(), 1)
                candidate = manager.envelope()["model"]
                control = mixed_control(candidate)
                if change == "owner":
                    control["id"] = "replacement-parent"
                elif change == "action":
                    control["actions"][1]["value"] = "medium"
                elif change == "phase":
                    control["activeSide"] = 1
                elif change == "delete":
                    device = candidate["emitters"][0]["devices"][0]
                    device["functions"] = []
                    device["layout"]["rows"][0]["cells"] = [None, None]
                    control["actions"][0].update(action="temp_up")
                    control["learnedActions"] = []
                else:
                    manager.signals["replacement-ref"] = signal_fixture(captured=True, command="replacement")
                    get_function(candidate)["signal_refs"] = {"press": "replacement-ref"}
                await manager.async_save_model(candidate, manager.revision)
                saved = deepcopy(manager.envelope())
                saved_storage = deepcopy(hass.storage)
                release.set()
                result = await task
                self.assertEqual(manager.envelope(), saved)
                self.assertEqual(hass.storage, saved_storage)
                self.assertEqual(result["model"], saved["model"])
                self.assertEqual(get_studio(manager.model)["state"], get_studio(candidate)["state"])
                self.assertEqual(len(hass.services.calls), 1)


if __name__ == "__main__":
    unittest.main()
