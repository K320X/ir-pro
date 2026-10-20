"""Validated visual-editor metadata; real functions remain the signal authority."""

from copy import deepcopy
import json
import math
import re
from typing import Any

from .errors import IRProError

MODES = {"cool", "heat", "dry", "fan", "auto"}
FANS = {"auto", "low", "medium", "high", "speed_4", "speed_5"}
SWINGS = {"off", "auto", *(f"position_{n}" for n in range(1, 7))}
STUDIO_ICONS = {
    "remote", "power-off", "plus", "minus", "droplet", "swing", "folder",
    "light", "auto", "home", "copy", "radio", "display", "tv", "lightbulb",
    *(f"swing-position-{n}" for n in range(1, 7)), "swing-off",
    *(f"fan-speed-{n}" for n in range(1, 6)),
}
ACTIONS = {"learned", "power_on", "power_off", "temp_up", "temp_down",
           "set_mode", "set_fan", "set_swing", "swing", "open_group"}
_ID = re.compile(r"^[a-zA-Z0-9_-]{1,128}$")
_COLOR = re.compile(r"^#[a-fA-F0-9]{6}$")


def _fail(message: str) -> None:
    raise IRProError("invalid_model", message)


def _text(value: Any, label: str, limit: int = 120) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        _fail(f"{label} no es válido.")
    return value.strip()


def _identity(value: Any) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        _fail("El identificador del editor no es válido.")
    return value


def _integer(value: Any, minimum: int, maximum: int, label: str) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        _fail(f"{label} no es válido.")
    return value


def _boolean(value: Any, label: str) -> bool:
    if type(value) is not bool:
        _fail(f"{label} no es válido.")
    return value


def validate_configuration(value: Any, *, full: bool = False) -> dict:
    """Normalize a command state. Off is one command, not many hidden presets."""
    if not isinstance(value, dict) or type(value.get("power")) is not bool:
        _fail("El estado del mando no es válido.")
    if not value["power"] and not full:
        return {"power": False}
    mode, fan = value.get("mode"), value.get("fan")
    if not isinstance(mode, str) or mode not in MODES or not isinstance(fan, str) or fan not in FANS:
        _fail("El modo o la velocidad del mando no son válidos.")
    temperature = _integer(value.get("temperature"), 18, 30, "La temperatura")
    swing = value.get("swing", "off")
    if type(swing) is bool:
        swing = "auto" if swing else "off"
    if not isinstance(swing, str) or swing not in SWINGS:
        _fail("La posición de oscilación no es válida.")
    return {"power": value["power"], "mode": mode, "temperature": temperature,
            "fan": fan, "swing": swing}


def configuration_key(value: dict) -> tuple:
    """The same exact state key is used by saving, learning UI and sending."""
    state = validate_configuration(value)
    if not state["power"]:
        return (False,)
    return (True, state["mode"], None if state["mode"] in {"dry", "fan"} else state["temperature"],
            state["fan"], state["swing"])


def _bounded_json(value: Any) -> None:
    """Reject non-JSON/deep/oversized metadata before traversing it."""
    def visit(item: Any, depth: int = 0) -> None:
        if depth > 16:
            _fail("La configuración del editor tiene demasiados niveles.")
        if item is None or isinstance(item, (str, bool)) or type(item) is int:
            return
        if type(item) is float and math.isfinite(item):
            return
        if isinstance(item, list):
            if len(item) > 1600:
                _fail("La configuración del editor contiene demasiados elementos.")
            for child in item:
                visit(child, depth + 1)
            return
        if isinstance(item, dict) and len(item) <= 100 and all(isinstance(key, str) for key in item):
            for child in item.values():
                visit(child, depth + 1)
            return
        _fail("La configuración del editor no contiene JSON válido.")
    visit(value)
    if len(json.dumps(value, ensure_ascii=False).encode("utf-8")) > 512 * 1024:
        _fail("La configuración del editor supera el tamaño permitido.")


