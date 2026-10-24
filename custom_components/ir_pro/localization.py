"""Translate backend presentation without changing saved names or commands.

The operation code and the original diagnostic message remain stable. Only
messages at the WebSocket/HA exception boundary are localized. This catalog is
kept in memory, so command handling never reads translation files on the loop.
"""

from typing import Any


def normalize_language(language: Any) -> str:
    """Use the two supported languages, including HA's regional language tags."""
    if isinstance(language, str) and language.lower().replace("_", "-").split("-", 1)[0] == "es":
        return "es"
    return "en"


# key, existing Spanish diagnostic, English presentation. Explicit keys also
# serve as native Home Assistant exception translation keys.
MESSAGES = (
    ("operation_failed", "No se ha podido completar la operación.", "Unable to complete the operation."),
    ("permission_denied", "Solo los administradores pueden realizar esta operación.", "Only administrators can perform this operation."),
    ("not_loaded", "IR Pro no está cargado.", "IR Pro is not loaded."),
    ("single_installation", "Solo se permite una instalación de IR Pro.", "Only one IR Pro installation is allowed."),
    ("learned_action_index", "Cada acción aprendida debe corresponder a una acción distinta del botón doble.", "Each learned action must belong to a different side of the dual-action button."),
    ("function_placement", "Cada función debe aparecer exactamente una vez en el mando.", "Each function must appear exactly once in the remote."),
    ("mixed_dual_actions", "Cada lado aprendido del botón mixto necesita su propia acción; dos lados aprendidos usan una entidad switch.", "Each learned side of a mixed button needs its own action; two learned sides use one switch entity."),
    ("independent_setting", "El ajuste de la acción independiente no es válido.", "The independent action's setting is invalid."),
    ("dual_action_count", "El botón de doble acción necesita dos acciones.", "The dual-action button needs two actions."),
    ("folder_content", "El contenido de la carpeta no es válido.", "The folder contents are invalid."),
    ("device_changed_learning", "El dispositivo ha cambiado durante el aprendizaje.", "The device changed while learning the signal."),
    ("signal_source", "El dispositivo y la señal no corresponden al emisor.", "The device and signal do not belong to this transmitter."),
    ("device_missing", "El dispositivo ya no existe.", "The device no longer exists."),
    ("editor_limit", "El editor contiene demasiadas funciones o niveles.", "The editor contains too many functions or levels."),
    ("signal_effect_retained", "El efecto de una señal existente se conserva. Crea otra función para cambiarlo.", "An existing signal's effect is preserved. Create another function to change it."),
    ("editor_effect_mismatch", "El efecto del editor no corresponde a su función real.", "The editor effect does not match its actual function."),
    ("source_offline", "El emisor está desconectado o desactivado.", "The transmitter is disconnected or disabled."),
    ("source_busy", "El emisor está ocupado. Espera a que termine la operación.", "The transmitter is busy. Wait for the operation to finish."),
    ("source_unavailable", "El emisor no está disponible en Home Assistant.", "The transmitter is unavailable in Home Assistant."),
    ("source_timeout", "El emisor no ha respondido a tiempo. Espera unos segundos y vuelve a intentarlo.", "The transmitter timed out. Wait a few seconds and try again."),
    ("source_missing", "El emisor ya no está disponible en Home Assistant.", "The transmitter is no longer available in Home Assistant."),
    ("off_state_fields", "El estado de apagado solo incluye el encendido.", "The off state includes only the power setting."),
    ("dual_state_invalid", "El estado del botón de doble acción no es válido.", "The dual-action button's state is invalid."),
    ("remote_state_invalid", "El estado del mando no es válido.", "The remote state is invalid."),
    ("saved_state_changed", "El estado guardado ha cambiado. Recarga el mando antes de enviarlo.", "The saved state changed. Reload the remote before sending it."),
    ("saved_state_entity", "El estado guardado no corresponde a una entidad button de este mando.", "The saved state does not belong to a button entity of this remote."),
    ("device_icon", "El icono del dispositivo no es válido.", "The device icon is invalid."),
    ("function_style", "El icono o el color de la función no es válido.", "The function icon or color is invalid."),
    ("editor_style", "El icono o el color del editor no son válidos.", "The editor icon or color is invalid."),
    ("editor_id", "El identificador del editor no es válido.", "The editor identifier is invalid."),
    ("remote_mode_speed", "El modo o la velocidad del mando no son válidos.", "The remote mode or fan speed is invalid."),
    ("entity_identifier", "El nombre de entidad debe conservar button. o switch. y usar un identificador válido.", "The entity ID must keep the button. or switch. domain and use a valid identifier."),
    ("cell_count", "El número de casillas no coincide con las columnas.", "The number of cells does not match the columns."),
    ("send_mode", "El tipo de envío de la función no es válido.", "The function's send type is invalid."),
    ("editor_row_type", "El tipo de fila del editor no es válido.", "The editor row type is invalid."),
    ("editor_function_type", "El tipo de función del editor no es válido.", "The editor function type is invalid."),
    ("editor_remote_type", "El tipo de mando del editor no es válido.", "The editor remote type is invalid."),
    ("editor_action_value", "El valor de la acción del editor no es válido.", "The editor action value is invalid."),
    ("stateful_remote_required", "Este dispositivo no es un mando con estados.", "This device is not a remote with states."),
    ("learning_unsupported", "Este emisor no permite aprender señales.", "This transmitter does not support learning signals."),
    ("source_duplicate", "Este emisor ya está añadido.", "This transmitter has already been added."),
    ("state_not_learned", "Este estado no tiene una señal aprendida. Aprende primero este estado del mando original.", "This state has no learned signal. First learn this state from the original remote."),
    ("duplicate_entities", "Hay entidades repetidas.", "There are duplicate entities."),
    ("duplicate_internal_ids", "Hay identificadores internos repetidos.", "There are duplicate internal identifiers."),
    ("duplicate_independent_options", "Hay opciones independientes repetidas en esta carpeta.", "There are duplicate independent options in this folder."),
    ("invalid_device", "Hay un dispositivo no válido.", "A device is invalid."),
    ("invalid_source", "Hay un emisor no válido.", "A transmitter is invalid."),
    ("invalid_saved_state", "Hay un estado guardado no válido.", "A saved state is invalid."),
    ("invalid_internal_id", "Hay un identificador interno no válido.", "An internal identifier is invalid."),
    ("invalid_editor_row", "Hay una fila del editor no válida.", "An editor row is invalid."),
    ("invalid_row", "Hay una fila no válida.", "A row is invalid."),
    ("invalid_columns_or_row", "Hay una fila repetida o un número de columnas no válido.", "There is a duplicate row or an invalid column count."),
    ("invalid_function", "Hay una función no válida.", "A function is invalid."),
    ("invalid_stored_signal", "Hay una referencia de señal guardada no válida.", "A stored signal reference is invalid."),
    ("ambiguous_state", "Hay varias capturas para estos ajustes. Conserva una sola antes de enviar el estado.", "There are multiple captures for these settings. Keep only one before sending the state."),
    ("reloading", "IR Pro se está recargando.", "IR Pro is reloading."),
    ("learned_action_effect", "La acción aprendida debe ser un botón sin cambios de ajustes.", "A learned action must be a button that does not change settings."),
    ("editor_action", "La acción del editor no es válida.", "The editor action is invalid."),
    ("independent_one_setting", "La acción independiente debe cambiar un único ajuste.", "An independent action must change exactly one setting."),
    ("row_height", "La altura de la fila no es válida.", "The row height is invalid."),
    ("capture_fields_changed", "La captura debe incluir únicamente los ajustes combinados actuales del mando. Recarga el panel antes de grabar el estado.", "The capture must include only the remote's current combined settings. Reload the panel before learning the state."),
    ("folder_limit", "La carpeta contiene demasiadas funciones.", "The folder contains too many functions."),
    ("collection_limit", "La colección no es válida o supera el tamaño permitido.", "The collection is invalid or exceeds the allowed size."),
    ("editor_element_limit", "La configuración del editor contiene demasiados elementos.", "The editor configuration contains too many elements."),
    ("editor_json", "La configuración del editor no contiene JSON válido.", "The editor configuration does not contain valid JSON."),
    ("editor_size", "La configuración del editor supera el tamaño permitido.", "The editor configuration exceeds the allowed size."),
    ("editor_depth", "La configuración del editor tiene demasiados niveles.", "The editor configuration has too many levels."),
    ("stored_configuration", "La configuración guardada de IR Pro no es válida.", "The saved IR Pro configuration is invalid."),
    ("revision_conflict", "La configuración ha cambiado en otra ventana. Recarga antes de guardar.", "The configuration changed in another window. Reload before saving."),
    ("invalid_configuration", "La configuración no es válida.", "The configuration is invalid."),
    ("row_layout", "La distribución de filas no es válida.", "The row layout is invalid."),
    ("editor_layout", "La distribución del editor no es válida.", "The editor layout is invalid."),
    ("entity_domain", "La entidad debe usar button. o switch. y un nombre válido.", "The entity must use button. or switch. and a valid name."),
    ("entity_occupied", "La entidad elegida ya está en uso. Escribe otro identificador.", "The chosen entity ID is already in use. Enter another identifier."),
    ("entity_ownership", "La entidad no pertenece a esta integración de IR Pro.", "The entity does not belong to this IR Pro integration."),
    ("function_identity_retained", "La entidad y el tipo de una función existente se conservan.", "An existing function's entity and type are preserved."),
    ("editor_function", "La función del editor no es válida.", "The editor function is invalid."),
    ("function_unavailable", "La función no está disponible o necesita aprender sus señales.", "The function is unavailable or its signals need to be learned."),
    ("new_function_identifier", "La función nueva necesita un identificador válido.", "The new function needs a valid identifier."),
    ("function_missing", "La función ya no está disponible.", "The function is no longer available."),
    ("action_identity_retained", "La identidad de una acción existente se conserva.", "An existing action's identity is preserved."),
    ("independent_effect_mismatch", "La opción independiente no coincide con el ajuste de su señal.", "The independent option does not match its signal's setting."),
    ("remote_display", "La pantalla del mando no es válida.", "The remote display is invalid."),
    ("swing_position", "La posición de oscilación no es válida.", "The swing position is invalid."),
    ("signal_function", "La señal no corresponde a esta función.", "The signal does not belong to this function."),
    ("signal_missing", "La señal no existe. Aprende la señal de nuevo.", "The signal does not exist. Learn it again."),
    ("signal_missing_relearn", "La señal no existe. Vuelve a aprenderla.", "The signal does not exist. Learn it again."),
    ("configuration_version", "La versión de la configuración no es válida.", "The configuration version is invalid."),
    ("name_visibility", "La visibilidad del nombre no es válida.", "The name visibility is invalid."),
    ("dual_learned_actions", "Las acciones aprendidas del botón doble no son válidas.", "The dual-action button's learned actions are invalid."),
    ("folder_independent_actions", "Las acciones independientes de la carpeta no son válidas.", "The folder's independent actions are invalid."),
    ("independent_stateful_required", "Las acciones independientes necesitan un mando con estados.", "Independent actions need a remote with states."),
    ("editor_cell_count", "Las casillas del editor no coinciden con las columnas.", "The editor cells do not match the columns."),
    ("signal_references", "Las referencias de señal no son válidas.", "The signal references are invalid."),
    ("controlled_fields_changed", "Los ajustes combinados del mando han cambiado. Recarga antes de enviarlos.", "The remote's combined settings changed. Reload before sending them."),
    ("saved_state_retained", "Los ajustes de un estado guardado se conservan. Crea otro estado para cambiarlos.", "A saved state's settings are preserved. Create another state to change them."),
    ("controlled_fields_invalid", "Los ajustes incluidos en el estado no son válidos.", "The settings included in the state are invalid."),
    ("capture_scope_retained", "Los ajustes incluidos en una captura existente se conservan. Crea otro estado para cambiarlos.", "The settings included in an existing capture are preserved. Create another state to change them."),
    ("entity_changes", "Los cambios de entidades no son válidos.", "The entity changes are invalid."),
    ("saved_states_invalid", "Los estados guardados del mando no son válidos.", "The remote's saved states are invalid."),
    ("entity_save_failed", "No se ha podido guardar el cambio de entidad.", "Unable to save the entity ID change."),
    ("configuration_save_failed", "No se ha podido guardar la configuración.", "Unable to save the configuration."),
    ("entity_restore_failed", "No se ha podido restaurar el nombre de la entidad. Revisa el registro de entidades antes de volver a guardar.", "Unable to restore the entity ID. Check the entity registry before saving again."),
    ("source_change_forbidden", "No se puede cambiar el emisor físico de un mando existente.", "An existing remote's physical transmitter cannot be changed."),
    ("identifier_reuse", "No se puede reutilizar un identificador interno para otro tipo de elemento.", "An internal identifier cannot be reused for a different type of item."),
    ("device_move", "No se pueden mover dispositivos existentes a otro emisor.", "Existing devices cannot be moved to another transmitter."),
    ("function_move", "No se pueden mover funciones existentes a otro dispositivo.", "Existing functions cannot be moved to another device."),
    ("signal_confirmation_required", "Prueba primero la señal y confirma que el aparato ha respondido.", "Test the signal first and confirm that the device responded."),
    ("function_limit", "Se ha superado el límite de funciones.", "The function limit has been exceeded."),
    ("entity_rename_type", "Solo se puede cambiar la entidad de una función existente del mismo tipo.", "Only an existing function's entity of the same type can be renamed."),
    ("dual_learned_only", "Solo un botón doble puede tener acciones aprendidas separadas.", "Only a dual-action button can have separate learned actions."),
    ("independent_button_required", "Solo una entidad button puede tener una acción independiente.", "Only a button entity can have an independent action."),
    ("controlled_setting_invalid", "Un ajuste incluido en el estado no es válido.", "A setting included in the state is invalid."),
    ("duplicate_editor_element", "Un elemento del editor aparece más de una vez.", "An editor item appears more than once."),
    ("simple_climate_settings", "Un mando de botones no puede modificar ajustes de climatización.", "A button remote cannot change climate settings."),
    ("independent_learned_button", "Una acción independiente debe ser un botón aprendido de un mando con estados.", "An independent action must be a learned button of a remote with states."),
    ("independent_complete_state", "Una acción independiente no puede representar un estado completo.", "An independent action cannot represent a complete state."),
    ("editor_entity_mismatch", "Una función del editor no corresponde a una entidad real de este mando.", "An editor function does not belong to an actual entity of this remote."),
    ("function_repeated", "Una función está repetida o situada en una fila incorrecta.", "A function is repeated or placed in an incorrect row."),
    ("capture_invalid", "No se ha capturado una señal válida. Vuelve a aprenderla.", "No valid signal was captured. Learn it again."),
    ("source_operation_failed", "No se ha podido completar la operación con el emisor.", "Unable to complete the operation with the transmitter."),
    ("invalid_model_name", "El modelo no es válido.", "The model is invalid."),
    ("invalid_auto_mode", "El modo automático no es válido.", "The automatic mode is invalid."),
    ("invalid_function_name", "El nombre de la función no es válido.", "The function name is invalid."),
    ("invalid_device_name", "El nombre del dispositivo no es válido.", "The device name is invalid."),
    ("invalid_source_name", "El nombre del emisor no es válido.", "The transmitter name is invalid."),
    ("invalid_button_action", "La acción del botón no es válido.", "The button action is invalid."),
    ("invalid_visible_action", "La acción visible no es válido.", "The visible action is invalid."),
    ("invalid_height", "La altura no es válido.", "The height is invalid."),
    ("invalid_display_height", "La altura de la pantalla no es válido.", "The display height is invalid."),
    ("invalid_display_width", "La anchura de la pantalla no es válido.", "The display width is invalid."),
    ("invalid_position_count", "La cantidad de posiciones no es válido.", "The position count is invalid."),
    ("invalid_speed_count", "La cantidad de velocidades no es válido.", "The fan speed count is invalid."),
    ("invalid_state_date", "La fecha del estado no es válido.", "The state date is invalid."),
    ("invalid_display_information", "La información de la pantalla no es válido.", "The display information is invalid."),
    ("invalid_swing_auto", "La oscilación automática no es válido.", "The automatic swing setting is invalid."),
    ("invalid_swing_off", "La oscilación desactivada no es válido.", "The disabled swing setting is invalid."),
    ("invalid_temperature", "La temperatura no es válido.", "The temperature is invalid."),
    ("invalid_text_visibility", "La visibilidad del texto no es válido.", "The text visibility is invalid."),
    ("invalid_column_count", "Las columnas no es válido.", "The column count is invalid."),
)

