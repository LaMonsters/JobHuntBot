/* Shared boundary for both extension links and downloaded single-job files. */
globalThis.OfferTrackImport = (() => {
  'use strict';
  const limits = { company: 80, role: 100, city: 60, majors: 500, jd: 20000, sourceUrl: 2000, deadline: 10, salary: 100, education: 100, jobType: 100, notes: 2000, resumeVersion: 100 };
  function validURL(value) {
    if (!value) return true;
    try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; }
  }
  function validate(data) {
    if (!data || data.kind !== 'offertrack-job' || data.version !== 1 || !data.job || Array.isArray(data.job) || typeof data.job !== 'object') throw new Error('请选择 OfferTrack 插件生成的岗位文件。投递备份请用“导入备份”。');
    const job = {};
    for (const [key, max] of Object.entries(limits)) {
      const value = data.job[key] ?? '';
      if (typeof value !== 'string' || value.length > max) throw new Error('岗位字段格式不正确或内容过长，未导入。');
      job[key] = value.trim();
    }
    if (!job.role && !job.jd) throw new Error('岗位文件缺少岗位名称和 JD，请重新采集。');
    if (!validURL(job.sourceUrl)) throw new Error('来源链接必须是有效的 HTTP 或 HTTPS 网页。');
    if (job.deadline) {
      const date = new Date(job.deadline + 'T12:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(job.deadline) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== job.deadline) throw new Error('截止日期不是有效日期。');
    }
    return job;
  }
  function canonical(value) {
    try {
      const url = new URL(value);
      for (const key of [...url.searchParams.keys()]) if (/^(utm_|spm$|from$|source$|ref$|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
      url.searchParams.sort();
      return url.href;
    } catch { return ''; }
  }
  const norm = s => String(s || '').trim().toLocaleLowerCase().replace(/\s+/g, '');
  // Company + role is enough to count as a duplicate: the same opening is often posted
  // in several cities, and a mistyped city must not silence the warning.
  function duplicate(records, job, excludeId = '') {
    const source = canonical(job.sourceUrl);
    return records.find(r => r.id !== excludeId && !r.isDemo && ((source && r.sourceUrl && canonical(r.sourceUrl) === source) || (job.company && job.role && norm(r.company) === norm(job.company) && norm(r.role) === norm(job.role))));
  }
  const sameCompany = (a, b) => Boolean(norm(a)) && norm(a) === norm(b);
  return { limits, validate, validURL, duplicate, sameCompany };
})();
