"""Switches with two independently verified commands and assumed state."""

from homeassistant.components.switch import SwitchEntity
from homeassistant.exceptions import HomeAssistantError

from .entity import IRProEntity
from .const import DOMAIN
from .errors import IRProError


async def async_setup_entry(hass, entry, async_add_entities) -> None:
    await entry.runtime_data.async_register_platform("switch", async_add_entities, IRProSwitch)


class IRProSwitch(IRProEntity, SwitchEntity):
    """The last requested state; unknown after startup, never device feedback."""

    _attr_assumed_state = True

    @property
    def is_on(self) -> bool | None:
        found = self.manager.find_function(self.key)
        return found[2].get("on") if found else None

    async def _send(self, on: bool) -> None:
        try:
            await self.manager.async_press(self.key, desired=on)
        except IRProError as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN, translation_key=err.translation_key,
            ) from err

    async def async_turn_on(self, **kwargs) -> None:
        await self._send(True)

    async def async_turn_off(self, **kwargs) -> None:
        await self._send(False)
