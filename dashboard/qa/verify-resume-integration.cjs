'use strict';
const { chromium } = require('D:/Program Files/nodejs/node_global/node_modules/@playwright/cli/node_modules/playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const assert = require('assert/strict');
const dashboardRoot = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'offertrack-resume-check-'));
const output = path.join(__dirname, 'resume-integration');
fs.mkdirSync(output, { recursive: true });
const base = 'http://127.0.0.1:8421';
const checks = [];
let child, browser;
function passed(label) { checks.push(label); console.log('PASS ' + label); }
function pdf(text) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const stream = `BT /F1 24 Tf 72 740 Td (${text}) Tj ET`;
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  let result = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((object, index) => { offsets.push(result.length); result += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const start = result.length;
  result += `xref\n0 6\n0000000000 65535 f \n` + offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  return Buffer.from(result + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
}
async function start() {
  child = spawn(process.execPath, [path.join(dashboardRoot, 'server.js')], { env: { ...process.env, OFFERTRACK_PORT: '8421', OFFERTRACK_RESUME_DIR: temporary }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stderr.on('data', data => { log += data; });
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(log || 'Test server exited');
    try { if ((await fetch(base + '/api/resumes')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Test server did not become ready');
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const done = new Promise(resolve => child.once('exit', resolve)); child.kill(); await done;
}
(async () => {
  try {
    await start();
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/dashboard.html');
    await page.waitForFunction(() => document.querySelector('#stat-total').textContent === '8');
    const initial = await page.evaluate(() => JSON.parse(localStorage.getItem('jobhuntbot.offertrack.v1')).records);
    assert.equal(initial.length, 8); passed('原工作台加载，已有示例和统计保持正常');
    await page.locator('[data-nav="resumes"]').click();
    await page.waitForFunction(() => !document.querySelector('[data-resume-upload]').disabled);
    assert.equal(await page.locator('#dashboard-content').isVisible(), false);
    assert.equal(await page.locator('#resume-manager').isVisible(), true);
    assert.equal(new URL(page.url()).pathname, '/dashboard.html');
    assert.equal(await page.getByText('简历优化', { exact: true }).count(), 0);
    passed('原 dashboard 同一页面切换简历管理，没有独立站点或简历优化');
    const first = { name: '产品经理简历.pdf', mimeType: 'application/pdf', buffer: pdf('Product Version One') };
    const second = { name: first.name, mimeType: 'application/pdf', buffer: pdf('Product Version Two') };
    const technical = { name: '研发工程师.pdf', mimeType: 'application/pdf', buffer: pdf('Engineering Version') };
    await page.locator('#resume-file-input').setInputFiles([first, second, { name: '错误格式.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not pdf') }, technical]);
    await page.getByText('上传完成 · 成功 3 份，失败 1 份', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.resume-file-card').length === 3);
    passed('批量上传支持同名不同版本，错误文件不影响后续上传');
    await page.locator('#resume-file-input').setInputFiles(first);
    await page.getByText('上传完成 · 成功 0 份，重复 1 份', { exact: true }).waitFor();
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.resume-file-card').length === 3);
    assert.equal(await page.locator('#resume-manager').isVisible(), true);
    passed('重复文件跳过，刷新保留全部简历并回到简历管理');
    const rows = (await (await fetch(base + '/api/resumes')).json()).resumes;
    const target = rows.find(row => row.originalName === technical.name);
    assert.equal((await fetch(`${base}/api/resumes/${target.id}/file`)).headers.get('content-type'), 'application/pdf');
    assert.deepEqual(Buffer.from(await (await fetch(`${base}/api/resumes/${target.id}/file`)).arrayBuffer()), technical.buffer);
    const downloadPromise = page.waitForEvent('download');
    await page.locator(`[data-resume-id="${target.id}"]`).getByRole('link', { name: /^下载简历/ }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), technical.name); assert.equal(await download.failure(), null);
    passed('PDF 可查看和下载，文件名及字节完整');
    await page.locator('[data-nav="applications"]').click();
    assert.equal(await page.locator('#dashboard-content').isVisible(), true);
    await page.locator('[data-action="add"]').first().click();
    await page.locator('#field-company').fill('集成测试公司');
    await page.locator('#field-role').fill('研发工程师');
    await page.locator('#field-city').fill('上海');
    await page.locator('#field-resume').selectOption(`upload:${target.id}`);
    assert.equal(await page.locator('#resume-bound-link').isVisible(), true);
    await page.locator('#record-form button[type="submit"]').click();
    await page.locator('#record-dialog').waitFor({ state: 'hidden' });
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('jobhuntbot.offertrack.v1')).records);
    const created = stored.find(row => row.company === '集成测试公司');
    assert.equal(created.resumeId, target.id); assert.equal(created.resumeVersion, '研发工程师');
    assert.equal(stored.length, 9);
    assert.equal(await page.locator(`[data-record="${created.id}"] .record-resume-link`).getAttribute('href'), `/api/resumes/${target.id}/file`);
    for (const original of initial) {
      const preserved = stored.find(row => row.id === original.id);
      for (const [key, value] of Object.entries(original)) assert.deepEqual(preserved[key], value);
      for (const [key, value] of Object.entries(preserved)) if (!(key in original)) assert.equal(value, '');
    }
    passed('岗位能绑定真实 PDF 并从列表查看，原来的八条记录未被改动');
    await page.locator(`[data-edit="${created.id}"]`).click();
    assert.equal(await page.locator('#field-resume').inputValue(), `upload:${target.id}`);
    await page.locator('#field-notes').fill('修改其他字段保留绑定');
    await page.locator('#record-form button[type="submit"]').click();
    await page.locator('#record-dialog').waitFor({ state: 'hidden' });
    await page.locator('[data-nav="resumes"]').click();
    await page.locator(`[data-resume-rename="${target.id}"]`).click();
    await page.locator('#resume-edit-name').fill('研发 · 正式版');
    await page.locator('#resume-edit-save').click();
    await page.getByRole('heading', { name: '研发 · 正式版', exact: true }).waitFor();
    const afterRename = await page.evaluate(() => JSON.parse(localStorage.getItem('jobhuntbot.offertrack.v1')).records);
    assert.equal(afterRename.find(row => row.id === created.id).resumeVersion, '研发工程师');
    passed('编辑岗位保留文件绑定，重命名简历不篡改历史投递的版本名称');
    if (await page.locator('#resume-dismiss').isVisible()) await page.locator('#resume-dismiss').click();
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    passed('简历管理桌面和手机布局均可用');
    await page.locator(`[data-resume-remove="${target.id}"]`).click();
    await page.locator('#resume-remove-dialog [data-close]').last().click();
    assert.equal(await page.locator('.resume-file-card').count(), 3);
    await page.locator(`[data-resume-remove="${target.id}"]`).click();
    await page.locator('#resume-remove-confirm').click();
    await page.waitForFunction(() => document.querySelectorAll('.resume-file-card').length === 2);
    const afterDelete = await page.evaluate(() => JSON.parse(localStorage.getItem('jobhuntbot.offertrack.v1')).records);
    assert.equal(afterDelete.length, 9); assert.equal(afterDelete.find(row => row.id === created.id).resumeVersion, '研发工程师');
    assert.equal((await fetch(`${base}/api/resumes/${target.id}/file`)).status, 404);
    passed('删除前确认，删除文件后仍保留岗位及历史版本名称');
    await page.locator('[data-nav="applications"]').click();
    await page.locator(`[data-edit="${created.id}"]`).click();
    await page.locator('#field-notes').fill('原文件删除后仍可编辑岗位');
    await page.locator('#record-form button[type="submit"]').click();
    await page.locator('#record-dialog').waitFor({ state: 'hidden' });
    passed('已删除文件的历史岗位仍能编辑，不会丢失记录');
    await stop(); await start();
    assert.equal((await (await fetch(base + '/api/resumes')).json()).resumes.length, 2);
    passed('重启工作台后磁盘简历仍然存在');
    for (const [requestPath, headers] of [['/api/resumes', { Origin: 'https://example.com' }], ['/.resume-data/index.json', {}], ['/..%2fserver.js', {}]]) {
      assert.equal((await fetch(base + requestPath, { headers })).status, 403, requestPath);
    }
    const wrongHost = await new Promise((resolve, reject) => { const req = require('http').get(base + '/api/resumes', { headers: { Host: 'example.com' } }, response => { response.resume(); resolve(response.statusCode); }); req.on('error', reject); });
    assert.equal(wrongHost, 403);
    assert.equal((await fetch(base + '/api/resumes?name=a.pdf', { method: 'POST', body: first.buffer })).status, 403);
    passed('跨站请求、无凭据写入及直接访问私有文件被拒绝');
    assert.deepEqual(errors, []); passed('浏览器运行无 JavaScript 错误');
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, checks }, null, 2));
  } finally {
    if (browser) await browser.close(); await stop();
    // This path comes directly from mkdtemp for this test run.
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
