"""Real button entities for learned IR commands."""

from homeassistant.components.button import ButtonEntity
from homeassistant.exceptions import HomeAssistantError

from .entity import IRProEntity
from .errors import IRProError


async def async_setup_entry(hass, entry, async_add_entities) -> None:
    await entry.runtime_data.async_register_platform("button", async_add_entities, IRProButton)


class IRProButton(IRProEntity, ButtonEntity):
    """A single action without an inferred on/off state."""

    async def async_press(self) -> None:
        try:
            await self.manager.async_press(self.key)
        except IRProError as err:
            raise HomeAssistantError(err.message) from err
