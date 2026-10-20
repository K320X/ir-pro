"""Visual metadata persistence and explicit full-state sending boundaries."""

from copy import deepcopy
import asyncio
from types import SimpleNamespace
import unittest

from tests.ha_fakes import FakeHass, fake_ha_modules
from tests.helpers import (
    DEVICE, FUNCTION, REF, SOURCE, backend_module, empty_model,
    get_function, model_fixture, signal_fixture,
)


def settings(**overrides):
    return {"power": True, "mode": "heat", "temperature": 22, "fan": "high",
            "swing": "position_3", **overrides}


def studio_fixture():
    model = model_fixture()
    device = model["emitters"][0]["devices"][0]
    device["icon"] = "wind"
    device["studio"] = {
        "type": "stateful", "state": settings(power=False),
        "rows": [
            {"id": "studio-screen", "type": "display", "height": 2, "width": 3,
             "style": "lcd", "accent": "#b9c9b0", "fields": {"temperature": True}},
            {"id": "studio-controls", "type": "buttons", "height": 2, "columns": 3,
             "cells": [
                 {"id": "power-control", "name": "Encender", "icon": "power",
                  "color": "#6cd9a2", "type": "button", "action": "power_on"},
                 {"id": "fan-folder", "name": "Ventilador", "icon": "fan", "color": "#56c4ed",
                  "type": "group", "group": "fan", "action": "open_group",
                  "fanSpeedCount": 5, "fanAuto": False},
                 {"id": "swing-folder", "name": "Oscilación", "icon": "swing", "color": "#c6b5ff",
                  "type": "group", "group": "swing", "action": "open_group",
                  "swingPositionCount": 6, "swingAuto": True, "swingOff": True},
             ]},
        ],
        "savedStates": [{"id": FUNCTION, "name": "Client name", "entity": "button.forged",
                         "settings": settings(), "signal": {"kind": "simulated", "id": "fake"},
                         "signals": {"press": True}, "signal_refs": {"press": "fake"}}],
    }
    return model


def get_studio(model):
    return model["emitters"][0]["devices"][0]["studio"]


class StudioValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = backend_module("studio")
        cls.validate = staticmethod(backend_module("validation").validate_model)
        cls.error = backend_module("errors").IRProError

    def check(self, model, *, current=None, records=None):
        return self.validate(model, current or empty_model(), {SOURCE}, records or {}, set())[0]

    def test_legacy_model_without_studio_is_unchanged(self):
        model = model_fixture()
        get_function(model)["signal_refs"] = {"press": REF}
        result = self.check(model, records={REF: signal_fixture()})
        self.assertNotIn("studio", result["emitters"][0]["devices"][0])
        self.assertEqual(get_function(result)["key"], FUNCTION)
        self.assertEqual(get_function(result)["name"], "Encender")
        self.assertEqual(get_function(result)["entity"], get_function(model)["entity"])
        self.assertEqual(get_function(result)["signal_refs"], {"press": REF})

    def test_studio_signal_claims_are_derived_from_real_function(self):
        model = studio_fixture()
        before = deepcopy(model)
        result = self.check(model)
        record = get_studio(result)["savedStates"][0]
        self.assertEqual(model, before)
        self.assertEqual(record["name"], get_function(model)["name"])
        self.assertEqual(record["entity"], get_function(model)["entity"])
        self.assertEqual(record["signal_refs"], {})
        self.assertFalse(record["signals"].get("press", False))
        self.assertIsNone(record["signal"])

    def test_captured_state_keeps_only_real_opaque_reference(self):
        model = studio_fixture()
        get_function(model)["signal_refs"] = {"press": REF}
        result = self.check(model, records={REF: signal_fixture(captured=True, tested=False, verified=False)})
        record = get_studio(result)["savedStates"][0]
        self.assertEqual(record["signal"], {"kind": "learned", "id": REF})
        self.assertEqual(record["signal_refs"], {"press": REF})
        self.assertTrue(record["signals"]["press"])

    def test_legacy_switch_in_stateful_studio_keeps_canonical_identity_and_readiness(self):
        model = studio_fixture()
        function = get_function(model)
        function.update(type="switch", entity="switch.legacy_toggle", signal_refs={"on": "on-ref", "off": "off-ref"})
        studio = get_studio(model)
        studio["savedStates"] = []
        studio["rows"][1]["cells"][0] = {
            "id": FUNCTION, "type": "dual", "action": "learned", "name": "Stale name",
            "icon": "remote", "color": "#ffffff", "actions": [
                {"name": "Apagado", "action": "learned", "icon": "power-off", "color": "#ff8b80"},
                {"name": "Encendido", "action": "learned", "icon": "power", "color": "#6cd9a2"},
            ],
        }
        records = {"on-ref": signal_fixture(signal="on"), "off-ref": signal_fixture(signal="off")}
        result = self.check(model, records=records)
        node = get_studio(result)["rows"][1]["cells"][0]
        self.assertEqual(node["name"], function["name"])
        self.assertEqual(node["entity"], function["entity"])
        self.assertEqual(node["signal_refs"], function["signal_refs"])
        self.assertEqual(node["signals"], {"on": True, "off": True})

    def test_every_position_is_distinct_but_off_is_universal(self):
        key = self.module.configuration_key
        values = ["off", "auto", *(f"position_{n}" for n in range(1, 7))]
        self.assertEqual(len({key(settings(swing=value)) for value in values}), 8)
        self.assertEqual(len({key(settings(power=False, swing=value)) for value in values}), 1)
        self.assertEqual(key(settings(swing=True)), key(settings(swing="auto")))
        self.assertEqual(key(settings(swing=False)), key(settings(swing="off")))
        for mode in ("dry", "fan"):
            self.assertEqual(key(settings(mode=mode, temperature=18)), key(settings(mode=mode, temperature=30)))

    def test_minimal_off_saved_state_and_legacy_swing_migrate_without_identity_change(self):
        for value, expected in ((True, "auto"), (False, "off")):
            model = studio_fixture()
            get_studio(model)["savedStates"][0]["settings"]["swing"] = value
            result = self.check(model)
            record = get_studio(result)["savedStates"][0]
            self.assertEqual(record["settings"]["swing"], expected)
            self.assertEqual(record["id"], FUNCTION)
        model = studio_fixture()
        get_studio(model)["savedStates"][0]["settings"] = {"power": False}
        self.assertEqual(get_studio(self.check(model))["savedStates"][0]["settings"], {"power": False})

    def test_saved_state_settings_cannot_be_reassigned_to_existing_entity(self):
        current = self.check(studio_fixture())
        candidate = deepcopy(current)
        get_studio(candidate)["savedStates"][0]["settings"]["temperature"] = 23
        with self.assertRaises(self.error):
            self.check(candidate, current=current)

    def test_old_client_does_not_erase_studio_and_visible_rename_keeps_entity(self):
        current = self.check(studio_fixture())
        candidate = deepcopy(current)
        del candidate["emitters"][0]["devices"][0]["studio"]
        get_function(candidate)["name"] = "Alias personalizado"
        result = self.check(candidate, current=current)
        self.assertEqual(get_studio(result)["savedStates"][0]["name"], "Alias personalizado")
        self.assertEqual(get_function(result)["entity"], get_function(current)["entity"])

    def test_invalid_configurations_are_rejected_without_coercing_values(self):
        for change in ({"temperature": True}, {"temperature": 31}, {"power": "true"},
                       {"mode": "unknown"}, {"fan": "speed_6"}, {"swing": "position_7"}):
            with self.subTest(change=change), self.assertRaises(self.error):
                self.module.validate_configuration(settings(**change))

    def test_unknown_function_and_duplicate_node_identity_are_rejected(self):
        for mutate in (lambda studio: studio["savedStates"][0].update(id="missing-function"),
                       lambda studio: studio["rows"][1]["cells"][1].update(id="power-control")):
            model = studio_fixture()
            mutate(get_studio(model))
            with self.assertRaises(self.error):
                self.check(model)

    def test_invalid_metadata_size_types_and_bounds_are_rejected(self):
        for mutate in (lambda studio: studio.update(type=[]),
                       lambda studio: studio["rows"][1]["cells"][1].update(fanSpeedCount=6),
                       lambda studio: studio["rows"][1]["cells"][2].update(swingAuto=1),
                       lambda studio: studio.update(unused="x" * (512 * 1024))):
            model = studio_fixture()
            mutate(get_studio(model))
            with self.assertRaises(self.error):
                self.check(model)


