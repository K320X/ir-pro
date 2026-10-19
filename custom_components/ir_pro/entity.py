"""Shared entity behavior for IR Pro's virtual remotes."""

from homeassistant.helpers.entity import DeviceInfo, Entity

from .const import DOMAIN

ICON_MAP = {
    "power": "power", "droplets": "water", "snowflake": "snowflake",
    "fan": "fan", "volume-2": "volume-high", "sun": "white-balance-sunny",
    "lightbulb": "lightbulb", "chevron-up": "chevron-up",
    "chevron-down": "chevron-down", "move-vertical": "swap-vertical",
    "move-horizontal": "swap-horizontal", "settings": "cog",
    "timer": "timer-outline", "timer-off": "timer-off-outline",
    "thermometer": "thermometer", "wind": "weather-windy",
    "zap": "lightning-bolt", "leaf": "leaf", "moon": "weather-night",
}


class IRProEntity(Entity):
    """An entity backed by a stable function UUID, not its visible name."""

    _attr_should_poll = False
    _attr_has_entity_name = True

    def __init__(self, manager, key: str) -> None:
        self.manager = manager
        self.key = key
        self._attr_unique_id = key
        found = manager.find_function(key)
        if found:
            self.entity_id = found[2]["entity"]

    @property
    def name(self):
        found = self.manager.find_function(self.key)
        return found[2]["name"] if found else None

    @property
    def icon(self):
        found = self.manager.find_function(self.key)
        return "mdi:" + ICON_MAP.get(found[2]["icon"], "remote") if found else "mdi:remote"

    @property
    def available(self) -> bool:
        return self.manager.function_available(self.key)

    @property
    def device_info(self):
        found = self.manager.find_function(self.key)
        if not found:
            return None
        emitter, device, _ = found
        info = DeviceInfo(
            identifiers={(DOMAIN, device["id"])}, name=device["name"],
            manufacturer="IR Pro", model="Mando virtual",
        )
        source = self.manager.registry.async_get(emitter["sourceId"])
        if source and source.device_id:
            info["via_device_id"] = source.device_id
        return info

    @property
    def extra_state_attributes(self):
        found = self.manager.find_function(self.key)
        if not found:
            return {}
        source = self.manager.registry.async_get(found[0]["sourceId"])
        return {"ir_pro_function": self.key,
                "source_entity_id": source.entity_id if source else None}

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(self.manager.async_add_listener(self.async_write_ha_state))
