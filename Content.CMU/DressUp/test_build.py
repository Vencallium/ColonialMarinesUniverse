"""Validate catalog coverage, source sprite extraction and inherited clothing."""
import json
import unittest

from PIL import Image, ImageChops

from build import OUT, ROOT, merge


class CatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = json.loads((OUT / "catalog.json").read_text(encoding="utf-8"))
        cls.items = {item["id"]: item for item in cls.catalog["items"]}

    def test_inherited_component_fields_and_explicit_empty_maps(self):
        parent = {"components": [{"type": "Clothing", "slots": ["HEAD"], "sprite": "a.rsi"},
                                  {"type": "Sprite", "sprite": "a.rsi", "layers": [{"state": "icon"}]},
                                  {"type": "ItemCamouflage", "camouflageVariations": {"Jungle": "j.rsi"}}]}
        child = {"components": [{"type": "Clothing", "sprite": "b.rsi"},
                                 {"type": "ItemCamouflage", "camouflageVariations": {}}]}
        components = {c["type"]: c for c in merge(parent, child)["components"]}
        self.assertEqual(components["Clothing"]["slots"], ["HEAD"])
        self.assertEqual(components["Clothing"]["sprite"], "b.rsi")
        self.assertEqual(components["ItemCamouflage"]["camouflageVariations"], {})
        self.assertEqual(components["Sprite"]["layers"], [{"state": "icon"}])

    def test_catalog_integrity(self):
        self.assertEqual(len(self.items), len(self.catalog["items"]))
        self.assertGreater(len(self.items), 5000)
        slots = {s["id"] for s in self.catalog["slots"]}
        for item in self.items.values():
            self.assertTrue(set(item["slots"]) <= slots, item["id"])
            self.assertTrue((ROOT / item["source"]).is_file(), item["source"])
        self.assertEqual(self.items["JumpsuitMarine"]["slots"], ["jumpsuit"])
        self.assertEqual(self.items["ArmorHelmetM10"]["slots"], ["head"])
        self.assertTrue(self.items["CMArmorM3Medium"]["layers"]["outerClothing"])
        self.assertTrue(any(i["source"].startswith("Content.CMU/") for i in self.items.values()))

    def test_every_referenced_sprite_exists_and_has_four_frames(self):
        layers = {}

        def walk(value):
            if isinstance(value, dict):
                if "src" in value:
                    layers[value["src"]] = value
                for v in value.values():
                    walk(v)
            elif isinstance(value, list):
                for v in value:
                    walk(v)

        walk(self.catalog)
        for path, layer in layers.items():
            with Image.open(OUT / path) as image:
                self.assertEqual(image.size, (layer["w"] * 4, layer["h"]), path)

    def test_directional_frames_match_original_rsi(self):
        original = Image.open(ROOT / "Resources/Textures/Mobs/Species/Human/parts.rsi/head_m.png").convert("RGBA")
        layer = self.catalog["body"]["head_m"]
        extracted = Image.open(OUT / layer["src"]).convert("RGBA")
        for direction in range(4):
            x, y = direction % (original.width // 32) * 32, direction // (original.width // 32) * 32
            expected = original.crop((x, y, x + 32, y + 32))
            actual = extracted.crop((direction * 32, 0, direction * 32 + 32, 32))
            self.assertIsNone(ImageChops.difference(expected, actual).getbbox())

    def test_asset_attribution_and_missing_overlay_report(self):
        credits = json.loads((OUT / "credits.json").read_text(encoding="utf-8"))
        self.assertIn("Resources/Textures/Mobs/Species/Human/parts.rsi", credits)
        report = json.loads((OUT / "build-report.json").read_text(encoding="utf-8"))
        self.assertEqual(report["totalPrototypes"], len(self.items))
        self.assertEqual(report["clothingPrototypes"], sum(item["clothing"] for item in self.items.values()))
        self.assertEqual(set(report["noHumanOverlay"]), {id for id, item in self.items.items() if not any(item["layers"].values())})

    def test_weapons_and_markings(self):
        rifle = self.items["RMCWeaponRifleM54C"]
        self.assertTrue(rifle["weapon"])
        for hand in ["leftHand", "rightHand"]:
            self.assertIn(hand, rifle["slots"])
            self.assertTrue(rifle["layers"][hand])
        self.assertNotEqual(rifle["layers"]["leftHand"], rifle["layers"]["rightHand"])
        self.assertTrue(any(v.get("twoHands") for v in rifle["variants"]))
        chest = {m["id"]: m for m in self.catalog["customization"]["Chest"]}
        self.assertIn("TattooHiveChest", chest)
        self.assertEqual(chest["TattooHiveChest"]["layers"][0]["colorMode"], "TattooColoring")
        self.assertIn("ScarEyeRight", {m["id"] for m in self.catalog["customization"]["Head"]})

    def test_accessories_and_latest_lacn_artwork(self):
        helmet = self.items["AU14LACNHelmetStandard"]
        self.assertIn("head", helmet["accessoryHolders"]["helmetAccessories"]["slots"])
        self.assertFalse(helmet["accessoryHolders"]["helmetAccessories"]["isHat"])
        armor = self.items["AU14LACNArmorStandard"]
        self.assertIn("outerClothing", armor["accessoryHolders"]["armorAddons"]["slots"])
        for id in ["CMULACNArmorGarbArms", "CMULACNArmorGarbCollar", "CMULACNArmorGarbLegs", "CMULACNArmorGarbPauldrons", "CMULACNArmorGarbPlate"]:
            item = self.items[id]
            self.assertEqual(item["slots"], ["armorAddons"])
            self.assertTrue(item["layers"]["armorAddons"], id)
            desert = next(v for v in item["variants"] if v["name"] == "Desert")
            self.assertNotEqual(item["layers"]["armorAddons"], desert["layers"]["armorAddons"])
        nvg = self.items["CMULACNHelmetGarbNightVision"]
        self.assertTrue(nvg["layers"]["helmetAccessories"])
        toggled = next(v for v in nvg["variants"] if "activated" in v["name"])
        self.assertNotEqual(nvg["layers"]["helmetAccessories"], toggled["layers"]["helmetAccessories"])
        layer = armor["layers"]["outerClothing"][0]
        source = ROOT / "Content.CMU/Resources/Textures/CMU14/Clothing/LACN/LACNRedux/Infantry/Jungle/LACNarmorvest.rsi"
        meta = json.loads((source / "meta.json").read_text(encoding="utf-8"))
        state = next(s for s in meta["states"] if s["name"] == "equipped-OUTERCLOTHING")
        original = Image.open(source / "equipped-OUTERCLOTHING.png").convert("RGBA")
        extracted = Image.open(OUT / layer["src"]).convert("RGBA")
        for direction in range(4):
            index = sum(len(d) for d in state.get("delays", [[1]] * 4)[:direction])
            w, h = layer["w"], layer["h"]
            x, y = index % (original.width // w) * w, index // (original.width // w) * h
            expected = original.crop((x, y, x + w, y + h))
            actual = extracted.crop((direction * w, 0, (direction + 1) * w, h))
            self.assertIsNone(ImageChops.difference(expected, actual).getbbox())


if __name__ == "__main__":
    unittest.main()
