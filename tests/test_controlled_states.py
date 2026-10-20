"""Capture scopes exclude independent commands without reinterpreting history."""

from copy import deepcopy
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from tests.ha_fakes import FakeHass, fake_ha_modules
from tests.helpers import DEVICE, FUNCTION, REF, SOURCE, backend_module, empty_model, get_function, signal_fixture
from tests.test_studio import get_studio, settings, studio_fixture

FULL = ["power", "mode", "temperature", "fan", "swing"]
WITHOUT_SWING = FULL[:-1]


def scoped_fixture():
    model = studio_fixture()
    studio = get_studio(model)
    studio["rows"][1]["cells"][2]["sendMode"] = "independent"
    record = studio["savedStates"][0]
    record["controlled_fields"] = WITHOUT_SWING[:]
    record["settings"] = {field: record["settings"][field] for field in WITHOUT_SWING}
    studio["state"] = settings(power=False, mode="cool", temperature=26, fan="low", swing="position_6")
    return model


class ControlledStateValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = backend_module("studio")
        cls.validate = staticmethod(backend_module("validation").validate_model)
        cls.error = backend_module("errors").IRProError

    def check(self, model, *, current=None, loading=False):
        return self.validate(model, current or empty_model(), {SOURCE}, {}, set(), loading=loading)[0]

    def test_only_active_independent_folders_exclude_fields(self):
        studio = {"rows": [{"cells": [
            {"type": "group", "group": "swing", "sendMode": "independent"},
            {"type": "group", "group": "custom", "children": [{"type": "group", "group": "fan", "sendMode": "independent"}]},
            {"type": "button", "action": "learned", "name": "Luz", "state_effect": {"mode": "heat"}},
            {"type": "group", "group": "mode", "sendMode": "settings", "independentActions": [{"type": "group", "group": "mode", "sendMode": "independent"}]},
            {"type": "button", "action": "set_swing", "value": "off"},
        ]}]}
        self.assertEqual(self.module.active_controlled_fields(studio, True), ["power", "mode", "temperature"])
        self.assertEqual(self.module.active_controlled_fields(studio, False), ["power"])
        self.assertEqual(self.module.active_controlled_fields({"rows": []}, True), FULL)

    def test_masks_are_canonical_bounded_and_not_coerced(self):
        for fields in (None, "power", [], ["unknown"], ["power", "power"], ["power", "unknown"], ["power", 1], ["power", "fan", "mode"]):
            with self.subTest(fields=fields), self.assertRaises(self.error):
                self.module.validate_controlled_fields(fields)
        for fields in (FULL, WITHOUT_SWING, ["power"], ["power", "temperature"]):
            self.assertEqual(self.module.validate_controlled_fields(fields), fields)

    def test_new_capture_projects_independent_values_out_of_storage(self):
        model = scoped_fixture()
        record = get_studio(model)["savedStates"][0]
        record["settings"]["swing"] = {"unrelated": "ignored"}
        result = self.check(model)
        stored = get_studio(result)["savedStates"][0]
        self.assertEqual(stored["controlled_fields"], WITHOUT_SWING)
        self.assertEqual(set(stored["settings"]), set(WITHOUT_SWING))
        self.assertNotIn("swing", stored["settings"])
        self.assertEqual(stored["id"], FUNCTION)

    def test_mode_independent_does_not_make_temperature_irrelevant(self):
        fields = ["power", "temperature", "fan", "swing"]
        key = self.module.scoped_configuration_key
        self.assertNotEqual(key(settings(mode="dry", temperature=18), fields), key(settings(mode="dry", temperature=30), fields))
        self.assertEqual(key(settings(mode="heat"), fields), key(settings(mode="dry"), fields))
        self.assertEqual(key(settings(mode="dry", temperature=18), FULL), key(settings(mode="dry", temperature=30), FULL))

    def test_new_capture_scope_must_match_configuration_not_client_claim(self):
        for fields in (FULL, ["power", "temperature"], None):
            candidate = scoped_fixture()
            record = get_studio(candidate)["savedStates"][0]
            record["settings"] = settings()
            if fields is None:
                record.pop("controlled_fields")
            else:
                record["controlled_fields"] = fields
            with self.subTest(fields=fields), self.assertRaises(self.error):
                self.check(candidate)

    def test_off_has_only_power_regardless_of_independent_folders(self):
        model = scoped_fixture()
        record = get_studio(model)["savedStates"][0]
        record.update(settings={"power": False}, controlled_fields=["power"])
        stored = get_studio(self.check(model))["savedStates"][0]
        self.assertEqual(stored["settings"], {"power": False})
        self.assertEqual(stored["controlled_fields"], ["power"])

    def test_existing_mask_values_and_legacy_absence_are_immutable(self):
        current = self.check(scoped_fixture())
        candidate = deepcopy(current)
        record = get_studio(candidate)["savedStates"][0]
        record.pop("controlled_fields")
        record["settings"]["swing"] = "auto"
        self.assertEqual(get_studio(self.check(candidate, current=current))["savedStates"], get_studio(current)["savedStates"])
        for mutate in (
            lambda record: record.update(controlled_fields=FULL, settings=settings()),
            lambda record: record["settings"].update(temperature=25),
        ):
            candidate = deepcopy(current)
            mutate(get_studio(candidate)["savedStates"][0])
            with self.assertRaises(self.error):
                self.check(candidate, current=current)
        legacy = self.check(studio_fixture())
        candidate = deepcopy(legacy)
        get_studio(candidate)["savedStates"][0]["controlled_fields"] = FULL
        with self.assertRaises(self.error):
            self.check(candidate, current=legacy)

    def test_scope_change_and_reload_preserve_historical_captures_exactly(self):
        for explicit in (False, True):
            model = studio_fixture()
            if explicit:
                get_studio(model)["savedStates"][0]["controlled_fields"] = FULL
            current = self.check(model)
            before = deepcopy(get_studio(current)["savedStates"])
            candidate = deepcopy(current)
            get_studio(candidate)["rows"][1]["cells"][2]["sendMode"] = "independent"
            changed = self.check(candidate, current=current)
            self.assertEqual(get_studio(changed)["savedStates"], before)
            reloaded = self.check(changed, loading=True)
            self.assertEqual(get_studio(reloaded)["savedStates"], before)
            self.assertEqual(reloaded["emitters"][0]["devices"][0]["functions"], current["emitters"][0]["devices"][0]["functions"])


