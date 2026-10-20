"""Authentication/authorization boundary tests, independent of HA schema parsing."""

from types import ModuleType, SimpleNamespace
import sys
import unittest
from unittest.mock import AsyncMock, Mock, patch

from tests.ha_fakes import fake_ha_modules
from tests.helpers import backend_module


class WebSocketTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        probatio = ModuleType("probatio")
        probatio.Required = lambda name: name
        probatio.Optional = lambda name: name
        probatio.In = lambda values: values
        with fake_ha_modules():
            api = ModuleType("homeassistant.components.websocket_api")
            api.websocket_command = lambda schema: lambda function: function
            api.async_response = lambda function: function
            with patch.dict(sys.modules, {"probatio": probatio, "homeassistant.components.websocket_api": api}):
                sys.modules["homeassistant.components"].websocket_api = api
                cls.websocket = backend_module("websocket")

    def setUp(self):
        self.manager = SimpleNamespace(
            envelope=Mock(return_value={"revision": 1}),
            async_save_model=AsyncMock(return_value={"revision": 2}),
            async_learn=AsyncMock(return_value={"signal_ref": "reference", "learned": True, "needs_test": False}),
            async_test_signal=AsyncMock(return_value={"status": "sent_unconfirmed"}),
            async_confirm_signal=AsyncMock(return_value={"verified": True}),
            async_press=AsyncMock(return_value={"status": "sent_unconfirmed"}),
            async_send_state=AsyncMock(return_value={"status": "sent_unconfirmed"}),
            async_delete_saved_states=AsyncMock(return_value={"revision": 2}),
            async_add_listener=Mock(return_value=Mock()),
        )
        self.hass = SimpleNamespace(data={"ir_pro": {"manager": self.manager}})

    @staticmethod
    def connection(*, authenticated=True, admin=False):
        return SimpleNamespace(
            user=SimpleNamespace(is_admin=admin) if authenticated else None,
            send_error=Mock(), send_result=Mock(), send_event=Mock(), subscriptions={},
        )

    def commands(self):
        return [
            (self.websocket.ws_save, {"model": {}, "expected_revision": 0}, "async_save_model"),
            (self.websocket.ws_learn, {"source_id": "source", "device_id": "device", "function_key": "function", "signal": "press"}, "async_learn"),
            (self.websocket.ws_test_signal, {"signal_ref": "reference"}, "async_test_signal"),
            (self.websocket.ws_confirm_signal, {"signal_ref": "reference"}, "async_confirm_signal"),
            (self.websocket.ws_press, {"function_key": "function"}, "async_press"),
            (self.websocket.ws_send_state, {"device_id": "device", "state": {"power": False}}, "async_send_state"),
            (self.websocket.ws_delete_saved_states, {"device_id": "device", "expected_revision": 1}, "async_delete_saved_states"),
        ]

    async def test_no_operation_is_available_without_authenticated_user(self):
        connection = self.connection(authenticated=False)
        await self.websocket.ws_get(self.hass, connection, {"id": 1})
        self.manager.envelope.assert_not_called()
        connection.send_error.assert_called_once()
        self.assertEqual(connection.send_error.call_args.args[1], "permission_denied")

    async def test_nonadmin_cannot_mutate_learn_confirm_or_send(self):
        for command, payload, manager_method in self.commands():
            with self.subTest(command=command.__name__):
                connection = self.connection(admin=False)
                await command(self.hass, connection, {"id": 5, **payload})
                getattr(self.manager, manager_method).assert_not_awaited()
                connection.send_result.assert_not_called()
                self.assertEqual(connection.send_error.call_args.args[1], "permission_denied")

    async def test_authenticated_nonadmin_can_read_without_hardware_calls(self):
        connection = self.connection()
        await self.websocket.ws_get(self.hass, connection, {"id": 9})
        self.manager.envelope.assert_called_once_with()
        connection.send_result.assert_called_once_with(9, {"revision": 1})
        for _, _, manager_method in self.commands():
            getattr(self.manager, manager_method).assert_not_awaited()

    async def test_authorized_commands_dispatch_once(self):
        for command, payload, manager_method in self.commands():
            with self.subTest(command=command.__name__):
                connection = self.connection(admin=True)
                await command(self.hass, connection, {"id": 4, **payload})
                getattr(self.manager, manager_method).assert_awaited_once()
                connection.send_error.assert_not_called()
                connection.send_result.assert_called_once()

    async def test_learn_returns_ready_capture_without_testing_or_confirming(self):
        connection = self.connection(admin=True)
        await self.websocket.ws_learn(self.hass, connection, {
            "id": 11, "source_id": "source", "device_id": "device",
            "function_key": "function", "signal": "press",
        })
        self.manager.async_learn.assert_awaited_once_with("source", "device", "function", "press")
        connection.send_result.assert_called_once_with(11, {
            "signal_ref": "reference", "learned": True, "needs_test": False,
        })
        self.manager.async_test_signal.assert_not_awaited()
        self.manager.async_confirm_signal.assert_not_awaited()
        self.manager.async_press.assert_not_awaited()

    async def test_explicit_double_action_passes_desired_state(self):
        connection = self.connection(admin=True)
        await self.websocket.ws_press(self.hass, connection, {"id": 12, "function_key": "function", "on": False})
        self.manager.async_press.assert_awaited_once_with("function", desired=False)

    async def test_bulk_state_deletion_passes_device_and_revision_without_hardware(self):
        connection = self.connection(admin=True)
        await self.websocket.ws_delete_saved_states(self.hass, connection, {"id": 14, "device_id": "device", "expected_revision": 7})
        self.manager.async_delete_saved_states.assert_awaited_once_with("device", 7)
        connection.send_result.assert_called_once_with(14, {"revision": 2})
        self.manager.async_press.assert_not_awaited()
        self.manager.async_send_state.assert_not_awaited()
        self.manager.async_learn.assert_not_awaited()

    async def test_full_state_send_forwards_optional_capture_scope(self):
        connection = self.connection(admin=True)
        fields = ["power", "mode", "temperature", "fan"]
        await self.websocket.ws_send_state(self.hass, connection, {
            "id": 15, "device_id": "device", "state": {"power": True}, "controlled_fields": fields,
        })
        self.manager.async_send_state.assert_awaited_once_with("device", {"power": True}, controlled_fields=fields)

    async def test_authenticated_subscription_only_reads_and_can_unsubscribe(self):
        connection = self.connection()
        await self.websocket.ws_subscribe(self.hass, connection, {"id": 13})
        self.manager.async_add_listener.assert_called_once()
        connection.send_result.assert_called_once_with(13, {"subscribed": True})
        listener = self.manager.async_add_listener.call_args.args[0]
        listener()
        connection.send_event.assert_called_once_with(13, {"revision": 1})
        connection.subscriptions[13]()
        self.manager.async_add_listener.return_value.assert_called_once()
        self.manager.async_press.assert_not_awaited()
        self.manager.async_send_state.assert_not_awaited()

    async def test_anonymous_cannot_subscribe(self):
        connection = self.connection(authenticated=False)
        await self.websocket.ws_subscribe(self.hass, connection, {"id": 13})
        self.manager.async_add_listener.assert_not_called()
        connection.send_error.assert_called_once()

    async def test_not_loaded_has_explicit_error_and_does_not_call_manager(self):
        connection = self.connection(admin=True)
        await self.websocket.ws_save(SimpleNamespace(data={}), connection, {"id": 1, "model": {}, "expected_revision": 0})
        self.manager.async_save_model.assert_not_awaited()
        self.assertEqual(connection.send_error.call_args.args[1], "not_loaded")

    async def test_domain_error_preserves_safe_code_and_message(self):
        self.manager.async_save_model.side_effect = self.websocket.IRProError("revision_conflict", "Recarga antes de guardar.")
        connection = self.connection(admin=True)
        await self.websocket.ws_save(self.hass, connection, {"id": 2, "model": {}, "expected_revision": 0})
        connection.send_error.assert_called_once_with(2, "revision_conflict", "Recarga antes de guardar.")
        connection.send_result.assert_not_called()


if __name__ == "__main__":
    unittest.main()
