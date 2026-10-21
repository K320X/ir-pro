"""Generic state sending persists as an action, without introducing new settings."""

import asyncio
from copy import deepcopy
from types import SimpleNamespace
import unittest

from tests.ha_fakes import FakeHass, fake_ha_modules
from tests.helpers import DEVICE, FUNCTION, REF, SOURCE, backend_module, empty_model, get_function, model_fixture, signal_fixture
from tests.test_controlled_states import FULL, WITHOUT_SWING, scoped_fixture
from tests.test_mixed_dual import mixed_control, mixed_fixture
from tests.test_studio import get_studio, settings, studio_fixture


def send_state_control(form="button"):
    control = {"id": "send-current-state", "name": "Enviar ajustes", "type": "button",
               "action": "send_state", "value": "", "icon": "remote", "color": "#56c4ed"}
    if form == "dual":
        control.update(type="dual", activeSide=0, actions=[
            {"name": "Enviar ajustes", "action": "send_state", "value": "", "icon": "remote", "color": "#56c4ed"},
            {"name": "Apagar", "action": "power_off", "value": "", "icon": "power-off", "color": "#ff8b80"},
        ])
    elif form == "custom-child":
        control = {"id": "send-folder", "name": "Opciones", "type": "group", "group": "custom",
                   "action": "open_group", "value": "", "icon": "folder", "color": "#56c4ed", "children": [control]}
    return control


class SendStateActionValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.validate = staticmethod(backend_module("validation").validate_model)
        cls.module = backend_module("studio")
        cls.error = backend_module("errors").IRProError

    def check(self, model, current=None, records=None):
        return self.validate(model, current or empty_model(), {SOURCE}, records or {}, set())[0]

    def test_button_dual_and_custom_child_roundtrip_without_new_entity_or_state_change(self):
        for form in ("button", "dual", "custom-child"):
            with self.subTest(form=form):
                model = studio_fixture()
                studio = get_studio(model)
                before = deepcopy(studio["state"])
                studio["rows"][1]["cells"][0] = send_state_control(form)
                stored = self.check(model)
                self.assertEqual(get_studio(stored)["state"], before)
                self.assertEqual(len(stored["emitters"][0]["devices"][0]["functions"]), 1)
                self.assertEqual(self.module.active_controlled_fields(get_studio(stored), True), FULL)
                self.assertEqual(self.module.active_controlled_fields(get_studio(stored), False), ["power"])
                self.assertEqual(self.check(stored, stored), stored)
                control = get_studio(stored)["rows"][1]["cells"][0]
                action = control["children"][0] if form == "custom-child" else control["actions"][0] if form == "dual" else control
                self.assertEqual(action["action"], "send_state")
                self.assertNotIn("state_effect", action)

    def test_simple_profile_rejects_state_action_until_promoted(self):
        for form in ("button", "dual", "custom-child"):
            model = studio_fixture()
            studio = get_studio(model)
            studio.update(type="simple", savedStates=[])
            studio["rows"][1].update(columns=1, cells=[send_state_control(form)])
            with self.subTest(form=form), self.assertRaises(self.error) as caught:
                self.check(model)
            self.assertIn("no puede modificar ajustes", caught.exception.message)
            studio["type"] = "stateful"
            self.assertEqual(get_studio(self.check(model))["type"], "stateful")

    def test_mixed_learned_side_retains_its_entity_signal_and_strict_coverage(self):
        records = {REF: signal_fixture(captured=True)}
        for index in (0, 1):
            for nested in (False, True):
                with self.subTest(index=index, nested=nested):
                    model = mixed_fixture(index, nested=nested)
                    control = mixed_control(model)
                    control["actions"][1 - index].update(action="send_state", value="")
                    stored = self.check(model, records=records)
                    child = mixed_control(stored)["learnedActions"][0]
                    self.assertEqual(child["action_index"], index)
                    self.assertEqual(child["entity"], get_function(stored)["entity"])
                    self.assertEqual(child["signal_refs"], {"press": REF})
                    self.assertNotIn("state_effect", child)
                    self.assertEqual(self.check(stored, stored, records), stored)
                    missing = deepcopy(stored)
                    mixed_control(missing)["learnedActions"] = []
                    with self.assertRaises(self.error):
                        self.check(missing, stored, records)
                    malformed = deepcopy(stored)
                    mixed_control(malformed)["learnedActions"][0]["action"] = "send_state"
                    with self.assertRaises(self.error):
                        self.check(malformed, stored, records)

    def test_preexisting_models_are_not_upgraded_or_reinterpreted(self):
        for model in (model_fixture(), studio_fixture(), mixed_fixture()):
            records = {REF: signal_fixture(captured=True)}
            stored = self.check(model, records=records)
            before = deepcopy(stored)
            self.assertEqual(self.check(stored, stored, records), before)
            self.assertNotIn("send_state", repr(before))


class SendStateActionManagerTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        with fake_ha_modules():
            module = backend_module("manager")
            cls.manager_class = module.IRProManager
            cls.error = module.IRProError
        cls.studio = backend_module("studio")

    async def prepare(self, *, scoped=False, off=False, learned=True):
        hass = FakeHass()
        manager = self.manager_class(hass, SimpleNamespace(entry_id="ir_pro_entry"))
        model = scoped_fixture() if scoped else studio_fixture()
        studio = get_studio(model)
        studio["rows"][1]["cells"][0] = send_state_control()
        studio["state"] = settings(power=not off, swing="position_6" if scoped else "position_3")
        if off:
            studio["savedStates"][0].update(settings={"power": False}, controlled_fields=["power"])
        if learned:
            get_function(model)["signal_refs"] = {"press": REF}
            manager.signals[REF] = signal_fixture(captured=True)
        await manager.async_save_model(model, 0)
        return manager, hass

    async def test_replays_only_existing_current_combination_without_modifying_settings(self):
        for scoped, off in ((False, False), (True, False), (False, True), (True, True)):
            with self.subTest(scoped=scoped, off=off):
                manager, hass = await self.prepare(scoped=scoped, off=off)
                before = deepcopy(get_studio(manager.model)["state"])
                refs = deepcopy(get_function(manager.model)["signal_refs"])
                fields = self.studio.active_controlled_fields(get_studio(manager.model), before["power"])
                self.assertEqual(fields, ["power"] if off else WITHOUT_SWING if scoped else FULL)
                result = await manager.async_send_state(DEVICE, deepcopy(before), controlled_fields=fields)
                self.assertEqual(get_studio(manager.model)["state"], before)
                self.assertEqual(get_function(manager.model)["signal_refs"], refs)
                self.assertEqual(result["status"], "sent_unconfirmed")
                self.assertEqual(len(hass.services.calls), 1)
                self.assertEqual(hass.services.calls[0][1], "send_command")
                self.assertEqual(hass.services.calls[0][2]["command"], manager.signals[REF]["command"])

    async def test_unlearned_state_or_incorrect_scope_never_emits(self):
        manager, hass = await self.prepare(learned=False)
        before = deepcopy(manager.envelope())
        with self.assertRaises(self.error):
            await manager.async_send_state(DEVICE, deepcopy(get_studio(manager.model)["state"]), controlled_fields=FULL)
        self.assertEqual(manager.envelope(), before)
        self.assertEqual(hass.services.calls, [])
        manager, hass = await self.prepare(scoped=True)
        before = deepcopy(manager.envelope())
        with self.assertRaises(self.error):
            await manager.async_send_state(DEVICE, deepcopy(get_studio(manager.model)["state"]), controlled_fields=FULL)
        self.assertEqual(manager.envelope(), before)
        self.assertEqual(hass.services.calls, [])

    async def prepare_dry_or_fan_replay(self, mode, *, scoped=False, power_independent=False):
        hass = FakeHass()
        manager = self.manager_class(hass, SimpleNamespace(entry_id="ir_pro_entry"))
        model = scoped_fixture() if scoped or power_independent else studio_fixture()
        studio = get_studio(model)
        studio["rows"][1]["cells"][0] = send_state_control()
        studio["state"] = settings(power=not power_independent, mode=mode, temperature=29,
                                   swing="position_6" if scoped or power_independent else "position_3")
        capture = studio["savedStates"][0]
        capture["settings"].update(mode=mode, temperature=18)
        if power_independent:
            studio["rows"].append({"id": "independent-power-row", "type": "buttons", "columns": 1, "height": 1, "cells": [
                {"id": "independent-power", "type": "button", "name": "Encender", "icon": "power", "color": "#56c4ed",
                 "action": "power_on", "sendMode": "independent"},
            ]})
            capture["controlled_fields"] = WITHOUT_SWING[1:]
            capture["settings"].pop("power")
        get_function(model)["signal_refs"] = {"press": REF}
        manager.signals[REF] = signal_fixture(captured=True)
        await manager.async_save_model(model, 0)
        return manager, hass

    async def test_dry_and_fan_replay_preserve_hidden_temperature_but_direct_entity_keeps_capture_semantics(self):
        for mode in ("dry", "fan"):
            for scoped in (False, True):
                with self.subTest(mode=mode, scoped=scoped):
                    manager, hass = await self.prepare_dry_or_fan_replay(mode, scoped=scoped)
                    before = deepcopy(get_studio(manager.model)["state"])
                    fields = self.studio.active_controlled_fields(get_studio(manager.model), before["power"])
                    await manager.async_send_state(DEVICE, deepcopy(before), controlled_fields=fields)
                    self.assertEqual(get_studio(manager.model)["state"], before)
                    self.assertEqual(get_studio(manager.model)["savedStates"][0]["settings"]["temperature"], 18)
                    self.assertEqual(len(hass.services.calls), 1)
                    await manager.async_press(FUNCTION)
                    self.assertEqual(get_studio(manager.model)["state"], {**before, "temperature": 18})
                    self.assertEqual(len(hass.services.calls), 2)

    async def test_replay_without_power_preserves_independent_power_swing_and_ignored_temperature(self):
        for mode in ("dry", "fan"):
            with self.subTest(mode=mode):
                manager, hass = await self.prepare_dry_or_fan_replay(mode, power_independent=True)
                before = deepcopy(get_studio(manager.model)["state"])
                fields = self.studio.active_controlled_fields(get_studio(manager.model), before["power"])
                self.assertEqual(fields, ["mode", "temperature", "fan"])
                await manager.async_send_state(DEVICE, deepcopy(before), controlled_fields=fields)
                self.assertEqual(get_studio(manager.model)["state"], before)
                self.assertFalse(get_studio(manager.model)["state"]["power"])
                self.assertEqual(len(hass.services.calls), 1)

    async def test_inflight_replay_preserves_concurrent_irrelevant_and_independent_settings(self):
        for mode in ("dry", "fan"):
            for power_independent in (False, True):
                with self.subTest(mode=mode, power_independent=power_independent):
                    manager, hass = await self.prepare_dry_or_fan_replay(mode, scoped=True, power_independent=power_independent)
                    before = deepcopy(get_studio(manager.model)["state"])
                    fields = self.studio.active_controlled_fields(get_studio(manager.model), before["power"])
                    started, release = asyncio.Event(), asyncio.Event()

                    async def wait(*_args):
                        started.set()
                        await release.wait()

                    hass.services.hook = wait
                    operation = asyncio.create_task(manager.async_send_state(DEVICE, deepcopy(before), controlled_fields=fields))
                    await asyncio.wait_for(started.wait(), 1)
                    candidate = manager.envelope()["model"]
                    get_studio(candidate)["state"].update(temperature=30, swing="position_1", power=True)
                    await manager.async_save_model(candidate, manager.revision)
                    expected = deepcopy(get_studio(manager.model)["state"])
                    release.set()
                    await operation
                    self.assertEqual(get_studio(manager.model)["state"], expected)
                    self.assertEqual(get_studio(manager.model)["state"]["temperature"], 30)
                    self.assertEqual(len(hass.services.calls), 1)
if __name__ == "__main__":
    unittest.main()
