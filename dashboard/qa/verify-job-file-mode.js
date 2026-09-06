async page => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = 'file:///C:/Users/14984/Desktop/就业/秋招/JobHuntBot/dashboard/dashboard.html';
  const data = { kind: 'offertrack-job', version: 1, job: { company: '文件模式测试公司', role: '测试岗位', city: '杭州', majors: '计算机专业', jd: '岗位职责：维护测试环境。', sourceUrl: 'https://example.com/jobs/file-mode-test' } };
  await page.goto(base + '#offertrack-import=' + encodeURIComponent(JSON.stringify(data)));
  await page.locator('#record-dialog').waitFor({ state: 'visible' });
  if (await page.locator('#field-jd').inputValue() !== data.job.jd || page.url().includes('offertrack-import')) throw new Error('本地文件导入失败');
  await page.locator('#record-form button[type="submit"]').click();
  await page.reload();
  await page.locator('#search').fill('文件模式测试公司');
  if (await page.locator('#jobs-body [data-edit]').count() !== 1) throw new Error('文件模式保存失败');
  await page.locator('#jobs-body [data-delete]').click();
  await page.locator('#confirm-button').click();
  if (errors.length) throw new Error(errors.join('\n'));
  return { passed: 3, checks: ['file:// 导入并清理链接', 'file:// 保存后刷新保留', '新增测试记录可删除'] };
}
