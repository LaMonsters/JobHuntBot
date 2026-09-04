'use strict';
const assert = require('assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('D:/Program Files/nodejs/node_global/node_modules/@playwright/cli/node_modules/playwright-core');
const A = require('../workspace-data.js');
const checks = [], passed = text => { checks.push(text); console.log('PASS ' + text); };
const record = (id, stage, fields = {}) => ({ id, company: id, role: '研发工程师', city: '上海', stage, appliedDate: '', eventTitle: '', eventAt: '', nextAction: '', ...fields });
const fixed = new Date(2026, 8, 4, 12);
const edgeCases = [
  record('today', 'planned', { deadline: '2026-09-04' }), record('plus2', 'planned', { deadline: '2026-09-06' }), record('plus3', 'planned', { deadline: '2026-09-07' }),
  record('past', 'planned', { deadline: '2026-09-03' }), record('submittedDeadline', 'applied', { deadline: '2026-09-04', appliedDate: '2026-08-31' }),
  record('sunday', 'test', { appliedDate: '2026-09-06', eventTitle: '笔试', eventAt: '2026-09-10T09:00' }),
  record('nextWeek', 'interview1', { appliedDate: '2026-09-07', eventAt: '2026-09-11T09:00', eventTitle: '面试' }),
  record('rejected', 'rejected', { appliedDate: '2026-08-30', eventAt: '2026-09-04T09:00', eventTitle: '面试', stageHistory: [{ stage: 'interview1', at: '2026-08-31T00:00:00.000Z' }] }),
  record('stalled14', 'applied', { appliedDate: '2026-08-21' }), record('stalled13', 'applied', { appliedDate: '2026-08-22' }),
  record('followup', 'planned', { followUpDate: '2026-09-04', nextAction: '询问内推' })
];
const edge = A.summarize(edgeCases, fixed);
assert.deepEqual(edge.deadlines.map(r => r.id), ['today', 'plus2']);
assert.deepEqual(edge.weekly.map(r => r.id), ['submittedDeadline', 'sunday']);
assert.deepEqual(edge.upcoming.map(r => r.id), ['sunday']);
assert.deepEqual(edge.stalled.map(r => r.id), ['stalled14']);
assert.deepEqual(edge.todos.map(r => r.record.id), ['today', 'past', 'followup']);
assert.equal(edge.progression, 50); // 3 of 6 submitted records advanced, including the rejected one.
assert.equal(A.summarize([], new Date(2027, 0, 1)).weekStart, '2026-12-28');
assert.equal(A.summarize([], new Date(2027, 0, 1)).weekEnd, '2027-01-03');
assert.equal(A.summarize([], fixed, -1).weekStart, '2026-08-24');
assert.equal(A.summarize([], fixed).progression, 0);
passed('统计边界：周一至周日、跨年、三天截止、七天安排、14 天停滞与历史推进率');
const today = new Date(), d = amount => A.key(A.offset(today, amount));
const thisWeek = A.summarize([], today).weekStart;
const fixtures = [
  record('目标岗位', 'planned', { deadline: d(0), tags: '内推,重点', favorite: true, matchScore: 90, resumeVersion: '历史研发版' }),
  record('本周笔试', 'test', { appliedDate: thisWeek, eventAt: d(0) + 'T14:00', eventTitle: '线上笔试' }),
  record('长期跟进', 'applied', { appliedDate: d(-20), followUpDate: d(0), nextAction: '确认招聘进度' }),
  record('已获录用', 'offer', { appliedDate: d(-14), stageHistory: [{ stage: 'offer', at: today.toISOString() }] }),
  record('结束流程', 'rejected', { appliedDate: d(0), stageHistory: [{ stage: 'interview1', at: today.toISOString() }], reviewNotes: '下次补充项目量化结果。' })
];
const root = path.resolve(__dirname, '..'), output = path.join(__dirname, 'workspace-integration');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'offertrack-workspace-check-'));
fs.mkdirSync(output, { recursive: true });
const base = 'http://127.0.0.1:8421', key = 'jobhuntbot.offertrack.v1';
let server, browser;
(async () => {
  try {
    server = spawn(process.execPath, [path.join(root, 'server.js')], { env: { ...process.env, OFFERTRACK_PORT: '8421', OFFERTRACK_RESUME_DIR: temporary }, windowsHide: true, stdio: 'ignore' });
    let ready = false;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/resumes')).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
    assert.equal(ready, true);
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    await context.addInitScript(({ fixtures, key }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, records: fixtures })); }, { fixtures, key });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const nav = async name => { await page.locator(`.sidebar button[data-nav="${name}"]`).click(); assert.equal(await page.locator('body').getAttribute('data-page'), name); };
    const saved = async () => page.evaluate(key => JSON.parse(localStorage.getItem(key)).records, key);
    const screenshot = async name => { await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true }); };
    const quickCount = async (filter, count) => { await page.locator(`[data-quick="${filter}"]`).click(); assert.equal(await page.locator('.job-card').count(), count, filter); };
    await page.goto(base + '/dashboard.html');
    await page.waitForFunction(() => document.querySelector('#overview-total-jobs').textContent === '5');
    assert.equal(await page.locator('.sidebar>.nav').first().getByRole('button').count(), 5);
    assert.equal(await page.locator('#stat-total').innerText(), '4');
    assert.equal(await page.locator('#overview-deadline-count').innerText(), '1 个');
    assert.equal(await page.locator('#overview-todo-count').innerText(), '3 项');
    assert.equal(await page.locator('#overview-week-count').innerText(), '2 份');
    assert.equal(await page.locator('#applications').isVisible(), false);
    assert.equal(await page.locator('.month-day').count(), 42);
    await screenshot('overview-desktop');
    passed('总览：五个入口、统计、趋势、截止和今日待办与旧记录一致');
    await page.locator(`[data-calendar-day="${d(0)}"]`).click();
    assert.ok((await page.locator('#calendar-events').innerText()).includes('投递截止'));
    assert.ok((await page.locator('#calendar-events').innerText()).includes('已获 Offer'));
    const originalMonth = await page.locator('#calendar-month').innerText();
    await page.locator('#calendar-next').click(); assert.notEqual(await page.locator('#calendar-month').innerText(), originalMonth);
    await page.locator('#calendar-prev').click(); assert.equal(await page.locator('#calendar-month').innerText(), originalMonth);
    await page.locator('#calendar-today').click();
    await page.locator('#calendar-events [data-edit="目标岗位"]').click();
    assert.equal(await page.locator('#field-company').inputValue(), '目标岗位');
    await page.locator('#record-dialog [data-close]').last().click();
    passed('总览台历：月切换、当天详情、投递/截止/安排/结果和岗位跳转');
    await nav('applications');
    assert.equal(await page.locator('#job-board').isVisible(), true);
    assert.equal(await page.locator('.job-card').count(), 5);
    await quickCount('favorite', 1); await quickCount('matched', 1); await quickCount('high', 1); await quickCount('deadline', 1); await quickCount('resume', 1); await quickCount('unscheduled', 2); await quickCount('all', 5);
    await page.locator('#search').fill('内推'); assert.equal(await page.locator('.job-card').count(), 1);
    await page.locator('#search').fill('历史研发版'); assert.equal(await page.locator('.job-card').count(), 1);
    await page.locator('#search').fill('不会有这个岗位'); assert.equal(await page.locator('.job-card').count(), 0);
    await page.locator('#search').fill('');
    await page.locator('[data-job-view="table"]').click();
    assert.equal(await page.locator('#jobs-body tr[data-record]').count(), 5);
    assert.equal(await page.locator('#job-board').isVisible(), false);
    await page.locator('#stage-filter').selectOption('planned'); assert.equal(await page.locator('#jobs-body tr[data-record]').count(), 1);
    await page.locator('#stage-filter').selectOption('');
    await page.reload(); assert.equal(await page.locator('#application-table').isVisible(), true);
    await page.locator('[data-job-view="board"]').click();
    passed('我的投递：卡片/表格切换，七种快捷筛选、标签与简历搜索及偏好持久化');
    await page.locator('.sidebar [data-action="add"]').click();
    await page.locator('#field-company').fill('验收新公司'); await page.locator('#field-role').fill('数据分析师'); await page.locator('#field-city').fill('杭州');
    await page.locator('#field-job-type').selectOption({ label: '数据岗' });
    await page.locator('#field-source-url').fill('https://example.com/careers/123');
    await page.locator('#field-deadline').fill(d(2));
    await page.locator('#field-jd').fill('独特JD关键词：SQL 与经营分析');
    await page.locator('#field-notes').fill('=HYPERLINK("x")\n备注第二行');
    await page.locator('#field-resume').selectOption({ label: '历史研发版' });
    await page.locator('#extra-job-fields summary').click();
    await page.locator('#field-tags').fill('内推, <img src=x onerror=alert(1)>');
    await page.locator('#field-match-score').fill('85'); await page.locator('#field-favorite').check();
    await page.locator('#progress-fields summary').click();
    await page.locator('#field-follow-up').fill(d(0));
    await page.locator('#field-action').fill('联系校招负责人');
    await page.locator('#field-review-notes').fill('准备一段业务分析案例。\n下一次先讲结论。');
    await page.locator('#record-form button[type="submit"]').click();
    await page.locator('#record-dialog').waitFor({ state: 'hidden' });
    const created = (await saved()).find(r => r.company === '验收新公司');
    assert.equal(created.stage, 'planned'); assert.equal(created.appliedDate, ''); assert.equal(created.matchScore, 85); assert.equal(created.favorite, true); assert.equal(created.stageHistory.length, 1); assert.equal(created.resumeVersion, '历史研发版');
    assert.equal(await page.locator('.job-card img').count(), 0);
    await page.locator('#search').fill('独特JD关键词'); assert.equal(await page.locator('.job-card').count(), 1); await page.locator('#search').fill('');
    await screenshot('applications-desktop');
    passed('添加岗位：完整字段、可选日期、简历版本、跟进和复盘保存；JD 可搜索且文本安全显示');
    await page.locator(`[data-job-card="${created.id}"]`).dragTo(page.locator('[data-drop-stage="applied"] .board-column-heading'));
    assert.equal((await saved()).find(r => r.id === created.id).stage, 'applied');
    await page.locator(`[data-change-stage="${created.id}"]`).selectOption('interview1');
    let current = (await saved()).find(r => r.id === created.id);
    assert.equal(current.appliedDate, d(0)); assert.deepEqual(current.stageHistory.map(item => item.stage), ['planned', 'applied', 'interview1']);
    await page.locator(`[data-favorite="${created.id}"]`).click();
    current = (await saved()).find(r => r.id === created.id);
    assert.equal(current.favorite, false); assert.equal(current.stageHistory.length, 3);
    await page.locator('[data-stage-label="interview1"]').click(); await page.locator('#stage-label-input').fill('技术一面');
    await page.locator('#stage-label-form button[type="submit"]').click();
    assert.ok((await page.locator('[data-drop-stage="interview1"] h3').innerText()).includes('技术一面'));
    await page.reload(); assert.ok((await page.locator('[data-drop-stage="interview1"] h3').innerText()).includes('技术一面'));
    await page.locator(`[data-job-card="${created.id}"] [data-edit]`).click();
    assert.equal(await page.locator('#record-stage-history li').count(), 3);
    assert.equal(await page.locator('#field-review-notes').inputValue(), created.reviewNotes);
    await page.locator('#record-dialog [data-close]').last().click();
    passed('投递更新：拖拽与下拉更新阶段，自动记录实际日期和历史；收藏及列名保存');
    await nav('overview'); assert.equal(await page.locator('#stat-total').innerText(), '5'); assert.equal(await page.locator('#overview-interviews').innerText(), '1'); assert.equal(await page.locator('#overview-week-count').innerText(), '3 份');
    await nav('review');
    assert.equal(await page.locator('#review-submitted').innerText(), '3'); assert.equal(await page.locator('#review-appointments').innerText(), '1'); assert.equal(await page.locator('#review-progression').innerText(), '80%');
    assert.equal(await page.locator('#review-stalled [data-edit]').count(), 1);
    assert.equal(await page.locator('#review-notes .review-note').count(), 2);
    await page.locator('#review-prev').click(); assert.equal(await page.locator('#review-submitted').innerText(), '0');
    await page.locator('#review-this-week').click(); assert.equal(await page.locator('#review-submitted').innerText(), '3');
    await page.locator(`#review-notes [data-edit="${created.id}"]`).click();
    await page.locator('#field-review-notes').fill('已完成复盘：先结论，再证据。');
    await page.locator('#record-form button[type="submit"]').click();
    await page.locator('#record-dialog').waitFor({ state: 'hidden' });
    await nav('review'); assert.ok((await page.locator('#review-notes').innerText()).includes('已完成复盘'));
    await screenshot('review-desktop');
    passed('投递复盘：周统计、历史推进率、停滞岗位、个人笔记及总览实时联动');
    await nav('applications'); await page.locator('#search').fill('验收新公司');
    let downloadPromise = page.waitForEvent('download'); await page.locator('[data-action="export-csv"]').click();
    let download = await downloadPromise; const csv = fs.readFileSync(await download.path(), 'utf8');
    assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes('验收新公司')); assert.ok(!csv.includes('长期跟进')); assert.ok(csv.includes("'=HYPERLINK")); assert.ok(csv.includes('备注第二行'));
    await page.locator('#search').fill('');
    downloadPromise = page.waitForEvent('download'); await page.locator('[data-action="export"]').first().click(); download = await downloadPromise;
    const backup = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.equal(backup.records.length, 6);
    await page.locator(`[data-job-card="${created.id}"] [data-delete]`).click();
    await page.locator('#confirm-dialog [data-close]').last().click(); assert.equal((await saved()).length, 6);
    await page.locator(`[data-job-card="${created.id}"] [data-delete]`).click(); await page.locator('#confirm-button').click(); assert.equal((await saved()).length, 5);
    await page.locator('[data-action="undo"]').click(); assert.equal((await saved()).length, 6);
    await page.locator('#import-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.locator('#confirm-button').click(); assert.deepEqual(await saved(), backup.records);
    passed('数据管理：CSV 当前筛选导出、防公式注入、JSON 完整恢复、删除确认与撤销');
    const other = await context.newPage(); await other.goto(base + '/dashboard.html#applications');
    await page.locator(`[data-job-card="${created.id}"] [data-edit]`).click();
    await other.locator(`[data-favorite="${created.id}"]`).click();
    await page.locator('#field-notes').fill('不应覆盖另一个窗口的修改');
    await page.locator('#record-form button[type="submit"]').click();
    await page.locator('#form-error').waitFor(); assert.ok((await page.locator('#form-error').innerText()).includes('其他窗口'));
    await page.locator('#record-dialog [data-close]').last().click(); await other.close();
    passed('并发保护：其他窗口更新后，过期编辑不会覆盖新记录');
    await page.setViewportSize({ width: 390, height: 844 });
    for (const name of ['overview', 'applications', 'resumes', 'review']) {
      await nav(name);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, name + ' mobile overflow');
      await screenshot(name + '-mobile');
    }
    await page.locator('.sidebar [data-action="add"]').click();
    assert.equal(await page.locator('#record-dialog').isVisible(), true); await screenshot('add-mobile');
    await page.locator('#record-dialog [data-close]').last().click();
    passed('手机布局：390px 下五个入口可操作，各面板没有页面横向溢出');
    await page.locator('#import-file').setInputFiles({ name: 'empty.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1,"records":[]}') });
    await page.locator('#confirm-button').click();
    await nav('overview'); assert.equal(await page.locator('#stat-total').innerText(), '0'); assert.equal(await page.locator('#overview-todo-count').innerText(), '0 项');
    await nav('review'); assert.equal(await page.locator('#review-progression').innerText(), '0%'); assert.equal(await page.locator('#review-notes .review-note').count(), 0);
    await nav('applications'); assert.equal(await page.locator('.job-card').count(), 0);
    await page.reload(); assert.equal((await saved()).length, 0);
    const invalid = { ...fixtures[0], stageHistory: [{ stage: 'unknown', at: today.toISOString() }] };
    await page.locator('#import-file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, records: [invalid] })) });
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('阶段历史'));
    assert.equal((await saved()).length, 0);
    passed('空状态与异常数据：清空后刷新不重建示例，无效历史备份不覆盖数据');
    assert.deepEqual(errors, []); passed('浏览器全流程无 JavaScript 运行错误');
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, testedAt: new Date().toISOString(), checks }, null, 2));
  } finally {
    if (browser) await browser.close();
    if (server && server.exitCode === null) { const done = new Promise(resolve => server.once('exit', resolve)); server.kill(); await done; }
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
