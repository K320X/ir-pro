"""Small explicit HA boundary fakes, not a substitute for an HA runtime test."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from enum import IntFlag
import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

from tests.helpers import SOURCE


def fake_callback(function):
    """Mark synchronous functions that HA must dispatch on its event loop."""
    function._fake_hass_callback = True
    return function


class FakeBus:
    """Model HA's callback-versus-executor dispatch, including unsubscription."""

    def __init__(self):
        self.listeners = {}

    def async_listen(self, event_type, listener):
        listeners = self.listeners.setdefault(event_type, [])
        listeners.append(listener)

        def unsubscribe():
            listeners.remove(listener)

        return unsubscribe

    async def async_fire(self, event_type, data=None):
        event = SimpleNamespace(event_type=event_type, data=data or {})
        for listener in tuple(self.listeners.get(event_type, [])):
            if getattr(listener, "_fake_hass_callback", False):
                listener(event)
            else:
                # A plain synchronous listener is a worker job in HA. This
                # distinction catches async entity writes from the wrong thread.
                await asyncio.to_thread(listener, event)


class FakeStore:
    def __class_getitem__(cls, _item):
        return cls

    def __init__(self, hass, version, key, *args, **kwargs):
        self.hass = hass
        self.key = key
        self.version = version

    async def async_load(self):
        return deepcopy(self.hass.storage.get(self.key))

    async def async_save(self, data):
        if self.hass.fail_save:
            self.hass.fail_save = False
            raise OSError("Simulated storage failure")
        self.hass.storage[self.key] = deepcopy(data)
        self.hass.saved.append(deepcopy(data))


class FakeEntityRegistry:
    def __init__(self):
        source = SimpleNamespace(
            id=SOURCE, entity_id="remote.ir_salon", device_id="broadlink_device",
            platform="broadlink", config_entry_id="broadlink_entry",
            disabled_by=None, name="IR salón", original_name="IR salón",
            unique_id="1cd1d7a40fb6", domain="remote",
        )
        self.entities = {source.entity_id: source}
        self.removed = []

    def async_get(self, entity_id):
        return self.entities.get(entity_id) or next(
            (row for row in self.entities.values() if row.id == entity_id), None
        )

    def async_get_entity_id(self, domain, platform, unique_id):
        return next((
            row.entity_id for row in self.entities.values()
            if row.entity_id.startswith(domain + ".")
            and row.platform == platform and row.unique_id == unique_id
        ), None)

    def async_remove(self, entity_id):
        self.removed.append(entity_id)
        self.entities.pop(entity_id, None)

    def async_update_entity(self, entity_id, **kwargs):
        entry = self.entities[entity_id]
        new_entity_id = kwargs.pop("new_entity_id", None)
        if new_entity_id:
            self.entities.pop(entity_id)
            entry.entity_id = new_entity_id
            self.entities[new_entity_id] = entry
        for key, value in kwargs.items():
            setattr(entry, key, value)
        return entry


class FakeDeviceRegistry:
    def __init__(self):
        self.entries = {
            "broadlink_device": SimpleNamespace(
                id="broadlink_device", model="RM4 mini", name="IR salón",
                name_by_user=None, identifiers={("broadlink", "1cd1d7a40fb6")},
                connections={("mac", "1c:d1:d7:a4:0f:b6")},
                config_entry_id="broadlink_entry",
            )
        }
        self.removed = []

    @property
    def devices(self):
        return list(self.entries.values())

    def async_get(self, device_id):
        return self.entries.get(device_id)

    def async_remove_device(self, device_id):
        self.removed.append(device_id)
        self.entries.pop(device_id, None)

    def async_remove(self, device_id):
        self.async_remove_device(device_id)

    def async_get_or_create(self, **kwargs):
        existing = next((
            device for device in self.entries.values()
            if device.identifiers == kwargs["identifiers"]
        ), None)
        if existing is None:
            device_id = "virtual_" + next(iter(kwargs["identifiers"]))[1]
            existing = SimpleNamespace(id=device_id, connections=set(), **kwargs)
            self.entries[device_id] = existing
        else:
            for key, value in kwargs.items():
                setattr(existing, key, value)
        return existing