class StudioManagerTests(unittest.IsolatedAsyncioTestCase):
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

    async def prepare(self, *, learned=True, off=False):
        model = studio_fixture()
        if learned:
            self.manager.signals[REF] = signal_fixture(captured=True, tested=False, verified=False)
            get_function(model)["signal_refs"] = {"press": REF}
        if off:
            get_studio(model)["savedStates"][0]["settings"] = {"power": False}
            get_studio(model)["state"] = settings(power=True, temperature=27, swing="position_6")
        await self.manager.async_save_model(model, 0)

    async def test_persist_reload_preserves_metadata_identity_and_never_transmits(self):
        await self.prepare()
        envelope = self.manager.envelope()
        self.assertEqual(self.hass.services.calls, [])
        restored = self.manager_class(self.hass, self.entry)
        await restored.async_load()
        self.assertEqual(restored.envelope(), envelope)
        record = get_studio(restored.model)["savedStates"][0]
        self.assertEqual(record["id"], FUNCTION)
        self.assertEqual(record["entity"], get_function(self.manager.model)["entity"])
        self.assertEqual(record["signal_refs"], {"press": REF})
        self.assertEqual(record["settings"]["swing"], "position_3")
        self.assertEqual(self.hass.services.calls, [])

    async def test_send_exact_state_uses_one_existing_signal_and_updates_estimate(self):
        await self.prepare()
        before_revision = self.manager.revision
        result = await self.manager.async_send_state(DEVICE, settings())
        self.assertEqual(len(self.hass.services.calls), 1)
        self.assertEqual(self.hass.services.calls[0][1], "send_command")
        self.assertEqual(self.hass.services.calls[0][2]["command"], self.manager.signals[REF]["command"])
        self.assertEqual(get_studio(self.manager.model)["state"], settings())
        self.assertEqual(result["status"], "sent_unconfirmed")
        self.assertEqual(result["revision"], before_revision + 1)

    async def test_direct_state_entity_press_updates_same_estimated_settings(self):
        await self.prepare()
        await self.manager.async_press(FUNCTION)
        self.assertEqual(get_studio(self.manager.model)["state"], settings())
        self.assertEqual(len(self.hass.services.calls), 1)

    async def test_send_increments_revision_so_stale_editor_cannot_overwrite_estimate(self):
        await self.prepare()
        old = self.manager.envelope()
        await self.manager.async_send_state(DEVICE, settings())
        with self.assertRaises(self.error) as caught:
            await self.manager.async_save_model(old["model"], old["revision"])
        self.assertEqual(caught.exception.code, "revision_conflict")
        self.assertEqual(get_studio(self.manager.model)["state"], settings())
        self.assertEqual(len(self.hass.services.calls), 1)

    async def test_deleting_state_while_sending_never_resurrects_function_or_metadata(self):
        await self.prepare()
        started, release = asyncio.Event(), asyncio.Event()

        async def wait_for_send(*_args):
            started.set()
            await release.wait()
        self.hass.services.hook = wait_for_send
        operation = asyncio.create_task(self.manager.async_send_state(DEVICE, settings()))
        await asyncio.wait_for(started.wait(), 1)
        candidate = self.manager.envelope()["model"]
        device = candidate["emitters"][0]["devices"][0]
        device["functions"] = []
        device["layout"]["rows"][0]["cells"] = [None, None]
        device["studio"]["savedStates"] = []
        await self.manager.async_save_model(candidate, self.manager.revision)
        release.set()
        await operation
        self.assertEqual(get_studio(self.manager.model)["savedStates"], [])
        self.assertEqual(self.manager.model["emitters"][0]["devices"][0]["functions"], [])
        self.assertFalse(get_studio(self.manager.model)["state"]["power"])
        self.assertEqual(len(self.hass.services.calls), 1)

    async def test_off_transmission_retains_prepared_temperature_mode_and_position(self):
        await self.prepare(off=True)
        prepared = deepcopy(get_studio(self.manager.model)["state"])
        await self.manager.async_send_state(DEVICE, {"power": False})
        self.assertEqual(get_studio(self.manager.model)["state"], {**prepared, "power": False})
        self.assertEqual(len(self.hass.services.calls), 1)

    async def test_unlearned_or_different_state_never_transmits(self):
        await self.prepare(learned=False)
        for state in (settings(), settings(temperature=23), settings(swing="position_4")):
            with self.subTest(state=state), self.assertRaises(self.error):
                await self.manager.async_send_state(DEVICE, state)
        self.assertEqual(self.hass.services.calls, [])

    async def test_failed_transmission_does_not_claim_new_state(self):
        await self.prepare()
        before = deepcopy(self.manager.model)
        stored = deepcopy(self.hass.storage)

        async def fail(*_args):
            raise RuntimeError("Transmission failed")
        self.hass.services.hook = fail
        with self.assertRaises(self.error):
            await self.manager.async_send_state(DEVICE, settings())
        self.assertEqual(self.manager.model, before)
        self.assertEqual(self.hass.storage, stored)

    async def test_clear_signal_keeps_entity_but_removing_state_removes_own_function(self):
        await self.prepare()
        entity = get_function(self.manager.model)["entity"]
        candidate = self.manager.envelope()["model"]
        get_function(candidate)["signal_refs"] = {}
        await self.manager.async_save_model(candidate, self.manager.revision)
        self.assertEqual(get_function(self.manager.model)["entity"], entity)
        self.assertIsNone(get_studio(self.manager.model)["savedStates"][0]["signal"])
        with self.assertRaises(self.error):
            await self.manager.async_send_state(DEVICE, settings())
        self.assertEqual(self.hass.services.calls, [])
        candidate = self.manager.envelope()["model"]
        device = candidate["emitters"][0]["devices"][0]
        device["functions"] = []
        device["layout"]["rows"][0]["cells"] = [None, None]
        device["studio"]["savedStates"] = []
        await self.manager.async_save_model(candidate, self.manager.revision)
        self.assertIsNone(self.manager.find_function(FUNCTION))
        self.assertEqual(get_studio(self.manager.model)["savedStates"], [])
        self.assertIn("broadlink_device", self.hass.dr.entries)
        self.assertEqual(self.hass.services.calls, [])

    def add_sensor(self, entity_id, kind, value, unit, *, device="broadlink_device"):
        self.hass.er.entities[entity_id] = SimpleNamespace(
            id="registry-" + entity_id, entity_id=entity_id, device_id=device,
            platform="broadlink", disabled_by=None,
        )
        self.hass.states.values[entity_id] = SimpleNamespace(
            state=value, attributes={"device_class": kind, "unit_of_measurement": unit},
        )

    async def test_ambient_uses_only_public_available_sensors_of_same_hardware(self):
        self.add_sensor("sensor.ir_temperature", "temperature", "24.5", "°C")
        self.add_sensor("sensor.ir_humidity", "humidity", "57.56", "%")
        self.add_sensor("sensor.other_temperature", "temperature", "99", "°C", device="other")
        ambient = self.manager.catalog()[0]["ambient"]
        self.assertEqual(ambient["temperature"], {"entity_id": "sensor.ir_temperature", "state": 24.5, "unit": "°C"})
        self.assertEqual(ambient["humidity"]["state"], 57.56)
        self.hass.states.values["sensor.ir_temperature"].state = "unavailable"
        self.hass.states.values["sensor.ir_humidity"].state = "nan"
        self.assertEqual(self.manager.catalog()[0]["ambient"], {})
        self.assertEqual(self.hass.services.calls, [])

    async def test_ambient_changes_notify_panel_without_sending(self):
        self.add_sensor("sensor.ir_temperature", "temperature", "24.5", "°C")
        observed = []
        self.manager.async_add_listener(lambda: observed.append(self.manager.catalog()[0]["ambient"]))
        await self.manager.async_start()
        self.hass.states.values["sensor.ir_temperature"].state = "25"
        await self.hass.bus.async_fire("state_changed", {"entity_id": "sensor.ir_temperature"})
        self.assertEqual(observed[-1]["temperature"]["state"], 25)
        await self.manager.async_unload()
        self.assertEqual(self.hass.services.calls, [])


if __name__ == "__main__":
    unittest.main()
