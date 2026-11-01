import assert from 'node:assert/strict';
import { join } from 'node:path';

export async function checkDisplayScopes({ context, settings, base, a, b, other, layer, saved, command, waitLayer, artifacts }) {
  await settings.locator('#enabled').check();
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const tab = await worker.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url === 'https://a.example.co.uk/one'));
  const popup = await context.newPage();
  await popup.addInitScript(tab => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = message => message.type === 'UI_GET_ACTIVE_PAGE_STATE'
      ? chrome.tabs.update(tab.id, { active: true }).then(() => send(message)) : send(message);
  }, tab);
  await popup.goto(base + 'popup/index.html');
  const settle = () => popup.waitForFunction(() => !document.querySelector('#reduceWhitePoint-status').disabled && !document.body.hasAttribute('aria-busy'));
  const hold = async button => {
    const global = await button.getAttribute('data-global');
    await button.hover(); await popup.mouse.down();
    try {
      await popup.waitForFunction(({id, global}) => document.getElementById(id).dataset.global !== global,
        {id: await button.getAttribute('id'), global});
    } finally { await popup.mouse.up(); }
    await settle();
  };
  const effect = (page, kind, enabled) => page.waitForFunction(({ layer, kind, enabled }) => {
    const node = document.querySelector(layer);
    return (kind === 'greyscale' ? node?.dataset.greyscale === 'true' : Number(node?.dataset.reduction) > 0) === enabled;
  }, { layer, kind, enabled });
  for (const kind of ['reduceWhitePoint', 'greyscale']) {
    const button = popup.locator('#' + kind + '-status');
    await settle(); await button.click(); await settle();
    await effect(a, kind, true); await effect(b, kind, true); await effect(other, kind, false);
    const sibling = await context.newPage();
    await sibling.goto('https://new.example.co.uk/'); await effect(sibling, kind, true);
    await sibling.close();
    assert.equal((await saved())[kind].enabled, false);
    if (kind === 'reduceWhitePoint') assert.deepEqual((await saved())[kind].siteRules, []);
    await popup.reload(); await settle();
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    await button.click(); await settle(); await effect(a, kind, false);
    await hold(button);
    await effect(other, kind, true); await effect(a, kind, false);
    assert.equal((await saved())[kind].enabled, true);
    assert.equal(await button.getAttribute('aria-pressed'), 'false');
    assert.equal(await button.getAttribute('data-global'), 'true');
    await button.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)));
    assert.notEqual(await button.evaluate(node => getComputedStyle(node).boxShadow), 'none');
    await popup.locator('.popup-shell').screenshot({ path: join(artifacts, kind + '-global-local-off.png') });
    await hold(button); await effect(other, kind, false);
    assert.equal((await saved())[kind].enabled, false);
    assert.equal(await button.getAttribute('data-global'), 'false');
    // A fresh click after either hold remains a single site operation.
    await button.click(); await settle(); await effect(a, kind, true);
    await button.click(); await settle(); await effect(a, kind, false);
  }
  await popup.close(); await settings.bringToFront();
  for (const kind of ['reduceWhitePoint']) {
    await settings.locator('#' + kind + 'SiteSpecific').check();
    const list = settings.locator('#' + kind + 'Websites');
    await list.locator('input').fill('https://a.example.co.uk/path');
    await list.locator('button[type=submit]').click();
    await list.locator('code').filter({ hasText: /^example.co.uk$/ }).waitFor();
    await effect(a, kind, false); // The current session's explicit off has priority.
  }
  await settings.evaluate(() => chrome.storage.session.remove('cosmicGeminiPageDisplaySites'));
  await command({ type: 'UI_SET_PAGE_DISPLAY_SETTING', name: 'reduction', value: .4 });
  await waitLayer(a, true); await waitLayer(b, true); await waitLayer(other, false);
  await effect(a, 'reduceWhitePoint', true); await effect(a, 'greyscale', false);
  await settings.reload(); await settings.locator('#reduceWhitePointWebsites code').waitFor();
  assert.equal(await settings.locator('#greyscaleSiteSpecific').count(), 0);
  for (const locale of ['en-US', 'zh-CN']) for (const scheme of ['light', 'dark']) {
    await command({ type: 'UI_SET_LOCALE', locale });
    await settings.emulateMedia({ colorScheme: scheme });
    await settings.waitForFunction(locale => document.documentElement.lang === locale, locale);
    await settings.screenshot({ path: join(artifacts, `${locale}-${scheme}.png`), fullPage: true });
    assert.equal(await settings.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  await settings.locator('#enabled').uncheck();
  await waitLayer(a, false); await waitLayer(b, false);
  assert.equal(await settings.locator('#pageDisplayGreyscaleEnabled').isDisabled(), true);
  await settings.locator('#enabled').check(); await waitLayer(a, true);
  await settings.setViewportSize({ width: 390, height: 850 });
  assert.equal(await settings.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
}