class FakeServices:
    def __init__(self):
        self.calls = []
        self.hook = None

    def has_service(self, domain, service):
        return domain == "remote" and service in {"learn_command", "send_command", "delete_command"}

    async def async_call(self, domain, service, service_data=None, blocking=False, **kwargs):
        self.calls.append((domain, service, deepcopy(service_data), blocking, kwargs))
        if self.hook:
            return await self.hook(domain, service, service_data)
        return None


class FakeStates:
    def __init__(self):
        self.values = {
            "remote.ir_salon": SimpleNamespace(
                state="on", name="IR salón",
                attributes={"friendly_name": "IR salón", "supported_features": 3},
            )
        }

    def get(self, entity_id):
        return self.values.get(entity_id)


class FakeHass:
    def __init__(self):
        self.data = {}
        self.storage = {}
        self.saved = []
        self.fail_save = False
        self.er = FakeEntityRegistry()
        self.dr = FakeDeviceRegistry()
        self.services = FakeServices()
        self.states = FakeStates()
        self.bus = FakeBus()
        self.dispatched = []


def fake_ha_modules():
    """Patch only the named import boundaries consumed by manager/entity code."""
    modules = {}
    names = [
        "homeassistant", "homeassistant.components", "homeassistant.components.remote",
        "homeassistant.core", "homeassistant.config_entries", "homeassistant.const",
        "homeassistant.exceptions", "homeassistant.helpers",
        "homeassistant.helpers.device_registry", "homeassistant.helpers.entity_registry",
        "homeassistant.helpers.dispatcher", "homeassistant.helpers.event",
        "homeassistant.helpers.storage",
    ]
    for name in names:
        module = ModuleType(name)
        module.__path__ = []
        modules[name] = module
    for name, module in modules.items():
        if "." in name:
            parent, member = name.rsplit(".", 1)
            setattr(modules[parent], member, module)

    class RemoteEntityFeature(IntFlag):
        LEARN_COMMAND = 1
        DELETE_COMMAND = 2

    modules["homeassistant.components.remote"].RemoteEntityFeature = RemoteEntityFeature
    modules["homeassistant.core"].HomeAssistant = FakeHass
    modules["homeassistant.core"].callback = fake_callback
    modules["homeassistant.config_entries"].ConfigEntry = SimpleNamespace
    modules["homeassistant.const"].STATE_UNAVAILABLE = "unavailable"
    modules["homeassistant.const"].STATE_UNKNOWN = "unknown"
    modules["homeassistant.const"].STATE_OFF = "off"
    modules["homeassistant.const"].STATE_ON = "on"
    modules["homeassistant.const"].EVENT_STATE_CHANGED = "state_changed"
    modules["homeassistant.exceptions"].HomeAssistantError = RuntimeError
    modules["homeassistant.exceptions"].ServiceValidationError = RuntimeError
    modules["homeassistant.helpers.storage"].Store = FakeStore
    modules["homeassistant.helpers.entity_registry"].async_get = lambda hass: hass.er
    modules["homeassistant.helpers.entity_registry"].async_entries_for_config_entry = (
        lambda registry, entry_id: [row for row in registry.entities.values() if row.config_entry_id == entry_id]
    )
    modules["homeassistant.helpers.device_registry"].async_get = lambda hass: hass.dr
    modules["homeassistant.helpers.device_registry"].async_entries_for_config_entry = (
        lambda registry, entry_id: [row for row in registry.entries.values() if row.config_entry_id == entry_id]
    )
    modules["homeassistant.helpers.dispatcher"].async_dispatcher_send = (
        lambda hass, *args: hass.dispatched.append(args)
    )
    modules["homeassistant.helpers.event"].async_track_state_change_event = lambda *args, **kwargs: lambda: None
    return patch.dict(sys.modules, modules)
