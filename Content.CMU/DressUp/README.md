# CMU Dressing Room

A static GitHub Pages character customizer using the repository's real clothing
prototypes and RSI artwork. No game server, database, API key, or JavaScript
package installation is required.

## Run locally

From the repository root, using Python 3.12 or newer:

```sh
python -m pip install -r Content.CMU/DressUp/requirements.txt
python Content.CMU/DressUp/build.py
python Content.CMU/DressUp/test_build.py
python -m http.server 4173 --directory Content.CMU/DressUp/dist
```

Open http://localhost:4173. Open the site through HTTP, not by double-clicking
`index.html`. Generated output is ignored by Git.

## GitHub Pages

The workflow `.github/workflows/cmu-dressup-pages.yml` builds, validates, uploads,
and deploys the site. In the hosting repository, choose **Settings → Pages →
Build and deployment → Source → GitHub Actions**. Push this implementation, then
run **CMU Dressing Room Pages** from Actions, or let a matching push trigger it.
The workflow supports `main`, `master`, and the current `Dressup-Website` branch.
Its deployment job reports the actual published URL. Do not enable this workflow
on a repository whose existing Pages site must be preserved; each repository has
one Pages site.

All URLs are relative, so both `owner.github.io/repository/` and custom domains
work. The generated site contains only the web application, catalog, used sprite
frames, attribution metadata, coverage report, and source code license.

## Features and coverage

- Human masculine/feminine bodies, skin and eye colors, hair, facial hair,
  undershirts, and underwear from the game resources. Hair and facial hair have
  searchable visual pickers with front, back, and side previews before applying.
- Human-compatible tattoos, scars, and body markings, with body-part filtering,
  individual layer colors, and add/remove controls. Markings render on their
  body parts beneath clothing; preview them on bare skin in the picker.
- Compatible equipment slots, searchable clothing names and prototype IDs,
  CMU/RMC14/SS14 collection filters, remove/clear controls, available camouflage
  and folding styles. Search defaults to every slot and collection; selecting
  an equipment slot narrows browsing. Selecting **All slots** restores the
  combined search. Wardrobe thumbnails crop transparent padding and enlarge
  the actual item artwork.
- Guns and melee weapons in independent left/right hand slots using their
  actual in-hand sprites. Available two-handed poses clear the other hand.
  Use **Equip in** to choose a hand or another compatible slot.
- Four-direction sprite rotation with buttons, arrow keys when the preview is
  focused, or horizontal dragging/swiping. Integer zoom and transparent PNG export.
- Full bright, natural daylight, warm indoor, night, and emergency-red lighting,
  plus adjustable brightness. Lighting affects the character and PNG export,
  preserving transparency. These are illustrative ambient-light presets, not
  a reproduction of the game engine's dynamic lighting. Full bright at 100%
  preserves the original rendered sprite colors.
- All non-abstract entities with an inherited `Clothing` component, plus
  holdable entities with `Gun` or `MeleeWeapon`, from both
  `Resources/Prototypes` and `Content.CMU/Resources/Prototypes`. This includes
  equipment such as belts, weapons, and pocket items. An item with no compatible
  human inventory slot cannot be equipped; see `build-report.json`.
- Parent component resolution, explicit worn layers, equipped prefixes/states,
  hidden hair/underwear, frame extraction in RSI S/N/E/W order, sprite tint,
  offsets, scale, flipped directions, and the feminine uniform displacement map.

This is a static appearance preview, not the game engine. It renders the first
animation frame. Items that have no human worn overlay remain selectable and
show a notice. Runtime systems such as armor attachments, squad patches, powered
lights, toggled visors, shader effects, and inventory restrictions
beyond slot compatibility are not simulated. Camouflage and folding styles are
individual alternatives, not combinable runtime states. Other species are not
currently rendered. A browser can optionally expose the validated `equip_clothing`
tool when `document.modelContext` is supported; it is not required for normal use.

Artwork is not relicensed: `credits.html` and `credits.json` preserve each used
RSI's original license and copyright metadata. The build reads source resources
without modifying them. `build-report.json` records items without human overlays
or supported slots so additions and upstream asset gaps remain visible.