def sync_studio(studio: dict, functions: list[dict]) -> None:
    """Refresh public identity/readiness from real functions, never client flags."""
    indexed = {function["key"]: function for function in functions}

    def apply(node: dict, *, saved: bool = False) -> None:
        function = indexed.get(node["id"])
        mapped = saved or (node.get("type") == "button" and node.get("action") == "learned") or (
            node.get("type") == "dual" and (studio["type"] == "simple" or function and function["type"] == "switch")
        )
        if mapped and function:
            node["name"] = function["name"]
            node["entity"] = function["entity"]
            node["signal_refs"] = deepcopy(function["signal_refs"])
            node["signals"] = deepcopy(function["signals"])
            node["on"] = function.get("on")
            if saved:
                reference = function["signal_refs"].get("press")
                node["signal"] = {"kind": "learned", "id": reference} if reference and function["signals"].get("press") else None
            else:
                for key in ("icon", "color", "showName"):
                    node[key] = function[key]
                if node.get("type") == "dual":
                    node["activeSide"] = 1 if function.get("on") is True else 0
        for child in node.get("children", []):
            if isinstance(child, dict):
                apply(child)

    for row in studio["rows"]:
        for node in row.get("cells", []):
            if node:
                apply(node)
    for record in studio["savedStates"]:
        apply(record, saved=True)


