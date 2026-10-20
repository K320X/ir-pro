"""Independent command effects and device-scoped state deletion boundaries."""

import asyncio
from copy import deepcopy
from types import ModuleType, SimpleNamespace
import sys
import unittest
from unittest.mock import patch

from tests.ha_fakes import FakeHass, fake_ha_modules
from tests.helpers import DEVICE, FUNCTION, REF, SOURCE, backend_module, empty_model, get_function, signal_fixture
from tests.test_studio import get_studio, settings, studio_fixture

FAN = "00000000-0000-4000-8000-000000000011"
SWING = "00000000-0000-4000-8000-000000000012"
LIGHT = "00000000-0000-4000-8000-000000000013"
FAN_REF = "00000000-0000-4000-8000-000000000021"
SWING_REF = "00000000-0000-4000-8000-000000000022"


def independent_fixture():
    model = studio_fixture()
    device = model["emitters"][0]["devices"][0]
    functions = device["functions"]
    functions[0]["signal_refs"] = {"press": REF}
    for key, name, effect, reference in (
        (FAN, "Ventilador automático", {"fan": "auto"}, FAN_REF),
        (SWING, "Oscilación posición 3", {"swing": "position_3"}, SWING_REF),
    ):
        function = deepcopy(functions[0])
        function.update(key=key, name=name, entity="button.option_" + key.replace("-", ""),
                        state_effect=effect, signal_refs={"press": reference})
        functions.append(function)
    light = deepcopy(functions[0])
    light.update(key=LIGHT, name="Luz", entity="button.ir_salon_luz", signal_refs={})
    functions.append(light)
    device["layout"]["rows"].extend(
        {"id": "layout-" + key, "columns": 1, "height": 2, "cells": [key]}
        for key in (FAN, SWING, LIGHT)
    )
    cells = get_studio(model)["rows"][1]["cells"]
    cells[0] = {"id": LIGHT, "type": "button", "action": "learned", "name": "Luz",
                "icon": "light", "color": "#f6cf79"}
    for folder, key in ((cells[1], FAN), (cells[2], SWING)):
        function = next(item for item in functions if item["key"] == key)
        folder.update(sendMode="independent", independentActions=[{
            "id": key, "type": "button", "action": "learned", "name": function["name"],
            "icon": folder["icon"], "color": folder["color"],
            "value": next(iter(function["state_effect"].values())),
            "state_effect": deepcopy(function["state_effect"]),
        }])
    state = get_studio(model)["savedStates"][0]
    state["controlled_fields"] = ["power", "mode", "temperature"]
    state["settings"] = {field: state["settings"][field] for field in state["controlled_fields"]}
    records = {reference: signal_fixture(function_key=key, command="command-" + key, captured=True)
               for key, reference in ((FUNCTION, REF), (FAN, FAN_REF), (SWING, SWING_REF))}
    return model, records


class IndependentValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = backend_module("studio")
        cls.validate = staticmethod(backend_module("validation").validate_model)
        cls.error = backend_module("errors").IRProError

    def check(self, candidate, *, current=None, records=None):
        return self.validate(candidate, current or empty_model(), {SOURCE}, records or {}, set())[0]

    def test_effect_is_one_absolute_mode_fan_or_swing_only(self):
        for value in (None, [], {}, {"power": 1}, {"temperature": 24}, {"fan": True},
                      {"mode": "invalid"}, {"swing": "toggle"}, {"toString": "auto"},
                      {"fan": "high", "swing": "auto"}, {1: "auto"}):
            with self.subTest(value=value), self.assertRaises(self.error):
                self.module.validate_state_effect(value)
        for effect in ({"mode": "heat"}, {"fan": "speed_5"}, {"swing": "off"}, {"swing": "position_6"}):
            self.assertEqual(self.module.validate_state_effect(effect), effect)

    def test_nested_hidden_actions_are_canonical_and_keep_captures(self):
        model, records = independent_fixture()
        current = self.check(model, records=records)
        folder = get_studio(model)["rows"][1]["cells"][1]
        folder.update(sendMode="settings", fanAuto=False, fanSpeedCount=2)
        before = deepcopy(model)
        result = self.check(model, current=current, records=records)
        self.assertEqual(model, before)
        action = get_studio(result)["rows"][1]["cells"][1]["independentActions"][0]
        function = result["emitters"][0]["devices"][0]["functions"][1]
        self.assertEqual(action["id"], FAN)
        self.assertEqual(action["entity"], function["entity"])
        self.assertEqual(action["state_effect"], {"fan": "auto"})
        self.assertEqual(action["signal_refs"], {"press": FAN_REF})
        self.assertEqual(action["signals"], {"press": True})

    def test_old_clients_omitting_new_metadata_preserve_it_or_fail_safely(self):
        model, records = independent_fixture()
        current = self.check(model, records=records)
        candidate = deepcopy(current)
        for function in candidate["emitters"][0]["devices"][0]["functions"]:
            function.pop("state_effect", None)
        for folder in get_studio(candidate)["rows"][1]["cells"][1:]:
            folder.pop("sendMode")
            folder.pop("independentActions")
        result = self.check(candidate, current=current, records=records)
        self.assertEqual(result, current)
        candidate["emitters"][0]["devices"][0]["functions"] = [function for function in candidate["emitters"][0]["devices"][0]["functions"] if function["key"] != FAN]
        candidate["emitters"][0]["devices"][0]["layout"]["rows"] = [row for row in candidate["emitters"][0]["devices"][0]["layout"]["rows"] if row["cells"] != [FAN]]
        with self.assertRaises(self.error):
            self.check(candidate, current=current, records=records)
        self.assertEqual(current["emitters"][0]["devices"][0]["functions"][1]["state_effect"], {"fan": "auto"})

    def test_captured_effect_cannot_be_reinterpreted_or_removed(self):
        model, records = independent_fixture()
        current = self.check(model, records=records)
        for effect in ({"swing": "auto"}, {"fan": "high"}, None):
            candidate = deepcopy(current)
            candidate["emitters"][0]["devices"][0]["functions"][1]["state_effect"] = effect
            with self.subTest(effect=effect), self.assertRaises(self.error):
                self.check(candidate, current=current, records=records)
        candidate = deepcopy(current)
        get_function(candidate)["state_effect"] = {"fan": "auto"}
        with self.assertRaises(self.error):
            self.check(candidate, current=current, records=records)

    def test_metadata_cannot_forge_effect_or_reuse_it_as_full_state(self):
        model, records = independent_fixture()
        for mutate in (
            lambda candidate: get_studio(candidate)["rows"][1]["cells"][1]["independentActions"][0].update(state_effect={"fan": "high"}),
            lambda candidate: get_studio(candidate)["rows"][1]["cells"][1]["independentActions"][0].update(value="high"),
            lambda candidate: get_studio(candidate)["savedStates"][0].update(id=FAN),
            lambda candidate: get_studio(candidate)["rows"][1]["cells"][1].update(sendMode="invalid"),
            lambda candidate: get_studio(candidate)["rows"][1]["cells"][1].update(independentActions={}),
        ):
            candidate = deepcopy(model)
            mutate(candidate)
            with self.assertRaises(self.error):
                self.check(candidate, records=records)

    def test_folder_content_change_retains_prior_command_meaning(self):
        model, records = independent_fixture()
        current = self.check(model, records=records)
        candidate = deepcopy(current)
        folder = get_studio(candidate)["rows"][1]["cells"][1]
        folder["group"] = "swing"
        result = self.check(candidate, current=current, records=records)
        hidden = get_studio(result)["rows"][1]["cells"][1]["independentActions"][0]
        self.assertEqual(hidden["state_effect"], {"fan": "auto"})
        self.assertEqual(hidden["signal_refs"], {"press": FAN_REF})


class IndependentManagerTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        with fake_ha_modules():
            module = backend_module("manager")
            cls.manager_class = module.IRProManager
            cls.error = module.IRProError

    def setUp(self):
        self.hass = FakeHass()
        self.entry = SimpleNamespace(entry_id="ir_pro_entry")
        self.manager = self.manager_class(self.hass, self.entry)

    async def prepare(self):
        model, records = independent_fixture()
        self.manager.signals = records
        await self.manager.async_save_model(model, 0)

    async def test_press_applies_only_stored_effect_after_send_and_persists(self):
        await self.prepare()
        before = deepcopy(get_studio(self.manager.model)["state"])
        revision = self.manager.revision
        observed = []

        async def during_send(*_args):
            observed.append(deepcopy(get_studio(self.manager.model)["state"]))

        self.hass.services.hook = during_send
        result = await self.manager.async_press(SWING)
        self.assertEqual(observed, [before])
        self.assertEqual(get_studio(self.manager.model)["state"], {**before, "swing": "position_3"})
        self.assertFalse(get_studio(self.manager.model)["state"]["power"])
        self.assertEqual(result["revision"], revision + 1)
        self.assertEqual(len(self.hass.services.calls), 1)
        self.assertEqual(self.hass.services.calls[0][1], "send_command")
        self.assertEqual(self.hass.services.calls[0][2]["command"], "command-" + SWING)
        restored = self.manager_class(self.hass, self.entry)
        await restored.async_load()
        self.assertEqual(restored.envelope(), self.manager.envelope())
        with self.assertRaises(self.error) as caught:
            await self.manager.async_save_model(result["model"], revision)
        self.assertEqual(caught.exception.code, "revision_conflict")

    async def test_send_and_storage_failures_leave_estimate_unchanged(self):
        await self.prepare()
        before, stored, revision = deepcopy(self.manager.model), deepcopy(self.hass.storage), self.manager.revision

        async def fail(*_args):
            raise RuntimeError("Unavailable")

        self.hass.services.hook = fail
        with self.assertRaises(self.error):
            await self.manager.async_press(FAN)
        self.assertEqual(self.manager.model, before)
        self.assertEqual(self.hass.storage, stored)
        self.assertEqual(self.manager.revision, revision)
        self.hass.services.hook = None
        self.hass.fail_save = True
        with self.assertRaises(self.error):
            await self.manager.async_press(FAN)
        self.assertEqual(self.manager.model, before)
        self.assertEqual(self.hass.storage, stored)

    async def test_real_button_entity_uses_same_partial_effect_path(self):
        await self.prepare()
        button_api, entity_api = ModuleType("homeassistant.components.button"), ModuleType("homeassistant.helpers.entity")
        button_api.ButtonEntity = type("ButtonEntity", (), {})
        entity_api.Entity = type("Entity", (), {})
        entity_api.DeviceInfo = dict
        with fake_ha_modules(), patch.dict(sys.modules, {"homeassistant.components.button": button_api, "homeassistant.helpers.entity": entity_api}):
            button = backend_module("button").IRProButton(self.manager, FAN)
            await button.async_press()
        self.assertEqual(get_studio(self.manager.model)["state"], settings(power=False, fan="auto"))
        self.assertEqual(len(self.hass.services.calls), 1)

    async def test_deleted_inflight_action_never_restores_state_or_entity(self):
        await self.prepare()
        before = deepcopy(get_studio(self.manager.model)["state"])
        started, release = asyncio.Event(), asyncio.Event()

        async def wait(*_args):
            started.set()
            await release.wait()

        self.hass.services.hook = wait
        task = asyncio.create_task(self.manager.async_press(FAN))
        await asyncio.wait_for(started.wait(), 1)
        candidate = self.manager.envelope()["model"]
        device = candidate["emitters"][0]["devices"][0]
        device["functions"] = [function for function in device["functions"] if function["key"] != FAN]
        for row in device["layout"]["rows"]:
            row["cells"] = [None if key == FAN else key for key in row["cells"]]
        get_studio(candidate)["rows"][1]["cells"][1]["independentActions"] = []
        await self.manager.async_save_model(candidate, self.manager.revision)
        release.set()
        await task
        self.assertIsNone(self.manager.find_function(FAN))
        self.assertEqual(get_studio(self.manager.model)["state"], before)

    async def test_bulk_delete_is_scoped_and_preserves_shared_signal_and_layout(self):
        await self.prepare()
        candidate = self.manager.envelope()["model"]
        original = candidate["emitters"][0]["devices"][0]
        # Another remote may still use the same source-bound state signal.
        other = deepcopy(original)
        other.update(id="other-device", name="Otro mando", functions=[deepcopy(original["functions"][0])])
        other.pop("studio")
        other["functions"][0].update(key="other-function", entity="button.other_function")
        other["layout"] = {"heightScale": "square-at-two", "rows": [{"id": "other-row", "height": 2, "columns": 1, "cells": ["other-function"]}]}
        candidate["emitters"][0]["devices"].append(other)
        await self.manager.async_save_model(candidate, self.manager.revision)
        before = self.manager.envelope()["model"]
        # Exercise normal entity registry cleanup, including an unrelated entry.
        for key, entity_id, platform, entry_id in ((FUNCTION, "button.state", "ir_pro", self.entry.entry_id),
                                                   (LIGHT, "button.ir_salon_luz", "ir_pro", self.entry.entry_id),
                                                   ("outside", "sensor.outside", "other", "other-entry")):
            self.hass.er.entities[entity_id] = SimpleNamespace(id="registry-" + key, entity_id=entity_id,
                platform=platform, unique_id=key, domain=entity_id.split(".")[0], config_entry_id=entry_id,
                device_id="broadlink_device")
        result = await self.manager.async_delete_saved_states(DEVICE, self.manager.revision)
        device = result["model"]["emitters"][0]["devices"][0]
        self.assertEqual(device["studio"]["savedStates"], [])
        self.assertEqual({function["key"] for function in device["functions"]}, {FAN, SWING, LIGHT})
        self.assertEqual(device["studio"]["rows"], before["emitters"][0]["devices"][0]["studio"]["rows"])
        expected_layout = deepcopy(before["emitters"][0]["devices"][0]["layout"])
        expected_layout["rows"][0]["cells"] = [None, None]
        self.assertEqual(device["layout"], expected_layout)
        self.assertEqual(result["model"]["emitters"][0]["devices"][1], before["emitters"][0]["devices"][1])
        self.assertIn(REF, self.manager.signals)
        self.assertIn(FAN_REF, self.manager.signals)
        self.assertIn(SWING_REF, self.manager.signals)
        self.assertNotIn("button.state", self.hass.er.entities)
        self.assertIn("button.ir_salon_luz", self.hass.er.entities)
        self.assertIn("sensor.outside", self.hass.er.entities)
        self.assertIn("broadlink_device", self.hass.dr.entries)
        self.assertEqual(self.hass.services.calls, [])
        restored = self.manager_class(self.hass, self.entry)
        await restored.async_load()
        self.assertEqual(restored.envelope(), self.manager.envelope())

    async def test_bulk_delete_conflict_failure_empty_and_invalid_remote_are_safe(self):
        await self.prepare()
        before, stored = deepcopy(self.manager.model), deepcopy(self.hass.storage)
        for revision in (0, True):
            with self.subTest(revision=revision), self.assertRaises(self.error):
                await self.manager.async_delete_saved_states(DEVICE, revision)
        with self.assertRaises(self.error):
            await self.manager.async_delete_saved_states("missing", self.manager.revision)
        self.hass.fail_save = True
        with self.assertRaises(self.error):
            await self.manager.async_delete_saved_states(DEVICE, self.manager.revision)
        self.assertEqual(self.manager.model, before)
        self.assertEqual(self.hass.storage, stored)
        self.assertEqual(self.hass.er.removed, [])
        await self.manager.async_delete_saved_states(DEVICE, self.manager.revision)
        self.assertNotIn(REF, self.manager.signals)
        revision, saves = self.manager.revision, len(self.hass.saved)
        await self.manager.async_delete_saved_states(DEVICE, revision)
        self.assertEqual(self.manager.revision, revision)
        self.assertEqual(len(self.hass.saved), saves)
        self.assertEqual(self.hass.services.calls, [])

    async def test_bulk_delete_retry_repairs_registry_after_committed_cleanup_failure(self):
        await self.prepare()
        entity_id = get_function(self.manager.model)["entity"]
        self.hass.er.entities[entity_id] = SimpleNamespace(id="state-registry", entity_id=entity_id,
            platform="ir_pro", unique_id=FUNCTION, domain="button", config_entry_id=self.entry.entry_id,
            device_id="broadlink_device")
        revision = self.manager.revision
        with patch.object(self.manager, "async_sync_entities", side_effect=RuntimeError("Registry unavailable")):
            with self.assertRaises(RuntimeError):
                await self.manager.async_delete_saved_states(DEVICE, revision)
        self.assertEqual(self.manager.revision, revision + 1)
        self.assertEqual(get_studio(self.manager.model)["savedStates"], [])
        self.assertIn(entity_id, self.hass.er.entities)
        saves = len(self.hass.saved)
        # After refreshing the revision, an empty/idempotent retry still syncs.
        await self.manager.async_delete_saved_states(DEVICE, self.manager.revision)
        self.assertNotIn(entity_id, self.hass.er.entities)
        self.assertEqual(len(self.hass.saved), saves)
        self.assertEqual(self.hass.services.calls, [])


if __name__ == "__main__":
    unittest.main()
