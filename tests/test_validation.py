"""Contract tests for state integrity and learned-signal trust boundaries."""

from copy import deepcopy
import unittest

from tests.helpers import (
    DEVICE, EMITTER, FUNCTION, OTHER_SOURCE, REF, SOURCE,
    backend_module, duplicate_device, empty_model, get_function,
    model_fixture, signal_fixture,
)


class ValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.validate = staticmethod(backend_module("validation").validate_model)
        cls.error = backend_module("errors").IRProError

    def validate_candidate(self, candidate, current=None, refs=None, sources=None, entities=None):
        return self.validate(
            candidate,
            empty_model() if current is None else current,
            {SOURCE, OTHER_SOURCE} if sources is None else sources,
            {} if refs is None else refs,
            set() if entities is None else entities,
        )

    def test_empty_initial_model(self):
        result, notices = self.validate_candidate(empty_model())
        self.assertEqual(result, empty_model())
        self.assertEqual(notices, [])

    def test_validation_does_not_modify_input_or_return_shared_objects(self):
        candidate = model_fixture()
        before = deepcopy(candidate)
        result, _ = self.validate_candidate(candidate)
        self.assertEqual(candidate, before)
        get_function(result)["name"] = "Changed returned value"
        self.assertEqual(candidate, before)

    def test_visible_renames_preserve_entity_and_hardware_binding(self):
        current = model_fixture()
        candidate = deepcopy(current)
        candidate["emitters"][0]["name"] = "IR oficina"
        candidate["emitters"][0]["devices"][0]["name"] = "Aire"
        get_function(candidate)["name"] = "Encendido"
        result, _ = self.validate_candidate(candidate, current)
        self.assertEqual(get_function(result)["entity"], get_function(current)["entity"])
        self.assertEqual(result["emitters"][0]["sourceId"], SOURCE)

    def test_cannot_move_existing_emitter_to_other_hardware(self):
        current = model_fixture()
        candidate = deepcopy(current)
        candidate["emitters"][0]["sourceId"] = OTHER_SOURCE
        with self.assertRaises(self.error):
            self.validate_candidate(candidate, current)

    def test_cannot_move_existing_device_between_emitters(self):
        current = model_fixture()
        candidate = deepcopy(current)
        device = candidate["emitters"][0]["devices"].pop()
        candidate["emitters"].append({
            "id": "00000000-0000-4000-8000-000000000021",
            "sourceId": OTHER_SOURCE,
            "name": "IR dormitorio",
            "model": "RM4 mini",
            "devices": [device],
        })
        with self.assertRaises(self.error):
            self.validate_candidate(candidate, current)

    def test_existing_entity_id_and_type_cannot_be_changed_in_model_save(self):
        current = model_fixture()
        for field, value in (
            ("entity", "button.something_else"),
            ("type", "switch"),
        ):
            with self.subTest(field=field):
                candidate = deepcopy(current)
                get_function(candidate)[field] = value
                with self.assertRaises(self.error):
                    self.validate_candidate(candidate, current)

    def test_internal_identity_cannot_change_role(self):
        current = model_fixture()
        candidate = deepcopy(current)
        candidate["emitters"][0]["devices"][0]["id"] = "new_device_id"
        get_function(candidate)["key"] = DEVICE
        candidate["emitters"][0]["devices"][0]["layout"]["rows"][0]["cells"][0] = DEVICE
        with self.assertRaises(self.error):
            self.validate_candidate(candidate, current)

    def test_client_cannot_change_switch_state_or_claim_initial_state(self):
        candidate = model_fixture()
        function = get_function(candidate)
        function.update(type="switch", entity="switch.ir_salon_split_salon_encender", on=True)
        result, _ = self.validate_candidate(candidate)
        self.assertIsNone(get_function(result)["on"])
        current = deepcopy(result)
        get_function(current)["on"] = True
        get_function(candidate)["on"] = False
        result, _ = self.validate_candidate(candidate, current)
        self.assertIs(get_function(result)["on"], True)

    def test_text_only_button_cannot_hide_its_text(self):
        candidate = model_fixture()
        get_function(candidate).update(icon="none", showName=False)
        result, _ = self.validate_candidate(candidate)
        self.assertIs(get_function(result)["showName"], True)

    def test_duplicate_function_identity_cannot_cross_devices(self):
        candidate, duplicate = duplicate_device(model_fixture())
        duplicate["functions"][0]["key"] = FUNCTION
        duplicate["layout"]["rows"][0]["cells"][0] = FUNCTION
        with self.assertRaises(self.error):
            self.validate_candidate(candidate)

    def test_duplicate_entity_id_rejected(self):
        candidate, duplicate = duplicate_device(model_fixture())
        duplicate["functions"][0]["entity"] = get_function(candidate)["entity"]
        with self.assertRaises(self.error):
            self.validate_candidate(candidate)

    def test_new_entity_cannot_claim_unrelated_registry_id(self):
        candidate = model_fixture()
        occupied = get_function(candidate)["entity"]
        result, notices = self.validate_candidate(candidate, entities={occupied, occupied + "_2"})
        self.assertEqual(get_function(result)["entity"], occupied + "_3")
        self.assertTrue(notices)

    def test_unavailable_existing_hardware_retains_configuration(self):
        current = model_fixture()
        result, _ = self.validate_candidate(deepcopy(current), current, sources=set())
        self.assertEqual(result["emitters"][0]["sourceId"], SOURCE)
        self.assertEqual(result["emitters"][0]["devices"][0]["id"], DEVICE)

    def test_unknown_new_hardware_is_rejected(self):
        with self.assertRaises(self.error):
            self.validate_candidate(model_fixture(), sources=set())

    def test_claimed_learned_status_is_not_trusted(self):
        candidate = model_fixture()
        get_function(candidate)["signals"] = {"press": True, "on": True, "off": True}
        result, _ = self.validate_candidate(candidate)
        self.assertFalse(get_function(result)["signals"].get("press", False))

    def test_verified_stored_reference_marks_button_learned(self):
        candidate = model_fixture()
        get_function(candidate)["signal_refs"] = {"press": REF}
        result, _ = self.validate_candidate(candidate, refs={REF: signal_fixture()})
        self.assertTrue(get_function(result)["signals"]["press"])

    def test_unknown_reference_is_rejected(self):
        candidate = model_fixture()
        get_function(candidate)["signal_refs"] = {"press": REF}
        with self.assertRaises(self.error):
            self.validate_candidate(candidate)

    def test_unverified_reference_never_marks_learned(self):
        for records in ({REF: signal_fixture(verified=False)}, {REF: signal_fixture(tested=False)}):
            with self.subTest(records=records):
                candidate = model_fixture()
                get_function(candidate)["signal_refs"] = {"press": REF}
                result, _ = self.validate_candidate(candidate, refs=records)
                self.assertFalse(get_function(result)["signals"].get("press", False))

    def test_reference_for_other_signal_is_not_accepted(self):
        candidate = model_fixture()
        get_function(candidate)["signal_refs"] = {"press": REF}
        with self.assertRaises(self.error):
            self.validate_candidate(candidate, refs={REF: signal_fixture(signal="off")})

    def test_same_emitter_duplicate_can_share_trusted_signal_without_aliasing(self):
        current = model_fixture()
        get_function(current)["signal_refs"] = {"press": REF}
        get_function(current)["signals"]["press"] = True
        candidate, _ = duplicate_device(current)
        result, _ = self.validate_candidate(candidate, current, refs={REF: signal_fixture()})
        functions = [device["functions"][0] for device in result["emitters"][0]["devices"]]
        self.assertTrue(all(function["signals"]["press"] for function in functions))
        self.assertNotEqual(functions[0]["entity"], functions[1]["entity"])
        functions[1]["signal_refs"].clear()
        self.assertEqual(functions[0]["signal_refs"], {"press": REF})

    def test_cross_emitter_duplicate_clears_signal_with_notice_and_preserves_original(self):
        current = model_fixture()
        get_function(current)["signal_refs"] = {"press": REF}
        get_function(current)["signals"]["press"] = True
        candidate, _ = duplicate_device(current, source_id=OTHER_SOURCE)
        result, notices = self.validate_candidate(candidate, current, refs={REF: signal_fixture()})
        copied = result["emitters"][1]["devices"][0]["functions"][0]
        self.assertFalse(copied["signals"].get("press", False))
        self.assertEqual(copied["signal_refs"], {})
        self.assertTrue(notices)
        self.assertTrue(get_function(result)["signals"]["press"])
        self.assertEqual(get_function(result)["entity"], get_function(current)["entity"])

    def test_row_dimensions_and_cells_are_validated(self):
        for field, value in (("columns", 0), ("columns", 7), ("height", 0), ("height", 5)):
            with self.subTest(field=field, value=value):
                candidate = model_fixture()
                candidate["emitters"][0]["devices"][0]["layout"]["rows"][0][field] = value
                with self.assertRaises(self.error):
                    self.validate_candidate(candidate)

    def test_malformed_json_values_raise_domain_error(self):
        for field, value in (("icon", []), ("icon", {}), ("color", []), ("showName", "false")):
            with self.subTest(field=field, value=value):
                candidate = model_fixture()
                get_function(candidate)[field] = value
                with self.assertRaises(self.error):
                    self.validate_candidate(candidate)
        candidate = model_fixture()
        candidate["emitters"][0]["devices"][0]["icon"] = []
        with self.assertRaises(self.error):
            self.validate_candidate(candidate)

    def test_layout_cannot_reference_unknown_or_duplicate_function(self):
        for cells in (["00000000-0000-4000-8000-000000000099", None], [FUNCTION, FUNCTION]):
            with self.subTest(cells=cells):
                candidate = model_fixture()
                candidate["emitters"][0]["devices"][0]["layout"]["rows"][0]["cells"] = cells
                with self.assertRaises(self.error):
                    self.validate_candidate(candidate)

    def test_delete_function_preserves_row_and_other_configuration(self):
        current = model_fixture()
        candidate = deepcopy(current)
        device = candidate["emitters"][0]["devices"][0]
        device["functions"].clear()
        device["layout"]["rows"][0]["cells"][0] = None
        result, _ = self.validate_candidate(candidate, current)
        self.assertEqual(result["emitters"][0]["id"], EMITTER)
        self.assertEqual(result["emitters"][0]["devices"][0]["id"], DEVICE)
        self.assertEqual(result["emitters"][0]["devices"][0]["layout"], device["layout"])


if __name__ == "__main__":
    unittest.main()
