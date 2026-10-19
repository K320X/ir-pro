"""State/service boundary tests using explicit in-memory HA API fakes."""

import asyncio
from copy import deepcopy
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from tests.ha_fakes import FakeHass, fake_ha_modules
from tests.helpers import (
    DEVICE, FUNCTION, REF, SOURCE, backend_module,
    empty_model, get_function, model_fixture, signal_fixture,
)


class ManagerTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        with fake_ha_modules():
            manager_module = backend_module("manager")
            cls.manager_module = manager_module
            cls.manager_class = manager_module.IRProManager
            cls.error = manager_module.IRProError

    def setUp(self):
        self.hass = FakeHass()
        self.entry = SimpleNamespace(entry_id="ir_pro_entry")
        self.manager = self.manager_class(self.hass, self.entry)

    async def save_fixture(self):
        await self.manager.async_save_model(model_fixture(), 0)

    async def prepare_verified_button(self):
        await self.save_fixture()
        learned = await self.manager.async_learn(SOURCE, DEVICE, FUNCTION, "press")
        reference = learned["signal_ref"]
        await self.manager.async_test_signal(reference)
        await self.manager.async_confirm_signal(reference)
        candidate = self.manager.envelope()["model"]
        get_function(candidate)["signal_refs"] = {"press": reference}
        await self.manager.async_save_model(candidate, self.manager.revision)
        return reference

    def calls(self, service):
        return [call for call in self.hass.services.calls if call[1] == service]

    async def test_initial_load_is_empty_and_never_sends(self):
        await self.manager.async_load()
        self.assertEqual(self.manager.envelope()["model"], empty_model())
        self.assertEqual(self.manager.revision, 0)
        self.assertEqual(self.hass.services.calls, [])

    async def test_save_does_not_learn_or_transmit_and_returns_independent_envelope(self):
        await self.save_fixture()
        envelope = self.manager.envelope()
        self.assertEqual(envelope["revision"], 1)
        self.assertEqual(self.hass.services.calls, [])
        get_function(envelope["model"])["name"] = "Changed outside manager"
        self.assertEqual(get_function(self.manager.model)["name"], "Encender")

    async def test_stale_revision_cannot_overwrite_current_state(self):
        await self.save_fixture()
        candidate = self.manager.envelope()["model"]
        get_function(candidate)["name"] = "Stale browser"
        before = deepcopy(self.manager.model)
        before_storage = deepcopy(self.hass.storage)
        with self.assertRaises(self.error) as caught:
            await self.manager.async_save_model(candidate, 0)
        self.assertEqual(caught.exception.code, "revision_conflict")
        self.assertEqual(self.manager.model, before)
        self.assertEqual(self.hass.storage, before_storage)

    async def test_failed_persistence_is_atomic(self):
        await self.save_fixture()
        before = deepcopy(self.manager.envelope())
        candidate = deepcopy(before["model"])
        get_function(candidate)["name"] = "Must not survive failed save"
        before_storage = deepcopy(self.hass.storage)
        self.hass.fail_save = True
        with self.assertRaises(self.error) as caught:
            await self.manager.async_save_model(candidate, before["revision"])
        self.assertEqual(caught.exception.code, "storage_error")
        self.assertEqual(self.manager.envelope(), before)
        self.assertEqual(self.hass.storage, before_storage)

    async def test_learn_does_not_send_or_trust_capture_without_user_test(self):
        await self.save_fixture()
        result = await self.manager.async_learn(SOURCE, DEVICE, FUNCTION, "press")
        reference = result["signal_ref"]
        self.assertTrue(result["needs_test"])
        self.assertEqual(len(self.calls("learn_command")), 1)
        self.assertEqual(self.calls("send_command"), [])
        self.assertFalse(self.manager.signals[reference]["tested"])
        self.assertFalse(self.manager.signals[reference]["verified"])
        self.assertFalse(self.manager.function_available(FUNCTION))
        with self.assertRaises(self.error):
            await self.manager.async_confirm_signal(reference)

    async def test_learning_a_draft_function_requires_existing_device(self):
        await self.save_fixture()
        draft_key = "00000000-0000-4000-8000-000000000050"
        result = await self.manager.async_learn(SOURCE, DEVICE, draft_key, "press")
        self.assertIn(result["signal_ref"], self.manager.signals)
        with self.assertRaises(self.error):
            await self.manager.async_learn(SOURCE, "missing_device", draft_key, "press")

    async def test_test_then_human_confirmation_never_autosends_again(self):
        await self.save_fixture()
        learned = await self.manager.async_learn(SOURCE, DEVICE, FUNCTION, "press")
        reference = learned["signal_ref"]
        tested = await self.manager.async_test_signal(reference)
        self.assertEqual(tested["status"], "sent_unconfirmed")
        self.assertEqual(len(self.calls("send_command")), 1)
        self.assertFalse(self.manager.signals[reference]["verified"])
        await self.manager.async_confirm_signal(reference)
        self.assertEqual(len(self.calls("send_command")), 1)
        self.assertTrue(self.manager.signals[reference]["verified"])
        self.assertEqual(get_function(self.manager.model)["signal_refs"], {})

    async def test_verified_function_only_sends_on_explicit_press(self):
        await self.prepare_verified_button()
        self.assertTrue(self.manager.function_available(FUNCTION))
        self.hass.services.calls.clear()
        result = await self.manager.async_press(FUNCTION)
        self.assertEqual(result["status"], "sent_unconfirmed")
        self.assertEqual(len(self.calls("send_command")), 1)
        self.assertEqual(self.calls("learn_command"), [])
        self.assertEqual(self.calls("send_command")[0][2]["entity_id"], "remote.ir_salon")

    async def test_relearning_keeps_previous_signal_until_new_reference_is_saved(self):
        previous = await self.prepare_verified_button()
        previous_command = self.manager.signals[previous]["command"]
        self.hass.services.calls.clear()
        result = await self.manager.async_learn(SOURCE, DEVICE, FUNCTION, "press")
        replacement = result["signal_ref"]
        self.assertNotEqual(previous, replacement)
        self.assertNotEqual(self.manager.signals[replacement]["command"], previous_command)
        self.assertEqual(get_function(self.manager.model)["signal_refs"]["press"], previous)
        await self.manager.async_press(FUNCTION)
        self.assertEqual(self.calls("send_command")[0][2]["command"], previous_command)

    async def test_offline_or_off_source_cannot_learn_test_or_press(self):
        reference = await self.prepare_verified_button()
        for state in ("off", "unavailable", "unknown"):
            with self.subTest(state=state):
                self.hass.states.values["remote.ir_salon"].state = state
                self.hass.services.calls.clear()
                self.assertFalse(self.manager.function_available(FUNCTION))
                self.assertFalse(self.manager.catalog()[0]["available"])
                with self.assertRaises(self.error):
                    await self.manager.async_press(FUNCTION)
                with self.assertRaises(self.error):
                    await self.manager.async_test_signal(reference)
                with self.assertRaises(self.error):
                    await self.manager.async_learn(SOURCE, DEVICE, FUNCTION, "press")
                self.assertEqual(self.hass.services.calls, [])

    async def test_stable_registry_id_survives_source_entity_rename(self):
        await self.prepare_verified_button()
        source = self.hass.er.entities.pop("remote.ir_salon")
        source.entity_id = "remote.renamed_in_home_assistant"
        self.hass.er.entities[source.entity_id] = source
        self.hass.states.values[source.entity_id] = self.hass.states.values.pop("remote.ir_salon")
        self.hass.services.calls.clear()
        await self.manager.async_press(FUNCTION)
        self.assertEqual(self.calls("send_command")[0][2]["entity_id"], source.entity_id)
        self.assertEqual(self.manager.model["emitters"][0]["sourceId"], SOURCE)

    async def test_failed_service_does_not_mark_tested_or_replace_previous_signal(self):
        await self.save_fixture()
        learned = await self.manager.async_learn(SOURCE, DEVICE, FUNCTION, "press")
        reference = learned["signal_ref"]
        before_records = deepcopy(self.manager.signals)

        async def fail(*_args):
            raise RuntimeError("Disconnected hardware")

        self.hass.services.hook = fail
        with self.assertRaises(self.error):
            await self.manager.async_test_signal(reference)
        self.assertEqual(self.manager.signals, before_records)
        with self.assertRaises(self.error):
            await self.manager.async_learn(SOURCE, DEVICE, FUNCTION, "press")
        self.assertEqual(self.manager.signals, before_records)

    async def test_one_operation_per_source(self):
        await self.save_fixture()
        started = asyncio.Event()
        release = asyncio.Event()

        async def wait_for_release(*_args):
            started.set()
            await release.wait()

        self.hass.services.hook = wait_for_release
        operation = asyncio.create_task(self.manager.async_learn(SOURCE, DEVICE, FUNCTION, "press"))
        await started.wait()
        try:
            with self.assertRaises(self.error) as caught:
                await self.manager.async_learn(SOURCE, DEVICE, FUNCTION, "press")
            self.assertEqual(caught.exception.code, "busy")
            self.assertEqual(len(self.calls("learn_command")), 1)
        finally:
            release.set()
            await operation

    async def test_restart_restores_metadata_and_signals_without_transmitting(self):
        await self.prepare_verified_button()
        self.hass.services.calls.clear()
        restored = self.manager_class(self.hass, self.entry)
        await restored.async_load()
        self.assertEqual(restored.model, self.manager.model)
        self.assertEqual(restored.signals, self.manager.signals)
        self.assertEqual(restored.revision, self.manager.revision)
        self.assertEqual(self.hass.services.calls, [])

    async def test_restart_switch_state_is_unknown_and_both_signals_required(self):
        model = model_fixture()
        function = get_function(model)
        function.update(type="switch", entity="switch.ir_salon_split_salon_encender", on=True)
        self.hass.storage["ir_pro"] = {
            "model": model, "revision": 7,
            "signals": {REF: signal_fixture(signal="on")},
        }
        await self.manager.async_load()
        self.assertIsNone(get_function(self.manager.model)["on"])
        self.assertFalse(self.manager.function_available(FUNCTION))
        self.assertEqual(self.hass.services.calls, [])

    async def test_switch_requires_separate_verified_on_and_off_and_updates_only_after_send(self):
        model = model_fixture()
        get_function(model).update(type="switch", entity="switch.ir_salon_split_salon_encender")
        await self.manager.async_save_model(model, 0)
        references = {}
        for signal in ("on", "off"):
            reference = (await self.manager.async_learn(SOURCE, DEVICE, FUNCTION, signal))["signal_ref"]
            await self.manager.async_test_signal(reference)
            await self.manager.async_confirm_signal(reference)
            references[signal] = reference
            candidate = deepcopy(self.manager.model)
            get_function(candidate)["signal_refs"] = dict(references)
            await self.manager.async_save_model(candidate, self.manager.revision)
            self.assertEqual(self.manager.function_available(FUNCTION), signal == "off")
        self.assertIsNone(get_function(self.manager.model)["on"])
        self.hass.services.calls.clear()
        await self.manager.async_press(FUNCTION, desired=True)
        self.assertIs(get_function(self.manager.model)["on"], True)
        self.assertEqual(self.calls("send_command")[-1][2]["command"], self.manager.signals[references["on"]]["command"])
        await self.manager.async_press(FUNCTION, desired=False)
        self.assertIs(get_function(self.manager.model)["on"], False)
        self.assertEqual(self.calls("send_command")[-1][2]["command"], self.manager.signals[references["off"]]["command"])

        async def fail(*_args):
            raise RuntimeError("Transmission failed")

        self.hass.services.hook = fail
        with self.assertRaises(self.error):
            await self.manager.async_press(FUNCTION, desired=True)
        self.assertIs(get_function(self.manager.model)["on"], False)

    async def test_learn_timeout_does_not_create_trusted_reference_and_cools_down_source(self):
        await self.save_fixture()

        async def never_respond(*_args):
            await asyncio.Event().wait()

        self.hass.services.hook = never_respond
        with patch.object(self.manager_module, "LEARN_TIMEOUT", 0.01):
            with self.assertRaises(self.error) as caught:
                await self.manager.async_learn(SOURCE, DEVICE, FUNCTION, "press")
        self.assertEqual(caught.exception.code, "learn_failed")
        self.assertEqual(self.manager.signals, {})
        with self.assertRaises(self.error) as caught:
            await self.manager.async_learn(SOURCE, DEVICE, FUNCTION, "press")
        self.assertEqual(caught.exception.code, "busy")

    async def test_unload_cancels_inflight_learning_without_saving_false_success(self):
        await self.save_fixture()
        started = asyncio.Event()

        async def never_respond(*_args):
            started.set()
            await asyncio.Event().wait()

        self.hass.services.hook = never_respond
        operation = asyncio.create_task(self.manager.async_learn(SOURCE, DEVICE, FUNCTION, "press"))
        await started.wait()
        await self.manager.async_unload()
        self.assertTrue(operation.cancelled())
        self.assertEqual(self.manager.signals, {})
        self.assertEqual(self.calls("send_command"), [])

    async def test_delete_our_metadata_never_removes_physical_or_unrelated_devices(self):
        await self.save_fixture()
        unrelated = SimpleNamespace(
            id="another_integration_device", config_entry_id="another_entry",
            identifiers={("another", "123")},
        )
        self.hass.dr.entries[unrelated.id] = unrelated
        await self.manager.async_save_model(empty_model(), self.manager.revision)
        self.assertIn("broadlink_device", self.hass.dr.entries)
        self.assertIn(unrelated.id, self.hass.dr.entries)
        self.assertNotIn("broadlink_device", self.hass.dr.removed)
        self.assertNotIn(unrelated.id, self.hass.dr.removed)
        self.assertIn("remote.ir_salon", self.hass.er.entities)
        self.assertEqual(self.hass.services.calls, [])


if __name__ == "__main__":
    unittest.main()
