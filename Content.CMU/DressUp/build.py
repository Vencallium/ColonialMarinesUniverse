"""Compile CMU's prototypes and licensed RSI sprites into an offline static site."""
from __future__ import annotations

import copy
import hashlib
import json
import re
import shutil
from pathlib import Path

import yaml
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = HERE / "dist"
RESOURCE_ROOTS = [ROOT / "Resources", ROOT / "Content.CMU/Resources"]
SLOTS = {
    "jumpsuit": ("Uniform", "INNERCLOTHING", "INNERCLOTHING"),
    "outerClothing": ("Outerwear", "OUTERCLOTHING", "OUTERCLOTHING"),
    "head": ("Head", "HEAD", "HELMET"),
    "mask": ("Mask", "MASK", "MASK"),
    "eyes": ("Eyewear", "EYES", "EYES"),
    "ears": ("Ears", "EARS", "EARS"),
    "neck": ("Neck", "NECK", "NECK"),
    "gloves": ("Gloves", "GLOVES", "HAND"),
    "shoes": ("Footwear", "FEET", "FEET"),
    "back": ("Back", "BACK", "BACKPACK"),
    "belt": ("Belt", "BELT", "BELT"),
    "id": ("ID", "IDCARD", "IDCARD"),
    "suitstorage": ("Suit storage", "SUITSTORAGE", "SUITSTORAGE"),
    "pocket1": ("Left pocket", "POCKET", "POCKET1"),
    "pocket2": ("Right pocket", "POCKET", "POCKET2"),
    "leftHand": ("Left hand", "LEFTHAND", "inhand-left"),
    "rightHand": ("Right hand", "RIGHTHAND", "inhand-right"),
}
BODY_PARTS = {"Chest": "Chest", "Head": "Head", "Eyes": "Eyes", "Snout": "Face",
              "LArm": "Left arm", "RArm": "Right arm", "LHand": "Left hand", "RHand": "Right hand",
              "LLeg": "Left leg", "RLeg": "Right leg", "LFoot": "Left foot", "RFoot": "Right foot",
              "HeadTop": "Head top", "HeadSide": "Head side", "Overlay": "Body overlay"}
HANDS = ("leftHand", "rightHand")


class Loader(yaml.CSafeLoader):
    pass


def tagged(loader, tag, node):
    if isinstance(node, yaml.MappingNode):
        return {**loader.construct_mapping(node, deep=True), "__type": tag.removeprefix("type:")}
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node, deep=True)
    value = loader.construct_scalar(node)
    return {"__type": tag.removeprefix("type:")} if tag.startswith("type:") and not value else value


Loader.add_multi_constructor("!", tagged)


def merge(base, child):
    result = copy.deepcopy(base)
    for key, value in child.items():
        if key == "components" and isinstance(value, list) and all(isinstance(c, dict) and "type" in c for c in value):
            components = {c["type"]: c for c in result.get(key, [])}
            for component in value or []:
                kind = component["type"]
                components[kind] = merge(components.get(kind, {}), component)
            result[key] = list(components.values())
        else:
            result[key] = copy.deepcopy(value)
    return result


def load_prototypes():
    entities, markings = {}, {}
    for root in RESOURCE_ROOTS:
        for path in sorted((root / "Prototypes").rglob("*.yml")):
            for doc in yaml.load_all(path.read_text(encoding="utf-8-sig"), Loader=Loader):
                for proto in doc or []:
                    if not isinstance(proto, dict) or not isinstance(proto.get("id"), str):
                        continue
                    proto["source"] = path.relative_to(ROOT).as_posix()
                    if proto.get("type") == "entity":
                        proto = {k: v for k, v in proto.items() if k in
                                 ("id", "parent", "abstract", "name", "description", "source", "components")}
                        proto["components"] = [c for c in proto.get("components", []) if c.get("type") in
                                               ("Clothing", "Sprite", "HideLayerClothing", "ItemCamouflage", "RMCClothingFoldable", "FoldableClothing", "Item", "Gun", "MeleeWeapon", "Wieldable")]
                        entities[proto["id"]] = proto
                    elif proto.get("type") == "marking":
                        markings[proto["id"]] = proto
    return entities, markings


