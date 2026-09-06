/* OfferTrack: dependency-free, offline-first dashboard for JobHuntBot. */
(() => {
  'use strict';
  const STORAGE_KEY = 'jobhuntbot.offertrack.v1';
  const STAGES = { planned: '待投递', applied: '已投递', screening: '筛选中', test: '笔试', interview1: '一面', interview2: '二面', hr: 'HR 面', offer: '已获 Offer', rejected: '已结束', withdrawn: '已撤回' };
  const ENDED = new Set(['rejected', 'withdrawn']);
  const INTERVIEWS = new Set(['interview1', 'interview2', 'hr']);
  const ICONS = {
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6"/>',
    briefcase: '<rect x="3" y="7" width="18" height="14" rx="3"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12a22 22 0 0 0 18 0M10 14h4"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2M8 18h2"/>',
    award: '<circle cx="12" cy="8" r="5"/><path d="m8.5 12-1 9 4.5-3 4.5 3-1-9m-5-4 1 1 2-2"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    download: '<path d="M12 3v13m-5-5 5 5 5-5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3v.1"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
    sparkles: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3ZM20 2v4m-2-2h4M3 19v3m-1.5-1.5h3"/>',
    shield: '<path d="m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7l8-4Z"/><path d="m9 12 2 2 4-4"/>',
    home: '<path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    edit: '<path d="m15 4 5 5M13 6l5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15l-1 5Z"/>',
    trash: '<path d="M3 6h18M9 6V4h6v2M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    x: '<path d="m6 6 12 12M18 6 6 18"/>',
    chart: '<path d="M4 3v17h17M8 15v-4M13 15V7M18 15V4"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    inbox: '<path d="m3 13 4-9h10l4 9v7H3v-7Zm0 0h5l2 3h4l2-3h5"/>'
  };
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.briefcase}</svg>`;
  document.querySelectorAll('[data-icon]').forEach(el => {
    if (el.classList.contains('brand-icon')) el.innerHTML = icon(el.dataset.icon);
    else el.outerHTML = icon(el.dataset.icon);
  });
  const pad = n => String(n).padStart(2, '0');
  const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const offsetDate = (offset, base = startOfDay()) => { const d = new Date(base); d.setDate(d.getDate() + offset); return d; };
  const shortDate = value => value.slice(5, 10).replace('-', '/');
  const uid = () => globalThis.crypto?.randomUUID?.() || `record-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && dateKey(new Date(`${s}T12:00:00`)) === s;
  const validDateTime = s => /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(s) && validDate(s.slice(0, 10)) && !Number.isNaN(new Date(s).getTime());
  const isActive = r => !['planned', 'offer'].includes(r.stage) && !ENDED.has(r.stage);
  const isInWeek = r => {
    if (!r.eventAt || ENDED.has(r.stage)) return false;
    const date = new Date(r.eventAt);
    return date >= startOfDay() && date < offsetDate(7);
  };
  function validateRecord(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error('记录格式不正确。');
    const result = {};
    for (const [key, max] of Object.entries({ id: 120, company: 80, role: 100, city: 60, appliedDate: 10, stage: 20, eventTitle: 120, eventAt: 16, nextAction: 500 })) {
      if (typeof r[key] !== 'string' || r[key].length > max) throw new Error('记录字段缺失、格式不正确或文字过长。');
      result[key] = r[key].trim();
    }
    if (!result.id || !result.company || !result.role || !result.city) throw new Error('请填写公司、岗位和城市，内容不能只有空格。');
    if (!(result.stage === 'planned' && !result.appliedDate) && !validDate(result.appliedDate)) throw new Error('请填写有效的投递日期。');
    if (!Object.hasOwn(STAGES, result.stage)) throw new Error('请选择有效的当前阶段。');
    if (result.eventAt && !validDateTime(result.eventAt)) throw new Error('请填写有效的安排时间。');
    if (result.eventAt && !result.eventTitle) throw new Error('填写安排时间后，请补充最近安排的名称。');
    for (const [key, max] of Object.entries(OfferTrackImport.limits)) {
      if (['company', 'role', 'city'].includes(key)) continue;
      const value = r[key] ?? '';
      if (typeof value !== 'string' || value.length > max) throw new Error('岗位信息格式不正确或文字过长。');
      result[key] = value.trim();
    }
    if (result.deadline && !validDate(result.deadline)) throw new Error('请填写有效的招聘截止日期。');
    if (!OfferTrackImport.validURL(result.sourceUrl)) throw new Error('岗位来源链接必须是 HTTP 或 HTTPS 网页。');
    result.isDemo = r.isDemo === true;
    result.resumeId = r.resumeId ?? '';
    if (typeof result.resumeId !== 'string' || (result.resumeId && !/^[0-9a-f-]{36}$/.test(result.resumeId))) throw new Error('绑定简历编号格式不正确。');
    return { ...result, ...OfferTrackWorkspace.validate(r) };
  }
  function validateBackup(data) {
    if (!data || data.version !== 1 || !Array.isArray(data.records) || data.records.length > 5000) throw new Error('请选择 OfferTrack 导出的 JSON 备份文件（最多 5000 条记录）。');
    const next = data.records.map(validateRecord);
    if (new Set(next.map(r => r.id)).size !== next.length) throw new Error('备份内有重复的记录编号，无法导入。');
    return next;
  }
  function demoRecords() {
    const templates = [
      ['星禾科技', '前端开发工程师', '杭州', -2, 'interview1', '技术一面 · 线上', 1, '14:00', '梳理项目难点，准备自我介绍'],
      ['云屿网络', '产品经理', '上海', -3, 'test', '线上笔试', 2, '19:00', '完成一套行测与产品分析练习'],
      ['知行数据', '数据分析师', '深圳', -5, 'hr', 'HR 面试 · 线上', 4, '10:30', '整理实习成果，准备职业规划'],
      ['北辰智造', '嵌入式软件工程师', '南京', -6, 'screening', '', null, '', '关注邮箱，等待简历筛选结果'],
      ['远川科技', '后端开发工程师', '北京', -7, 'interview2', '技术二面 · 线上', 6, '15:00', '复习系统设计与数据库优化'],
      ['光年互动', '用户体验设计师', '杭州', -8, 'applied', '', null, '', '完善作品集中的设计思考'],
      ['沐光数字', '产品运营管培生', '上海', -10, 'offer', '', null, '', '确认入职时间与 Offer 细节'],
      ['森屿科技', '内容运营', '成都', -12, 'rejected', '', null, '', '复盘面试问题，沉淀经验']
    ];
    return templates.map(([company, role, city, days, stage, eventTitle, eventDay, time, nextAction]) => ({
      id: uid(), company, role, city, appliedDate: dateKey(offsetDate(days)), stage, eventTitle,
      eventAt: eventDay === null ? '' : `${dateKey(offsetDate(eventDay))}T${time}`, nextAction, isDemo: true
    }));
  }
  let records = [], revision = null, filter = 'all', query = '', selectedDay = '', editingId = null, editSnapshot = null;
  let pendingConfirmation = null, toastTimer, undoAction = null, importingJob = false;
  function storageError(message) {
    $('storage-error').textContent = message;
    $('storage-error').hidden = false;
    $('save-label').textContent = '保存需处理';
  }
  function saveRecords(next) {
    try {
      // Compare the complete snapshot to avoid overwriting a newer tab's changes.
      if (localStorage.getItem(STORAGE_KEY) !== revision) throw new Error('记录已在其他窗口变化。请先导出当前备份，再刷新页面后重试。');
      const data = JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), records: next });
      localStorage.setItem(STORAGE_KEY, data);
      revision = data;
      records = next;
      $('storage-error').hidden = true;
      $('save-label').textContent = '已保存到本地';
      render();
      return true;
    } catch (error) {
      storageError(error.message.includes('其他窗口') ? error.message : '无法保存到浏览器，本次修改尚未写入。请检查存储权限或空间，并先导出已有记录备份。');
      return false;
    }
  }
  function initialize() {
    let raw;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch {
      records = demoRecords();
      storageError('浏览器禁用了本地存储。当前展示虚构示例；请允许本地存储后刷新，才能保存修改。');
      render();
      return;
    }
    revision = raw;
    if (raw === null) { records = demoRecords(); saveRecords(records); }
    else {
      try { records = validateBackup(JSON.parse(raw)); }
      catch { records = []; storageError('已有浏览器数据无法读取。原数据已保留，请通过“导入备份”恢复有效的备份文件。'); }
    }
    render();
  }
  function render() {
    const counts = { all: records.length, planned: records.filter(r => r.stage === 'planned').length, active: records.filter(isActive).length, offer: records.filter(r => r.stage === 'offer').length, ended: records.filter(r => ENDED.has(r.stage)).length };
    $('today-label').textContent = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
    $('today-label').dateTime = dateKey(new Date());
    $('season-tag').textContent = `${new Date().getFullYear()} 秋招季`;
    $('stat-total').textContent = counts.all - counts.planned;
    $('stat-active').textContent = counts.active;
    $('stat-offer').textContent = counts.offer;
    $('stat-week').textContent = records.filter(isInWeek).length;
    $('interview-note').textContent = `${records.filter(r => INTERVIEWS.has(r.stage)).length} 个`;
    $('nav-total').textContent = counts.all;
    Object.entries(counts).forEach(([key, value]) => { $(`tab-${key}`).textContent = value; });
    const demoCount = records.filter(r => r.isDemo).length;
    $('demo-banner').hidden = !demoCount;
    $('demo-text').textContent = `这里有 ${demoCount} 条虚构示例，帮你快速了解工作台。准备好后，就开始记录自己的机会吧。`;
    const city = $('city-filter').value;
    $('city-filter').innerHTML = '<option value="">全部城市</option>' + [...new Set(records.map(r => r.city))].sort((a, b) => a.localeCompare(b, 'zh-CN')).map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    if ([...$('city-filter').options].some(o => o.value === city)) $('city-filter').value = city;
    renderTable(); renderSchedule(); renderPipeline(); OfferTrackResumes.render(); OfferTrackWorkspace.render(records);
  }
  function filteredRecords() {
    return records.filter(r => {
      if (filter === 'active' && !isActive(r)) return false;
      if (filter === 'planned' && r.stage !== 'planned') return false;
      if (filter === 'offer' && r.stage !== 'offer') return false;
      if (filter === 'ended' && !ENDED.has(r.stage)) return false;
      if ($('city-filter').value && r.city !== $('city-filter').value) return false;
      if ($('stage-filter').value && r.stage !== $('stage-filter').value) return false;
      if (!OfferTrackWorkspace.matches(r)) return false;
      const haystack = [r.company, r.role, r.city, r.jobType, r.majors, r.jd, r.notes, r.resumeVersion, r.tags, r.reviewNotes, r.eventTitle, r.nextAction, STAGES[r.stage]].join(' ').toLocaleLowerCase();
      return !query || haystack.includes(query);
    }).sort((a, b) => b.appliedDate.localeCompare(a.appliedDate));
  }
  function renderTable() {
    document.querySelectorAll('[data-filter]').forEach(el => { el.classList.toggle('active', el.dataset.filter === filter); el.setAttribute('aria-pressed', String(el.dataset.filter === filter)); });
    const visible = filteredRecords();
    OfferTrackWorkspace.renderList(visible);
    $('list-count').textContent = `${records.length} 条记录`;
    $('results-label').textContent = `共 ${records.length} 条记录，当前显示 ${visible.length} 条 · 待投递不计入投递总数`;
    if (!visible.length) {
      const isEmpty = !records.length;
      $('jobs-body').innerHTML = `<tr><td colspan="7" class="empty-state">${icon('inbox')}<h3>${isEmpty ? '你的下一站，从第一份投递开始' : '没有找到匹配的投递'}</h3><p>${isEmpty ? '添加一个机会，把准备与进展都记录在这里。' : '试试其他关键词，或清除筛选条件。'}</p><button class="button ${isEmpty ? 'primary' : ''}" data-action="${isEmpty ? 'add' : 'reset-filters'}">${isEmpty ? '＋ 新增投递' : '清除筛选'}</button></td></tr>`;
      return;
    }
    $('jobs-body').innerHTML = visible.map(r => {
      const tone = [...r.company].reduce((sum, c) => sum + c.codePointAt(0), 0) % 6;
      let arrangement = '<span class="cell-muted">暂无安排</span>';
      if (r.eventTitle) {
        let dateHtml = '<span class="arrangement-date">时间待定</span>';
        if (r.eventAt) {
          const overdue = new Date(r.eventAt) < new Date() && isActive(r);
          dateHtml = `<span class="arrangement-date ${overdue ? 'overdue' : isInWeek(r) ? 'soon' : ''}">${shortDate(r.eventAt)} ${esc(r.eventAt.slice(11))}${overdue ? ' · 时间已过' : ''}</span>`;
        }
        arrangement = `<span class="arrangement-title">${esc(r.eventTitle)}</span>${dateHtml}`;
      }
      return `<tr data-record="${esc(r.id)}"><td><div class="company-cell"><span class="company-avatar tone-${tone}" aria-hidden="true">${esc([...r.company][0])}</span><span><span class="company-name">${esc(r.company)}</span><span class="role-name">${esc(r.role)}</span>${r.jd ? '<small class="jd-saved">已保存 JD</small>' : ''}${OfferTrackResumes.recordLink(r)}</span></div></td><td class="cell-muted">${esc(r.city)}</td><td class="cell-muted" style="font-variant-numeric:tabular-nums">${esc(r.appliedDate.replaceAll('-', '/')) || '待投递'}</td><td><span class="stage-badge stage-${esc(r.stage)}">${STAGES[r.stage]}</span></td><td>${arrangement}</td><td><span class="next-action">${esc(r.nextAction) || '—'}</span></td><td class="actions-cell"><button class="icon-button" data-edit="${esc(r.id)}" title="编辑 ${esc(r.company)}" aria-label="编辑 ${esc(r.company)} ${esc(r.role)}">${icon('edit')}</button><button class="icon-button delete" data-delete="${esc(r.id)}" title="删除 ${esc(r.company)}" aria-label="删除 ${esc(r.company)} ${esc(r.role)}">${icon('trash')}</button></td></tr>`;
    }).join('');
  }
  function renderSchedule() {
    const events = records.filter(isInWeek).sort((a, b) => a.eventAt.localeCompare(b.eventAt));
    if (selectedDay && (selectedDay < dateKey(startOfDay()) || selectedDay > dateKey(offsetDate(6)))) selectedDay = '';
    $('schedule-count').textContent = `${events.length} 项安排`;
    $('week-range').textContent = `${shortDate(dateKey(startOfDay()))} — ${shortDate(dateKey(offsetDate(6)))}`;
    $('week-strip').innerHTML = Array.from({ length: 7 }, (_, i) => {
      const d = offsetDate(i), key = dateKey(d), dayEvents = events.filter(r => r.eventAt.startsWith(key));
      return `<button class="day-button ${i === 0 ? 'today' : ''} ${selectedDay === key ? 'selected' : ''}" data-day="${key}" aria-pressed="${selectedDay === key}" aria-label="${key}，${dayEvents.length} 项安排"><span>${i === 0 ? '今天' : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]}</span><strong>${pad(d.getDate())}</strong><i class="day-dot ${dayEvents.length ? '' : 'invisible'}"></i></button>`;
    }).join('');
    const visible = events.filter(r => !selectedDay || r.eventAt.startsWith(selectedDay));
    $('event-list').innerHTML = visible.length ? visible.map(r => `<div class="event-row"><time class="event-time" datetime="${esc(r.eventAt)}">${shortDate(r.eventAt)}<small>${esc(r.eventAt.slice(11))}</small></time><span class="event-line ${r.stage === 'test' ? 'amber' : r.stage === 'hr' ? 'purple' : ''}"></span><div class="event-details"><strong>${esc(r.company)} · ${esc(r.eventTitle)}</strong><p>${esc(r.role)}${r.nextAction ? ' · ' + esc(r.nextAction) : ''}</p></div><button class="icon-button" data-edit="${esc(r.id)}" aria-label="查看 ${esc(r.company)} 安排" title="查看并编辑安排">${icon('arrow')}</button></div>`).join('') : `<p class="events-empty">${selectedDay ? '这一天暂无安排，给自己留一点准备时间。' : '未来七天暂无安排。<br>在投递记录中添加时间，重要节点就会出现在这里。'}</p>`;
  }
  function renderPipeline() {
    const groups = [
      ['投递 / 筛选', records.filter(r => ['applied', 'screening'].includes(r.stage)).length],
      ['笔试阶段', records.filter(r => r.stage === 'test').length],
      ['面试阶段', records.filter(r => INTERVIEWS.has(r.stage)).length],
      ['已获 Offer', records.filter(r => r.stage === 'offer').length],
      ['已结束', records.filter(r => ENDED.has(r.stage)).length],
      ['待投递', records.filter(r => r.stage === 'planned').length]
    ];
    $('pipeline').innerHTML = groups.map(([label, n]) => `<div class="pipeline-item"><span>${label}</span><div class="pipeline-track"><div class="pipeline-fill" style="width:${records.length ? n / records.length * 100 : 0}%"></div></div><b>${n}</b></div>`).join('') + `<p class="pipeline-note">${icon('info')}每条投递按当前阶段统计，进展实时更新。</p>`;
  }
  function scrollToSection(id) { $(id).scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); }
  function resetFilters(nextFilter = 'all') { filter = nextFilter; query = ''; $('search').value = ''; $('city-filter').value = ''; $('stage-filter').value = ''; OfferTrackWorkspace.resetQuick(); renderTable(); }
  function setNav(name) {
    name = name === 'schedule' ? 'overview' : name === 'offers' ? 'applications' : name;
    if (!['overview', 'applications', 'resumes', 'review', 'job-library'].includes(name)) name = 'overview';
    document.querySelectorAll('button[data-nav]').forEach(el => { el.classList.toggle('active', el.dataset.nav === name); if (el.dataset.nav === name) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
    $('dashboard-content').hidden = ['resumes', 'review', 'job-library'].includes(name);
    $('resume-manager').hidden = name !== 'resumes';
    $('review-panel').hidden = name !== 'review';
    $('job-library-panel').hidden = name !== 'job-library';
    OfferTrackWorkspace.navigate(name);
    if (name === 'resumes') OfferTrackResumes.open();
    if (!location.hash.startsWith('#offertrack-import=')) history.replaceState(null, '', '#' + name);
  }
  const dialogFocus = new Map();
  function showDialog(id) { dialogFocus.set(id, document.activeElement); $(id).showModal(); document.body.classList.add('modal-open'); }
  function closeDialog(id) {
    $(id).close(); document.body.classList.remove('modal-open');
    const previous = dialogFocus.get(id);
    const target = previous?.isConnected && previous.getClientRects().length ? previous : document.querySelector('.sidebar button[aria-current="page"]');
    target?.focus({ preventScroll: true }); dialogFocus.delete(id);
  }
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('close', () => { if (!document.querySelector('dialog[open]')) document.body.classList.remove('modal-open'); if (dialog.id === 'confirm-dialog') pendingConfirmation = null; });
    // Keep the job form open during text selection and backdrop clicks; Escape still works.
    if (dialog.id === 'record-dialog') return;
    dialog.addEventListener('click', e => { if (e.target === dialog) { const rect = dialog.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) closeDialog(dialog.id); } });
  });
  function openRecord(id) {
    const existing = records.find(r => r.id === id);
    editingId = existing?.id || null;
    editSnapshot = existing ? JSON.stringify(existing) : null;
    $('record-form').reset();
    importingJob = false;
    $('job-import-notice').hidden = true;
    $('job-duplicate').hidden = true;
    $('form-error').hidden = true;
    $('record-title').textContent = existing ? '编辑岗位信息' : '岗位信息';
    $('save-button-label').textContent = existing ? '保存修改' : '保存岗位';
    const values = existing || { appliedDate: '', stage: 'planned' };
    prepareJobSelects(values);
    for (const [key, value] of Object.entries(values)) {
      const field = $('record-form').elements.namedItem(key);
      if (field?.type === 'checkbox') field.checked = value === true;
      else if (field) field.value = value ?? '';
    }
    OfferTrackResumes.refreshSelect(values);
    OfferTrackWorkspace.formHistory(existing);
    $('extra-job-fields').open = false;
    $('progress-fields').open = !!existing && existing.stage !== 'planned';
    syncJobFields();
    showDialog('record-dialog');
    $('field-company').focus();
  }
  function syncJobFields() {
    const planned = $('field-stage').value === 'planned';
    $('field-date').required = !planned;
    $('date-required').hidden = planned;
    $('date-hint').hidden = !planned;
    $('progress-summary').textContent = STAGES[$('field-stage').value] || '';
    const url = $('field-source-url').value.trim();
    $('job-source-link').hidden = !url || !OfferTrackImport.validURL(url);
    if (!$('job-source-link').hidden) $('job-source-link').href = url;
    else $('job-source-link').removeAttribute('href');
    if (importingJob) $('job-duplicate').hidden = !OfferTrackImport.duplicate(records, Object.fromEntries(new FormData($('record-form'))));
  }
  function importJob(data) {
    const job = OfferTrackImport.validate(data);
    const fill = () => {
      if ($('record-dialog').open) closeDialog('record-dialog');
      openRecord();
      importingJob = true;
      prepareJobSelects(job);
      for (const [key, value] of Object.entries(job)) $('record-form').elements.namedItem(key).value = value;
      OfferTrackResumes.refreshSelect(job);
      $('field-stage').value = 'planned';
      $('field-date').value = '';
      $('job-import-notice').hidden = false;
      syncJobFields();
      $('record-dialog').scrollTop = 0;
      $('field-company').focus();
    };
    if ($('record-dialog').open) confirmAction('用采集岗位填入表单？', '当前表单中尚未保存的内容会被替换，已保存的记录不受影响。', '填入岗位', fill, false);
    else fill();
  }
  function importFromHash() {
    const prefix = '#offertrack-import=';
    if (!location.hash.startsWith(prefix)) return;
    const value = location.hash.slice(prefix.length);
    try {
      if (value.length > 250000) throw new Error('岗位信息过长，请使用插件下载岗位文件后导入。');
      const data = JSON.parse(decodeURIComponent(value));
      importJob(data);
    } catch (error) { toast(error instanceof SyntaxError || error instanceof URIError ? '岗位链接格式不正确，未修改已有记录。' : error.message); }
    // Do not repeat an import when refreshing, or leave the JD in a copied URL.
    history.replaceState(null, '', location.pathname + location.search);
  }
  $('import-job-file').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 150000) throw new Error('单个岗位文件不能超过 150 KB。');
      importJob(JSON.parse((await file.text()).replace(/^\uFEFF/, '')));
    } catch (error) { toast(error instanceof SyntaxError ? '岗位文件不是有效的 JSON，未修改已有记录。' : error.message); }
  });
  $('field-stage').addEventListener('change', () => {
    if ($('field-stage').value !== 'planned' && !$('field-date').value) $('field-date').value = dateKey(new Date());
    syncJobFields();
  });
  const resumeControl = OfferTrackFields.resumeControl($('field-resume'), $('resume-editor'), $('resume-name'), $('add-resume'), $('apply-resume'));
  function prepareJobSelects(job) {
    OfferTrackFields.choose($('field-job-type'), OfferTrackFields.jobTypes, job.jobType || '', '请选择岗位类型');
    resumeControl.set(job.resumeVersion || '', records.map(record => record.resumeVersion).filter(Boolean));
  }
  // Native validation must be able to focus a field inside a collapsed section.
  $('record-form').addEventListener('invalid', event => { const details = event.target.closest('details'); if (details) details.open = true; }, true);
  $('record-form').addEventListener('input', syncJobFields);
  $('open-existing').addEventListener('click', () => {
    const match = OfferTrackImport.duplicate(records, Object.fromEntries(new FormData($('record-form'))));
    if (match) { closeDialog('record-dialog'); openRecord(match.id); }
  });
  window.addEventListener('hashchange', importFromHash);
  function toast(message, undo) {
    clearTimeout(toastTimer); undoAction = undo || null;
    $('toast').innerHTML = `${icon('check-circle')}<span>${esc(message)}</span>${undo ? '<button data-action="undo">撤销</button>' : ''}`;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; undoAction = null; }, undo ? 10000 : 4200);
  }
  function confirmAction(title, message, label, callback, danger = true) {
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = message;
    $('confirm-button').textContent = label;
    $('confirm-button').className = `button ${danger ? 'danger' : 'primary'}`;
    pendingConfirmation = callback;
    showDialog('confirm-dialog');
  }
  function deleteRecord(id) {
    const target = records.find(r => r.id === id);
    if (!target) return;
    confirmAction('删除这条投递？', `“${target.company} · ${target.role}”及其最近安排将一并删除。`, '确认删除', () => {
      if (saveRecords(records.filter(r => r.id !== id))) toast('已删除投递记录', () => {
        if (records.some(r => r.id === id)) return toast('这条记录已存在，无需恢复');
        if (saveRecords([...records, target])) toast('已恢复投递记录');
      });
    });
  }
  function exportBackup() {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), records }, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `OfferTrack-投递备份-${dateKey(new Date())}.json`; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('备份文件已生成，请保存在常用文件夹');
  }
  $('record-form').addEventListener('submit', e => {
    e.preventDefault();
    try {
      const existing = records.find(r => r.id === editingId);
      if (editingId && (!existing || JSON.stringify(existing) !== editSnapshot)) throw new Error('这条记录已在其他窗口变化，请关闭表单后重新编辑。');
      const raw = Object.fromEntries(new FormData(e.currentTarget));
      raw.favorite = $('field-favorite').checked;
      raw.matchScore = raw.matchScore === '' ? null : Number(raw.matchScore);
      const record = validateRecord(OfferTrackWorkspace.prepare({ ...existing, ...raw, ...OfferTrackResumes.binding(raw.resumeVersion), id: editingId || uid(), isDemo: existing?.isDemo || false }, existing));
      if (importingJob && !$('allow-duplicate').checked && OfferTrackImport.duplicate(records, record)) {
        $('job-duplicate').hidden = false;
        throw new Error('这个岗位已有记录。请查看已有记录，或勾选“我确认要另外新增一条”。');
      }
      const next = editingId ? records.map(r => r.id === editingId ? record : r) : [...records, record];
      if (!saveRecords(next)) throw new Error($('storage-error').textContent);
      const wasEditing = !!editingId;
      closeDialog('record-dialog'); resetFilters(); setNav('applications');
      toast(wasEditing ? '投递进展已更新' : record.stage === 'planned' ? '岗位已收藏，完成网申后可更新为已投递' : '已添加新投递，祝你收获好消息');
    } catch (error) { $('form-error').textContent = error.message; $('form-error').hidden = false; }
  });
  $('confirm-button').addEventListener('click', () => { const action = pendingConfirmation; closeDialog('confirm-dialog'); action?.(); });
  $('import-file').addEventListener('change', async e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('备份文件不能超过 5 MB。');
      const imported = validateBackup(JSON.parse((await file.text()).replace(/^\uFEFF/, '')));
      const snapshot = revision;
      confirmAction('恢复备份？', `备份包含 ${imported.length} 条记录，将替换当前的 ${records.length} 条记录。\n建议先导出当前数据作为备份。`, '确认导入', () => {
        if (revision !== snapshot) return toast('确认期间记录已变化，请重新选择备份文件');
        if (saveRecords(imported)) { resetFilters(); toast(`已恢复 ${imported.length} 条记录`); }
      }, false);
    } catch (error) { toast(error instanceof SyntaxError ? '备份不是有效的 JSON 文件，未修改现有记录' : error.message); }
  });
  document.addEventListener('click', e => {
    const target = e.target.closest('button,a[data-nav]');
    if (!target) return;
    if (target.dataset.close) return closeDialog(target.dataset.close);
    if (target.dataset.edit) return openRecord(target.dataset.edit);
    if (target.dataset.delete) return deleteRecord(target.dataset.delete);
    if (target.dataset.filter) { filter = target.dataset.filter; renderTable(); return; }
    if (target.dataset.day) { selectedDay = selectedDay === target.dataset.day ? '' : target.dataset.day; renderSchedule(); return; }
    if (target.dataset.nav) {
      e.preventDefault(); const nav = target.dataset.nav; setNav(nav);
      if (nav === 'overview') { resetFilters(); scrollToSection('main'); }
      if (nav === 'applications') { resetFilters(); scrollToSection('applications'); }
      if (nav === 'schedule') { selectedDay = ''; renderSchedule(); scrollToSection('schedule'); }
      if (nav === 'offers') { resetFilters('offer'); scrollToSection('applications'); }
      if (nav === 'resumes') scrollToSection('main');
      if (nav === 'review' || nav === 'job-library') scrollToSection('main');
      return;
    }
    if (target.dataset.stat) {
      if (target.dataset.stat === 'week') { selectedDay = ''; renderSchedule(); setNav('schedule'); scrollToSection('schedule'); }
      else { resetFilters(target.dataset.stat); setNav(target.dataset.stat === 'offer' ? 'offers' : 'applications'); scrollToSection('applications'); }
      return;
    }
    switch (target.dataset.action) {
      case 'add': openRecord(); break;
      case 'export': exportBackup(); break;
      case 'export-csv': OfferTrackWorkspace.exportCSV(filteredRecords()); break;
      case 'import': $('import-file').click(); break;
      case 'import-job': $('import-job-file').click(); break;
      case 'help': showDialog('help-dialog'); break;
      case 'reset-filters': resetFilters(); break;
      case 'undo': { const action = undoAction; undoAction = null; action?.(); break; }
      case 'clear-demo': confirmAction('清空虚构示例？', '只会删除标记为示例的记录，你自己新增的投递会保留。编辑过的示例仍属于示例。', '清空示例', () => { if (saveRecords(records.filter(r => !r.isDemo))) toast('示例已清空，开始记录自己的机会吧'); }); break;
    }
  });
  $('search').addEventListener('input', e => { query = e.target.value.trim().toLocaleLowerCase(); renderTable(); });
  $('city-filter').addEventListener('change', renderTable);
  $('stage-filter').addEventListener('change', renderTable);
  const stageOptions = Object.entries(STAGES).map(([key, label]) => `<option value="${key}">${label}</option>`).join('');
  $('stage-filter').innerHTML += stageOptions; $('field-stage').innerHTML = stageOptions;
  window.addEventListener('storage', e => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try { const next = validateBackup(JSON.parse(e.newValue)); revision = e.newValue; records = next; render(); toast('已同步其他窗口的最新记录'); }
    catch { storageError('其他窗口写入了无法读取的数据。请先导出当前记录，再刷新检查。'); }
  });
  // Refresh calendar boundaries after midnight or when returning to an old tab.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  setInterval(() => { if (!document.hidden) render(); }, 60000);
  initialize();
  OfferTrackWorkspace.init({ getRecords: () => records, saveRecords, validateRecord, renderTable, setNav, toast, show: showDialog, close: closeDialog, icon });
  OfferTrackResumes.init({ getRecords: () => records, changed: render, toast, show: showDialog, close: closeDialog, icon });
  setNav(location.hash.slice(1));
  importFromHash();
})();
