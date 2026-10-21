"""IR Pro's durable state, Broadlink adapter and real command execution."""

import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
import logging
import math
import time
from typing import Any, Callable
from uuid import UUID, uuid4

from homeassistant.const import EVENT_STATE_CHANGED, STATE_ON
from homeassistant.core import callback
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.storage import Store

from .const import DOMAIN, EMPTY_MODEL, LEARN_TIMEOUT, STORAGE_KEY, STORAGE_VERSION, VERSION
from .errors import IRProError
from .validation import ENTITY, signal_is_learned, validate_model
from .studio import (active_controlled_fields, apply_state_effect, independent_action_owner, learned_action_owner, learned_action_signature, record_configuration_key, record_fields,
                     scoped_configuration_key, sync_studio, validate_configuration,
                     validate_controlled_fields)

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
        self._entity_rename_pending = False

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
                "ambient": self._ambient_readings(source.device_id),
            })
        return sorted(result, key=lambda item: (item["name"].casefold(), item["id"]))

    def _ambient_readings(self, device_id: str | None) -> dict:
        """Use public HA sensor states belonging to this Broadlink hardware."""
        if not device_id:
            return {}
        result = {}
        for entity in sorted(self.registry.entities.values(), key=lambda item: item.entity_id):
            if entity.platform != "broadlink" or entity.device_id != device_id or entity.disabled_by or not entity.entity_id.startswith("sensor."):
                continue
            state = self.hass.states.get(entity.entity_id)
            if not state or not isinstance(state.state, (str, int, float)) or isinstance(state.state, bool):
                continue
            try:
                value = float(state.state)
            except (TypeError, ValueError):
                continue
            if not math.isfinite(value):
                continue
            kind = state.attributes.get("device_class")
            unit = state.attributes.get("unit_of_measurement")
            if kind == "temperature" and unit in ("°C", "C", "℃", "°F", "F"):
                unit = "°F" if unit in ("°F", "F") else "°C"
            elif kind == "humidity" and unit == "%" and 0 <= value <= 100:
                pass
            else:
                continue
            if kind not in result:
                result[kind] = {"entity_id": entity.entity_id, "state": value, "unit": unit}
        return result

    def _refresh_entity_ids(self) -> None:
        """Respect renames made in HA's entity registry."""
        if self._entity_rename_pending:
            return
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
                if "studio" in device:
                    sync_studio(device["studio"], device["functions"])
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
        self.model, _ = validate_model(incoming, EMPTY_MODEL, known, records, set(), loading=True)
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

    @callback
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
        @callback
        def changed(event) -> None:
            if event.event_type == EVENT_STATE_CHANGED:
                entity_id = event.data.get("entity_id", "")
                if not entity_id.startswith("remote."):
                    sensor = self.registry.async_get(entity_id)
                    if not sensor or sensor.platform != "broadlink" or not entity_id.startswith("sensor.") or not sensor.device_id:
                        return
                    if not any(source.platform == "broadlink" and source.entity_id.startswith("remote.") and source.device_id == sensor.device_id for source in self.registry.entities.values()):
                        return
            self._notify()
        self._unsubs.append(self.hass.bus.async_listen(EVENT_STATE_CHANGED, changed))
        self._unsubs.append(self.hass.bus.async_listen("entity_registry_updated", changed))

    def _prepare_entity_renames(self, candidate: dict, renames: dict | None) -> tuple[dict, list[tuple[str, str, str]]]:
        """Allow only explicit existing-function renames, before any side effects."""
        if renames is None or renames == {}:
            return self.model, []
        if not isinstance(renames, dict) or len(renames) > 1500:
            raise IRProError("invalid_model", "Los cambios de entidades no son válidos.")
        if not isinstance(candidate, dict):
            raise IRProError("invalid_model", "La configuración no es válida.")
        incoming = {}
        emitters = candidate.get("emitters", [])
        for emitter in emitters if isinstance(emitters, list) else []:
            devices = emitter.get("devices", []) if isinstance(emitter, dict) else []
            for device in devices if isinstance(devices, list) else []:
                functions = device.get("functions", []) if isinstance(device, dict) else []
                for function in functions if isinstance(functions, list) else []:
                    if isinstance(function, dict) and isinstance(function.get("key"), str):
                        incoming.setdefault(function["key"], []).append(function)
        rebased = deepcopy(self.model)
        current = {function["key"]: function for emitter in rebased["emitters"] for device in emitter["devices"] for function in device["functions"]}
        updates = []
        for key, target in renames.items():
            old = current.get(key) if isinstance(key, str) else None
            requested = incoming.get(key, []) if isinstance(key, str) else []
            if old is None or len(requested) != 1 or requested[0].get("type") != old["type"]:
                raise IRProError("invalid_model", "Solo se puede cambiar la entidad de una función existente del mismo tipo.")
            if not isinstance(target, str) or not ENTITY.fullmatch(target) or not target.startswith(old["type"] + ".") or requested[0].get("entity") != target:
                raise IRProError("invalid_model", "El nombre de entidad debe conservar button. o switch. y usar un identificador válido.")
            occupied = self.registry.async_get(target)
            if occupied and not (occupied.platform == DOMAIN and occupied.unique_id == key and occupied.config_entry_id == self.entry.entry_id):
                raise IRProError("invalid_model", "La entidad elegida ya está en uso. Escribe otro identificador.")
            registered = self.registry.async_get_entity_id(old["type"], DOMAIN, key)
            if registered:
                entry = self.registry.async_get(registered)
                if not entry or entry.config_entry_id != self.entry.entry_id:
                    raise IRProError("invalid_model", "La entidad no pertenece a esta integración de IR Pro.")
                if registered != target:
                    updates.append((registered, target, key))
            old["entity"] = target
        return rebased, updates

    def _rollback_entity_renames(self, updates: list[tuple[str, str, str]]) -> None:
        for previous, target, key in reversed(updates):
            entry = self.registry.async_get(target)
            if entry and entry.platform == DOMAIN and entry.unique_id == key and entry.config_entry_id == self.entry.entry_id:
                self.registry.async_update_entity(target, new_entity_id=previous)

    async def async_save_model(self, candidate: dict, expected_revision: int, *, entity_renames: dict | None = None) -> dict:
        async with self._lock:
            if self._closing:
                raise IRProError("source_unavailable", "IR Pro se está recargando.")
            if type(expected_revision) is not int or expected_revision != self.revision:
                raise IRProError("revision_conflict", "La configuración ha cambiado en otra ventana. Recarga antes de guardar.")
            self._refresh_entity_ids()
            validation_current, registry_renames = self._prepare_entity_renames(candidate, entity_renames)
            model, notices = validate_model(
                candidate, validation_current, {source["id"] for source in self.catalog()},
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
            applied = []
            self._entity_rename_pending = bool(registry_renames)
            try:
                for change in registry_renames:
                    applied.append(change)
                    self.registry.async_update_entity(change[0], new_entity_id=change[1])
                await self._write(model, records, revision)
            except BaseException as err:
                try:
                    self._rollback_entity_renames(applied)
                except Exception as rollback_error:
                    raise IRProError("storage_error", "No se ha podido restaurar el nombre de la entidad. Revisa el registro de entidades antes de volver a guardar.") from rollback_error
                if isinstance(err, Exception) and not isinstance(err, IRProError):
                    raise IRProError("storage_error", "No se ha podido guardar el cambio de entidad.") from err
                raise
            finally:
                self._entity_rename_pending = False
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

    async def async_send_state(self, device_id: str, state: dict, controlled_fields: list[str] | None = None) -> dict:
        """Only an explicitly learned exact configuration can be transmitted."""
        if not isinstance(state, dict) or type(state.get("power")) is not bool:
            raise IRProError("invalid_model", "El estado del mando no es válido.")
        _, device = self._find_device(device_id)
        studio = device.get("studio")
        if not studio or studio["type"] != "stateful":
            raise IRProError("invalid_model", "Este dispositivo no es un mando con estados.")
        fields = active_controlled_fields(studio, state["power"])
        if controlled_fields is not None and validate_controlled_fields(controlled_fields) != fields:
            raise IRProError("invalid_model", "Los ajustes combinados del mando han cambiado. Recarga antes de enviarlos.")
        key = scoped_configuration_key(state, fields)
        matches = [item for item in studio["savedStates"] if record_fields(item) == fields and record_configuration_key(item) == key]
        explicit = [item for item in matches if "controlled_fields" in item]
        matches = explicit or matches
        if len(matches) > 1:
            raise IRProError("ambiguous_state", "Hay varias capturas para estos ajustes. Conserva una sola antes de enviar el estado.")
        record = matches[0] if matches else None
        if not record:
            raise IRProError("invalid_signal", "Este estado no tiene una señal aprendida. Aprende primero este estado del mando original.")
        result = await self.async_press(record["id"], _expected_state=key)
        return {**result, **self.envelope()}

    async def async_delete_saved_states(self, device_id: str, expected_revision: int) -> dict:
        """Atomically forget only this remote's complete-state recordings."""
        async with self._lock:
            if self._closing:
                raise IRProError("source_unavailable", "IR Pro se está recargando.")
            if type(expected_revision) is not int or expected_revision != self.revision:
                raise IRProError("revision_conflict", "La configuración ha cambiado en otra ventana. Recarga antes de guardar.")
            _, original = self._find_device(device_id)
            if original.get("studio", {}).get("type") != "stateful":
                raise IRProError("invalid_model", "Este dispositivo no es un mando con estados.")
            removed = {item["id"] for item in original["studio"]["savedStates"]}
            if not removed:
                # A previous committed deletion may still need registry cleanup.
                await self.async_sync_entities()
                return self.envelope()
            model = deepcopy(self.model)
            for emitter in model["emitters"]:
                for device in emitter["devices"]:
                    if device["id"] != device_id:
                        continue
                    device["studio"]["savedStates"] = []
                    device["functions"] = [function for function in device["functions"] if function["key"] not in removed]
                    for row in device["layout"]["rows"]:
                        row["cells"] = [None if key in removed else key for key in row["cells"]]
            referenced = {ref for emitter in model["emitters"] for device in emitter["devices"] for function in device["functions"] for ref in function["signal_refs"].values()}
            records = {ref: deepcopy(record) for ref, record in self.signals.items() if ref in referenced or record["function_key"] not in removed}
            revision = self.revision + 1
            await self._write(model, records, revision)
            self.model, self.signals, self.revision = model, records, revision
            await self.async_sync_entities()
            return self.envelope()

    async def async_press(self, function_key: str, desired: bool | None = None, *, _expected_state: tuple | None = None) -> dict:
        if desired is not None and type(desired) is not bool:
            raise IRProError("invalid_model", "El estado del botón de doble acción no es válido.")
        found = self.find_function(function_key)
        if not found or not self.function_available(function_key):
            raise IRProError("invalid_signal", "La función no está disponible o necesita aprender sus señales.")
        emitter, _, function = found
        async with self._tracked_operation(emitter["sourceId"]):
            # Re-read after acquiring the lock; a save may have deleted it.
            found = self.find_function(function_key)
            if not found or not self.function_available(function_key):
                raise IRProError("invalid_signal", "La función ya no está disponible.")
            emitter, device, function = found
            state_record = next((item for item in device.get("studio", {}).get("savedStates", []) if item["id"] == function_key), None)
            if _expected_state is not None and (not state_record or record_configuration_key(state_record) != _expected_state or active_controlled_fields(device.get("studio", {}), state_record["settings"].get("power", device["studio"]["state"]["power"])) != list(_expected_state[0])):
                raise IRProError("invalid_signal", "El estado guardado ha cambiado. Recarga el mando antes de enviarlo.")
            next_state = (not function.get("on")) if desired is None else desired
            signal = "press" if function["type"] == "button" else ("on" if next_state else "off")
            record = self._record(function["signal_refs"][signal])
            sent_settings = deepcopy(state_record["settings"]) if state_record else None
            if _expected_state is not None:
                # Scoped matching marks irrelevant dry/fan temperatures as None.
                # Replaying a match must not overwrite those prepared settings.
                sent_settings = {field: value for field, value in zip(_expected_state[0], _expected_state[1:]) if value is not None}
            sent_effect = deepcopy(function.get("state_effect"))
            owner = independent_action_owner(device.get("studio", {}), function_key) if sent_effect else None
            sent_owner = (owner[0]["id"], owner[1].get("action_index")) if owner and owner[0].get("type") == "dual" else None
            sent_learned_owner = learned_action_signature(learned_action_owner(device.get("studio", {}), function_key))
            sent_device_id, sent_source_id = device["id"], emitter["sourceId"]
            await self._remote_call(emitter["sourceId"], "send_command", record)
            async with self._lock:
                current = self.find_function(function_key)
                if current and (current[2]["type"] == "switch" or state_record or sent_effect or sent_learned_owner):
                    model = deepcopy(self.model)
                    state_updated = False
                    for e in model["emitters"]:
                        for d in e["devices"]:
                            for f in d["functions"]:
                                if f["key"] == function_key:
                                    if f["type"] == "switch":
                                        f["on"] = bool(next_state)
                                    if sent_effect and f.get("state_effect") == sent_effect and d["id"] == sent_device_id and e["sourceId"] == sent_source_id and d.get("studio", {}).get("type") == "stateful":
                                        d["studio"]["state"].update(apply_state_effect(d["studio"]["state"], sent_effect))
                                        owner = independent_action_owner(d["studio"], function_key)
                                        if owner and sent_owner == (owner[0]["id"], owner[1].get("action_index")) and owner[0].get("type") == "dual" and type(owner[1].get("action_index")) is int and owner[1]["action_index"] in (0, 1):
                                            owner[0]["activeSide"] = 1 - owner[1]["action_index"]
                                        state_updated = True
                                    if sent_learned_owner and f["type"] == "button" and not f.get("state_effect") and d["id"] == sent_device_id and e["sourceId"] == sent_source_id and f["signal_refs"].get("press") == function["signal_refs"].get("press"):
                                        learned_owner = learned_action_owner(d.get("studio", {}), function_key)
                                        if learned_action_signature(learned_owner) == sent_learned_owner:
                                            learned_owner[0]["activeSide"] = 1 - learned_owner[1]["action_index"]
                                            state_updated = True
                            current_record = next((item for item in d.get("studio", {}).get("savedStates", []) if item["id"] == function_key), None)
                            if current_record and sent_settings is not None and d["id"] == sent_device_id and e["sourceId"] == sent_source_id and record_configuration_key(current_record) == record_configuration_key(state_record):
                                d["studio"]["state"].update(sent_settings)
                                state_updated = True
                    revision = self.revision + 1 if state_updated else self.revision
                    await self._write(model, self.signals, revision)
                    self.model, self.revision = model, revision
                self._notify()
            result = {"status": "sent_unconfirmed", "on": bool(next_state) if function["type"] == "switch" else None}
            return {**result, **self.envelope()} if sent_effect or sent_learned_owner else result

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
        for device in list(dr.async_entries_for_config_entry(device_registry, self.entry.entry_id)):
            ours = [identifier for domain, identifier in device.identifiers if domain == DOMAIN]
            if ours and not any(identity in wanted_devices for identity in ours):
                if not any(entity.device_id == device.id and entity.platform != DOMAIN for entity in self.registry.entities.values()):
                    device_registry.async_remove_device(device.id)
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