def load_names():
    names = {}
    for root in RESOURCE_ROOTS:
        for path in sorted((root / "Locale/en-US").rglob("*.ftl")):
            for match in re.finditer(r"^([\w-]+)\s*=\s*([^\r\n{]+)", path.read_text(encoding="utf-8-sig"), re.MULTILINE):
                names[match[1]] = match[2].strip()
    return names


class Sprites:
    def __init__(self):
        self.metadata = {}
        self.cache = {}
        self.credits = {}
        self.missing = set()

    def rsi(self, name):
        if not name:
            return None
        name = name.removeprefix("/Textures/").lstrip("/")
        for root in reversed(RESOURCE_ROOTS):
            path = root / "Textures" / name
            if (path / "meta.json").is_file():
                if path not in self.metadata:
                    self.metadata[path] = json.loads((path / "meta.json").read_text(encoding="utf-8-sig"))
                return path, self.metadata[path]
        return None

    def layer(self, name, state, **options):
        rsi = self.rsi(name)
        if not rsi or not state:
            return None
        path, meta = rsi
        key = f"{path.relative_to(ROOT).as_posix()}:{state}"
        info = next((s for s in meta["states"] if s["name"] == state), None)
        if not info or not (path / f"{state}.png").exists():
            return None
        if key not in self.cache:
            w, h = meta["size"]["x"], meta["size"]["y"]
            sheet = Image.open(path / f"{state}.png").convert("RGBA")
            strip = Image.new("RGBA", (w * 4, h))
            directions = info.get("directions", 1)
            delays = info.get("delays", [[1]] * directions)
            for direction in range(4):
                source_dir = direction if directions >= 4 else 0
                index = sum(len(d) for d in delays[:source_dir])
                x, y = index % (sheet.width // w) * w, index // (sheet.width // w) * h
                strip.paste(sheet.crop((x, y, x + w, y + h)), (direction * w, 0))
            filename = hashlib.sha256(key.encode()).hexdigest()[:20] + ".png"
            strip.save(OUT / "sprites" / filename)
            self.cache[key] = {"src": "sprites/" + filename, "w": w, "h": h}
            self.credits[path.relative_to(ROOT).as_posix()] = meta
        return {**self.cache[key], **{k: v for k, v in options.items() if v is not None}}


def build():
    OUT.mkdir(exist_ok=True)
    (OUT / "sprites").mkdir(exist_ok=True)
    entities, markings = load_prototypes()
    print(f"Loaded {len(entities)} entities and {len(markings)} markings.", flush=True)
    resolved = {}

    def resolve(id, stack=()):
        if id in resolved:
            return resolved[id]
        if id in stack:
            raise ValueError(f"Prototype inheritance cycle: {stack + (id,)}")
        raw = entities.get(id, {})
        parents = raw.get("parent", [])
        parents = [parents] if isinstance(parents, str) else parents
        result = {}
        # Robust gives the first parent priority where multiple parents define a field.
        for parent in reversed(parents):
            result = merge(result, resolve(parent, stack + (id,)))
        result = merge(result, raw)
        result["abstract"] = raw.get("abstract", False)
        resolved[id] = result
        return result

    sprites = Sprites()
    names = load_names()
    items = []
    for id in sorted(entities):
        proto = resolve(id)
        comp = {c["type"]: c for c in proto.get("components", [])}
        weapon = "Item" in comp and ("Gun" in comp or "MeleeWeapon" in comp)
        if proto["abstract"] or ("Clothing" not in comp and not weapon):
            continue
        clothing, sprite = comp.get("Clothing", {}), comp.get("Sprite", {})
        flags = clothing.get("slots", [])
        if isinstance(flags, str):
            flags = re.split(r"[, |]+", flags)
        flags = {str(f).upper() for f in flags}
        slots = [k for k, v in SLOTS.items() if v[1] in flags]
        base = clothing.get("sprite") or sprite.get("sprite")
        visuals = clothing.get("clothingVisuals", {})

        def get_layers(slot, rsi=base, prefix=None):
            explicit = visuals.get(slot)
            if explicit is not None and rsi == base and prefix is None:
                result = []
                for layer in explicit:
                    if layer.get("visible", True):
                        rendered = sprites.layer(layer.get("sprite", sprite.get("sprite", rsi)), layer.get("state"),
                                                 color=layer.get("color"), offset=layer.get("offset"), scale=layer.get("scale"),
                                                 flip=clothing.get("flipDirOffset", False) and slot in ("back", "suitstorage"))
                        if rendered:
                            result.append(rendered)
                return result
            prefix = clothing.get("equippedPrefix", "") if prefix is None else prefix
            state = clothing.get("equippedState") or (f"{prefix}-" if prefix else "") + f"equipped-{SLOTS[slot][2]}"
            rendered = sprites.layer(rsi, state, scale=clothing.get("scale"),
                                     flip=clothing.get("flipDirOffset", False) and slot in ("back", "suitstorage"))
            return [rendered] if rendered else []

        def inhand_layers(slot, prefix=None, rsi=None):
            item = comp.get("Item", {})
            rsi = rsi or item.get("sprite") or sprite.get("sprite")
            hand = "Left" if slot == "leftHand" else "Right"
            explicit = (item.get("inhandVisuals") or {}).get(hand)
            if explicit is not None and prefix is None:
                result = [sprites.layer(layer.get("sprite", rsi), layer.get("state"),
                                        color=layer.get("color"), offset=layer.get("offset"), scale=layer.get("scale"))
                          for layer in explicit if layer.get("visible", True)]
                return [layer for layer in result if layer]
            held = item.get("heldPrefix") if prefix is None else prefix
            state = (f"{held}-" if held else "") + SLOTS[slot][2]
            layer = sprites.layer(rsi, state)
            return [layer] if layer else []

        layers = {slot: get_layers(slot) for slot in slots}
        if weapon:
            slots.extend(HANDS)
            layers.update({slot: inhand_layers(slot) for slot in HANDS})
        icon_layers = sprite.get("layers", [])
        icon = sprites.layer(sprite.get("sprite", base), sprite.get("state") or "icon", color=sprite.get("color"))
        if not icon:
            for layer in icon_layers:
                icon = sprites.layer(layer.get("sprite", sprite.get("sprite", base)), layer.get("state"), color=layer.get("color"))
                if icon:
                    break
        variants = []
        for label, rsi in (comp.get("ItemCamouflage", {}).get("camouflageVariations") or {}).items():
            if isinstance(rsi, str):
                variants.append({"name": label, "layers": {slot: inhand_layers(slot, rsi=rsi) if slot in HANDS else get_layers(slot, rsi) for slot in slots}})
        prefixes = [v.get("prefix") for v in comp.get("RMCClothingFoldable", {}).get("types", [])]
        prefixes.append(comp.get("FoldableClothing", {}).get("foldedEquippedPrefix"))
        for prefix in dict.fromkeys(p for p in prefixes if p):
            reveal = next((v.get("revealLayers", []) for v in comp.get("RMCClothingFoldable", {}).get("types", []) if v.get("prefix") == prefix), [])
            variants.append({"name": prefix.title(), "layers": {slot: layers[slot] if slot in HANDS else get_layers(slot, prefix=prefix) for slot in slots}, "reveal": reveal})
        if weapon and "Wieldable" in comp:
            wielded = {slot: inhand_layers(slot, prefix=comp["Wieldable"].get("wieldedInhandPrefix") or "wielded") for slot in HANDS}
            if any(wielded.values()):
                variants.append({"name": "Wielded (two hands)", "layers": wielded, "twoHands": True})
        hidden = comp.get("HideLayerClothing", {})
        name = names.get(f"ent-{id}") or proto.get("name") or id
        if name == "item":
            name = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", id)
        items.append({"id": id, "name": name,
                      "description": proto.get("description", ""), "source": entities[id]["source"],
                      "slots": slots, "layers": layers, "icon": icon, "variants": variants,
                      "clothing": "Clothing" in comp, "weapon": weapon,
                      "hide": hidden.get("slots", []), "hideBySlot": hidden.get("layers", {})})
    customization = {}
    for id, marking in markings.items():
        part = marking.get("bodyPart")
        if part not in ("Hair", "FacialHair", "UndergarmentTop", "UndergarmentBottom") and part not in BODY_PARTS:
            continue
        restriction = marking.get("speciesRestriction", [])
        if restriction and "Human" not in restriction:
            continue
        if marking.get("groupWhitelist") and "Human" not in marking["groupWhitelist"]:
            continue
        layers = []
        coloring = marking.get("coloring") or {}
        for entry in marking.get("sprites", []):
            color = (coloring.get("layers") or {}).get(entry.get("state"), coloring.get("default", {})) or {}
            color_type = color.get("type") or {}
            layer = sprites.layer(entry.get("sprite"), entry.get("state"),
                                  color=color.get("fallbackColor"), colorMode=color_type.get("__type"),
                                  negative=color_type.get("negative", False), label=entry.get("state"))
            layers.append(layer)
        layers = [s for s in layers if s]
        if layers:
            name = re.sub(r"^(RMCHuman|Human|RMC)", "", id)
            name = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name)
            name = names.get(f"marking-{id}", name)
            customization.setdefault(part, []).append({"id": id, "name": name, "layers": layers,
                                                       "part": part, "sex": marking.get("sexRestriction"),
                                                       "forcedColoring": marking.get("forcedColoring", False)})
    body = {state: sprites.layer("Mobs/Species/Human/parts.rsi", state) for state in
            ["torso_m", "torso_f", "head_m", "head_f", "l_arm", "r_arm", "l_hand", "r_hand", "l_leg", "r_leg", "l_foot", "r_foot"]}
    body["eyes"] = sprites.layer("Mobs/Customization/eyes.rsi", "eyes")
    body["femaleDisplacement"] = sprites.layer("Mobs/Species/Human/displacement.rsi", "jumpsuit-female")
    catalog = {"items": items, "customization": customization, "body": body, "bodyParts": BODY_PARTS,
               "slots": [{"id": k, "name": v[0], "flag": v[1]} for k, v in SLOTS.items()]}
    (OUT / "catalog.json").write_text(json.dumps(catalog, separators=(",", ":")), encoding="utf-8")
    (OUT / "credits.json").write_text(json.dumps(sprites.credits, indent=2), encoding="utf-8")
    shutil.copy2(ROOT / "LICENSE", OUT / "CODE-LICENSE.txt")
    report = {"clothingPrototypes": sum(i["clothing"] for i in items), "weaponPrototypes": sum(i["weapon"] for i in items),
              "totalPrototypes": len(items), "sprites": len(sprites.cache),
              "noHumanOverlay": [i["id"] for i in items if not any(i["layers"].values())],
              "noSupportedSlot": [i["id"] for i in items if not i["slots"]]}
    (OUT / "build-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    for path in (HERE / "web").iterdir():
        shutil.copy2(path, OUT / path.name)
    print(f"Built {len(items)} clothing and weapon prototypes, {len(sprites.cache)} sprite states, "
          f"{sum(map(len, customization.values()))} customization choices. "
          f"{len(report['noHumanOverlay'])} items have no human overlay (listed in build-report.json).")


if __name__ == "__main__":
    build()
