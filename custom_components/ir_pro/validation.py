"""Pure validation. The browser is never trusted to assert learned signals."""

from copy import deepcopy
import re
from typing import Any
from uuid import NAMESPACE_URL, uuid5

from .errors import IRProError
from .studio import STUDIO_ICONS, validate_state_effect, validate_studio

ICONS = {
    "droplets", "power", "snowflake", "fan", "volume-2", "sun", "lightbulb",
    "chevron-up", "chevron-down", "move-vertical", "move-horizontal", "settings",
    "timer", "timer-off", "thermometer", "wind", "zap", "leaf", "moon", "none",
}
ICONS |= STUDIO_ICONS
DEVICE_ICONS = {"air-vent", "tv", "fan", "remote", "wind", "light"}
IDENTIFIER = re.compile(r"^[a-zA-Z0-9_-]{1,128}$")
ENTITY = re.compile(r"^(button|switch)\.[a-z0-9_]{1,240}$")
COLOR = re.compile(r"^#[a-fA-F0-9]{6}$")


def signal_is_learned(record: dict) -> bool:
    """Accept a completed capture or a verified signal from the first beta."""
    return record.get("captured") is True or (
        record.get("tested") is True and record.get("verified") is True
    )


def _fail(message: str) -> None:
    raise IRProError("invalid_model", message)


def _text(value: Any, label: str, limit: int = 100) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        _fail(f"{label} no es válido.")
    return value.strip()


def _id(value: Any) -> str:
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        _fail("Hay un identificador interno no válido.")
    return value


def _items(value: Any, limit: int) -> list:
    if not isinstance(value, list) or len(value) > limit:
        _fail("La colección no es válida o supera el tamaño permitido.")
    return value


def _indexes(model: dict) -> tuple[dict, dict, dict]:
    emitters, devices, functions = {}, {}, {}
    for emitter in model.get("emitters", []):
        emitters[emitter["id"]] = emitter
        for device in emitter["devices"]:
            devices[device["id"]] = (emitter["id"], device)
            for function in device["functions"]:
                functions[function["key"]] = (device["id"], function)
    return emitters, devices, functions


def _layout(value: Any, keys: list[str], device_id: str) -> dict:
    if value is None:
        return {
            "heightScale": "square-at-two",
            "rows": [
                {"id": uuid5(NAMESPACE_URL, f"ir_pro/{device_id}/{index}").hex, "columns": 1, "height": 2,
                 "cells": [key]}
                for index, key in enumerate(keys or [None])
            ],
        }
    if not isinstance(value, dict) or value.get("heightScale") != "square-at-two":
        _fail("La distribución de filas no es válida.")
    rows, row_ids, placed = [], set(), set()
    for raw in _items(value.get("rows"), 256):
        if not isinstance(raw, dict):
            _fail("Hay una fila no válida.")
        row_id = _id(raw.get("id"))
        columns, height = raw.get("columns"), raw.get("height")
        if row_id in row_ids or type(columns) is not int or not 1 <= columns <= 6:
            _fail("Hay una fila repetida o un número de columnas no válido.")
        if type(height) is not int or not 1 <= height <= 4:
            _fail("La altura de la fila no es válida.")
        row_ids.add(row_id)
        cells = _items(raw.get("cells"), 6)
        if len(cells) != columns:
            _fail("El número de casillas no coincide con las columnas.")
        for key in cells:
            if key is not None:
                if not isinstance(key, str) or key not in keys or key in placed:
                    _fail("Una función está repetida o situada en una fila incorrecta.")
                placed.add(key)
        rows.append({"id": row_id, "columns": columns, "height": height,
                     "cells": list(cells)})
    if not rows or placed != set(keys):
        _fail("Cada función debe aparecer exactamente una vez en el mando.")
    return {"heightScale": "square-at-two", "rows": rows}


