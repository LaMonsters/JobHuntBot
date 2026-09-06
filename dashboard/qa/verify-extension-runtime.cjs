const { chromium } = require('D:/Program Files/nodejs/node_global/node_modules/@playwright/cli/node_modules/playwright-core');
const path = require('path');
const fs = require('fs');
const os = require('os');
(async () => {
  const extensionPath = path.resolve(__dirname, '../../offertrack-extension');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'offertrack-extension-qa-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'msedge', headless: true,
    args: ['--enable-unsafe-extension-debugging', `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    ignoreDefaultArgs: ['--disable-extensions']
  });
  const checks = [];
  const assert = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
  try {
    const jobPage = context.pages()[0];
    await jobPage.goto('http://localhost:8420/qa/job-capture-demo.html');
    const cdp = await context.browser().newBrowserCDPSession();
    const { extensions } = await cdp.send('Extensions.getExtensions');
    const ext = extensions.find(e => e.name === 'OfferTrack 岗位采集助手');
    assert(ext?.enabled, '实际 Edge 成功加载 Manifest V3 插件');
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
    const tab = targetInfos.find(t => t.url.includes('job-capture-demo.html'));
    await cdp.send('Extensions.triggerAction', { id: ext.id, targetId: tab.targetId });
    await new Promise(resolve => setTimeout(resolve, 2000));
    // Chromium exposes the native popup as an "other" target. Use the same
    // extension HTML in a tab for Playwright's UI actions, restoring the real capture.
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${ext.id}/popup.html`);
    const saved = await popup.evaluate(() => chrome.storage.local.get('lastCapture'));
    assert(saved.lastCapture?.job.company === '星河研究院（虚构示例）', '真实工具栏 action 采集成功，写入扩展草稿');
    await popup.locator('#restore-empty').click();
    await popup.locator('#preview').waitFor({ state: 'visible', timeout: 10000 });
    assert(await popup.locator('[name="company"]').inputValue() === '星河研究院（虚构示例）', '实际插件恢复已采集的公司字段');
    assert((await popup.locator('[name="jd"]').inputValue()).includes('SQL'), '实际 popup 显示 JD 预览');
    await popup.locator('[name="role"]').fill('数据分析师 · 预览修订');
    await popup.setViewportSize({ width: 410, height: 850 });
    await popup.screenshot({ path: path.join(__dirname, 'extension-popup.png'), fullPage: true });
    const dashboardPromise = context.waitForEvent('page', { timeout: 10000 });
    await popup.locator('#send').click();
    const dashboard = await dashboardPromise;
    await dashboard.waitForLoadState('domcontentloaded');
    await dashboard.locator('#record-dialog').waitFor({ state: 'visible' });
    assert(await dashboard.locator('#field-role').inputValue() === '数据分析师 · 预览修订', '实际插件打开工作台并填入修订后的字段');
    const pending = await popup.evaluate(() => chrome.storage.local.get('lastCapture'));
    assert(pending.lastCapture.job.role === '数据分析师 · 预览修订', '采集草稿保存在扩展本地存储');
    await dashboard.locator('#record-form button[type="submit"]').click();
    await dashboard.reload();
    assert(await dashboard.locator('#tab-planned').textContent() === '1', '实际插件采集的岗位保存后刷新保留');
    console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
  } finally {
    await context.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