class ControlledStateManagerTests(unittest.IsolatedAsyncioTestCase):
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

    async def prepare(self, model=None):
        model = model or scoped_fixture()
        self.manager.signals[REF] = signal_fixture(captured=True)
        get_function(model)["signal_refs"] = {"press": REF}
        await self.manager.async_save_model(model, 0)

    async def test_scoped_send_ignores_position_and_preserves_estimated_lamas(self):
        await self.prepare()
        revision = self.manager.revision
        result = await self.manager.async_send_state(DEVICE, settings(swing="position_1"), controlled_fields=WITHOUT_SWING)
        self.assertEqual(get_studio(self.manager.model)["state"], settings(swing="position_6"))
        self.assertEqual(result["revision"], revision + 1)
        self.assertEqual(len(self.hass.services.calls), 1)
        await self.manager.async_send_state(DEVICE, settings(swing="auto"))
        self.assertEqual(get_studio(self.manager.model)["state"]["swing"], "position_6")
        self.assertEqual(len(self.hass.services.calls), 2)

    async def test_state_entity_press_applies_only_stored_fields_and_reloads(self):
        await self.prepare()
        await self.manager.async_press(FUNCTION)
        self.assertEqual(get_studio(self.manager.model)["state"], settings(swing="position_6"))
        restored = self.manager_class(self.hass, self.entry)
        await restored.async_load()
        self.assertEqual(restored.envelope(), self.manager.envelope())
        self.assertEqual(get_studio(restored.model)["savedStates"][0]["controlled_fields"], WITHOUT_SWING)

    async def test_broader_legacy_does_not_match_but_direct_entity_retains_meaning(self):
        await self.prepare(studio_fixture())
        candidate = self.manager.envelope()["model"]
        get_studio(candidate)["rows"][1]["cells"][2]["sendMode"] = "independent"
        await self.manager.async_save_model(candidate, self.manager.revision)
        before = deepcopy(get_studio(self.manager.model)["savedStates"])
        with self.assertRaises(self.error):
            await self.manager.async_send_state(DEVICE, settings())
        self.assertEqual(self.hass.services.calls, [])
        await self.manager.async_press(FUNCTION)
        self.assertEqual(get_studio(self.manager.model)["state"], settings())
        self.assertEqual(get_studio(self.manager.model)["savedStates"], before)

    async def test_invalid_target_scope_or_failed_send_does_not_change_state(self):
        await self.prepare()
        before, storage = deepcopy(self.manager.model), deepcopy(self.hass.storage)
        for fields in (FULL, ["power", "temperature"], ["power", "unknown"]):
            with self.subTest(fields=fields), self.assertRaises(self.error):
                await self.manager.async_send_state(DEVICE, settings(), controlled_fields=fields)
        self.assertEqual(self.hass.services.calls, [])

        async def fail(*_args):
            raise RuntimeError("Unavailable")

        self.hass.services.hook = fail
        with self.assertRaises(self.error):
            await self.manager.async_send_state(DEVICE, settings())
        self.assertEqual(self.manager.model, before)
        self.assertEqual(self.hass.storage, storage)

    async def test_explicit_full_capture_preferred_to_legacy_and_duplicates_rejected(self):
        await self.prepare(studio_fixture())
        candidate = self.manager.envelope()["model"]
        device = candidate["emitters"][0]["devices"][0]
        function = deepcopy(device["functions"][0])
        function.update(key="explicit-state", entity="button.explicit_state", signal_refs={"press": "explicit-ref"})
        device["functions"].append(function)
        device["layout"]["rows"].append({"id": "explicit-layout", "height": 2, "columns": 1, "cells": ["explicit-state"]})
        device["studio"]["savedStates"].append({"id": "explicit-state", "name": "Explícito", "settings": settings(), "controlled_fields": FULL})
        self.manager.signals["explicit-ref"] = signal_fixture(function_key="explicit-state", command="explicit-command", captured=True)
        await self.manager.async_save_model(candidate, self.manager.revision)
        await self.manager.async_send_state(DEVICE, settings())
        self.assertEqual(self.hass.services.calls[0][2]["command"], "explicit-command")
        candidate = self.manager.envelope()["model"]
        device = candidate["emitters"][0]["devices"][0]
        duplicate = deepcopy(device["functions"][-1])
        duplicate.update(key="duplicate-state", entity="button.duplicate_state")
        device["functions"].append(duplicate)
        device["layout"]["rows"].append({"id": "duplicate-layout", "height": 2, "columns": 1, "cells": ["duplicate-state"]})
        device["studio"]["savedStates"].append({"id": "duplicate-state", "name": "Duplicado", "settings": settings(), "controlled_fields": FULL})
        await self.manager.async_save_model(candidate, self.manager.revision)
        with self.assertRaises(self.error) as caught:
            await self.manager.async_send_state(DEVICE, settings())
        self.assertEqual(caught.exception.code, "ambiguous_state")
        self.assertEqual(len(self.hass.services.calls), 1)

    async def test_scope_rechecked_after_configuration_changes_before_press(self):
        await self.prepare()
        press = self.manager.async_press

        async def change_scope(*args, **kwargs):
            candidate = self.manager.envelope()["model"]
            get_studio(candidate)["rows"][1]["cells"][2]["sendMode"] = "settings"
            await self.manager.async_save_model(candidate, self.manager.revision)
            return await press(*args, **kwargs)

        with patch.object(self.manager, "async_press", new=change_scope), self.assertRaises(self.error):
            await self.manager.async_send_state(DEVICE, settings())
        self.assertEqual(self.hass.services.calls, [])


if __name__ == "__main__":
    unittest.main()
