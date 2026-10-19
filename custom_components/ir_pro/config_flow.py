"""UI setup for one empty IR Pro installation."""

from homeassistant.config_entries import ConfigFlow

from .const import DOMAIN


class IRProConfigFlow(ConfigFlow, domain=DOMAIN):
    """Add one manager. Emitters are selected explicitly inside the panel."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if user_input is not None:
            return self.async_create_entry(title="IR Pro", data={})
        return self.async_show_form(step_id="user")
