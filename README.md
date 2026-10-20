# IR Pro

<img src="brand/icon.svg" alt="IR Pro" width="96" height="96">

Visual infrared remotes for Home Assistant.

**0.2.0 beta** adds editable remotes with settings, displays and learned states. IR Pro starts empty: it does not import demo remotes, modify your existing scripts or take over physical devices. Upgrading preserves existing remotes, learned signals and entity identifiers.

Build your own remotes with buttons, dual actions, folders, optional labels, icon previews, colors and independent grid rows. Learn commands from a physical remote, save them directly and expose real Home Assistant entities for automations. Testing a signal is optional.

## Install with HACS

Requires Home Assistant **2026.10 or later**, HACS and a supported Broadlink remote already configured in Home Assistant.

1. Open **HACS → menu → Custom repositories**.
2. Add `https://github.com/K320X/ir-pro` with type **Integration**.
3. Open **IR Pro** and download the release. For beta versions, enable prereleases or select the beta explicitly.
4. Restart Home Assistant.
5. Go to **Settings → Devices & services → Add integration → IR Pro**.
6. Open **IR Pro** in the sidebar. Select **Añadir emisor** to start.

No YAML, browser tokens or manufacturer cloud account are required by IR Pro. Configure the physical transmitter through its existing Home Assistant integration first.

This repository is installed as a custom HACS repository; it is not listed in the default HACS catalog.

## First remote

1. Add a recognized transmitter, then create a device with its name and icon.
2. Open **Editar mando** and add a function. Choose a button for a single action, or a dual-action button with separate on/off commands.
3. Select **Aprender del mando original**, point the original remote at the Broadlink and press the required key.
4. Select **Guardar cambios** to keep the learned signal. **Probar señal** is optional and sends the command only when selected.
5. Find the function's entity under **Entidad para automatizaciones**. It can be used by Home Assistant automations and scripts.

Changes are stored in Home Assistant, not in browser storage. Transmitter selection uses stable entity registry IDs. Renaming a remote or function does not automatically change an existing entity ID.

## Remotes with settings

When creating a device, choose **Mando con estados** for equipment such as an air conditioner that sends its complete configuration in an IR message. The editable starting layout includes a display, mode, one combined on/off button, five fan speeds with automatic mode, temperature controls, six swing positions with oscillation and disabled options, and a light button. Every element can be edited or removed. Existing layouts are preserved. Fan folders can be configured for two to five speeds.

To learn a state, first prepare the settings in IR Pro and on the physical remote. Select **Aprender este estado del mando original**. For an on state, start with the physical remote off, point it at the transmitter and press **Encender** with the intended settings. For the off state, press **Apagar**. A temperature or fan key may not include the instruction to turn the appliance on. Save after the signal is received. Each learned state appears in the state/entity table as a real `button` entity. The off state is independent of temperature, mode, fan and swing. Copy the entity ID to use it in automations.

Changing a setting can send its matching learned state; IR Pro does not guess or synthesize unknown IR protocols. If the combination has no learned signal, it must be learned before it can control the appliance. Preparing temperature, mode, fan or swing while the remote is off does not turn the appliance on. Loading, saving, duplicating and restarting never send IR automatically.

The display shows the remote's estimated settings, not confirmation from the appliance. Available temperature and humidity readings from the transmitter's Home Assistant device are shown separately as room measurements. Missing or unavailable measurements are omitted.

## Beta scope and limitations

- Initially supports learning and sending through **Broadlink `remote` entities**. Other IR adapters are not supported yet.
- IR is normally one-way. A successful send does not confirm delivery; switch state is estimated.
- A captured signal is immediately available for saving. IR Pro checks the stored command with zero repetitions through Broadlink's public service, without emitting infrared. This handles capture errors that the learning service may otherwise hide. Testing the appliance's response remains optional.
- Many air conditioner remotes send the full configuration in one message. Use a remote with settings and learn complete states for those appliances. A simple learned “temperature up” key can otherwise replay a fixed temperature, mode and fan setting.
- Duplicating preserves layout and presentation. Signals can be reused on the same transmitter. A copy created under another transmitter must learn its signals there; copying a flag cannot transfer Broadlink's stored codes.
- Existing remotes cannot be moved between transmitters. Create a copy at its destination so the original entities remain intact.
- Existing entity IDs and entity types cannot be changed in this beta. Choose them when creating a function; visible names remain editable.
- Removing a function or remote is permanent. References in automations, scripts or dashboards must be reviewed. Removing an emitter from IR Pro does not remove the physical Broadlink integration.
- Deletion removes IR Pro metadata and its own entities. This beta leaves previously learned commands in Broadlink's storage; deleted functions can no longer call them through IR Pro.
- The management panel requires administrator access. Normal entity use follows Home Assistant permissions.

## Updates and recovery

Create a Home Assistant backup before installing or updating a custom integration. IR Pro metadata is kept in Home Assistant's configuration storage and included in normal configuration backups. Learned commands are kept by the Broadlink integration. Do not edit either integration's `.storage` files manually.

For an update:

1. Publish/install a tagged GitHub release. In HACS, enable prereleases for IR Pro if you want beta updates.
2. When HACS detects the release, **Settings → System → Updates** shows the IR Pro update. Select it and choose **Install**. You can also update from IR Pro's HACS repository page.
3. Restart Home Assistant when the installation finishes, then reload the browser or app to load the new panel assets.
4. Open IR Pro and check your existing remotes and entities. If the release is not listed yet, use **Update information** on the repository's HACS menu.

Updating downloads files through HACS; it does not run a GitHub version directly. HACS checks for releases periodically, so a publication can take time to appear. The integration restart is still required after the download.

To remove IR Pro, remove its integration entry, uninstall it in HACS and restart Home Assistant. Existing Broadlink devices and unrelated scripts remain configured. Uninstalling does not purge IR Pro's saved metadata; reinstalling can restore it. To discard remotes, delete them in the panel before uninstalling.

## Development

```sh
python -m unittest discover -s tests -v
python -m compileall -q custom_components
node --check custom_components/ir_pro/frontend/ir-pro-panel.js
python scripts/build_release.py
```

GitHub Actions runs the unit tests, syntax checks for every frontend module, HACS validation and Hassfest. Physical infrared behavior requires testing with actual hardware.

## License

MIT. IR Pro is an independent community project for Home Assistant.
