"""IR Pro's durable state, Broadlink adapter and real command execution."""

import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
import logging
import time
from typing import Any, Callable
from uuid import UUID, uuid4

from homeassistant.const import EVENT_STATE_CHANGED, STATE_ON
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.storage import Store

from .const import DOMAIN, EMPTY_MODEL, LEARN_TIMEOUT, STORAGE_KEY, STORAGE_VERSION, VERSION
from .errors import IRProError
from .validation import signal_is_learned, validate_model

_LOGGER = logging.getLogger(__name__)


class IRProManager:
    """One manager, one Store and immutable identities for a HA instance."""

    def __init__(self, hass, entry) -> None:
        self.hass = hass
        self.entry = entry
        self.store = Store(hass, STORAGE_VERSION, STORAGE_KEY, atomic_writes=True)
        self.model = deepcopy(EMPTY_MODEL)
        self.revision = 0
        self.signals: dict[str, dict] = {}
        self._lock = asyncio.Lock()
        self._entity_lock = asyncio.Lock()
        self._source_locks: dict[str, asyncio.Lock] = {}
        self._cooldowns: dict[str, float] = {}
        self._listeners: set[Callable] = set()
        self._platforms: dict[str, tuple[Callable, Callable]] = {}
        self._entities: dict[str, Any] = {}
        self._unsubs: list[Callable] = []
        self._operations: set[asyncio.Task] = set()
        self._closing = False

    @property
    def registry(self):
        return er.async_get(self.hass)

    def catalog(self) -> list[dict]:
        """Enumerate existing supported entities. Never create/add an emitter."""
        result = []
        device_registry = dr.async_get(self.hass)
        for source in self.registry.entities.values():
            if source.platform != "broadlink" or not source.entity_id.startswith("remote."):
                continue
            state = self.hass.states.get(source.entity_id)
            device = device_registry.async_get(source.device_id) if source.device_id else None
            result.append({
                "id": source.id, "entity_id": source.entity_id, "device_id": source.device_id,
                "name": (state.name if state else None) or source.name or source.original_name or source.entity_id,
                "model": (device.model if device else None) or "Broadlink",
                "available": bool(state and state.state == STATE_ON and not source.disabled_by),
                "canLearn": bool(state and int(state.attributes.get("supported_features", 0)) & 1),
            })
        return sorted(result, key=lambda item: (item["name"].casefold(), item["id"]))

    def _refresh_entity_ids(self) -> None:
        """Respect renames made in HA's entity registry."""
        for emitter in self.model["emitters"]:
            for device in emitter["devices"]:
                for function in device["functions"]:
                    entity_id = self.registry.async_get_entity_id(function["type"], DOMAIN, function["key"])
                    if entity_id:
                        function["entity"] = entity_id

    def envelope(self, notices: list[str] | None = None) -> dict:
        self._refresh_entity_ids()
        for emitter in self.model["emitters"]:
            for device in emitter["devices"]:
                for function in device["functions"]:
                    function["signals"] = {
                        signal: self._learned_reference(function, emitter["sourceId"], signal)
                        for signal in function["signal_refs"]
                    }
        response = {
            "model": deepcopy(self.model), "revision": self.revision,
            "catalog": self.catalog(), "version": VERSION,
        }
        if notices:
            response["notices"] = notices
        return response

    async def async_load(self) -> None:
        """Load only our own storage, starting entirely empty on first setup."""
        stored = await self.store.async_load()
        if stored is None:
            return
        if not isinstance(stored, dict) or not isinstance(stored.get("signals", {}), dict):
            raise IRProError("storage_error", "La configuración guardada de IR Pro no es válida.")
        records = stored.get("signals", {})
        for reference, record in records.items():
            if not isinstance(reference, str) or not isinstance(record, dict) or not all(
                isinstance(record.get(field), str)
                for field in ("source_id", "device_id", "function_key", "signal", "device", "command")
            ) or record["signal"] not in ("press", "on", "off"):
                raise IRProError("storage_error", "Hay una referencia de señal guardada no válida.")
            record["tested"] = record.get("tested") is True
            record["verified"] = record.get("verified") is True
            record["captured"] = record.get("captured") is True
        incoming = stored.get("model", EMPTY_MODEL)
        if not isinstance(incoming, dict) or type(stored.get("revision", 0)) is not int:
            raise IRProError("storage_error", "La configuración guardada de IR Pro no es válida.")
        known = {e["sourceId"] for e in incoming.get("emitters", []) if isinstance(e, dict) and isinstance(e.get("sourceId"), str)}
        self.model, _ = validate_model(incoming, EMPTY_MODEL, known, records, set())
        self.signals = deepcopy(records)
        self.revision = max(0, int(stored.get("revision", 0)))
        # No device acknowledgement exists. A restart must never imply it is on.
        for emitter in self.model["emitters"]:
            for device in emitter["devices"]:
                for function in device["functions"]:
                    function["on"] = None

    async def _write(self, model: dict, records: dict, revision: int) -> None:
        try:
            await self.store.async_save({
                "model": deepcopy(model), "signals": deepcopy(records), "revision": revision,
            })
        except Exception as err:
            raise IRProError("storage_error", "No se ha podido guardar la configuración.") from err

    def _find_device(self, device_id: str):
        for emitter in self.model["emitters"]:
            for device in emitter["devices"]:
                if device["id"] == device_id:
                    return emitter, device
        raise IRProError("invalid_model", "El dispositivo ya no existe.")

    def find_function(self, key: str):
        for emitter in self.model["emitters"]:
            for device in emitter["devices"]:
                for function in device["functions"]:
                    if function["key"] == key:
                        return emitter, device, function
        return None

    def _source(self, source_id: str):
        source = self.registry.async_get(source_id)
        if not source or source.platform != "broadlink" or not source.entity_id.startswith("remote."):
            raise IRProError("source_unavailable", "El emisor ya no está disponible en Home Assistant.")
        state = self.hass.states.get(source.entity_id)
        if source.disabled_by or not state or state.state != STATE_ON:
            raise IRProError("source_unavailable", "El emisor está desconectado o desactivado.")
        return source, state

    def function_available(self, key: str) -> bool:
        found = self.find_function(key)
        if not found:
            return False
        emitter, _, function = found
        try:
            self._source(emitter["sourceId"])
        except IRProError:
            return False
        required = ("press",) if function["type"] == "button" else ("on", "off")
        return all(self._learned_reference(function, emitter["sourceId"], signal) for signal in required)

    def _learned_reference(self, function: dict, source_id: str, signal: str) -> bool:
        record = self.signals.get(function.get("signal_refs", {}).get(signal, ""))
        return bool(record and record["source_id"] == source_id and record["signal"] == signal and signal_is_learned(record))

    def _notify(self) -> None:
        for listener in tuple(self._listeners):
            try:
                listener()
            except Exception:
                _LOGGER.exception("Unable to update an IR Pro entity")

    def async_add_listener(self, listener: Callable) -> Callable:
        self._listeners.add(listener)
        return lambda: self._listeners.discard(listener)

    async def async_start(self) -> None:
        """Refresh entity availability on HA state/registry changes."""
        def changed(event) -> None:
            if event.event_type == EVENT_STATE_CHANGED:
                entity_id = event.data.get("entity_id", "")
                if not entity_id.startswith("remote."):
                    return
            self._notify()
        self._unsubs.append(self.hass.bus.async_listen(EVENT_STATE_CHANGED, changed))
        self._unsubs.append(self.hass.bus.async_listen("entity_registry_updated", changed))

    async def async_save_model(self, candidate: dict, expected_revision: int) -> dict:
        async with self._lock:
            if self._closing:
                raise IRProError("source_unavailable", "IR Pro se está recargando.")
            if type(expected_revision) is not int or expected_revision != self.revision:
                raise IRProError("revision_conflict", "La configuración ha cambiado en otra ventana. Recarga antes de guardar.")
            self._refresh_entity_ids()
            model, notices = validate_model(
                candidate, self.model, {source["id"] for source in self.catalog()},
                self.signals, set(self.registry.entities),
            )
            # Old drafts are never a source of trusted signals or estimated state.
            referenced = {ref for e in model["emitters"] for d in e["devices"] for f in d["functions"] for ref in f["signal_refs"].values()}
            old_keys = {f["key"] for e in self.model["emitters"] for d in e["devices"] for f in d["functions"]}
            new_keys = {f["key"] for e in model["emitters"] for d in e["devices"] for f in d["functions"]}
            new_devices = {d["id"] for e in model["emitters"] for d in e["devices"]}
            records = {
                ref: deepcopy(record) for ref, record in self.signals.items()
                if ref in referenced or (
                    record["device_id"] in new_devices
                    and record["function_key"] not in old_keys - new_keys
                    and time.time() - record.get("created", 0) < 86400
                )
            }
            revision = self.revision + 1
            await self._write(model, records, revision)
            self.model, self.signals, self.revision = model, records, revision
            await self.async_sync_entities()
            self._notify()
            return self.envelope(notices)

    async def _remote_call(self, source_id: str, service: str, record: dict, *, validate_only: bool = False) -> None:
        source, _ = self._source(source_id)
        data = {"entity_id": source.entity_id, "device": record["device"], "command": record["command"]}
        if service == "learn_command":
            data["command_type"] = "ir"
        if validate_only:
            # Broadlink validates the stored code before its repeat loop. Zero
            # repetitions checks capture without sending data to the hardware.
            data["num_repeats"] = 0
        try:
            await asyncio.wait_for(
                self.hass.services.async_call("remote", service, data, blocking=True),
                timeout=LEARN_TIMEOUT,
            )
        except asyncio.TimeoutError as err:
            self._cooldowns[source_id] = time.monotonic() + 35
            raise IRProError("learn_failed" if service == "learn_command" or validate_only else "command_failed", "El emisor no ha respondido a tiempo. Espera unos segundos y vuelve a intentarlo.") from err
        except Exception as err:
            _LOGGER.debug("Broadlink %s failed", service, exc_info=True)
            message = "No se ha capturado una señal válida. Vuelve a aprenderla." if validate_only else "No se ha podido completar la operación con el emisor."
            raise IRProError("learn_failed" if service == "learn_command" or validate_only else "command_failed", message) from err

    def _operation_lock(self, source_id: str) -> asyncio.Lock:
        if self._closing:
            raise IRProError("source_unavailable", "IR Pro se está recargando.")
        lock = self._source_locks.setdefault(source_id, asyncio.Lock())
        if lock.locked() or time.monotonic() < self._cooldowns.get(source_id, 0):
            raise IRProError("busy", "El emisor está ocupado. Espera a que termine la operación.")
        return lock

    @asynccontextmanager
    async def _tracked_operation(self, source_id: str):
        async with self._operation_lock(source_id):
            task = asyncio.current_task()
            self._operations.add(task)
            try:
                yield
            finally:
                self._operations.discard(task)

    async def async_learn(self, source_id: str, device_id: str, function_key: str, signal: str) -> dict:
        emitter, _ = self._find_device(device_id)
        if emitter["sourceId"] != source_id or signal not in ("press", "on", "off"):
            raise IRProError("invalid_signal", "El dispositivo y la señal no corresponden al emisor.")
        found = self.find_function(function_key)
        if found:
            if found[1]["id"] != device_id or signal not in (("press",) if found[2]["type"] == "button" else ("on", "off")):
                raise IRProError("invalid_signal", "La señal no corresponde a esta función.")
        else:
            try:
                UUID(function_key)
            except (ValueError, TypeError, AttributeError) as err:
                raise IRProError("invalid_signal", "La función nueva necesita un identificador válido.") from err
        _, state = self._source(source_id)
        if not int(state.attributes.get("supported_features", 0)) & 1:
            raise IRProError("invalid_signal", "Este emisor no permite aprender señales.")
        lock = self._operation_lock(source_id)
        async with lock:
            task = asyncio.current_task()
            self._operations.add(task)
            reference = uuid4().hex
            record = {
                "source_id": source_id, "device_id": device_id, "function_key": function_key,
                "signal": signal, "device": "ir_pro_" + device_id,
                "command": "ir_pro_" + uuid4().hex, "captured": False,
                "tested": False, "verified": False,
                "created": time.time(),
            }
            try:
                await self._remote_call(source_id, "learn_command", record)
                # The native learning service can swallow capture timeouts.
                # Validate the unique new command through its public service.
                await self._remote_call(source_id, "send_command", record, validate_only=True)
                self._source(source_id)
                record["captured"] = True
                async with self._lock:
                    current_emitter, _ = self._find_device(device_id)
                    if current_emitter["sourceId"] != source_id:
                        raise IRProError("invalid_signal", "El dispositivo ha cambiado durante el aprendizaje.")
                    records = deepcopy(self.signals)
                    records[reference] = record
                    await self._write(self.model, records, self.revision)
                    self.signals = records
                return {"signal_ref": reference, "learned": True, "needs_test": False}
            finally:
                self._operations.discard(task)

    def _record(self, reference: str) -> dict:
        if not isinstance(reference, str) or reference not in self.signals:
            raise IRProError("invalid_signal", "La señal no existe. Aprende la señal de nuevo.")
        return deepcopy(self.signals[reference])

    async def async_test_signal(self, signal_ref: str) -> dict:
        record = self._record(signal_ref)
        async with self._tracked_operation(record["source_id"]):
            await self._remote_call(record["source_id"], "send_command", record)
            async with self._lock:
                current = self._record(signal_ref)
                current["tested"] = True
                records = deepcopy(self.signals)
                records[signal_ref] = current
                await self._write(self.model, records, self.revision)
                self.signals = records
            return {"status": "sent_unconfirmed"}

    async def async_confirm_signal(self, signal_ref: str) -> dict:
        async with self._lock:
            if self._closing:
                raise IRProError("source_unavailable", "IR Pro se está recargando.")
            record = self._record(signal_ref)
            if not record.get("tested"):
                raise IRProError("invalid_signal", "Prueba primero la señal y confirma que el aparato ha respondido.")
            record["verified"] = True
            records = deepcopy(self.signals)
            records[signal_ref] = record
            await self._write(self.model, records, self.revision)
            self.signals = records
            self._notify()
            return {"verified": True}

    async def async_press(self, function_key: str, desired: bool | None = None) -> dict:
        found = self.find_function(function_key)
        if not found or not self.function_available(function_key):
            raise IRProError("invalid_signal", "La función no está disponible o necesita aprender sus señales.")
        emitter, _, function = found
        async with self._tracked_operation(emitter["sourceId"]):
            # Re-read after acquiring the lock; a save may have deleted it.
            found = self.find_function(function_key)
            if not found or not self.function_available(function_key):
                raise IRProError("invalid_signal", "La función ya no está disponible.")
            emitter, _, function = found
            next_state = (not function.get("on")) if desired is None else desired
            signal = "press" if function["type"] == "button" else ("on" if next_state else "off")
            record = self._record(function["signal_refs"][signal])
            await self._remote_call(emitter["sourceId"], "send_command", record)
            async with self._lock:
                current = self.find_function(function_key)
                if current and current[2]["type"] == "switch":
                    model = deepcopy(self.model)
                    for e in model["emitters"]:
                        for d in e["devices"]:
                            for f in d["functions"]:
                                if f["key"] == function_key:
                                    f["on"] = bool(next_state)
                    await self._write(model, self.signals, self.revision)
                    self.model = model
                self._notify()
            return {"status": "sent_unconfirmed", "on": bool(next_state) if function["type"] == "switch" else None}

    async def async_register_platform(self, kind: str, add_entities: Callable, factory: Callable) -> None:
        self._platforms[kind] = (add_entities, factory)
        await self.async_sync_entities()

    async def async_sync_entities(self) -> None:
        """Reconcile only our own entities and virtual devices using public APIs."""
        async with self._entity_lock:
            await self._async_sync_entities()

    async def _async_sync_entities(self) -> None:
        desired = {f["key"]: f for e in self.model["emitters"] for d in e["devices"] for f in d["functions"]}
        for key in list(self._entities):
            if key not in desired:
                entity = self._entities.pop(key)
                if entity.hass is not None:
                    await entity.async_remove()
        for entity in list(er.async_entries_for_config_entry(self.registry, self.entry.entry_id)):
            if entity.platform == DOMAIN and entity.unique_id not in desired:
                self.registry.async_remove(entity.entity_id)
        device_registry = dr.async_get(self.hass)
        wanted_devices = {d["id"] for e in self.model["emitters"] for d in e["devices"]}
        for device in list(device_registry.devices):
            if device.config_entry_id != self.entry.entry_id:
                continue
            ours = [identifier for domain, identifier in device.identifiers if domain == DOMAIN]
            if ours and not any(identity in wanted_devices for identity in ours):
                if not any(entity.device_id == device.id and entity.platform != DOMAIN for entity in self.registry.entities.values()):
                    device_registry.async_remove(device.id)
        for emitter in self.model["emitters"]:
            source = self.registry.async_get(emitter["sourceId"])
            for device in emitter["devices"]:
                info = {"config_entry_id": self.entry.entry_id, "identifiers": {(DOMAIN, device["id"])},
                        "name": device["name"], "manufacturer": "IR Pro", "model": "Mando virtual"}
                if source and source.device_id:
                    info["via_device_id"] = source.device_id
                device_registry.async_get_or_create(**info)
        for key, function in desired.items():
            if key not in self._entities and function["type"] in self._platforms:
                add_entities, factory = self._platforms[function["type"]]
                entity = factory(self, key)
                self._entities[key] = entity
                add_entities([entity])
        self._notify()

    async def async_unload(self) -> None:
        self._closing = True
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()
        for task in tuple(self._operations):
            task.cancel()
        if self._operations:
            await asyncio.gather(*tuple(self._operations), return_exceptions=True)
        # A metadata save already writing to Store completes before a new manager
        # can load the same key after config-entry reload.
        async with self._lock:
            pass
        self._listeners.clear()
