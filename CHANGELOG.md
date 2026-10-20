# Changelog

## 0.2.0b1

- Add remotes with adjustable settings, configurable displays, folders and dual-action buttons.
- Learn complete air-conditioner states and expose each learned state as a real button entity, with one independent off state.
- Configure two to five fan speeds with optional automatic mode, and up to six fixed swing positions with automatic and disabled options.
- Show available room temperature and humidity sensors associated with the transmitter.
- Keep learned-signal testing optional, with an animated listening indicator and a clear capture result.
- Restore icon previews, improve remote layout editing and compact the state/entity table with copy actions.
- Preserve existing remotes, learned references and entity identifiers when upgrading from the first beta.

## 0.1.0b3

- Keep source state and registry event callbacks on Home Assistant's event loop, fixing entity update errors after startup.
- Includes the direct learn-and-save flow from beta 2; existing remotes, signals and entity IDs are preserved.

## 0.1.0b2

- Save a learned signal directly without first testing it or confirming the appliance's response.
- Keep signal testing optional; learning and saving never send an infrared command.
- Check that Broadlink stored a valid code without emitting infrared, so failed captures cannot be saved as learned.
- Preserve existing signals and entity IDs, including signals verified in the first beta.

## 0.1.0b1

First public beta for installation through a HACS custom repository.

- Empty initial configuration with recognized Broadlink transmitter selection.
- Visual remote editor, centered dialogs, icons, optional labels and grid rows.
- Real button and switch entities with stable internal identities.
- Learning, explicit physical testing and confirmation of commands.
- Revision-checked server persistence and duplication at the chosen destination.
- No prototype data import, automatic signal sending or movement of existing remotes.