_BY_SPANISH = {spanish: (key, english) for key, spanish, english in MESSAGES}


def translation_key(message: str) -> str:
    """Unknown diagnostics get a safe translated fallback, never raw payloads."""
    return _BY_SPANISH.get(message, ("operation_failed", ""))[0]


def localize_message(message: str, language: Any) -> str:
    """Localize a known diagnostic only; caller data is never translated."""
    if normalize_language(language) == "es":
        return message
    return _BY_SPANISH.get(message, ("operation_failed", "Unable to complete the operation."))[1]


def localize_result(result: Any, language: Any) -> Any:
    """Translate top-level save notices without rewriting any model values."""
    if not isinstance(result, dict) or not isinstance(result.get("notices"), list):
        return result
    if normalize_language(language) == "es":
        return result
    notices = []
    for notice in result["notices"]:
        if not isinstance(notice, str):
            continue
        prefix, suffix = "La entidad ya existía. Se ha usado ", "."
        if notice.startswith(prefix) and notice.endswith(suffix):
            # This substring is an entity ID, not a translation source.
            notices.append(f"The entity already existed. Used {notice[len(prefix):-len(suffix)]}.")
        elif notice == "El mando se ha copiado a otro emisor. Aprende de nuevo sus señales.":
            notices.append("The remote was copied to another transmitter. Learn its signals again.")
        else:
            notices.append(localize_message(notice, language))
    return {**result, "notices": notices}
