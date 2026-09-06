const { chromium } = require('D:/Program Files/nodejs/node_global/node_modules/@playwright/cli/node_modules/playwright-core');
const path = require('path');
const fs = require('fs');
const os = require('os');
(async () => {
  const extensionPath = path.resolve(__dirname, '../../offertrack-extension');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'offertrack-tab-reuse-qa-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'msedge', headless: true,
    args: ['--enable-unsafe-extension-debugging', `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    ignoreDefaultArgs: ['--disable-extensions']
  });
  const results = [];
  const assert = (value, text) => { if (!value) throw new Error(text); results.push(text); };
  const base = 'http://localhost:8420/dashboard.html';
  try {
    const cdp = await context.browser().newBrowserCDPSession();
    const { extensions } = await cdp.send('Extensions.getExtensions');
    const ext = extensions.find(e => e.name === 'OfferTrack 岗位采集助手');
    const popup = context.pages()[0];
    await popup.goto(`chrome-extension://${ext.id}/popup.html`);
    await popup.locator('#restore-empty').waitFor({ state: 'visible' });
    await popup.evaluate(async () => chrome.storage.local.set({ lastCapture: { kind: 'offertrack-job', version: 1, method: '标签页测试', warnings: [], job: { company: '标签页测试公司', role: '岗位一', city: '杭州', majors: '计算机', jd: '测试岗位描述', sourceUrl: 'https://example.com/job/one' } } }));
    await popup.locator('#restore-empty').click();
    const tabs = () => popup.evaluate(async () => (await chrome.tabs.query({})).filter(tab => tab.url?.startsWith('http://localhost:8420/dashboard.html')));
    assert((await tabs()).length === 0, '没有已打开工作台时开始验证');
    const created = context.waitForEvent('page');
    await popup.locator('#send').click();
    const dashboard = await created;
    await dashboard.locator('#record-dialog').waitFor({ state: 'visible' });
    assert((await tabs()).length === 1, '没有工作台时创建一个标签页');
    assert(await dashboard.locator('#field-role').inputValue() === '岗位一', '新建工作台接收到岗位');
    await dashboard.locator('#record-dialog [data-close]').last().click();
    await dashboard.goto(base + '?view=list#applications');
    await dashboard.evaluate(() => { window.tabReuseMarker = 'keep-document'; });
    const firstId = (await tabs())[0].id;
    await popup.bringToFront();
    await popup.locator('[name="role"]').fill('岗位二');
    await popup.locator('#send').click();
    await dashboard.waitForFunction(() => document.getElementById('field-role').value === '岗位二');
    assert((await tabs()).length === 1 && (await tabs())[0].id === firstId, '再次导入复用同一标签页，数量不增加');
    assert(await dashboard.evaluate(() => window.tabReuseMarker) === 'keep-document', '复用时没有重新加载工作台');
    assert(new URL(dashboard.url()).search === '?view=list', '保留已有查询参数，防止意外刷新');
    assert((await tabs())[0].active, '复用后激活工作台标签页');
    await dashboard.locator('#field-company').fill('尚未保存的公司');
    await popup.bringToFront();
    await popup.locator('[name="role"]').fill('岗位三');
    await popup.locator('#send').click();
    await dashboard.locator('#confirm-dialog').waitFor({ state: 'visible' });
    assert(await dashboard.locator('#field-company').inputValue() === '尚未保存的公司', '存在未保存表单时先确认，未自动覆盖');
    await dashboard.locator('#confirm-dialog [data-close]').last().click();
    assert(await dashboard.locator('#field-company').inputValue() === '尚未保存的公司' && await dashboard.locator('#field-role').inputValue() === '岗位二', '取消替换后保留全部未保存字段');
    await popup.bringToFront();
    await popup.locator('#send').click();
    await dashboard.locator('#confirm-dialog').waitFor({ state: 'visible' });
    await dashboard.locator('#confirm-button').click();
    assert(await dashboard.locator('#field-role').inputValue() === '岗位三' && (await tabs()).length === 1, '确认替换后同一标签页接收新岗位');
    await dashboard.locator('#record-dialog [data-close]').last().click();
    const otherWindow = await popup.evaluate(id => chrome.windows.create({ tabId: id, focused: false }), firstId);
    await popup.bringToFront();
    await popup.locator('[name="role"]').fill('另一窗口的岗位');
    await popup.locator('#send').click();
    await dashboard.waitForFunction(() => document.getElementById('field-role').value === '另一窗口的岗位');
    assert((await tabs()).length === 1 && (await tabs())[0].windowId === otherWindow.id, '复用其他窗口中的工作台');
    const focused = await popup.evaluate(id => chrome.windows.get(id), otherWindow.id);
    assert(focused.focused, '自动聚焦工作台所在的浏览器窗口');
    assert(await dashboard.evaluate(() => window.tabReuseMarker) === 'keep-document', '跨窗口复用仍保留原页面状态');
    const originalTotal = await dashboard.locator('#stat-total').textContent();
    assert(originalTotal === '8', '反复导入和取消没有自动新增投递记录');
    console.log(JSON.stringify({ passed: results.length, results }, null, 2));
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
