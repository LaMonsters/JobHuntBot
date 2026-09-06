const { chromium } = require('D:/Program Files/nodejs/node_global/node_modules/@playwright/cli/node_modules/playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');
(async () => {
  const extensionPath = path.resolve(__dirname, '../../offertrack-extension');
  const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'offertrack-job-format-qa-')), {
    channel: 'msedge', headless: true, viewport: { width: 1440, height: 1080 },
    args: ['--enable-unsafe-extension-debugging', `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    ignoreDefaultArgs: ['--disable-extensions']
  });
  const checks = [], errors = [];
  const assert = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
  const base = 'http://localhost:8420/';
  const storageKey = 'jobhuntbot.offertrack.v1';
  const output = path.join(__dirname, 'job-format');
  fs.mkdirSync(output, { recursive: true });
  try {
    const dashboard = context.pages()[0];
    dashboard.on('pageerror', error => errors.push(error.message));
    await dashboard.goto(base + 'dashboard.html');
    const initial = await dashboard.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
    const legacy = { ...initial.records[0], id: 'legacy-format-fixture', company: '旧版兼容测试公司', isDemo: false, jobType: '校招 / 全职', majors: '计算机相关专业', education: '本科', salary: '面议', jd: '旧版岗位描述', sourceUrl: 'https://example.com/legacy-role', deadline: '' };
    await dashboard.evaluate(({ key, record }) => {
      const data = JSON.parse(localStorage.getItem(key)); data.records.push(record);
      localStorage.setItem(key, JSON.stringify(data));
    }, { key: storageKey, record: legacy });
    await dashboard.reload();
    assert(await dashboard.locator('#stat-total').textContent() === '9', '旧备份缺少备注、简历版本时正常载入，统计保持一致');
    const jobPage = await context.newPage();
    await jobPage.goto(base + 'qa/job-capture-demo.html');
    await jobPage.evaluate(() => { const p = document.createElement('p'); p.textContent = '岗位备注：请关注笔试通知（虚构示例）'; document.querySelector('main').append(p); });
    const cdp = await context.browser().newBrowserCDPSession();
    const { extensions } = await cdp.send('Extensions.getExtensions');
    const ext = extensions.find(e => e.name === 'OfferTrack 岗位采集助手');
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
    await cdp.send('Extensions.triggerAction', { id: ext.id, targetId: targetInfos.find(t => t.url.includes('job-capture-demo.html')).targetId });
    await new Promise(resolve => setTimeout(resolve, 1800));
    // The native toolbar capture runs with real activeTab permission. The same
    // popup is opened in a tab to drive its UI because native popups are CDP "other" targets.
    const popup = await context.newPage();
    popup.on('pageerror', error => errors.push(error.message));
    await popup.goto(`chrome-extension://${ext.id}/popup.html`);
    await popup.locator('#restore-empty').waitFor({ state: 'visible' });
    const { lastCapture } = await popup.evaluate(() => chrome.storage.local.get('lastCapture'));
    assert(lastCapture.job.company === '星河研究院（虚构示例）' && lastCapture.job.jobType === '数据岗', '真实工具栏采集按职位归为数据岗，employmentType 校招未混入分类');
    assert(lastCapture.job.notes === '请关注笔试通知（虚构示例）' && lastCapture.job.resumeVersion === '', '读取明确标注的岗位备注，简历版本留空');
    assert(lastCapture.warnings.some(text => text.includes('岗位类型按岗位名称')), '推断的岗位类型提供核对提示');
    await popup.locator('#restore-empty').click();
    const mainNames = ['company', 'role', 'city', 'jobType', 'sourceUrl', 'deadline', 'jd', 'notes', 'resumeVersion'];
    assert(JSON.stringify(await popup.locator('#preview [name]').evaluateAll(nodes => nodes.map(node => node.name).slice(0, 9))) === JSON.stringify(mainNames), '插件九个主要字段按参考截图排列');
    await popup.locator('[name="notes"]').fill('内推人：陈同学（虚构）\n关注岗位轮岗安排 <仅备注>');
    await popup.locator('#add-resume').click();
    await popup.locator('#resume-name').fill('数据分析简历 V2');
    await popup.locator('#apply-resume').click();
    await popup.setViewportSize({ width: 440, height: 850 });
    await popup.screenshot({ path: path.join(output, 'extension.png'), fullPage: true });
    await popup.locator('#send').click();
    await dashboard.locator('#record-dialog').waitFor({ state: 'visible' });
    const tabs = await popup.evaluate(() => chrome.tabs.query({}));
    assert(tabs.filter(tab => tab.url?.startsWith('http://localhost:8420/dashboard.html')).length === 1, '新格式导入复用已打开的工作台');
    assert(JSON.stringify(await dashboard.locator('#record-form [name]').evaluateAll(nodes => nodes.map(node => node.name).slice(0, 9))) === JSON.stringify(mainNames), '工作台与插件九个主要字段顺序一致');
    const expected = await popup.locator('#preview').evaluate(form => Object.fromEntries(new FormData(form)));
    const received = await dashboard.locator('#record-form').evaluate(form => Object.fromEntries(new FormData(form)));
    assert(Object.keys(expected).every(key => received[key] === expected[key]), '九个主要字段和三个补充字段完整填入工作台');
    assert(received.stage === 'planned' && received.appliedDate === '', '采集岗位仍默认待投递，不伪造网申进度');
    await dashboard.screenshot({ path: path.join(output, 'imported-desktop.png') });
    const save = () => dashboard.locator('#record-form button[type="submit"]').click();
    const close = () => dashboard.locator('#record-dialog [data-close]').last().click();
    const records = () => dashboard.evaluate(key => JSON.parse(localStorage.getItem(key)).records, storageKey);
    await save();
    await dashboard.reload();
    const added = (await records()).find(record => record.company === expected.company);
    assert(added && Object.keys(expected).every(key => added[key] === expected[key]), '保存并刷新后保留所有新增字段及补充信息');
    assert(await dashboard.locator('#stat-total').textContent() === '9', '收藏岗位不增加已投递总数');
    await dashboard.locator(`[data-edit="${added.id}"]`).first().click();
    assert(await dashboard.locator('#field-resume').inputValue() === '数据分析简历 V2' && await dashboard.locator('#field-notes').inputValue() === expected.notes, '编辑正确回显备注和简历版本');
    await dashboard.locator('#field-notes').fill('已确认内推（虚构示例）');
    await dashboard.locator('#add-resume').click();
    await dashboard.locator('#resume-name').fill('数据分析简历 V3');
    await dashboard.locator('#resume-name').press('Enter');
    await dashboard.locator('#progress-fields summary').click();
    await dashboard.locator('#field-stage').selectOption('applied');
    assert(!!(await dashboard.locator('#field-date').inputValue()), '展开进度并改为已投递时补入可调整的投递日期');
    await save();
    const edited = (await records()).find(record => record.id === added.id);
    assert(edited.notes === '已确认内推（虚构示例）' && edited.resumeVersion === '数据分析简历 V3' && edited.majors === expected.majors, '编辑保存新字段，收起的专业信息仍保留');
    await dashboard.locator(`[data-edit="${legacy.id}"]`).first().click();
    assert(await dashboard.locator('#field-job-type').inputValue() === legacy.jobType, '旧版自定义岗位类型在下拉框中保留原值');
    await dashboard.locator('#field-notes').fill('为旧记录添加备注');
    await save();
    const oldSaved = (await records()).find(record => record.id === legacy.id);
    assert(Object.keys(legacy).every(key => oldSaved[key] === legacy[key]) && oldSaved.notes === '为旧记录添加备注', '编辑旧记录不丢失投递日期、阶段、安排、下一步及旧岗位字段');
    const downloadPromise = dashboard.waitForEvent('download');
    await dashboard.locator('[data-action="export"]').first().click();
    const download = await downloadPromise;
    const backup = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert(backup.records.find(record => record.id === added.id).resumeVersion === '数据分析简历 V3', 'JSON 备份包含备注和简历版本');
    await dashboard.locator('#import-file').setInputFiles({ name: 'format-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await dashboard.locator('#confirm-button').click();
    assert((await records()).find(record => record.id === added.id).notes === edited.notes, '新版字段可通过备份完整恢复');
    await dashboard.locator('[data-action="add"]').first().click();
    assert(await dashboard.locator('#field-notes').inputValue() === '' && await dashboard.locator('#field-resume').inputValue() === '', '新增表单不残留上次的备注或简历选择');
    assert((await dashboard.locator('#field-resume').textContent()).includes('数据分析简历 V3'), '新增岗位可选择已有记录中的简历版本名称');
    await dashboard.screenshot({ path: path.join(output, 'desktop.png') });
    await dashboard.setViewportSize({ width: 390, height: 844 });
    await dashboard.screenshot({ path: path.join(output, 'mobile.png') });
    assert(await dashboard.locator('#record-dialog').evaluate(el => el.scrollWidth <= el.clientWidth), '窄屏岗位表单没有横向溢出');
    const saveRect = await dashboard.locator('#record-form button[type="submit"]').boundingBox();
    assert(saveRect.y >= 0 && saveRect.y + saveRect.height <= 844, '手机窄屏始终可见保存按钮');
    await close();
    // A version 1 packet from the older extension must clear optional fields,
    // rather than inheriting the previous preview's notes or resume selection.
    await popup.bringToFront();
    await popup.evaluate(job => chrome.storage.local.set({ lastCapture: { kind: 'offertrack-job', version: 1, method: '旧版采集测试', warnings: [], job } }), { company: '旧采集测试', role: '工程师', city: '杭州', jd: '岗位职责：测试兼容性', jobType: '全职' });
    await popup.locator('#restore').click();
    assert(await popup.locator('[name="notes"]').inputValue() === '' && await popup.locator('#resume-version').inputValue() === '' && await popup.locator('#job-type').inputValue() === '全职', '旧插件草稿恢复兼容原类型，新增字段不串到其他岗位');
    assert(errors.length === 0, '工作台与插件运行无 JavaScript 页面错误');
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: checks.length, checks }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
