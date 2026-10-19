"""IR Pro: visual IR remotes using existing Home Assistant Broadlink entities."""

from pathlib import Path

from homeassistant.components import frontend
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.panel_custom import async_register_panel
from homeassistant.exceptions import ConfigEntryError

from .const import DOMAIN, PANEL_URL, PLATFORMS, STATIC_URL, VERSION
from .errors import IRProError
from .manager import IRProManager
from .websocket import async_register


async def async_setup(hass, config) -> bool:
    data = hass.data.setdefault(DOMAIN, {})
    if not data.get("websocket_registered"):
        async_register(hass)
        data["websocket_registered"] = True
    return True


async def async_setup_entry(hass, entry) -> bool:
    data = hass.data.setdefault(DOMAIN, {})
    if "manager" in data:
        raise ConfigEntryError("Solo se permite una instalación de IR Pro.")
    manager = IRProManager(hass, entry)
    try:
        await manager.async_load()
    except IRProError as err:
        raise ConfigEntryError(err.message) from err
    entry.runtime_data = manager
    data["manager"] = manager
    panel_registered = False
    try:
        if not data.get("static_registered"):
            await hass.http.async_register_static_paths([
                StaticPathConfig(STATIC_URL, str(Path(__file__).parent / "frontend"), False)
            ])
            data["static_registered"] = True
        await async_register_panel(
            hass, frontend_url_path=PANEL_URL, webcomponent_name="ir-pro-panel",
            sidebar_title="IR Pro", sidebar_icon="mdi:remote",
            module_url=f"{STATIC_URL}/ir-pro-panel.js?v={VERSION}",
            require_admin=True, config_panel_domain=DOMAIN,
        )
        panel_registered = True
        await manager.async_start()
        await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    except Exception:
        await manager.async_unload()
        if panel_registered:
            frontend.async_remove_panel(hass, PANEL_URL, warn_if_unknown=False)
        data.pop("manager", None)
        raise
    return True


async def async_unload_entry(hass, entry) -> bool:
    if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        return False
    await entry.runtime_data.async_unload()
    frontend.async_remove_panel(hass, PANEL_URL, warn_if_unknown=False)
    hass.data[DOMAIN].pop("manager", None)
    return True


async def async_remove_config_entry_device(hass, entry, device_entry) -> bool:
    """Only allow removal of a virtual device absent from our saved model."""
    return not any(
        (DOMAIN, device["id"]) in device_entry.identifiers
        for emitter in entry.runtime_data.model["emitters"]
        for device in emitter["devices"]
    )