def validate_model(
    candidate: Any,
    current: dict,
    source_ids: set[str],
    signal_records: dict[str, dict],
    entity_ids: set[str],
) -> tuple[dict, list[str]]:
    """Return a sanitized independent model and notices, or reject atomically."""
    if not isinstance(candidate, dict) or candidate.get("version") != 2:
        _fail("La versión de la configuración no es válida.")
    old_emitters, old_devices, old_functions = _indexes(current)
    used_ids, used_sources, used_entities = set(), set(), set()
    occupied = set(entity_ids)
    notices, emitters = [], []

    def unique(value: Any) -> str:
        identity = _id(value)
        if identity in used_ids:
            _fail("Hay identificadores internos repetidos.")
        used_ids.add(identity)
        return identity

    for raw_emitter in _items(candidate.get("emitters"), 32):
        if not isinstance(raw_emitter, dict):
            _fail("Hay un emisor no válido.")
        emitter_id, source_id = unique(raw_emitter.get("id")), _id(raw_emitter.get("sourceId"))
        if emitter_id in old_devices or emitter_id in old_functions:
            _fail("No se puede reutilizar un identificador interno para otro tipo de elemento.")
        old_emitter = old_emitters.get(emitter_id)
        if old_emitter and old_emitter["sourceId"] != source_id:
            _fail("No se puede cambiar el emisor físico de un mando existente.")
        if source_id not in source_ids and not (old_emitter and old_emitter["sourceId"] == source_id):
            _fail("El emisor no está disponible en Home Assistant.")
        if source_id in used_sources:
            _fail("Este emisor ya está añadido.")
        used_sources.add(source_id)
        emitter = {"id": emitter_id, "sourceId": source_id,
                   "name": _text(raw_emitter.get("name"), "El nombre del emisor"),
                   "model": _text(raw_emitter.get("model", "Broadlink"), "El modelo", 150),
                   "devices": []}
        for raw_device in _items(raw_emitter.get("devices"), 100):
            if not isinstance(raw_device, dict):
                _fail("Hay un dispositivo no válido.")
            device_id = unique(raw_device.get("id"))
            if device_id in old_emitters or device_id in old_functions:
                _fail("No se puede reutilizar un identificador interno para otro tipo de elemento.")
            if device_id in old_devices and old_devices[device_id][0] != emitter_id:
                _fail("No se pueden mover dispositivos existentes a otro emisor.")
            icon = raw_device.get("icon", "remote")
            if not isinstance(icon, str) or icon not in DEVICE_ICONS:
                _fail("El icono del dispositivo no es válido.")
            device = {"id": device_id, "name": _text(raw_device.get("name"), "El nombre del dispositivo"),
                      "icon": icon, "functions": []}
            for raw_function in _items(raw_device.get("functions"), 200):
                if not isinstance(raw_function, dict):
                    _fail("Hay una función no válida.")
                key = unique(raw_function.get("key"))
                if key in old_emitters or key in old_devices:
                    _fail("No se puede reutilizar un identificador interno para otro tipo de elemento.")
                prior = old_functions.get(key)
                if prior and prior[0] != device_id:
                    _fail("No se pueden mover funciones existentes a otro dispositivo.")
                kind, entity = raw_function.get("type"), raw_function.get("entity")
                if kind not in ("button", "switch") or not isinstance(entity, str) or not ENTITY.fullmatch(entity) or not entity.startswith(kind + "."):
                    _fail("La entidad debe usar button. o switch. y un nombre válido.")
                if prior and (prior[1]["entity"] != entity or prior[1]["type"] != kind):
                    _fail("La entidad y el tipo de una función existente se conservan.")
                if entity in used_entities:
                    _fail("Hay entidades repetidas.")
                if not prior:
                    stem, suffix = entity, 2
                    while entity in occupied or entity in used_entities:
                        entity = f"{stem}_{suffix}"
                        suffix += 1
                    if entity != stem:
                        notices.append(f"La entidad ya existía. Se ha usado {entity}.")
                used_entities.add(entity)
                occupied.add(entity)
                function_icon, color = raw_function.get("icon"), raw_function.get("color")
                if not isinstance(function_icon, str) or function_icon not in ICONS or not isinstance(color, str) or not COLOR.fullmatch(color):
                    _fail("El icono o el color de la función no es válido.")
                if type(raw_function.get("showName", True)) is not bool:
                    _fail("La visibilidad del nombre no es válida.")
                incoming_refs = raw_function.get("signal_refs", {})
                allowed = ("press",) if kind == "button" else ("on", "off")
                if not isinstance(incoming_refs, dict) or any(signal not in allowed for signal in incoming_refs):
                    _fail("Las referencias de señal no son válidas.")
                refs, signals = {}, {}
                cross_source = False
                for signal, reference in incoming_refs.items():
                    if not isinstance(reference, str) or reference not in signal_records:
                        raise IRProError("invalid_signal", "La señal no existe. Vuelve a aprenderla.")
                    record = signal_records[reference]
                    if record.get("source_id") != source_id:
                        cross_source = True
                        continue
                    if record.get("signal") != signal:
                        raise IRProError("invalid_signal", "La señal no corresponde a esta función.")
                    refs[signal] = reference
                    signals[signal] = signal_is_learned(record)
                if cross_source:
                    refs, signals = {}, {}
                    notices.append("El mando se ha copiado a otro emisor. Aprende de nuevo sus señales.")
                function = {
                    "key": key, "name": _text(raw_function.get("name"), "El nombre de la función", 120),
                    "showName": function_icon == "none" or raw_function.get("showName", True),
                    "icon": function_icon, "color": color, "type": kind, "entity": entity,
                    "signals": signals, "signal_refs": refs,
                    "on": prior[1].get("on") if prior and kind == "switch" else None,
                }
                effect = raw_function.get("state_effect", prior[1].get("state_effect") if prior else None)
                if "state_effect" in raw_function or effect is not None:
                    effect = validate_state_effect(effect)
                    if kind != "button":
                        _fail("Solo una entidad button puede tener una acción independiente.")
                    old_effect = prior[1].get("state_effect") if prior else None
                    if prior and (old_effect is not None and old_effect != effect or old_effect is None and prior[1]["signal_refs"]):
                        _fail("El efecto de una señal existente se conserva. Crea otra función para cambiarlo.")
                    function["state_effect"] = effect
                device["functions"].append(function)
            device["layout"] = _layout(raw_device.get("layout"), [f["key"] for f in device["functions"]], device_id)
            previous_studio = old_devices.get(device_id, (None, {}))[1].get("studio")
            if "studio" in raw_device:
                device["studio"] = validate_studio(raw_device["studio"], device["functions"], ICONS, previous_studio)
            elif previous_studio is not None:
                # Older clients must not silently erase the visual editor.
                device["studio"] = validate_studio(previous_studio, device["functions"], ICONS, previous_studio)
            if any("state_effect" in function for function in device["functions"]) and device.get("studio", {}).get("type") != "stateful":
                _fail("Las acciones independientes necesitan un mando con estados.")
            emitter["devices"].append(device)
        emitters.append(emitter)
    if sum(len(d["functions"]) for e in emitters for d in e["devices"]) > 1500:
        _fail("Se ha superado el límite de funciones.")
    return deepcopy({"version": 2, "emitters": emitters}), list(dict.fromkeys(notices))
