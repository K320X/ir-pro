# IR Pro

<img src="brand/icon.svg" alt="IR Pro" width="96" height="96">

**Build infrared remotes that work the way your appliance does.**

[English](README.md) · [Español](docs/README.es.md) · [Latest stable release](https://github.com/K320X/ir-pro/releases/latest)

IR Pro is a visual remote editor for Home Assistant. Learn ordinary commands, capture complete air conditioner settings, and combine both in one editable remote. Buttons, displays, folders and real Home Assistant entities stay together in one place.

<img src="docs/images/remote-states-en.jpg" alt="Example air conditioner remote with a display, temperature, mode, fan and swing controls, plus a table of learned states and their entities" width="720">

*An air conditioner remote with estimated settings and learned states. Screenshots use fictional example devices and readings.*

## Why an infrared remote needs more than buttons

A learned code is not always a simple instruction such as “increase temperature.” Some air conditioner protocols include mode, temperature and fan speed in the same transmission. A code learned while pressing **+** at **Heat · 24 °C · Fan 3** may replay that combination later, even if the appliance is currently cooling. Calling the recording “temperature up” does not change what it contains. The [ESPHome LG implementation](https://github.com/esphome/esphome/blob/dev/esphome/components/climate_ir_lg/climate_ir_lg.cpp) illustrates combined setting messages, separate swing commands and distinct power-on messages.

This makes a remote made only of named recordings easy to misunderstand. At the other extreme, placing every combination in a separate script or dashboard button creates a growing list to organize and maintain. A protocol-specific climate integration can generate supported combinations, but it needs an implementation compatible with the appliance; [ESPHome documents its supported IR climate platforms](https://esphome.io/components/climate/climate_ir/).

IR Pro makes the recording's meaning explicit:

| What the physical command does | Configure it in IR Pro | What is sent |
| --- | --- | --- |
| Performs one independent action, such as mute or light | A learned button or **Independent action** | That action's own recording |
| Applies several settings together, such as power, mode, temperature and fan | **Remote settings** | The learned recording matching those settings |
| Handles some settings together and others separately | Combine both behaviors in the same remote | A complete-state recording for linked settings; separate recordings for independent controls |

For example, an air conditioner can use **Remote settings** for mode, temperature, fan and power, while swing and light remain **Independent actions**. Changing swing then uses its own learned command. Swing is excluded from the combined recording's name and matching fields instead of creating unnecessary complete-state combinations.

**IR Pro organizes and replays signals you teach it. It does not decode unknown protocols or generate combinations you have never learned.** Learn the combinations you need; if a matching recording is missing, IR Pro does not substitute another signal.

## One remote, different kinds of controls

<img src="docs/images/state-actions-en.jpg" alt="Function editor showing the choice between remote settings and an independent action" width="720">

*Choose whether a control participates in the combined settings or has its own independent recording.*

- **Buttons** send a learned signal or change a linked setting.
- **Dual-action buttons** keep two actions in one tile, with separate names, icons and colors. A learned on/off pair exposes one Home Assistant switch.
- **Folders** reveal modes, fan speeds, swing positions or your own grouped controls. Configure two to five fan speeds, optional automatic fan mode, up to six fixed swing positions, oscillation and disabled swing.
- **Displays** show the estimated remote settings at a configurable size. If the transmitter publishes temperature or humidity sensors on its Home Assistant device, their available readings appear separately as room measurements. Missing or unavailable readings are simply omitted.
- **Starting layouts** provide editable air conditioner and television remotes. They are applied only when creating a device; changing an existing icon never replaces its controls.

The interface follows the Home Assistant user's language: **English and Spanish** are available, with English as the fallback. Number formatting follows the selected interface language. Your remote names, labels and entity IDs are not translated or renamed automatically.

### Learn a complete state

1. Set the desired combination in IR Pro, for example **Heat · 24 °C · Fan 3**. Configure the same settings on the original remote.
2. Select **Learn state**. The suggested state name is editable.
3. For an on state, start with the original remote off, point it at the Broadlink and press **On** with the intended settings. For the off state, press **Off**. A temperature or fan key may omit the instruction to turn the appliance on.
4. Save when the signal arrives. Testing it is optional.
5. Find the saved state and its real `button` entity in the table. Copy its entity ID for an automation or script.

<img src="docs/images/state-learning-en.jpg" alt="Learn state dialog with an editable suggested name, the entity to be created and an active listening indicator" width="720">

*Prepare the original remote, start listening, and capture the exact command for those settings.*

**Off is one state.** It does not need a separate recording for every temperature, mode or fan speed. Preparing other settings while the remote is off does not turn the appliance on.

The **Send remote settings signal** action resends the recording matching the current settings without changing them first. It is available on a button, either side of a dual-action button, or a custom folder child. It respects independent settings and uses the off recording when power is off. No matching learned state means no infrared transmission.

Learn independent commands inside their function or folder editor. They have their own signals and entities, and do not appear in the complete-state table. After a successful send, only their declared setting changes in the estimated display. This behavior also supports independent power or temperature controls when that matches the physical protocol.

Each state recording retains the fields it controls. Changing a folder to independent does not silently reinterpret an older, broader recording: IR Pro only sends recordings whose field scope matches the current configuration. When all settings are independent, there is no combined state to learn.

### Ordinary remotes stay simple

<img src="docs/images/tv-remote-en.jpg" alt="Editable television starting layout with a dual-action power button, volume, channel, source and compact numeric keys" width="420">

*The television layout uses individually learned commands, without an air conditioner state panel.*

Choose the television icon to start with a compact three-column layout: dual-action power, volume, mute, channel, source and digits 1–9, with 0 centered below. Both air conditioner icons choose the same air conditioner layout, including a display and configurable folders. Every starting control can be edited, replaced or removed.

## Install with HACS

Requires Home Assistant **2026.10 or later**, HACS and a supported Broadlink remote already configured in Home Assistant.

1. Open **HACS → menu → Custom repositories**.
2. Add `https://github.com/K320X/ir-pro` with type **Integration**.
3. Open **IR Pro** and download the latest stable release.
4. Restart Home Assistant.
5. Go to **Settings → Devices & services → Add integration → IR Pro**.
6. Open **IR Pro** in the sidebar and select **Add transmitter**.

IR Pro uses Broadlink's existing [learning and sending actions](https://www.home-assistant.io/integrations/broadlink/#remote). Configure the physical transmitter through that integration first. IR Pro itself requires no YAML, browser tokens or manufacturer cloud account; the manufacturer's app may be needed to connect a new Broadlink device to the network.

This repository is installed as a custom HACS repository; it is not listed in the default HACS catalog. IR Pro starts empty and does not import the example remotes shown here.

## Edit, learn and automate

1. Add a recognized transmitter, then create a device with its name and icon.
2. Open **Edit remote** to adjust the starting layout or add a function.
3. For an ordinary learned action, select **Learn from original remote**, point the original remote at the Broadlink and press the required key.
4. Select **Save changes** after reception. **Test signal** is optional and transmits only when selected.
5. Use the function or saved state's entity in Home Assistant automations and scripts.

A learned dual-action control exposes **one `switch` entity with two separately captured signals**. `switch.turn_on` runs Action 1 and `switch.turn_off` runs Action 2, targeting that same entity. Each call sends the corresponding signal once; the switch does not transmit continuously. Its visible state is estimated. A dual control can also combine a setting action with a separately learned action; the learned side has its own `button` entity.

Use the pencil beside **Entity** to edit an existing identifier. The domain (`button.` or `switch.`) stays fixed. A confirmed rename preserves its unique identity and learned signals; update automations, scripts and dashboards that reference the old ID.

Existing controls are editable, including controls supplied by a starting layout. Cosmetic changes preserve entities and recordings. If changing a function's type or meaning requires replacement, the editor shows the affected entities before saving. Replacement functions must learn their own signals. Canceling preserves the saved remote.

Changes are stored in Home Assistant rather than browser storage. Transmitter selection uses stable entity registry IDs. Renaming a remote or function does not automatically rename an existing entity.

## What to expect

- **Broadlink support:** learning and sending currently use Broadlink `remote` entities. Other IR adapters are not supported yet.
- **Estimated appliance state:** ordinary IR communication provides no delivery confirmation. The display represents IR Pro's estimated settings, not a measurement of the appliance. Operating the original remote outside a learning session does not automatically synchronize IR Pro. This one-way limitation also applies to [IR climate control without a supported receiver](https://esphome.io/components/climate/climate_ir/).
- **Learned combinations:** each required complete state must be captured from the original remote. IR Pro does not provide a universal protocol database, automatic protocol decoding or an automatically generated `climate` entity.
- **Explicit transmissions:** loading, saving, duplicating and restarting do not send IR automatically. A capture can be saved immediately. IR Pro checks Broadlink's stored command with zero repetitions, without emitting IR; testing the appliance's response remains optional.
- **Room sensors:** temperature and humidity are discovered on the transmitter's Home Assistant device, not from hard-coded entity names or arbitrary room sensors. Only available readings are shown.
- **Copies:** duplicating preserves layout and presentation. Signals can be reused on the same transmitter. A copy under another transmitter must learn its signals there; Broadlink's stored codes are not transferred. Existing remotes cannot be moved between transmitters.
- **Deletion:** deleting a function or remote removes its IR Pro metadata and entities. Review any automation using them. The physical Broadlink integration remains, and its previously learned codes are not purged. **Delete all states** removes only the remote's combined recordings and their IR Pro entities, leaving its layout and independent actions intact.
- **Access:** the management panel requires administrator access. Normal entity use follows Home Assistant permissions.

## Updates and recovery

Create a Home Assistant backup before installing or updating a custom integration. IR Pro metadata is included in normal configuration backups. Learned commands are kept by the Broadlink integration. Do not edit either integration's `.storage` files manually.

1. Install a tagged stable release through HACS. Enable prereleases only when intentionally testing one.
2. When the update appears in **Settings → System → Updates**, select IR Pro and choose **Install**. Its HACS repository page also offers updates.
3. Restart Home Assistant when installation finishes, then reload the browser or app to load the new panel assets.
4. Check your existing remotes and entities. If a release is not listed yet, select **Update information** in the repository's HACS menu.

Upgrades preserve existing remotes, learned signals and entity identifiers. HACS checks releases periodically, so publication may take time to appear. Updating downloads files through HACS; it does not run a GitHub version directly.

To uninstall, remove the IR Pro integration entry, uninstall it in HACS and restart Home Assistant. Broadlink devices and unrelated scripts remain configured. Uninstalling does not purge saved IR Pro metadata, so reinstalling can restore it. Delete remotes in the panel first if you intend to discard them.

## Development

```sh
python -m unittest discover -s tests -v
python -m compileall -q custom_components
node --check custom_components/ir_pro/frontend/ir-pro-panel.js
python scripts/build_release.py
```

GitHub Actions runs unit tests, frontend checks, HACS validation and Hassfest. Physical infrared behavior requires testing with actual hardware.

## License

MIT. IR Pro is an independent community project for Home Assistant.
