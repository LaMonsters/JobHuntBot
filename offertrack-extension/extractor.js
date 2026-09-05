/* Runs only on the page the user explicitly chooses. No network or form writes. */
function extractOfferTrackJob(selectionOnly) {
  'use strict';
  const clean = value => typeof value === 'string' ? value.replace(/\u00a0/g, ' ').replace(/[\t ]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : '';
  const warnings = [];
  const visible = el => !!el && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const textOf = el => clean(el?.innerText || '');
  const first = selectors => {
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (visible(el) && textOf(el)) return textOf(el);
      }
    }
    return '';
  };
  const plainHTML = html => {
    if (typeof html !== 'string') return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,iframe,object,form').forEach(el => el.remove());
    doc.querySelectorAll('br').forEach(el => el.replaceWith('\n'));
    doc.querySelectorAll('p,div,li,h1,h2,h3,h4,section,tr').forEach(el => el.append('\n'));
    return clean(doc.body.textContent);
  };
  const selection = clean(window.getSelection()?.toString() || '');
  if (selectionOnly && !selection) throw new Error('请先在岗位页面选中岗位介绍文字，再点击“读取选中文字”。');
  const candidateSelectors = ['[itemprop="description"]', '.job-description', '.job-detail-description', '.job-detail', '.job-details', '.job_detail', '.job-info', '.job-sec-text', '[data-testid="job-description"]', '[class*="jobDescription"]', '[class*="job-description"]', '[class*="jobDetail"]', 'main', 'article'];
  const blocks = [...new Set(candidateSelectors.flatMap(s => [...document.querySelectorAll(s)]))].filter(visible);
  const jobSignal = /岗位职责|职位描述|岗位描述|职位职责|任职要求|职位要求|招聘要求|工作职责|职位介绍|job description|responsibilities|qualifications/i;
  const jdStopLine = /^(?:推荐职位|相关职位|相似职位|猜你喜欢|公司介绍|关于我们|隐私政策|竞争力分析|工作地点|单位信息|联系方式|related jobs)\s*$/i;
  const jdNoise = /(?:如遇|若有).{0,16}收费|谨防上当受骗|拨打热线电话|免费提供发岗位|^更新于\s*20\d{2}/;
  const scored = blocks.map(el => ({ el, text: textOf(el) })).filter(x => x.text.length > 30 && jobSignal.test(x.text));
  scored.sort((a, b) => {
    const score = x => Math.min(x.text.length, 6000) / 6000 + (/岗位职责|工作职责|responsibilities/i.test(x.text) ? 2 : 0) + (/任职要求|招聘要求|qualifications/i.test(x.text) ? 2 : 0) - (x.el.matches('main,article') ? 0.5 : 0);
    return score(b) - score(a) || a.text.length - b.text.length;
  });
  const jobRoot = scored[0]?.el;
  const readable = el => {
    const copy = el.cloneNode(true);
    copy.querySelectorAll('script,style,noscript,nav,footer,form,input,textarea,select,button,[hidden],[aria-hidden="true"]').forEach(node => node.remove());
    copy.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
    copy.querySelectorAll('div,p,li,h1,h2,h3,h4,section,dt,dd,tr').forEach(node => node.append('\n'));
    return clean(copy.textContent).slice(0, 80000);
  };
  const pageText = selectionOnly ? selection : readable(document.body);
  const lines = pageText.split('\n').map(clean).filter(Boolean);
  const field = labels => {
    const sameLine = new RegExp('^(?:' + labels + ')\\s*[：:]\\s*(.+)$', 'i');
    const ownLine = new RegExp('^(?:' + labels + ')\\s*[：:]?$', 'i');
    for (let i = 0; i < lines.length; i++) {
      const hit = lines[i].match(sameLine);
      if (hit) return hit[1].split(/\s*[|｜]\s*/)[0];
      if (ownLine.test(lines[i]) && lines[i + 1] && !/[：:]$/.test(lines[i + 1])) return lines[i + 1];
    }
    return '';
  };
  const asString = value => typeof value === 'string' ? value : value && typeof value.name === 'string' ? value.name : '';
  let structured = null;
  if (!selectionOnly) {
    const postings = [];
    const walk = (value, depth = 0) => {
      if (!value || depth > 12 || postings.length > 100) return;
      if (Array.isArray(value)) { value.forEach(v => walk(v, depth + 1)); return; }
      if (typeof value !== 'object') return;
      if ([value['@type']].flat().some(t => typeof t === 'string' && /(^|\/)JobPosting$/.test(t))) postings.push(value);
      else Object.values(value).forEach(v => walk(v, depth + 1));
    };
    for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
      if (node.textContent.length > 1000000) continue;
      try { walk(JSON.parse(node.textContent)); } catch { /* Other JSON-LD blocks may still be valid. */ }
    }
    if (postings.length === 1) structured = postings[0];
    else if (postings.length > 1) {
      const title = first(['h1']) || document.title;
      const matches = postings.filter(p => p.title && title.includes(p.title));
      if (matches.length === 1) structured = matches[0];
      else warnings.push('页面包含多个岗位，请进入单个岗位详情，或选中目标岗位后重新读取。');
    }
  }
  const job = { company: '', role: '', city: '', jobType: '', sourceUrl: location.href, deadline: '', jd: '', notes: '', resumeVersion: '', majors: '', salary: '', education: '' };
  let method = selectionOnly ? '选中文字' : '网页文字识别';
  if (structured) {
    method = '岗位结构化信息';
    job.role = asString(structured.title);
    job.company = asString(structured.hiringOrganization);
    job.jd = plainHTML(structured.description);
    const locations = [structured.jobLocation || []].flat().map(place => {
      const address = place?.address || place;
      return typeof address === 'string' ? address : asString(address?.addressLocality) || asString(address?.addressRegion) || asString(place?.name);
    }).filter(Boolean);
    job.city = [...new Set(locations)].join(' / ');
    if (!job.city && structured.jobLocationType === 'TELECOMMUTE') job.city = '远程';
    job.education = [structured.educationRequirements || []].flat().map(asString).filter(Boolean).join(' / ');
    job.jobType = [structured.occupationalCategory || []].flat().map(asString).filter(Boolean).join(' / ');
    if (typeof structured.validThrough === 'string' && /^\d{4}-\d{2}-\d{2}/.test(structured.validThrough)) job.deadline = structured.validThrough.slice(0, 10);
    const salary = structured.baseSalary;
    if (typeof salary === 'string' || typeof salary === 'number') job.salary = String(salary);
    else if (salary?.value != null) {
      const v = salary.value;
      const amount = typeof v === 'number' || typeof v === 'string' ? v : v.value ?? (v.minValue != null && v.maxValue != null ? `${v.minValue}–${v.maxValue}` : '');
      if (amount !== '') job.salary = `${salary.currency || ''} ${amount}${v.unitText ? ' / ' + v.unitText : ''}`.trim();
    }
  }
  job.company ||= field('公司名称|招聘公司|招聘单位|用人单位|单位名称|公司|company|employer');
  job.role ||= field('岗位名称|职位名称|招聘岗位|招聘职位|岗位|职位|job title|position');
  job.city ||= field('工作城市|工作地点|工作地区|工作地址|招聘城市|工作所在地|城市|地点|location|job location');
  if (!selectionOnly) {
    job.role ||= first(['[itemprop="title"]', '.job-name h1', '.job-title', '[data-testid="job-title"]', '[class*="jobTitle"]', 'h1', '.title-section .title']);
    job.company ||= first(['[itemprop="hiringOrganization"] [itemprop="name"]', '.company-name', '.company-title', '[data-testid="company-name"]', '[class*="companyName"]']);
    job.city ||= first(['[itemprop="addressLocality"]', '.job-location', '[data-testid="job-location"]']);
    // A title can identify the role; separators count with or without surrounding spaces (国聘 uses 岗位-公司-平台).
    const titleParts = document.title.split(/[|｜]|[-–—](?![A-Za-z0-9])|(?<![A-Za-z0-9])[-–—]/).map(clean).filter(Boolean);
    const textParts = titleParts.filter(p => /[\u4e00-\u9fa5A-Za-z]/.test(p));
    if (!job.role && textParts.length > 1) job.role = textParts[0];
    if (!job.company) {
      const companyTitle = titleParts.find(p => /.+(?:校园招聘|人才招聘|招聘官网|招聘网站)$/.test(p));
      if (companyTitle) job.company = companyTitle.replace(/(?:校园招聘|人才招聘|招聘官网|招聘网站)$/, '').trim();
    }
  }
  job.majors = field('招聘专业|专业要求|专业需求|所需专业|所学专业|相关专业|需求专业|专业');
  job.education ||= field('学历要求|学历|education');
  job.salary ||= field('薪资待遇|薪资范围|薪酬范围|薪资|薪酬|salary|compensation');
  job.jobType ||= field('岗位类型|职位类型|职位类别|岗位类别|职能类别|职位分类|job category');
  // Classify the role, rather than treating full-time/internship as a role category.
  // This function runs on the source page, so its rules must be self-contained.
  const categories = [
    ['管培生', /管培|管理培训|management trainee/i],
    ['产品岗', /产品经理|产品策划|产品助理|产品实习|产品运营|product manager|product owner/i],
    ['数据岗', /数据分析|数据科学|数据挖掘|商业分析|商业智能|data analyst|data scien|business analyst/i],
    ['设计岗', /设计|交互|用户体验|designer|design/i],
    ['技术岗', /前端|后端|软件|客户端|全栈|运维|测试开发|测试工程|信息安全|网络安全|开发工程|software|developer|devops/i],
    ['科研岗', /科研|研究员|博士后|研究助理|research scientist|research assistant/i],
    ['研发岗', /研发|算法|硬件|芯片|人工智能|机器学习|深度学习|algorithm|research.*develop/i],
    ['运营岗', /运营|用户增长|内容编辑|operation/i],
    ['销售岗', /销售|商务拓展|客户经理|sales|account manager/i],
    ['市场岗', /市场|营销|品牌|公关|marketing/i],
    ['职能岗', /人力|人事|招聘专员|财务|会计|法务|行政|审计|采购|human resources|accountant|finance/i],
    ['工程岗', /工程|质量|生产|工艺|制造|engineer/i]
  ];
  const categoryNames = [...categories.map(([name]) => name), '通用校招'];
  const explicitType = clean(job.jobType);
  if (!categoryNames.includes(explicitType)) {
    const fromExplicit = categories.find(([, pattern]) => pattern.test(explicitType));
    const fromRole = categories.find(([, pattern]) => pattern.test(job.role));
    job.jobType = fromExplicit?.[0] || fromRole?.[0] || '';
    if (!fromExplicit && fromRole) warnings.push('岗位类型按岗位名称归类，请核对；可在下拉框中修改。');
  }
  job.notes = field('岗位备注|招聘备注|备注');
  if (!job.jd) {
    if (selectionOnly) job.jd = selection;
    else if (jobRoot) job.jd = readable(jobRoot);
    else {
      const start = lines.findIndex(line => jobSignal.test(line));
      if (start >= 0) {
        const tail = lines.slice(start);
        const end = tail.findIndex((line, i) => i > 0 && jdStopLine.test(line));
        job.jd = tail.slice(0, end < 0 ? undefined : end).join('\n');
      } else {
        // No signal words anywhere: fall back to the most descriptive job block, still trimmed below.
        const widest = blocks
          .filter(el => !el.matches('main,article') && !jobSignal.test(textOf(el)))
          .map(el => ({ el, text: textOf(el) }))
          .filter(x => x.text.length > 30)
          .sort((a, b) => b.text.length - a.text.length)[0];
        if (widest) {
          job.jd = readable(widest.el);
          warnings.push('页面没有岗位职责类关键词，已按岗位区块提取 JD，请核对内容。');
        }
      }
    }
  }
  // Trim section headings after the JD, platform boilerplate, and start at the first signal line when present.
  if (job.jd && !selectionOnly) {
    const rows = job.jd.split('\n').map(clean).filter(Boolean);
    const begin = rows.findIndex(row => jobSignal.test(row));
    const start = begin > 0 ? begin : 0;
    const stopAt = rows.findIndex(row => jdStopLine.test(row));
    const end = stopAt > start ? stopAt : rows.length;
    const kept = rows.slice(start, end).filter(row => !jdNoise.test(row));
    job.jd = (kept.length ? kept : rows.filter(row => !jdNoise.test(row))).join('\n');
  }
  if (!job.majors) {
    const majorLines = job.jd.split(/\n|[。；;]/).filter(line => /(?:相关)?专业/.test(line) && !/专业技能|专业知识|专业能力|专业精神|专业培训/.test(line));
    job.majors = majorLines.slice(0, 3).map(clean).join('；');
  }
  if (!job.deadline) {
    const rawDeadline = field('截止日期|截止时间|申请截止|投递截止|报名截止日期|报名截止时间|报名截止|closing date|application deadline');
    const m = rawDeadline.match(/(20\d{2})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})/);
    if (m) job.deadline = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }
  const limits = { company: 80, role: 100, city: 60, majors: 500, jd: 20000, sourceUrl: 2000, deadline: 10, salary: 100, education: 100, jobType: 100, notes: 2000, resumeVersion: 100 };
  for (const [key, max] of Object.entries(limits)) {
    const value = clean(job[key]);
    if (value.length > max) warnings.push(`${{ jd: 'JD', majors: '招聘专业', sourceUrl: '来源链接' }[key] || key}内容过长，已截取前 ${max} 字，请核对。`);
    job[key] = value.slice(0, max);
  }
  if (job.deadline) {
    const date = new Date(job.deadline + 'T12:00:00Z');
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== job.deadline) { job.deadline = ''; warnings.push('截止日期格式不明确，请核对原页面。'); }
  }
  for (const [key, label] of Object.entries({ company: '公司', role: '岗位', city: '城市', jd: 'JD' })) {
    if (!job[key]) warnings.push(`未识别到${label}，可在预览或工作台中补充。`);
  }
  if (!structured && !selectionOnly) warnings.push('通用网页识别，请核对公司、地点和 JD 是否属于当前岗位。');
  if (!job.jd && !job.role) warnings.push('当前页面未找到岗位详情；请打开具体岗位，等待加载完成后重试。');
  return { kind: 'offertrack-job', version: 1, capturedAt: new Date().toISOString(), method, warnings, job };
}
