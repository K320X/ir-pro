# IR Pro

<img src="brand/icon.svg" alt="IR Pro" width="96" height="96">

Visual infrared remotes for Home Assistant.

**0.1.0 beta** is the first experimental release. IR Pro starts empty: it does not import demo remotes, modify your existing scripts or take over physical devices.

Build your own remotes with buttons, optional labels, icons, colors and independent grid rows. Learn commands from a physical remote, test them and expose real Home Assistant entities for automations.

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
2. Open **Editar mando** and add a function. Choose a button for a single action, or a switch with separate on/off commands.
3. Select **Aprender del mando original**, point the original remote at the Broadlink and press the required key.
4. Use **Probar señal**. Confirm that the appliance responded before saving the function.
5. Find the function's entity under **Entidad para automatizaciones**. It can be used by Home Assistant automations and scripts.

Changes are stored in Home Assistant, not in browser storage. Transmitter selection uses stable entity registry IDs. Renaming a remote or function does not automatically change an existing entity ID.

## Beta scope and limitations

- Initially supports learning and sending through **Broadlink `remote` entities**. Other IR adapters are not supported yet.
- IR is normally one-way. A successful send does not confirm delivery; switch state is estimated.
- Some Home Assistant/Broadlink versions do not propagate every learning error. This beta requires a physical test and user confirmation rather than declaring capture success automatically.
- Many air conditioner remotes send the full configuration in one message. A learned “temperature up” key may replay a fixed temperature, mode and fan setting. Use explicit presets unless your protocol has been verified.
- Duplicating preserves layout and presentation. Signals can be reused on the same transmitter. A copy created under another transmitter must learn its signals there; copying a flag cannot transfer Broadlink's stored codes.
- Existing remotes cannot be moved between transmitters. Create a copy at its destination so the original entities remain intact.
- Existing entity IDs and entity types cannot be changed in this beta. Choose them when creating a function; visible names remain editable.
- Removing a function or remote is permanent. References in automations, scripts or dashboards must be reviewed. Removing an emitter from IR Pro does not remove the physical Broadlink integration.
- Deletion removes IR Pro metadata and its own entities. This beta leaves previously learned commands in Broadlink's storage; deleted functions can no longer call them through IR Pro.
- The management panel requires administrator access. Normal entity use follows Home Assistant permissions.

## Updates and recovery

Create a Home Assistant backup before installing or updating a custom integration. IR Pro metadata is kept in Home Assistant's configuration storage and included in normal configuration backups. Learned commands are kept by the Broadlink integration. Do not edit either integration's `.storage` files manually.

To remove IR Pro, remove its integration entry, uninstall it in HACS and restart Home Assistant. Existing Broadlink devices and unrelated scripts remain configured.

## Development

```sh
python -m unittest discover -s tests -v
python -m compileall -q custom_components
node --check custom_components/ir_pro/frontend/ir-pro-panel.js
python scripts/build_release.py
```

GitHub Actions runs the unit tests, JavaScript syntax check, HACS validation and Hassfest. Physical infrared behavior requires testing with actual hardware.

## License

MIT. IR Pro is an independent community project for Home Assistant.
