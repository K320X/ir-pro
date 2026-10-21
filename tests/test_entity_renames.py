"""Explicit entity-ID changes commit with the edited function, without sending IR."""

from copy import deepcopy
from types import SimpleNamespace
import unittest

from tests.ha_fakes import FakeHass, fake_ha_modules
from tests.helpers import DEVICE, FUNCTION, REF, backend_module, get_function, model_fixture, signal_fixture


def registered(function, key_suffix=""):
    return SimpleNamespace(id="registry-ir-pro" + key_suffix, entity_id=function["entity"],
                           device_id="virtual_" + DEVICE, platform="ir_pro", config_entry_id="ir_pro_entry",
                           unique_id=function["key"], disabled_by=None, hidden_by=None,
                           domain=function["type"], name=None)


class EntityRenameTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        with fake_ha_modules():
            module = backend_module("manager")
            cls.manager_class = module.IRProManager
            cls.error = module.IRProError

    async def prepare(self, kind="button", second=False):
        hass = FakeHass()
        manager = self.manager_class(hass, SimpleNamespace(entry_id="ir_pro_entry"))
        model = model_fixture()
        function = get_function(model)
        function.update(type=kind, entity=kind + ".original")
        if kind == "button":
            function["signal_refs"] = {"press": REF}
            manager.signals[REF] = signal_fixture(captured=True)
        else:
            function["signal_refs"] = {"on": "on-ref", "off": "off-ref"}
            manager.signals.update({"on-ref": signal_fixture(signal="on", captured=True),
                                    "off-ref": signal_fixture(signal="off", captured=True)})
        if second:
            duplicate = deepcopy(function)
            duplicate.update(key="second-function", name="Otra función", entity=kind + ".second")
            model["emitters"][0]["devices"][0]["functions"].append(duplicate)
            model["emitters"][0]["devices"][0]["layout"]["rows"][0]["cells"][1] = duplicate["key"]
        await manager.async_save_model(model, 0)
        for index, fn in enumerate(manager.model["emitters"][0]["devices"][0]["functions"]):
            entry = registered(fn, str(index))
            hass.er.entities[entry.entity_id] = entry
        return manager, hass

    async def test_rename_and_edit_commit_together_preserving_identity_signals_and_restart(self):
        for kind in ("button", "switch"):
            manager, hass = await self.prepare(kind)
            original = deepcopy(get_function(manager.model))
            records = deepcopy(manager.signals)
            candidate = manager.envelope()["model"]
            function = get_function(candidate)
            function.update(name="Nuevo nombre visible", entity=kind + ".renamed")
            old_revision = manager.revision
            result = await manager.async_save_model(candidate, old_revision, entity_renames={FUNCTION: function["entity"]})
            updated = get_function(result["model"])
            self.assertEqual(updated["key"], original["key"])
            self.assertEqual(updated["type"], original["type"])
            self.assertEqual(updated["signal_refs"], original["signal_refs"])
            self.assertEqual(updated["entity"], kind + ".renamed")
            self.assertEqual(updated["name"], "Nuevo nombre visible")
            self.assertEqual(manager.signals, records)
            self.assertEqual(manager.revision, old_revision + 1)
            self.assertNotIn(kind + ".original", hass.er.entities)
            self.assertEqual(hass.er.entities[kind + ".renamed"].unique_id, FUNCTION)
            self.assertEqual(hass.er.entities[kind + ".renamed"].id, "registry-ir-pro0")
            self.assertEqual(hass.services.calls, [])
            restored = self.manager_class(hass, SimpleNamespace(entry_id="ir_pro_entry"))
            await restored.async_load()
            self.assertEqual(get_function(restored.envelope()["model"])["entity"], kind + ".renamed")
            self.assertEqual(restored.signals, records)
            self.assertEqual(hass.services.calls, [])
            await restored.async_press(FUNCTION, **({"desired": True} if kind == "switch" else {}))
            self.assertEqual(len(hass.services.calls), 1)
            self.assertEqual(hass.services.calls[0][1], "send_command")

    async def test_without_allowlist_existing_id_remains_immutable(self):
        manager, hass = await self.prepare()
        before = deepcopy(manager.envelope())
        candidate = deepcopy(before["model"])
        get_function(candidate)["entity"] = "button.new_name"
        for renames in (None, {}):
            with self.subTest(renames=renames), self.assertRaises(self.error):
                await manager.async_save_model(candidate, manager.revision, entity_renames=renames)
        self.assertEqual(manager.envelope(), before)
        self.assertIn("button.original", hass.er.entities)
        self.assertEqual(hass.services.calls, [])

    async def test_invalid_domain_slug_collision_unknown_or_mismatched_allowlist_reject_before_changes(self):
        for target, supplied_key in (("switch.other", FUNCTION), ("button.Upper Case", FUNCTION),
                                     ("button.", FUNCTION), ("button.existing", FUNCTION),
                                     ("button.other", "unknown-function"), ("button.other", True)):
            with self.subTest(target=target, key=supplied_key):
                manager, hass = await self.prepare()
                hass.er.entities["button.existing"] = SimpleNamespace(entity_id="button.existing", platform="other",
                                                                      unique_id="foreign", config_entry_id="other")
                before = deepcopy(manager.envelope())
                stored = deepcopy(hass.storage)
                registry = deepcopy(hass.er.entities)
                candidate = deepcopy(before["model"])
                get_function(candidate)["entity"] = target
                with self.assertRaises(self.error):
                    await manager.async_save_model(candidate, manager.revision, entity_renames={supplied_key: target})
                self.assertEqual(manager.envelope(), before)
                self.assertEqual(hass.storage, stored)
                self.assertEqual(hass.er.entities, registry)
                self.assertEqual(hass.services.calls, [])
        manager, hass = await self.prepare()
        candidate = manager.envelope()["model"]
        get_function(candidate)["entity"] = "button.requested"
        with self.assertRaises(self.error):
            await manager.async_save_model(candidate, manager.revision, entity_renames={FUNCTION: "button.different"})
        get_function(candidate).update(type="switch", entity="switch.requested", signal_refs={})
        with self.assertRaises(self.error):
            await manager.async_save_model(candidate, manager.revision, entity_renames={FUNCTION: "switch.requested"})
        for malformed in ([], "button.other", False):
            with self.subTest(malformed=malformed), self.assertRaises(self.error):
                await manager.async_save_model(candidate, manager.revision, entity_renames=malformed)
        self.assertIn("button.original", hass.er.entities)

    async def test_stale_revision_and_invalid_other_edit_cannot_rename(self):
        manager, hass = await self.prepare()
        candidate = manager.envelope()["model"]
        get_function(candidate)["entity"] = "button.renamed"
        before = deepcopy(manager.envelope())
        with self.assertRaises(self.error) as caught:
            await manager.async_save_model(candidate, manager.revision - 1, entity_renames={FUNCTION: "button.renamed"})
        self.assertEqual(caught.exception.code, "revision_conflict")
        get_function(candidate)["color"] = "invalid"
        with self.assertRaises(self.error):
            await manager.async_save_model(candidate, manager.revision, entity_renames={FUNCTION: "button.renamed"})
        self.assertEqual(manager.envelope(), before)
        self.assertIn("button.original", hass.er.entities)
        self.assertNotIn("button.renamed", hass.er.entities)
        self.assertEqual(hass.services.calls, [])

    async def test_failed_store_restores_registry_model_and_signals(self):
        manager, hass = await self.prepare()
        before = deepcopy(manager.envelope())
        stored = deepcopy(hass.storage)
        registry = deepcopy(hass.er.entities)
        candidate = deepcopy(before["model"])
        get_function(candidate).update(entity="button.renamed", name="Must not survive")
        hass.fail_save = True
        with self.assertRaises(self.error):
            await manager.async_save_model(candidate, manager.revision, entity_renames={FUNCTION: "button.renamed"})
        self.assertEqual(manager.envelope(), before)
        self.assertEqual(hass.storage, stored)
        self.assertEqual(hass.er.entities, registry)
        self.assertFalse(manager._entity_rename_pending)
        self.assertEqual(hass.services.calls, [])

    async def test_partial_registry_failure_rolls_back_prior_rename_without_writing_store(self):
        manager, hass = await self.prepare(second=True)
        before = deepcopy(manager.envelope())
        stored = deepcopy(hass.storage)
        registry = deepcopy(hass.er.entities)
        candidate = deepcopy(before["model"])
        functions = candidate["emitters"][0]["devices"][0]["functions"]
        functions[0]["entity"] = "button.first_new"
        functions[1]["entity"] = "button.second_new"
        original_update = hass.er.async_update_entity

        def fail_second(entity, **kwargs):
            if kwargs.get("new_entity_id") == "button.second_new":
                raise ValueError("Registry failure")
            return original_update(entity, **kwargs)

        hass.er.async_update_entity = fail_second
        with self.assertRaises(self.error):
            await manager.async_save_model(candidate, manager.revision,
                                           entity_renames={FUNCTION: "button.first_new", "second-function": "button.second_new"})
        self.assertEqual(manager.envelope(), before)
        self.assertEqual(hass.storage, stored)
        self.assertEqual(hass.er.entities, registry)
        self.assertFalse(manager._entity_rename_pending)
        self.assertEqual(hass.services.calls, [])

    async def test_callback_read_during_persistence_never_adopts_provisional_registry_id(self):
        manager, hass = await self.prepare()
        before = deepcopy(manager.envelope())
        candidate = deepcopy(before["model"])
        get_function(candidate)["entity"] = "button.renamed"
        save = manager.store.async_save
        observed = []

        async def observe(data):
            observed.append((deepcopy(manager.envelope()), "button.renamed" in hass.er.entities))
            await save(data)

        manager.store.async_save = observe
        result = await manager.async_save_model(candidate, manager.revision, entity_renames={FUNCTION: "button.renamed"})
        self.assertEqual(observed, [(before, True)])
        self.assertEqual(get_function(result["model"])["entity"], "button.renamed")
        self.assertFalse(manager._entity_rename_pending)
        self.assertEqual(hass.services.calls, [])


if __name__ == "__main__":
    unittest.main()
