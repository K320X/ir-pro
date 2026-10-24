"""Language boundaries preserve data, authorization and native HA exceptions."""

import ast
from copy import deepcopy
import json
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

from tests.ha_fakes import fake_ha_modules
from tests.helpers import DOMAIN_PATH, backend_module, model_fixture
from tests import test_websocket


class LocalizationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.locale = backend_module("localization")
        cls.error = backend_module("errors").IRProError

    def test_language_regions_and_unsupported_language_fallback(self):
        for language in ("es", "ES", "es-ES", "es_MX"):
            self.assertEqual(self.locale.normalize_language(language), "es")
        for language in ("en", "en-GB", "fr", "ca", "", None, [], {"es": True}):
            self.assertEqual(self.locale.normalize_language(language), "en")

    def test_native_catalogs_match_every_runtime_message(self):
        catalogs = {
            language: json.loads((DOMAIN_PATH / "translations" / f"{language}.json").read_text(encoding="utf-8"))
            for language in ("en", "es")
        }
        source = json.loads((DOMAIN_PATH / "strings.json").read_text(encoding="utf-8"))
        self.assertEqual(source, catalogs["en"])
        keys = [key for key, _, _ in self.locale.MESSAGES]
        spanish = [message for _, message, _ in self.locale.MESSAGES]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertEqual(len(spanish), len(set(spanish)))
        for key, es, en in self.locale.MESSAGES:
            with self.subTest(key=key):
                self.assertEqual(catalogs["es"]["exceptions"][key]["message"], es)
                self.assertEqual(catalogs["en"]["exceptions"][key]["message"], en)
                error = self.error("invalid_model", es)
                self.assertEqual(error.translation_key, key)
                self.assertEqual(error.message, es)
                self.assertEqual(str(error), es)
                self.assertEqual(error.localized_message("en-US"), en)
                self.assertEqual(error.localized_message("es-MX"), es)

    def test_current_validation_literals_and_controlled_labels_have_translations(self):
        """A new diagnostic must not silently degrade to a generic EN error."""
        messages = set()
        for filename in ("manager.py", "validation.py", "studio.py"):
            tree = ast.parse((DOMAIN_PATH / filename).read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                name = getattr(node.func, "id", "")
                index = 1 if name == "IRProError" else 0 if name == "_fail" else None
                if index is not None and len(node.args) > index:
                    arg = node.args[index]
                    if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                        messages.add(arg.value)
                index = 1 if name in ("_text", "_boolean") else 3 if name == "_integer" else None
                if index is not None and len(node.args) > index:
                    label = node.args[index]
                    if isinstance(label, ast.Constant) and isinstance(label.value, str):
                        messages.add(f"{label.value} no es válido.")
        known = {message for _, message, _ in self.locale.MESSAGES}
        self.assertEqual(messages - known, set())

    def test_unknown_english_diagnostic_never_exposes_raw_spanish_or_provider_data(self):
        error = self.error("command_failed", "Fallo nuevo: payload privado y credenciales")
        self.assertEqual(error.localized_message("en"), "Unable to complete the operation.")
        self.assertEqual(error.translation_key, "operation_failed")
        self.assertEqual(error.code, "command_failed")

    def test_only_notice_presentation_changes_and_entity_ids_stay_exact(self):
        result = {"model": model_fixture(), "revision": 2, "notices": [
            "La entidad ya existía. Se ha usado button.ir_salon_split_salon_encender_2.",
            "El mando se ha copiado a otro emisor. Aprende de nuevo sus señales.",
        ]}
        before = deepcopy(result)
        translated = self.locale.localize_result(result, "en")
        self.assertEqual(translated["notices"], [
            "The entity already existed. Used button.ir_salon_split_salon_encender_2.",
            "The remote was copied to another transmitter. Learn its signals again.",
        ])
        self.assertEqual(translated["model"], before["model"])
        self.assertIs(translated["model"], result["model"])
        self.assertEqual(result, before)
        self.assertIs(self.locale.localize_result(result, "es"), result)
        self.assertEqual(translated["model"]["emitters"][0]["name"], "IR salón")
        self.assertEqual(translated["model"]["emitters"][0]["devices"][0]["functions"][0]["name"], "Encender")


class WebSocketLocalizationTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        test_websocket.WebSocketTests.setUpClass()
        cls.websocket = test_websocket.WebSocketTests.websocket

    def setUp(self):
        self.manager = SimpleNamespace(envelope=Mock(return_value={"model": model_fixture()}))
        self.hass = SimpleNamespace(data={"ir_pro": {"manager": self.manager}})
        self.connection = test_websocket.WebSocketTests.connection

    async def test_requested_language_is_per_request_not_shared_manager_state(self):
        operation = AsyncMock(side_effect=self.websocket.IRProError(
            "busy", "El emisor está ocupado. Espera a que termine la operación."
        ))
        for language, expected in (("es", "El emisor está ocupado. Espera a que termine la operación."),
                                   ("en", "The transmitter is busy. Wait for the operation to finish."),
                                   ("es-MX", "El emisor está ocupado. Espera a que termine la operación."),
                                   ("fr", "The transmitter is busy. Wait for the operation to finish.")):
            with self.subTest(language=language):
                connection = self.connection(admin=True)
                await self.websocket._run(self.hass, connection, {"id": 1, "language": language}, operation)
                connection.send_error.assert_called_once_with(1, "busy", expected)
        self.assertEqual(vars(self.manager), {"envelope": self.manager.envelope})

    async def test_absent_language_defaults_english_even_on_spanish_installation(self):
        self.hass.config = SimpleNamespace(language="es")
        connection = self.connection(admin=False)
        operation = AsyncMock()
        await self.websocket._run(self.hass, connection, {"id": 2}, operation)
        connection.send_error.assert_called_once_with(2, "permission_denied", "Only administrators can perform this operation.")
        operation.assert_not_awaited()

    async def test_language_does_not_bypass_permission_or_not_loaded_guards(self):
        for language in ("es", "en"):
            connection = self.connection(authenticated=False)
            operation = AsyncMock()
            await self.websocket._run(self.hass, connection, {"id": 3, "language": language}, operation)
            self.assertEqual(connection.send_error.call_args.args[1], "permission_denied")
            operation.assert_not_awaited()
            connection = self.connection(admin=True)
            await self.websocket._run(SimpleNamespace(data={}), connection, {"id": 4, "language": language}, operation)
            self.assertEqual(connection.send_error.call_args.args[1], "not_loaded")
            operation.assert_not_awaited()

    async def test_unknown_errors_are_localized_without_leaking_raw_provider_error(self):
        operation = AsyncMock(side_effect=RuntimeError("Proveedor secreto"))
        for language, message in (("en", "Unable to complete the operation."), ("es", "No se ha podido completar la operación.")):
            connection = self.connection(admin=True)
            with self.assertLogs(self.websocket._LOGGER, level="ERROR"):
                await self.websocket._run(self.hass, connection, {"id": 5, "language": language}, operation)
            connection.send_error.assert_called_once_with(5, "unknown_error", message)

    async def test_command_metadata_never_reaches_manager_arguments(self):
        self.manager.async_press = AsyncMock(return_value={"status": "sent_unconfirmed"})
        connection = self.connection(admin=True)
        await self.websocket.ws_press(self.hass, connection, {"id": 6, "language": "en", "function_key": "unchanged-id", "on": False})
        self.manager.async_press.assert_awaited_once_with("unchanged-id", desired=False)

    async def test_english_success_notices_do_not_modify_returned_model(self):
        result = {"model": model_fixture(), "notices": ["La entidad ya existía. Se ha usado button.existing_2."]}
        before = deepcopy(result)
        connection = self.connection(admin=True)
        await self.websocket._run(self.hass, connection, {"id": 7, "language": "en"}, AsyncMock(return_value=result))
        presented = connection.send_result.call_args.args[1]
        self.assertEqual(presented["model"], before["model"])
        self.assertEqual(presented["notices"], ["The entity already existed. Used button.existing_2."])
        self.assertEqual(result, before)


class NativeEntityLocalizationTests(unittest.IsolatedAsyncioTestCase):
    async def test_button_and_switch_exceptions_use_native_ha_translation_keys(self):
        button_api = ModuleType("homeassistant.components.button")
        switch_api = ModuleType("homeassistant.components.switch")
        entity_api = ModuleType("homeassistant.helpers.entity")
        button_api.ButtonEntity = type("ButtonEntity", (), {})
        switch_api.SwitchEntity = type("SwitchEntity", (), {})
        entity_api.Entity = type("Entity", (), {})
        entity_api.DeviceInfo = dict

        class NativeError(Exception):
            def __init__(self, *, translation_domain, translation_key):
                self.translation_domain = translation_domain
                self.translation_key = translation_key

        with fake_ha_modules(), patch.dict(sys.modules, {
            "homeassistant.components.button": button_api,
            "homeassistant.components.switch": switch_api,
            "homeassistant.helpers.entity": entity_api,
        }):
            button_module, switch_module = backend_module("button"), backend_module("switch")
        error = backend_module("errors").IRProError("busy", "El emisor está ocupado. Espera a que termine la operación.")
        manager = SimpleNamespace(async_press=AsyncMock(side_effect=error), find_function=Mock(return_value=None))
        for module, entity_type, method in ((button_module, button_module.IRProButton, "async_press"),
                                            (switch_module, switch_module.IRProSwitch, "async_turn_on"),
                                            (switch_module, switch_module.IRProSwitch, "async_turn_off")):
            with self.subTest(method=method), patch.object(module, "HomeAssistantError", NativeError):
                entity = entity_type(manager, "stable-function-key")
                with self.assertRaises(NativeError) as raised:
                    await getattr(entity, method)()
                self.assertEqual(raised.exception.translation_domain, "ir_pro")
                self.assertEqual(raised.exception.translation_key, "source_busy")
                self.assertIs(raised.exception.__cause__, error)


if __name__ == "__main__":
    unittest.main()
