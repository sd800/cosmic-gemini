// Focused real-extension reload check, using a disposable profile only.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PDF_VIEWER_PLAYWRIGHT).href);
const folder = await mkdtemp(join(tmpdir(), 'cg-popup-reload-'));
const artifacts = resolve('test-dist/popup-settings'); await mkdir(artifacts, { recursive: true });
const context = await chromium.launchPersistentContext(join(folder, 'profile'), {
  executablePath: process.env.PDF_VIEWER_CHROME, headless: true, viewport: { width: 300, height: 430 },
  args: [`--disable-extensions-except=${resolve('extension')}`, `--load-extension=${resolve('extension')}`]
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const base = `chrome-extension://${new URL(worker.url()).host}/`;
  // Command-line loading works without Developer mode, but reloading an unpacked
  // extension requires the same Developer mode setting as a normal local install.
  const manager = await context.newPage(); await manager.goto('chrome://extensions/');
  const developerMode = manager.locator('extensions-toolbar #devMode');
  if (!await developerMode.evaluate(n => n.checked)) await developerMode.click();
  await manager.waitForFunction(() => document.querySelector('extensions-manager').shadowRoot
    .querySelector('extensions-toolbar').shadowRoot.querySelector('#devMode').checked);
  await manager.close();
  const openPopup = async (afterReload = false) => {
    const page = await context.newPage();
    for (let attempt = 0; ; attempt++) {
      try { await page.goto(base + 'popup/index.html'); break; }
      catch (error) {
        // Chrome briefly unregisters the old extension before reloading its files.
        if (!afterReload || attempt >= 9 || !String(error).includes('ERR_BLOCKED_BY_CLIENT')) throw error;
        await page.waitForTimeout(100 * (attempt + 1));
      }
    }
    await page.waitForFunction(() => document.documentElement.dataset.localePending === 'false');
    return page;
  };
  let popup = await openPopup();
  const opened = context.waitForEvent('page');
  await popup.locator('#all-settings').click();
  const settings = await opened; await settings.waitForURL(base + 'settings/all-settings.html');
  assert.equal(context.serviceWorkers().includes(worker), true, 'short click never reloads the extension');
  popup = await openPopup();
  const button = popup.locator('#all-settings');
  const arm = async () => {
    await button.hover(); await popup.mouse.down();
    await popup.waitForFunction(() => document.querySelector('#all-settings').dataset.reloadArmed === 'true');
    await popup.mouse.up();
    assert.equal(await button.textContent(), 'Reload');
    assert.equal(context.serviceWorkers().includes(worker), true, 'release never confirms the hold');
  };
  for (const scheme of ['light', 'dark']) {
    await popup.emulateMedia({ colorScheme: scheme }); await arm();
    const expectedColor = scheme === 'dark' ? 'rgb(255, 180, 171)' : 'rgb(179, 38, 30)';
    await popup.waitForFunction(color => getComputedStyle(document.querySelector('#all-settings')).color === color, expectedColor);
    await popup.locator('.popup-shell').screenshot({ path: join(artifacts, `reload-${scheme}.png`) });
    await popup.keyboard.press('Escape');
    assert.equal(await button.locator('svg').count(), 1);
  }
  await arm();
  await popup.mouse.click(10, 5);
  assert.equal(await button.locator('svg').count(), 1, 'outside click cancels confirmation');
  await worker.evaluate(() => chrome.storage.local.set({ popupReloadFixture: 'retained' }));
  await arm();
  const closedWorker = worker.waitForEvent('close');
  await button.click();
  await closedWorker;
  // MV3 may leave the replacement worker asleep until the next popup request.
  popup = await openPopup(true);
  assert.equal(await popup.evaluate(async () => (await chrome.storage.local.get('popupReloadFixture')).popupReloadFixture), 'retained');
  assert.equal(await popup.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'UI_GET_LOCALE' })).ok), true);
  assert.equal(await popup.locator('#all-settings svg').count(), 1, 'a reopened popup never retains confirmation');
  console.log('PASS: ordinary Settings click, long-press/release separation, red Reload layout, Escape/outside cancellation, actual extension restart, saved storage retained, confirmation cleared on reopen');
} catch (error) {
  const diagnostics = await context.newPage(); await diagnostics.goto('chrome://extensions/');
  console.error('Extension registration:', await diagnostics.evaluate(() => {
    const list = document.querySelector('extensions-manager')?.shadowRoot?.querySelector('extensions-item-list')?.shadowRoot;
    return [...(list?.querySelectorAll('extensions-item') || [])].map(item => ({
      name: item.data?.name, state: item.data?.state, disableReasons: item.data?.disableReasons,
      manifestErrors: item.data?.manifestErrors, runtimeErrors: item.data?.runtimeErrors
    }));
  }));
  throw error;
} finally { await context.close(); await rm(folder, { recursive: true, force: true }); }
