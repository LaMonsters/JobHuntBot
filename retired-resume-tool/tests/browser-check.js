async (page) => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:8766/');
  await page.locator('#empty-state').waitFor({ state: 'visible' });
  check(await page.locator('#header-upload').isEnabled(), 'Upload button disabled');
  check(await page.getByText('简历优化', { exact: true }).count() === 0, 'Unexpected optimization feature');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'qa-output/desktop-empty.png', fullPage: true });

  function pdf(text) {
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    const content = `BT /F1 24 Tf 72 740 Td (${text}) Tj ET`;
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    let result = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => { offsets.push(result.length); result += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const start = result.length;
    result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach(offset => { result += `${String(offset).padStart(10, '0')} 00000 n \n`; });
    result += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
    return result;
  }
  const first = 'qa-output/fixtures/first/产品经理-秋招版.pdf';
  const second = 'qa-output/fixtures/second/产品经理-秋招版.pdf';
  const third = 'qa-output/fixtures/研发工程师-技术岗.pdf';
  const invalid = 'qa-output/fixtures/不支持的文件.txt';
  await page.locator('#file-input').setInputFiles([first, second, invalid, third]);
  await page.getByText('上传完成 · 成功 3 份，失败 1 份', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.resume-card').length === 3);
  check(await page.locator('.upload-status .failed').count() === 1, 'Invalid file not reported');
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.resume-card').length === 3);

  await page.locator('#file-input').setInputFiles(first);
  await page.getByText('上传完成 · 成功 0 份，重复 1 份', { exact: true }).waitFor();
  check(await page.locator('.resume-card').count() === 3, 'Duplicate changed record count');
  await page.locator('.resume-card').first().getByRole('button', { name: /^重命名/ }).click();
  await page.locator('#resume-title').fill('研发工程师 · 秋招通用版');
  await page.locator('#save-rename').click();
  await page.getByRole('heading', { name: '研发工程师 · 秋招通用版', exact: true }).waitFor();
  await page.locator('#dismiss-upload').click();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('.resume-card').first().getByRole('link', { name: /^下载简历/ }).click();
  const download = await downloadPromise;
  check(download.suggestedFilename() === '研发工程师-技术岗.pdf', 'Downloaded filename mismatch');
  check(await download.failure() === null, 'Download failed');

  const fileHref = await page.locator('.view-link').first().getAttribute('href');
  const pdfResponse = await page.request.get(`http://127.0.0.1:8766${fileHref}`);
  check(pdfResponse.ok(), 'View URL failed');
  check(pdfResponse.headers()['content-type'] === 'application/pdf', 'View MIME type incorrect');
  check((await pdfResponse.text()) === pdf('Engineering Resume Test'), 'Downloaded PDF bytes changed');
  await page.screenshot({ path: 'qa-output/desktop-resumes.png', fullPage: true });

  // Uploaded titles are data, never interpreted as markup.
  await page.locator('.resume-card').first().getByRole('button', { name: /^重命名/ }).click();
  await page.locator('#resume-title').fill('<img src=x onerror=alert(1)>');
  await page.locator('#save-rename').click();
  await page.getByRole('heading', { name: '<img src=x onerror=alert(1)>', exact: true }).waitFor();
  check(await page.locator('.resume-card img').count() === 0, 'Filename interpreted as HTML');

  await page.locator('.resume-card').first().getByRole('button', { name: /^删除/ }).click();
  await page.locator('#cancel-delete').click();
  check(await page.locator('.resume-card').count() === 3, 'Cancel removed a resume');
  await page.locator('.resume-card').first().getByRole('button', { name: /^删除/ }).click();
  await page.locator('#confirm-delete').click();
  await page.waitForFunction(() => document.querySelectorAll('.resume-card').length === 2);
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.resume-card').length === 2);

  await page.setViewportSize({ width: 390, height: 844 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile horizontal overflow');
  await page.screenshot({ path: 'qa-output/mobile-resumes.png', fullPage: true });

  // Drag-and-drop uses the same multi-file pipeline as the file picker.
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(['%PDF-1.4\n% drag test a\n%%EOF'], '拖拽版本A.pdf', { type: 'application/pdf' }));
    data.items.add(new File(['%PDF-1.4\n% drag test b\n%%EOF'], '拖拽版本B.pdf', { type: 'application/pdf' }));
    document.querySelector('#dropzone').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: data }));
  });
  await page.getByText('上传完成 · 成功 2 份', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.resume-card').length === 4);
  check(errors.length === 0, `Browser errors: ${errors.join('; ')}`);
  return { passed: true, checks: ['batch upload', 'mixed file failure', 'same filename versions', 'reload persistence', 'duplicate skip', 'rename', 'download bytes and name', 'safe text rendering', 'delete confirmation', 'mobile layout', 'multi-file drag-and-drop', 'no browser errors'] };
}