def validate_studio(value: Any, functions: list[dict], icons: set[str], current: dict | None = None) -> dict:
    """Keep the reviewed visual editor without changing existing real identities."""
    _bounded_json(value)
    if not isinstance(value, dict) or value.get("type") not in ("simple", "stateful"):
        _fail("El tipo de mando del editor no es válido.")
    studio = {"type": value["type"], "state": validate_configuration(value.get("state"), full=True),
              "rows": [], "savedStates": []}
    indexed = {function["key"]: function for function in functions}
    used: set[str] = set()
    count = 0

    def identity(raw: Any) -> str:
        identity = _identity(raw)
        if identity in used:
            _fail("Un elemento del editor aparece más de una vez.")
        used.add(identity)
        return identity

    def appearance(raw: Any) -> dict:
        if not isinstance(raw, dict):
            _fail("La función del editor no es válida.")
        name, icon, color = _text(raw.get("name"), "El nombre de la función"), raw.get("icon", "remote"), raw.get("color", "#56c4ed")
        if not isinstance(icon, str) or icon not in icons or not isinstance(color, str) or not _COLOR.fullmatch(color):
            _fail("El icono o el color del editor no son válidos.")
        show = _boolean(raw.get("showName", True), "La visibilidad del texto")
        return {"name": name, "icon": icon, "color": color, "showName": icon == "none" or show}

    def action(raw: dict) -> dict:
        result = appearance(raw)
        kind = raw.get("action", "learned")
        if not isinstance(kind, str) or kind not in ACTIONS:
            _fail("La acción del editor no es válida.")
        if studio["type"] == "simple" and kind not in {"learned", "open_group"}:
            _fail("Un mando de botones no puede modificar ajustes de climatización.")
        value = raw.get("value", "")
        allowed = {"set_mode": MODES, "set_fan": FANS, "set_swing": SWINGS}.get(kind)
        if not isinstance(value, str) or len(value) > 128 or (allowed is not None and value not in allowed):
            _fail("El valor de la acción del editor no es válido.")
        result.update(action=kind, value=value)
        return result

    def node(raw: Any, depth: int = 0) -> dict:
        nonlocal count
        count += 1
        if depth > 4 or count > 1500 or not isinstance(raw, dict):
            _fail("El editor contiene demasiadas funciones o niveles.")
        result = action(raw)
        result.update(id=identity(raw.get("id")), type=raw.get("type", "button"))
        if result["type"] not in ("button", "dual", "group"):
            _fail("El tipo de función del editor no es válido.")
        if result["type"] == "dual":
            actions = raw.get("actions")
            if not isinstance(actions, list) or len(actions) != 2:
                _fail("El botón de doble acción necesita dos acciones.")
            result["actions"] = [action(side) for side in actions]
            result["activeSide"] = _integer(raw.get("activeSide", 0), 0, 1, "La acción visible")
        if result["type"] == "group":
            kind = raw.get("group")
            if kind not in ("mode", "fan", "swing", "custom") or (studio["type"] == "simple" and kind != "custom"):
                _fail("El contenido de la carpeta no es válido.")
            result["group"] = kind
            result["action"] = "open_group"
            if kind == "custom":
                children = raw.get("children", [])
                if not isinstance(children, list) or len(children) > 100:
                    _fail("La carpeta contiene demasiadas funciones.")
                result["children"] = [node(child, depth + 1) for child in children]
            if kind == "fan":
                result.update(fanSpeedCount=_integer(raw.get("fanSpeedCount", 3), 2, 5, "La cantidad de velocidades"),
                              fanAuto=_boolean(raw.get("fanAuto", True), "El modo automático"))
            if kind == "swing":
                result.update(swingPositionCount=_integer(raw.get("swingPositionCount", 6), 1, 6, "La cantidad de posiciones"),
                              swingAuto=_boolean(raw.get("swingAuto", True), "La oscilación automática"),
                              swingOff=_boolean(raw.get("swingOff", True), "La oscilación desactivada"))
        mapped = result["type"] == "button" and result["action"] == "learned"
        existing_function = indexed.get(result["id"])
        mapped = mapped or (result["type"] == "dual" and (
            studio["type"] == "simple" or existing_function and existing_function["type"] == "switch"
        ))
        if mapped:
            function = indexed.get(result["id"])
            required = "switch" if result["type"] == "dual" else "button"
            if not function or function["type"] != required:
                _fail("Una función del editor no corresponde a una entidad real de este mando.")
        return result

    rows = value.get("rows")
    if not isinstance(rows, list) or len(rows) > 256:
        _fail("La distribución del editor no es válida.")
    for raw in rows:
        if not isinstance(raw, dict):
            _fail("Hay una fila del editor no válida.")
        result = {"id": identity(raw.get("id")), "type": raw.get("type")}
        if result["type"] == "display":
            result.update(height=_integer(raw.get("height", 2), 2, 4, "La altura de la pantalla"),
                          width=_integer(raw.get("width", 3), 3, 6, "La anchura de la pantalla"))
            style, accent, fields = raw.get("style", "lcd"), raw.get("accent", "#b9c9b0"), raw.get("fields", {})
            if style not in ("lcd", "modern") or not isinstance(accent, str) or not _COLOR.fullmatch(accent) or not isinstance(fields, dict):
                _fail("La pantalla del mando no es válida.")
            result.update(style=style, accent=accent, fields={key: _boolean(fields.get(key, True), "La información de la pantalla") for key in ("temperature", "mode", "fan", "swing", "power")})
        elif result["type"] == "buttons":
            columns = _integer(raw.get("columns"), 1, 6, "Las columnas")
            cells = raw.get("cells")
            if not isinstance(cells, list) or len(cells) != columns:
                _fail("Las casillas del editor no coinciden con las columnas.")
            result.update(columns=columns, height=_integer(raw.get("height", 2), 1, 4, "La altura"),
                          cells=[node(cell) if cell is not None else None for cell in cells])
        else:
            _fail("El tipo de fila del editor no es válido.")
        studio["rows"].append(result)
    records = value.get("savedStates", [])
    if not isinstance(records, list) or len(records) > 200 or (records and studio["type"] != "stateful"):
        _fail("Los estados guardados del mando no son válidos.")
    previous = {record["id"]: record for record in (current or {}).get("savedStates", [])}
    for raw in records:
        if not isinstance(raw, dict):
            _fail("Hay un estado guardado no válido.")
        identity_value = identity(raw.get("id"))
        function = indexed.get(identity_value)
        if not function or function["type"] != "button":
            _fail("El estado guardado no corresponde a una entidad button de este mando.")
        settings = validate_configuration(raw.get("settings"))
        if identity_value in previous and configuration_key(previous[identity_value]["settings"]) != configuration_key(settings):
            _fail("Los ajustes de un estado guardado se conservan. Crea otro estado para cambiarlos.")
        record = {"id": identity_value, "name": function["name"], "settings": settings}
        for stamp in ("createdAt", "updatedAt"):
            if stamp in raw:
                record[stamp] = _text(raw[stamp], "La fecha del estado", 64)
        studio["savedStates"].append(record)
    sync_studio(studio, functions)
    return studio
