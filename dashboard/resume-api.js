/* PDF storage for the existing local dashboard. No third-party dependencies. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function createResumeAPI(directory) {
  const root = path.resolve(directory);
  const indexPath = path.join(root, 'index.json');
  const token = crypto.randomBytes(32).toString('hex');
  const limit = 20 * 1024 * 1024;
  fs.mkdirSync(root, { recursive: true });
  function readIndex() {
    if (!fs.existsSync(indexPath)) return [];
    const rows = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    if (!Array.isArray(rows)) throw new Error('Invalid resume index');
    return rows;
  }
  function writeIndex(rows) {
    const temporary = path.join(root, `${crypto.randomUUID()}.index.tmp`);
    try {
      fs.writeFileSync(temporary, JSON.stringify(rows, null, 2), { flag: 'wx' });
      fs.renameSync(temporary, indexPath);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
    const content = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    res.writeHead(status, { 'Content-Type': type, 'Content-Length': content.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
    res.end(content);
  }
  function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
  async function body(req, max) {
    const size = Number(req.headers['content-length']);
    if (!Number.isSafeInteger(size) || size <= 0 || size > max || req.headers['transfer-encoding']) fail('文件不能为空，单份 PDF 不能超过 20 MB。', 413);
    const chunks = []; let received = 0;
    for await (const chunk of req) {
      received += chunk.length;
      if (received > max) fail('文件超过大小限制。', 413);
      chunks.push(chunk);
    }
    if (received !== size) fail('上传不完整，请重试。');
    return Buffer.concat(chunks);
  }
  function checkSource(req) {
    const port = req.socket.localPort;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!hosts.includes(req.headers.host)) fail('请从本机工作台打开简历管理。', 403);
    if (req.headers.origin && !hosts.map(host => `http://${host}`).includes(req.headers.origin)) fail('不允许其他网站访问简历库。', 403);
    if (req.headers['sec-fetch-site'] === 'cross-site') fail('请在工作台中查看简历。', 403);
    if (req.method !== 'GET' && req.headers['x-resume-token'] !== token) fail('连接已更新，请刷新工作台后重试。', 403);
  }
  const publicRow = ({ hash, ...row }) => row;
  async function handle(req, res) {
    try {
      checkSource(req);
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/resumes' && req.method === 'GET') {
        return send(res, 200, { resumes: readIndex().map(publicRow).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)), token });
      }
      if (url.pathname === '/api/resumes' && req.method === 'POST') {
        const name = (url.searchParams.get('name') || '').replaceAll('\\', '/').split('/').pop().trim();
        if (!name.toLowerCase().endsWith('.pdf') || name.length > 240 || /[\x00-\x1f\x7f]/.test(name)) fail('请选择文件名不超过 240 个字符的 PDF。');
        const bytes = await body(req, limit);
        if (bytes.subarray(0, 5).toString() !== '%PDF-') fail('文件内容不是 PDF，请重新导出后上传。');
        // There is no await between reading and committing: concurrent uploads cannot lose an index update.
        const rows = readIndex();
        const hash = crypto.createHash('sha256').update(bytes).digest('hex');
        if (rows.some(row => row.hash === hash)) return send(res, 409, { error: '这份文件已上传，已跳过重复文件。', duplicate: true });
        const row = { id: crypto.randomUUID(), name: name.slice(0, -4).slice(0, 100) || '未命名简历', originalName: name, size: bytes.length, uploadedAt: new Date().toISOString(), hash };
        const filePath = path.join(root, `${row.id}.pdf`);
        fs.writeFileSync(filePath, bytes, { flag: 'wx' });
        try { writeIndex([...rows, row]); } catch (error) { fs.unlinkSync(filePath); throw error; }
        return send(res, 201, { resume: publicRow(row) });
      }
      const match = /^\/api\/resumes\/([0-9a-f-]{36})(\/file)?$/.exec(url.pathname);
      if (!match) return send(res, 404, { error: '找不到该简历。' });
      const id = match[1], rows = readIndex(), row = rows.find(item => item.id === id);
      if (!row) return send(res, 404, { error: '这份简历已被删除。岗位中的版本名称仍会保留。' });
      const filePath = path.join(root, `${id}.pdf`);
      if (match[2] && req.method === 'GET') {
        if (!fs.existsSync(filePath)) return send(res, 404, { error: '简历文件缺失，请重新上传。' });
        const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline';
        return send(res, 200, fs.readFileSync(filePath), 'application/pdf', { 'Content-Disposition': `${disposition}; filename="resume.pdf"; filename*=UTF-8''${encodeURIComponent(row.originalName)}`, 'Content-Security-Policy': "frame-ancestors 'self'" });
      }
      if (!match[2] && req.method === 'PATCH') {
        const payload = JSON.parse((await body(req, 4096)).toString());
        if (typeof payload?.name !== 'string' || !payload.name.trim() || payload.name.trim().length > 100 || /[\x00-\x1f\x7f]/.test(payload.name)) fail('请填写 1–100 个字符的简历名称。');
        // Refresh after reading an asynchronous request body to preserve other writes.
        const latest = readIndex(), target = latest.find(item => item.id === id);
        if (!target) return send(res, 404, { error: '这份简历已被删除。' });
        target.name = payload.name.trim();
        writeIndex(latest);
        return send(res, 200, { resume: publicRow(target) });
      }
      if (!match[2] && req.method === 'DELETE') {
        const tombstone = path.join(root, `${id}.deleted`);
        const present = fs.existsSync(filePath);
        if (present) fs.renameSync(filePath, tombstone);
        try { writeIndex(rows.filter(item => item.id !== id)); }
        catch (error) { if (present) fs.renameSync(tombstone, filePath); throw error; }
        if (present) { try { fs.unlinkSync(tombstone); } catch { /* Not exposed by the API; a backup may still be reading it. */ } }
        return send(res, 200, { ok: true });
      }
      send(res, 405, { error: '不支持此操作。' });
    } catch (error) {
      send(res, error.status || (error instanceof SyntaxError ? 400 : 500), { error: error.status ? error.message : '简历库读写失败，请检查文件夹权限或磁盘空间后重试。' });
    }
  }
  return { handle, root };
};
