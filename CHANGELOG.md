# Changelog

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
