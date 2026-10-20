"""Authenticated and validated WebSocket commands for the IR Pro panel."""

import logging

import probatio
from homeassistant.components import websocket_api

from .const import DOMAIN
from .errors import IRProError

_LOGGER = logging.getLogger(__name__)


async def _run(hass, connection, msg, operation, *, admin=True) -> None:
    if not connection.user or (admin and not connection.user.is_admin):
        connection.send_error(msg["id"], "permission_denied", "Solo los administradores pueden realizar esta operación.")
        return
    manager = hass.data.get(DOMAIN, {}).get("manager")
    if manager is None:
        connection.send_error(msg["id"], "not_loaded", "IR Pro no está cargado.")
        return
    try:
        result = await operation(manager)
    except IRProError as err:
        connection.send_error(msg["id"], err.code, err.message)
    except Exception:
        _LOGGER.exception("Unexpected IR Pro WebSocket error")
        connection.send_error(msg["id"], "unknown_error", "No se ha podido completar la operación.")
    else:
        connection.send_result(msg["id"], result)


@websocket_api.websocket_command({"type": "ir_pro/get"})
@websocket_api.async_response
async def ws_get(hass, connection, msg):
    async def get(manager):
        return manager.envelope()
    await _run(hass, connection, msg, get, admin=False)


@websocket_api.websocket_command({"type": "ir_pro/subscribe"})
@websocket_api.async_response
async def ws_subscribe(hass, connection, msg):
    async def subscribe(manager):
        connection.subscriptions[msg["id"]] = manager.async_add_listener(
            lambda: connection.send_event(msg["id"], manager.envelope())
        )
        return {"subscribed": True}
    await _run(hass, connection, msg, subscribe, admin=False)


@websocket_api.websocket_command({
    "type": "ir_pro/save", probatio.Required("model"): dict,
    probatio.Required("expected_revision"): int,
})
@websocket_api.async_response
async def ws_save(hass, connection, msg):
    await _run(hass, connection, msg, lambda m: m.async_save_model(msg["model"], msg["expected_revision"]))


@websocket_api.websocket_command({
    "type": "ir_pro/learn", probatio.Required("source_id"): str,
    probatio.Required("device_id"): str, probatio.Required("function_key"): str,
    probatio.Required("signal"): probatio.In(["press", "on", "off"]),
})
@websocket_api.async_response
async def ws_learn(hass, connection, msg):
    await _run(hass, connection, msg, lambda m: m.async_learn(msg["source_id"], msg["device_id"], msg["function_key"], msg["signal"]))


@websocket_api.websocket_command({
    "type": "ir_pro/test_signal", probatio.Required("signal_ref"): str,
})
@websocket_api.async_response
async def ws_test_signal(hass, connection, msg):
    await _run(hass, connection, msg, lambda m: m.async_test_signal(msg["signal_ref"]))


@websocket_api.websocket_command({
    "type": "ir_pro/confirm_signal", probatio.Required("signal_ref"): str,
})
@websocket_api.async_response
async def ws_confirm_signal(hass, connection, msg):
    await _run(hass, connection, msg, lambda m: m.async_confirm_signal(msg["signal_ref"]))


@websocket_api.websocket_command({
    "type": "ir_pro/press", probatio.Required("function_key"): str,
    probatio.Optional("on"): bool,
})
@websocket_api.async_response
async def ws_press(hass, connection, msg):
    await _run(hass, connection, msg, lambda m: m.async_press(msg["function_key"], desired=msg.get("on")))


@websocket_api.websocket_command({
    "type": "ir_pro/send_state", probatio.Required("device_id"): str,
    probatio.Required("state"): dict,
})
@websocket_api.async_response
async def ws_send_state(hass, connection, msg):
    await _run(hass, connection, msg, lambda m: m.async_send_state(msg["device_id"], msg["state"]))


@websocket_api.websocket_command({
    "type": "ir_pro/delete_saved_states", probatio.Required("device_id"): str,
    probatio.Required("expected_revision"): int,
})
@websocket_api.async_response
async def ws_delete_saved_states(hass, connection, msg):
    await _run(hass, connection, msg, lambda m: m.async_delete_saved_states(msg["device_id"], msg["expected_revision"]))


def async_register(hass) -> None:
    for command in (ws_get, ws_subscribe, ws_save, ws_learn, ws_test_signal, ws_confirm_signal, ws_press, ws_send_state, ws_delete_saved_states):
        websocket_api.async_register_command(hass, command)
