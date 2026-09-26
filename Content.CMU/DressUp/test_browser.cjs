// Run with Node and Playwright: node test_browser.cjs [playwright-package-path] [URL]
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(process.argv[2] || 'playwright');
const url = process.argv[3] || 'http://127.0.0.1:4173';

(async () => {
  const qa = path.join(__dirname, '.qa');
  fs.mkdirSync(qa, { recursive: true });
  const browser = await chromium.launch({ headless: true,
    ...(process.env.DRESSUP_BROWSER ? { executablePath: process.env.DRESSUP_BROWSER } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.url().startsWith(url) && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    });
    await page.addInitScript(() => {
      Object.defineProperty(document, 'modelContext', { value: {
        registerTool: tool => { window.dressupTestTool = tool; }
      } });
    });
    await page.goto(url);
    await page.waitForFunction(() => !document.querySelector('#export').disabled);
    const pixels = () => page.locator('#character').evaluate(c => c.toDataURL());
    const front = await pixels();
    await page.locator('#rotate-right').click();
    await page.waitForFunction(() => document.querySelector('#facing').textContent === 'EAST');
    assert.notEqual(await pixels(), front, 'Rotation changes the rendered frame');
    for (const face of ['NORTH', 'WEST', 'SOUTH']) {
      await page.locator('#rotate-right').click();
      await page.waitForFunction(value => document.querySelector('#facing').textContent === value, face);
    }
    assert.equal(await pixels(), front, 'Four turns return to the original frame');
    const alpha = () => page.locator('#character').evaluate(c => Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data).filter((_, i) => i % 4 === 3));
    const originalAlpha = await alpha();
    for (const preset of ['natural', 'indoor', 'night', 'emergency']) {
      const before = await pixels();
      await page.locator('#lighting').selectOption(preset);
      await page.waitForFunction(old => document.querySelector('#character').toDataURL() !== old, before);
      assert.deepEqual(await alpha(), originalAlpha, 'Lighting preserves transparency');
    }
    await page.locator('#lighting').selectOption('full');
    await page.waitForFunction(original => document.querySelector('#character').toDataURL() === original, front);
    await page.locator('#brightness').fill('50');
    await page.waitForFunction(old => document.querySelector('#character').toDataURL() !== old, front);
    assert.equal(await page.locator('#brightness-value').innerText(), '50%');
    await page.locator('#brightness').fill('100');
    await page.waitForFunction(original => document.querySelector('#character').toDataURL() === original, front);
    await page.locator('#body').selectOption('f');
    await page.waitForFunction(old => document.querySelector('#character').toDataURL() !== old, front);
    assert.notEqual(await pixels(), front, 'Body selection changes the preview');
    await page.getByRole('button', { name: 'Head: empty', exact: true }).click();
    await page.locator('#search').fill('RMCArmorHelmetPMCTactical');
    await page.locator('button.item[title="RMCArmorHelmetPMCTactical"]').click();
    assert.match(await page.locator('#item-detail').innerText(), /RMCArmorHelmetPMCTactical/);
    await page.waitForTimeout(150);
    const helmet = await pixels();
    await page.locator('#hairColor').fill('#ff00ff');
    await page.locator('#hairColor').dispatchEvent('input');
    await page.waitForTimeout(150);
    assert.equal(await pixels(), helmet, 'Helmet hides the hair layer');
    await page.getByRole('button', { name: 'Remove from slot', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Head: empty', exact: true }).count(), 1);
    await page.locator('#search').fill('NO_MATCH_123456');
    assert.match(await page.locator('#catalog').innerText(), /No equipment matches/);
    await page.locator('#search').fill('');
    await page.locator('#collection').selectOption('CMU');
    assert.ok(Number(await page.locator('#result-count').innerText()) > 0);
    await page.locator('#next').click();
    assert.match(await page.locator('#page-label').innerText(), /^2 /);
    await page.locator('#previous').click();
    await page.locator('#clear').click();
    await page.waitForFunction(() => document.querySelector('#equipped-count').textContent === '0 items equipped');
    // Exercise the same action through the optional browser tool, including validation.
    const result = await page.evaluate(() => window.dressupTestTool.execute({ prototypeId: 'JumpsuitMarine', slot: 'jumpsuit' }));
    assert.equal(result.equipped, 'JumpsuitMarine');
    const invalid = await page.evaluate(async () => {
      try { await window.dressupTestTool.execute({ prototypeId: 'JumpsuitMarine', slot: 'head' }); return false; }
      catch { return true; }
    });
    assert.ok(invalid, 'Wrong-slot tool input is rejected');
    // Global search crosses both collections and equipment slots.
    await page.locator('#search-scope').selectOption('all');
    assert.equal(await page.locator('#collection').inputValue(), 'all');
    await page.locator('#search').fill('RMCWeaponRifleM54C');
    await page.locator('button.item[title="RMCWeaponRifleM54C"]').click();
    assert.equal(await page.locator('#item-detail label').filter({ hasText: 'Equip in' }).locator('select').inputValue(), 'rightHand');
    await page.waitForTimeout(150);
    const withRightGun = await pixels();
    await page.evaluate(() => window.dressupTestTool.execute({ prototypeId: 'RMCWeaponRifleM54C', slot: 'leftHand' }));
    assert.notEqual(await pixels(), withRightGun, 'Left hand is drawn independently from right hand');
    const pose = page.locator('#item-detail label').filter({ hasText: 'Style' }).locator('select');
    await pose.selectOption({ label: 'Wielded (two hands)' });
    assert.equal(await page.getByRole('button', { name: 'Right hand: empty', exact: true }).count(), 1, 'Wielding frees the other hand');
    const wielded = await pixels();
    await page.locator('#rotate-right').click();
    await page.waitForFunction(() => document.querySelector('#facing').textContent === 'EAST');
    assert.notEqual(await pixels(), wielded, 'Held weapons rotate with the character');
    await page.locator('#rotate-left').click();
    await page.waitForFunction(() => document.querySelector('#facing').textContent === 'SOUTH');
    // Browsing previews must not alter the character before selection.
    const beforeBrowsing = await pixels();
    await page.locator('#browse-hair').click();
    await page.locator('#appearance-search').fill('RMCHumanHairLong');
    const hairChoice = page.locator('.appearance-choice[title="RMCHumanHairLong"]');
    await hairChoice.locator('canvas[data-ready=true]').waitFor();
    assert.equal(await pixels(), beforeBrowsing);
    assert.ok(await hairChoice.locator('canvas').evaluate(c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0)));
    await hairChoice.click();
    await page.waitForFunction(() => document.querySelector('#Hair').value === 'RMCHumanHairLong');
    await page.locator('#browse-facial').click();
    await page.locator('#appearance-options .appearance-choice').nth(1).locator('canvas[data-ready=true]').waitFor();
    await page.locator('#appearance-options .appearance-choice').nth(1).click();
    assert.ok(await page.locator('#FacialHair').inputValue());
    // Tattoos are visible on bare skin and are covered by the same uniform pixels.
    await page.locator('#clear').click();
    await page.locator('#UndergarmentTop').selectOption('');
    await page.locator('#rotate-right').click();
    await page.waitForFunction(() => document.querySelector('#facing').textContent === 'EAST');
    await page.locator('#rotate-right').click();
    await page.waitForFunction(() => document.querySelector('#facing').textContent === 'NORTH');
    await page.waitForTimeout(150);
    const bare = await pixels();
    await page.locator('#browse-markings').click();
    await page.locator('#appearance-search').fill('TattooHiveChest');
    await page.locator('.appearance-choice[title="TattooHiveChest"]').click();
    await page.waitForFunction(old => document.querySelector('#character').toDataURL() !== old, bare);
    assert.match(await page.locator('#chosen-markings').innerText(), /Chest/);
    const tattoo = await pixels();
    await page.locator('#chosen-markings input[type=color]').fill('#ff0000');
    await page.locator('#chosen-markings input[type=color]').dispatchEvent('input');
    await page.waitForFunction(old => document.querySelector('#character').toDataURL() !== old, tattoo);
    await page.evaluate(() => window.dressupTestTool.execute({ prototypeId: 'JumpsuitMarine', slot: 'jumpsuit' }));
    const clothedTattoo = await pixels();
    await page.locator('#chosen-markings button').click();
    await page.waitForTimeout(100);
    assert.equal(await pixels(), clothedTattoo, 'Uniform covers chest tattoo');
    await page.locator('#rotate-right').click();
    await page.waitForFunction(() => document.querySelector('#facing').textContent === 'WEST');
    await page.locator('#rotate-right').click();
    await page.waitForFunction(() => document.querySelector('#facing').textContent === 'SOUTH');
    await page.locator('#search').fill('');
    assert.ok(await page.locator('.item canvas').first().evaluate(c => c.getBoundingClientRect().width >= 90), 'Wardrobe thumbnails are enlarged');
    await page.locator('#stage').focus();
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => document.querySelector('#facing').textContent === 'WEST');
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#export').click();
    assert.match((await downloadEvent).suggestedFilename(), /-west\.png$/);
    await page.screenshot({ path: path.join(qa, 'desktop.png'), fullPage: true });
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow at ${width}px`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(qa, 'mobile.png'), fullPage: true });
    await page.goto(`${url}/credits.html`);
    await page.waitForFunction(() => document.querySelectorAll('#credits section').length > 0);
    assert.deepEqual(errors, [], 'No browser exceptions or missing local assets');
    console.log('PASS: global search, visual hair/facial pickers, markings/colors/occlusion, both hands and wielded poses, enlarged sprites, rotation, export, responsive layouts, and credits.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
