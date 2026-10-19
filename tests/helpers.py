"""Load pure backend modules without executing Home Assistant setup."""

from __future__ import annotations

from copy import deepcopy
import importlib
from pathlib import Path
import sys
import types

SOURCE = "a" * 32
OTHER_SOURCE = "b" * 32
EMITTER = "00000000-0000-4000-8000-000000000001"
DEVICE = "00000000-0000-4000-8000-000000000002"
FUNCTION = "00000000-0000-4000-8000-000000000003"
ROW = "00000000-0000-4000-8000-000000000004"
REF = "00000000-0000-4000-8000-000000000005"
DOMAIN_PATH = Path(__file__).resolve().parents[1] / "custom_components" / "ir_pro"


def backend_module(name: str):
    """Use a private package so importing tests never initializes HA setup."""
    package = "_ir_pro_contract_tests"
    if package not in sys.modules:
        module = types.ModuleType(package)
        module.__path__ = [str(DOMAIN_PATH)]
        sys.modules[package] = module
    return importlib.import_module(f"{package}.{name}")


def empty_model():
    return {"version": 2, "emitters": []}


def model_fixture():
    """An editable remote with one unlearned command and an empty cell."""
    return {
        "version": 2,
        "emitters": [{
            "id": EMITTER,
            "sourceId": SOURCE,
            "name": "IR salón",
            "model": "RM4 mini",
            "devices": [{
                "id": DEVICE,
                "name": "Split salón",
                "icon": "air-vent",
                "functions": [{
                    "key": FUNCTION,
                    "name": "Encender",
                    "showName": True,
                    "icon": "power",
                    "color": "#00d6b4",
                    "type": "button",
                    "entity": "button.ir_salon_split_salon_encender",
                    "signals": {"press": False},
                    "signal_refs": {},
                    "on": None,
                }],
                "layout": {
                    "heightScale": "square-at-two",
                    "rows": [{
                        "id": ROW,
                        "columns": 2,
                        "height": 2,
                        "cells": [FUNCTION, None],
                    }],
                },
            }],
        }],
    }


def get_function(model):
    return model["emitters"][0]["devices"][0]["functions"][0]


def signal_fixture(**overrides):
    record = {
        "source_id": SOURCE,
        "device_id": DEVICE,
        "function_key": FUNCTION,
        "signal": "press",
        "tested": True,
        "verified": True,
        "device": "ir_pro_test",
        "command": "ir_pro_command",
    }
    record.update(overrides)
    return record


def duplicate_device(model, *, source_id=None):
    """Duplicate independently; an emitter change always creates new identity."""
    candidate = deepcopy(model)
    device = deepcopy(candidate["emitters"][0]["devices"][0])
    device["id"] = "00000000-0000-4000-8000-000000000010"
    function = device["functions"][0]
    function["key"] = "00000000-0000-4000-8000-000000000011"
    function["entity"] = "button.ir_salon_split_salon_encender_2"
    device["layout"]["rows"][0]["id"] = "00000000-0000-4000-8000-000000000012"
    device["layout"]["rows"][0]["cells"][0] = function["key"]
    if source_id is None:
        candidate["emitters"][0]["devices"].append(device)
    else:
        candidate["emitters"].append({
            "id": "00000000-0000-4000-8000-000000000013",
            "sourceId": source_id,
            "name": "IR dormitorio",
            "model": "RM4 mini",
            "devices": [device],
        })
    return candidate, device
