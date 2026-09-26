const $ = id => document.getElementById(id);
const canvas = $('character');
const context = canvas.getContext('2d');
const images = new Map();
const directions = [0, 2, 1, 3]; // Clockwise: south, east, north, west; RSI uses S,N,E,W.
const facing = ['SOUTH', 'EAST', 'NORTH', 'WEST'];
const views = ['FRONT', 'LEFT SIDE', 'BACK', 'RIGHT SIDE'];
const state = { slot: 'jumpsuit', equipped: {}, markings: [], direction: 0, page: 0 };
const hands = ['leftHand', 'rightHand'];
const picker = { kind: 'Hair', page: 0, version: 0 };
let data, byId, renderVersion = 0;
const pageSize = 6;

function status(message) { $('status').textContent = message; }
function loadImage(src) {
  if (!images.has(src)) images.set(src, new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => { images.delete(src); reject(new Error(`Could not load ${src}`)); };
    image.src = src;
  }));
  return images.get(src);
}
function vector(value, fallback) {
  if (typeof value === 'string') return value.split(',').map(Number);
  return Array.isArray(value) ? value : fallback;
}
async function drawLayer(ctx, layer, direction, tint, displacement) {
  if (!layer) return;
  const image = await loadImage(layer.src);
  const scratch = document.createElement('canvas');
  scratch.width = layer.w; scratch.height = layer.h;
  const s = scratch.getContext('2d');
  const sourceDirection = layer.flip ? [1, 0, 3, 2][direction] : direction;
  s.drawImage(image, sourceDirection * layer.w, 0, layer.w, layer.h, 0, 0, layer.w, layer.h);
  if (displacement && layer.w === 32 && layer.h === 32) {
    const map = document.createElement('canvas'); map.width = 32; map.height = 32;
    const m = map.getContext('2d');
    m.drawImage(await loadImage(displacement.src), direction * 32, 0, 32, 32, 0, 0, 32, 32);
    const offsets = m.getImageData(0, 0, 32, 32).data;
    const original = s.getImageData(0, 0, 32, 32).data;
    const shifted = s.createImageData(32, 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4;
      const sampleX = x + offsets[i] - 128, sampleY = y - (offsets[i + 1] - 128);
      if (sampleX < 0 || sampleX >= 32 || sampleY < 0 || sampleY >= 32) continue;
      const j = (sampleY * 32 + sampleX) * 4;
      shifted.data.set(original.slice(j, j + 4), i);
      shifted.data[i + 3] *= offsets[i + 3] / 255;
    }
    s.putImageData(shifted, 0, 0);
  }
  const color = tint || layer.color;
  if (typeof color === 'string' && color !== '#ffffff') {
    // Multiply RGB without changing alpha, matching sprite tinting in the game.
    const swatch = document.createElement('canvas').getContext('2d');
    swatch.fillStyle = color; swatch.fillRect(0, 0, 1, 1);
    const rgb = swatch.getImageData(0, 0, 1, 1).data;
    const pixels = s.getImageData(0, 0, layer.w, layer.h);
    for (let i = 0; i < pixels.data.length; i += 4) {
      for (let c = 0; c < 3; c++) pixels.data[i + c] *= rgb[c] / 255;
      pixels.data[i + 3] *= rgb[3] / 255;
    }
    s.putImageData(pixels, 0, 0);
  }
  const [sx, sy] = vector(layer.scale, [1, 1]);
  const [ox, oy] = vector(layer.offset, [0, 0]);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, (ctx.canvas.width - layer.w * sx) / 2 + ox * 32,
    (ctx.canvas.height - layer.h * sy) / 2 - oy * 32, layer.w * sx, layer.h * sy);
}
function selectedLayers(slot) {
  const selection = state.equipped[slot];
  if (!selection) return [];
  const item = byId.get(selection.id);
  return (selection.variant >= 0 ? item.variants[selection.variant].layers : item.layers)[slot] || [];
}
function allowsBody(marking) {
  const sexes = Array.isArray(marking.sex) ? marking.sex : marking.sex ? [marking.sex] : [];
  return !sexes.length || sexes.some(sex => sex.toLowerCase() === ($('body').value === 'm' ? 'male' : 'female'));
}
function markingColor(layer) {
  const skin = $('skin').value;
  if (layer.colorMode === 'TattooColoring') {
    const rgb = skin.slice(1).match(/../g).map(hex => parseInt(hex, 16));
    return '#' + rgb.map(v => Math.round(v * 102 / Math.max(...rgb, 1)).toString(16).padStart(2, '0')).join('');
  }
  if (layer.colorMode === 'SkinColoring') return skin;
  if (layer.colorMode === 'EyeColoring') {
    const eye = $('eyeColor').value;
    return layer.negative ? '#' + eye.slice(1).match(/../g).map(hex => (255 - parseInt(hex, 16)).toString(16).padStart(2, '0')).join('') : eye;
  }
  return layer.color || '#ffffff';
}
function getMarking(id) {
  return Object.values(data.customization).flat().find(marking => marking.id === id);
}
function applyLighting(ctx) {
  const presets = {
    full: { color: [1, 1, 1], falloff: 0 },
    natural: { color: [1, 0.97, 0.91], falloff: 0.16 },
    indoor: { color: [0.88, 0.71, 0.52], falloff: 0.22 },
    night: { color: [0.30, 0.42, 0.64], falloff: 0.12 },
    emergency: { color: [0.92, 0.26, 0.20], falloff: 0.20 },
  };
  const preset = presets[$('lighting').value] || presets.full;
  const brightness = Number($('brightness').value) / 100;
  if ($('lighting').value === 'full' && brightness === 1) return;
  const pixels = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    if (!pixels.data[i + 3]) continue;
    // Approximate ambient light on the sprite, retaining its original shading and alpha.
    const y = Math.floor(i / 4 / ctx.canvas.width);
    const height = Math.max(0, Math.min(1, (y - 32) / 32));
    const light = brightness * (1 - preset.falloff * height);
    for (let c = 0; c < 3; c++) pixels.data[i + c] *= preset.color[c] * light;
  }
  ctx.putImageData(pixels, 0, 0);
}
async function render() {
  if (!data) return;
  const version = ++renderVersion;
  const frame = document.createElement('canvas'); frame.width = 96; frame.height = 96;
  const ctx = frame.getContext('2d');
  const direction = directions[state.direction];
  const hidden = new Set();
  for (const [slot, selected] of Object.entries(state.equipped)) {
    if (hands.includes(slot)) continue;
    const item = byId.get(selected.id);
    const reveal = selected.variant >= 0 ? item.variants[selected.variant].reveal || [] : [];
    item.hide.filter(part => !reveal.includes(part)).forEach(part => hidden.add(part));
    for (const [part, flag] of Object.entries(item.hideBySlot)) {
      if (!reveal.includes(part) && String(flag).split(/[, |]+/).includes(data.slots.find(s => s.id === slot)?.flag)) hidden.add(part);
    }
  }
  const body = $('body').value;
  const skin = $('skin').value;
  const plans = [];
  const bodyMarks = key => {
    if (hidden.has(key)) return;
    for (const selected of state.markings) {
      const marking = getMarking(selected.id);
      if (marking.part !== key || !allowsBody(marking)) continue;
      marking.layers.forEach((layer, i) => plans.push([layer, selected.colors[i] || markingColor(layer)]));
    }
  };
  const part = (key, tint, markingPart) => { plans.push([data.body[key], tint]); if (markingPart) bodyMarks(markingPart); };
  const equipment = slot => selectedLayers(slot).forEach(layer => plans.push([layer, null, body === 'f' && slot === 'jumpsuit' ? data.body.femaleDisplacement : null]));
  const marking = (key, tint) => {
    if (hidden.has(key)) return;
    const item = data.customization[key]?.find(m => m.id === $(key).value);
    if (item && !allowsBody(item)) return;
    item?.layers.forEach(layer => plans.push([layer, tint]));
  };
  part(`torso_${body}`, skin, 'Chest'); part(`head_${body}`, skin, 'Head'); bodyMarks('Snout'); part('eyes', $('eyeColor').value, 'Eyes');
  for (const [key, markingPart] of [['r_arm', 'RArm'], ['l_arm', 'LArm'], ['r_leg', 'RLeg'], ['l_leg', 'LLeg']]) part(key, skin, markingPart);
  marking('UndergarmentBottom'); marking('UndergarmentTop'); equipment('jumpsuit');
  for (const [key, markingPart] of [['l_foot', 'LFoot'], ['r_foot', 'RFoot'], ['l_hand', 'LHand'], ['r_hand', 'RHand']]) part(key, skin, markingPart);
  bodyMarks('Overlay');
  ['gloves', 'shoes', 'id', 'ears', 'eyes', 'outerClothing', 'belt', 'back', 'neck', 'suitstorage'].forEach(equipment);
  marking('FacialHair', $('facialColor').value); marking('Hair', $('hairColor').value);
  bodyMarks('HeadSide'); bodyMarks('HeadTop');
  ['mask', 'head', 'pocket1', 'pocket2'].forEach(equipment);
  hands.forEach(equipment);
  try {
    await Promise.all(plans.filter(([layer]) => layer).map(([layer]) => loadImage(layer.src)));
    for (const [layer, tint, displacement] of plans) await drawLayer(ctx, layer, direction, tint, displacement);
    if (version !== renderVersion) return;
    applyLighting(ctx);
    context.clearRect(0, 0, 96, 96); context.drawImage(frame, 0, 0);
    $('facing').textContent = facing[state.direction]; $('direction-label').textContent = views[state.direction];
    $('equipped-count').textContent = `${Object.keys(state.equipped).length} items equipped`;
    $('export').disabled = false;
  } catch (error) { status(`Preview incomplete: ${error.message}. Reload to retry.`); }
}
async function icon(target, item) {
  target.width = 96; target.height = 96;
  const layer = item?.icon || Object.values(item?.layers || {}).flat()[0];
  if (!layer) return;
  try {
    const raw = document.createElement('canvas'); raw.width = Math.max(96, layer.w); raw.height = Math.max(96, layer.h);
    const ctx = raw.getContext('2d'); await drawLayer(ctx, layer, 0);
    const pixels = ctx.getImageData(0, 0, raw.width, raw.height).data;
    let left = raw.width, top = raw.height, right = -1, bottom = -1;
    for (let y = 0; y < raw.height; y++) for (let x = 0; x < raw.width; x++) if (pixels[(y * raw.width + x) * 4 + 3]) {
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    if (right < left) return;
    const w = right - left + 1, h = bottom - top + 1;
    const scale = Math.max(1, Math.floor(80 / Math.max(w, h)));
    const display = target.getContext('2d'); display.imageSmoothingEnabled = false;
    display.drawImage(raw, left, top, w, h, Math.floor((96 - w * scale) / 2), Math.floor((96 - h * scale) / 2), w * scale, h * scale);
  }
  catch { target.title = 'Sprite unavailable'; }
}
function collection(item) { return item.source.startsWith('Content.CMU/') ? 'CMU' : item.source.includes('/_RMC14/') ? 'RMC' : 'SS14'; }
function equipmentUI() {
  $('equipment').replaceChildren();
  for (const slot of data.slots) {
    const button = document.createElement('button');
    button.className = 'slot' + (state.slot === slot.id ? ' active' : '');
    button.setAttribute('aria-pressed', String(state.slot === slot.id));
    const selected = state.equipped[slot.id];
    const item = selected && byId.get(selected.id);
    button.setAttribute('aria-label', `${slot.name}: ${item?.name || 'empty'}`);
    const picture = document.createElement('canvas'); void icon(picture, item);
    const text = document.createElement('span'); text.className = 'slot-text';
    const name = document.createElement('strong'); name.textContent = slot.name;
    const label = document.createElement('small'); label.textContent = item?.name || 'Empty';
    text.append(name, label); button.append(picture, text);
    button.onclick = () => { state.slot = slot.id; state.page = 0; $('search-scope').value = 'slot'; $('search').value = ''; refresh(); };
    $('equipment').append(button);
  }
}
function equip(id, slot = state.slot) {
  const item = byId.get(id);
  if (!item?.slots.includes(slot)) throw new Error('This item does not fit that slot.');
  if (hands.includes(slot)) {
    for (const hand of hands) {
      const other = state.equipped[hand];
      if (other && byId.get(other.id).variants[other.variant]?.twoHands) delete state.equipped[hand];
    }
  }
  state.slot = slot;
  state.equipped[slot] = { id, variant: -1 };
  status(`${item.name} equipped in ${data.slots.find(s => s.id === slot).name}.`);
  refresh();
}
function catalogUI() {
  const query = $('search').value.trim().toLowerCase();
  const source = $('collection').value;
  const allSlots = $('search-scope').value === 'all';
  const items = data.items.filter(item => (allSlots || item.slots.includes(state.slot))
    && (source === 'all' || collection(item) === source)
    && `${item.name} ${item.id}`.toLowerCase().includes(query));
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  state.page = Math.min(state.page, pages - 1);
  $('wardrobe-title').textContent = allSlots ? 'All equipment' : data.slots.find(s => s.id === state.slot).name;
  $('result-count').textContent = items.length;
  $('page-label').textContent = `${state.page + 1} / ${pages}`;
  $('previous').disabled = state.page === 0; $('next').disabled = state.page + 1 === pages;
  $('catalog').replaceChildren();
  for (const item of items.slice(state.page * pageSize, (state.page + 1) * pageSize)) {
    const button = document.createElement('button');
    const selected = Object.values(state.equipped).some(equipped => equipped.id === item.id);
    button.className = 'item' + (selected ? ' selected' : '');
    button.setAttribute('aria-pressed', String(selected)); button.title = item.id;
    const picture = document.createElement('canvas'); void icon(picture, item);
    const text = document.createElement('span'); text.textContent = item.name;
    const tag = document.createElement('small'); tag.textContent = collection(item) === 'RMC' ? 'RMC14' : collection(item);
    const slotLabel = document.createElement('small');
    slotLabel.textContent = item.weapon ? 'Weapon · left / right hand' : item.slots.filter(slot => !hands.includes(slot)).map(slot => data.slots.find(s => s.id === slot).name).join(' / ') || 'No compatible slot';
    button.append(picture, text, tag, slotLabel);
    button.disabled = !item.slots.length;
    button.onclick = () => equip(item.id, item.slots.includes(state.slot) ? state.slot : item.weapon ? 'rightHand' : item.slots[0]);
    $('catalog').append(button);
  }
  if (!items.length) {
    const empty = document.createElement('p'); empty.className = 'empty';
    empty.textContent = 'No equipment matches. Try another search or collection.'; $('catalog').append(empty);
  }
}
function detailsUI() {
  const panel = $('item-detail'); panel.replaceChildren();
  const selected = state.equipped[state.slot];
  if (!selected) { panel.textContent = 'Select an item to equip it.'; return; }
  const item = byId.get(selected.id);
  const name = document.createElement('strong'); name.textContent = item.name;
  const id = document.createElement('code'); id.textContent = item.id;
  const description = document.createElement('p'); description.textContent = item.description;
  panel.append(name, id, description);
  if (item.slots.length > 1) {
    const label = document.createElement('label'); label.textContent = 'Equip in';
    const select = document.createElement('select');
    item.slots.forEach(slot => select.add(new Option(data.slots.find(s => s.id === slot).name, slot)));
    select.value = state.slot;
    select.onchange = () => equip(item.id, select.value);
    label.append(select); panel.append(label);
  }
  const variants = item.variants.map((variant, index) => ({ ...variant, index })).filter(variant => state.slot in variant.layers);
  if (variants.length) {
    const label = document.createElement('label'); label.textContent = 'Style';
    const select = document.createElement('select'); select.add(new Option('Default', '-1'));
    variants.forEach(variant => select.add(new Option(variant.name, variant.index)));
    select.value = selected.variant;
    select.onchange = () => {
      selected.variant = Number(select.value);
      if (item.variants[selected.variant]?.twoHands) {
        delete state.equipped[hands.find(hand => hand !== state.slot)];
        status('Two-handed pose selected; the other hand is kept free.');
      }
      refresh();
    };
    label.append(select); panel.append(label);
  }
  if (!selectedLayers(state.slot).length) {
    const notice = document.createElement('p'); notice.className = 'notice';
    notice.textContent = `This item has no ${hands.includes(state.slot) ? 'in-hand' : 'human worn'} sprite for this slot/style. It is equipped but will not change the preview.`;
    panel.append(notice);
  }
  const remove = document.createElement('button'); remove.textContent = 'Remove from slot';
  remove.onclick = () => { delete state.equipped[state.slot]; status(`${item.name} removed.`); refresh(); };
  panel.append(remove);
}
function refresh() { equipmentUI(); catalogUI(); detailsUI(); void render(); }
function rotate(delta) { state.direction = (state.direction + delta + 4) % 4; void render(); }
function customizationUI() {
  for (const key of ['Hair', 'FacialHair', 'UndergarmentTop', 'UndergarmentBottom']) {
    const select = $(key), previous = select.value;
    select.replaceChildren(new Option('None', ''));
    for (const marking of data.customization[key] || []) {
      if (allowsBody(marking)) select.add(new Option(marking.name, marking.id));
    }
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
  }
}
async function appearancePreview(target, marking, kind, direction = 0) {
  const request = Symbol(); target.previewRequest = request;
  const raw = document.createElement('canvas'); raw.width = 32; raw.height = 32;
  const ctx = raw.getContext('2d');
  const body = $('body').value, skin = $('skin').value;
  const keys = kind === 'markings'
    ? [`torso_${body}`, `head_${body}`, 'l_arm', 'r_arm', 'l_leg', 'r_leg', 'l_hand', 'r_hand', 'l_foot', 'r_foot']
    : [`head_${body}`];
  try {
    for (const key of keys) await drawLayer(ctx, data.body[key], direction, skin);
    await drawLayer(ctx, data.body.eyes, direction, $('eyeColor').value);
    for (const layer of marking?.layers || []) {
      await drawLayer(ctx, layer, direction, kind === 'Hair' ? $('hairColor').value : kind === 'FacialHair' ? $('facialColor').value : markingColor(layer));
    }
    if (target.previewRequest !== request) return;
    let size = 32, x = 0, y = 0;
    if (kind !== 'markings') {
      const pixels = ctx.getImageData(0, 0, 32, 32).data;
      let left = 32, top = 32, right = 0, bottom = 0;
      for (let py = 0; py < 32; py++) for (let px = 0; px < 32; px++) if (pixels[(py * 32 + px) * 4 + 3]) {
        left = Math.min(left, px); right = Math.max(right, px); top = Math.min(top, py); bottom = Math.max(bottom, py);
      }
      size = Math.max(24, Math.ceil((Math.max(right - left, bottom - top) + 5) / 8) * 8);
      x = Math.floor((size - right - left - 1) / 2); y = Math.floor((size - bottom - top - 1) / 2);
    }
    target.width = size; target.height = size;
    target.getContext('2d').drawImage(raw, x, y);
    target.dataset.ready = 'true';
  } catch { target.title = 'Preview unavailable'; }
}
function updateAppearanceButtons() {
  for (const [kind, id] of [['Hair', 'browse-hair'], ['FacialHair', 'browse-facial']]) {
    const marking = data.customization[kind]?.find(m => m.id === $(kind).value);
    const button = $(id);
    button.querySelector('span').textContent = (marking?.name || 'None') + ' · Browse';
    void appearancePreview(button.querySelector('canvas'), marking, kind);
  }
}
function markingsUI() {
  const container = $('chosen-markings'); container.replaceChildren();
  if (!state.markings.length) {
    const empty = document.createElement('p'); empty.textContent = 'No markings added.'; container.append(empty);
  }
  for (const selected of state.markings) {
    const marking = getMarking(selected.id);
    const entry = document.createElement('div'); entry.className = 'chosen-marking';
    const name = document.createElement('strong'); name.textContent = marking.name;
    const part = document.createElement('small'); part.textContent = data.bodyParts[marking.part] + (allowsBody(marking) ? '' : ' · Unavailable for this body');
    entry.append(name, part);
    marking.layers.forEach((layer, index) => {
      const label = document.createElement('label'); label.className = 'color-row';
      label.textContent = marking.layers.length > 1 ? `Color ${index + 1}` : 'Color';
      const color = document.createElement('input'); color.type = 'color'; color.value = selected.colors[index] || markingColor(layer);
      color.setAttribute('aria-label', `${marking.name} color ${index + 1}`);
      color.oninput = () => { selected.colors[index] = color.value; void render(); };
      label.append(color); entry.append(label);
    });
    const remove = document.createElement('button'); remove.textContent = 'Remove marking';
    remove.setAttribute('aria-label', `Remove ${marking.name}`);
    remove.onclick = () => { state.markings = state.markings.filter(m => m.id !== marking.id); markingsUI(); void render(); };
    entry.append(remove); container.append(entry);
  }
}
function openPicker(kind) {
  picker.kind = kind; picker.page = 0;
  $('appearance-search').value = ''; $('marking-part').value = 'all';
  $('picker-title').textContent = kind === 'Hair' ? 'Hair styles' : kind === 'FacialHair' ? 'Facial hair' : 'Tattoos & body markings';
  $('marking-part-label').hidden = kind !== 'markings';
  $('picker-hint').textContent = kind === 'markings' ? 'Previewed on bare skin. Clothing may cover a marking when worn. Choose one to add it.' : 'Previewed in your selected colors. Choose a style to apply it.';
  $('appearance-dialog').showModal(); pickerUI();
}
function pickerUI() {
  const version = ++picker.version;
  const kind = picker.kind;
  const query = $('appearance-search').value.trim().toLowerCase();
  const part = $('marking-part').value;
  let choices = kind === 'markings'
    ? Object.keys(data.bodyParts).flatMap(key => data.customization[key] || []).filter(marking => part === 'all' || marking.part === part)
    : [{ id: '', name: 'None', layers: [] }, ...(data.customization[kind] || [])];
  choices = choices.filter(marking => allowsBody(marking) && `${marking.name} ${marking.id}`.toLowerCase().includes(query));
  const pages = Math.max(1, Math.ceil(choices.length / 12));
  picker.page = Math.min(picker.page, pages - 1);
  $('picker-page').textContent = `${picker.page + 1} / ${pages} · ${choices.length} styles`;
  $('picker-previous').disabled = picker.page === 0; $('picker-next').disabled = picker.page + 1 === pages;
  const grid = $('appearance-options'); grid.replaceChildren();
  for (const marking of choices.slice(picker.page * 12, picker.page * 12 + 12)) {
    const button = document.createElement('button'); button.className = 'appearance-choice'; button.title = marking.id;
    const selected = kind === 'markings' ? state.markings.some(m => m.id === marking.id) : $(kind).value === marking.id;
    button.setAttribute('aria-pressed', String(selected));
    const picture = document.createElement('canvas');
    const name = document.createElement('span'); name.textContent = marking.name;
    button.append(picture, name);
    if (kind === 'markings') {
      const region = document.createElement('small'); region.textContent = data.bodyParts[marking.part]; button.append(region);
      button.disabled = selected;
    }
    button.onclick = () => {
      if (kind === 'markings') {
        state.markings.push({ id: marking.id, colors: [] }); markingsUI();
        status(`${marking.name} added to ${data.bodyParts[marking.part].toLowerCase()}.`);
      } else {
        $(kind).value = marking.id; updateAppearanceButtons(); status(`${marking.name || 'None'} selected.`);
      }
      $('appearance-dialog').close(); void render();
    };
    grid.append(button);
    void appearancePreview(picture, marking, kind, Number($('picker-angle').value)).then(() => {
      if (version === picker.version) button.dataset.previewReady = 'true';
    });
  }
  if (!choices.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No styles match these filters.'; grid.append(empty); }
}
async function start() {
  const response = await fetch('catalog.json');
  if (!response.ok) throw new Error(`Catalog returned ${response.status}`);
  data = await response.json(); byId = new Map(data.items.map(item => [item.id, item]));
  customizationUI();
  if ([...$('Hair').options].some(o => o.value === 'RMCHumanHairCrew')) $('Hair').value = 'RMCHumanHairCrew';
  for (const [part, value] of [['UndergarmentTop', 'RMCUndershirtStandard'], ['UndergarmentBottom', 'RMCUnderwearBoxersBlue']]) {
    if ([...$(part).options].some(o => o.value === value)) $(part).value = value;
  }
  if (byId.has('JumpsuitMarine')) state.equipped.jumpsuit = { id: 'JumpsuitMarine', variant: -1 };
  for (const id of ['skin', 'eyeColor', 'Hair', 'FacialHair', 'hairColor', 'facialColor', 'UndergarmentTop', 'UndergarmentBottom']) $(id).oninput = () => { void render(); updateAppearanceButtons(); markingsUI(); };
  $('body').onchange = () => { customizationUI(); updateAppearanceButtons(); markingsUI(); void render(); };
  for (const [part, label] of Object.entries(data.bodyParts)) if (data.customization[part]?.length) $('marking-part').add(new Option(label, part));
  $('browse-hair').onclick = () => openPicker('Hair');
  $('browse-facial').onclick = () => openPicker('FacialHair');
  $('browse-markings').onclick = () => openPicker('markings');
  $('close-picker').onclick = () => $('appearance-dialog').close();
  $('appearance-search').oninput = $('marking-part').onchange = () => { picker.page = 0; pickerUI(); };
  $('picker-angle').onchange = pickerUI;
  $('picker-previous').onclick = () => { picker.page--; pickerUI(); };
  $('picker-next').onclick = () => { picker.page++; pickerUI(); };
  $('name').oninput = () => { $('preview-name').textContent = $('name').value || 'New marine'; };
  $('search').oninput = $('collection').onchange = () => { state.page = 0; catalogUI(); };
  $('search-scope').onchange = () => { state.page = 0; if ($('search-scope').value === 'all') $('collection').value = 'all'; catalogUI(); };
  $('previous').onclick = () => { state.page--; catalogUI(); }; $('next').onclick = () => { state.page++; catalogUI(); };
  $('rotate-left').onclick = () => rotate(-1); $('rotate-right').onclick = () => rotate(1);
  $('stage').onkeydown = event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); rotate(event.key === 'ArrowLeft' ? -1 : 1); } };
  let startX = null;
  $('stage').onpointerdown = event => { if (event.target.closest('button')) return; startX = event.clientX; $('stage').setPointerCapture(event.pointerId); };
  $('stage').onpointerup = event => { if (startX !== null && Math.abs(event.clientX - startX) > 25) rotate(event.clientX > startX ? 1 : -1); startX = null; };
  $('stage').onpointercancel = () => { startX = null; };
  $('zoom').oninput = () => { const size = 96 * Number($('zoom').value); canvas.style.width = `${size}px`; canvas.style.height = `${size}px`; canvas.style.top = `calc(50% - ${size / 2}px)`; };
  const updateLighting = () => {
    $('stage').dataset.lighting = $('lighting').value;
    $('brightness-value').textContent = `${$('brightness').value}%`;
    void render();
  };
  $('lighting').onchange = $('brightness').oninput = updateLighting;
  $('clear').onclick = () => { state.equipped = {}; status('Outfit cleared.'); refresh(); };
  $('export').onclick = async () => {
    await render();
    const output = document.createElement('canvas'); output.width = 768; output.height = 768;
    const ctx = output.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(canvas, 0, 0, 768, 768);
    const link = document.createElement('a'); link.download = `${($('name').value || 'character').replace(/[^a-z0-9_-]/gi, '-')}-${facing[state.direction].toLowerCase()}.png`;
    link.href = output.toDataURL('image/png'); link.click(); status('Character exported as a transparent PNG.');
  };
  updateAppearanceButtons(); markingsUI();
  refresh(); status(`${data.items.length.toLocaleString()} clothing & weapon prototypes · Four-direction preview`);
  if (document.modelContext?.registerTool) {
    const lifecycle = new AbortController();
    window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
    try {
      await document.modelContext.registerTool({ name: 'equip_clothing', title: 'Equip clothing',
        description: 'Equip a clothing prototype in a compatible character slot.',
        inputSchema: { type: 'object', properties: { prototypeId: { type: 'string' }, slot: { type: 'string', enum: data.slots.map(s => s.id) } }, required: ['prototypeId', 'slot'], additionalProperties: false },
        annotations: { readOnlyHint: false },
        execute: async input => { if (!input || typeof input.prototypeId !== 'string' || typeof input.slot !== 'string') throw new Error('prototypeId and slot are required.'); equip(input.prototypeId, input.slot); await render(); return { equipped: input.prototypeId, slot: input.slot }; }
      }, { signal: lifecycle.signal });
    } catch (error) { console.info('Optional browser tool registration unavailable', error); }
  }
}
start().catch(error => { status(`Unable to open the wardrobe: ${error.message}. Reload to retry.`); $('catalog').textContent = 'The wardrobe could not be loaded. Serve the built dist folder over HTTP.'; });
