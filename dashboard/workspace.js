/* The five workspace views share the original dashboard records and forms. */
globalThis.OfferTrackWorkspace = (() => {
  'use strict';
  const A = OfferTrackAnalytics, $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PREF_KEY = 'jobhuntbot.offertrack.ui.v1';
  let host = null, all = [], quick = 'all', view = 'board', aliases = {}, editingStage = '', dragging = '';
  let month = new Date(new Date().getFullYear(), new Date().getMonth(), 1), calendarDay = A.key(new Date()), weekOffset = 0;
  const label = stage => aliases[stage] || A.stages[stage];
  const empty = message => `<p class="workspace-empty">${esc(message)}</p>`;
  function validate(record) {
    const result = {};
    for (const [key, max] of Object.entries({ tags: 200, followUpDate: 10, reviewNotes: 6000, createdAt: 30, updatedAt: 30 })) {
      const value = record[key] ?? '';
      if (typeof value !== 'string' || value.length > max) throw new Error('标签、跟进日期或复盘记录格式不正确。');
      result[key] = value.trim();
    }
    if (result.followUpDate && (!/^\d{4}-\d{2}-\d{2}$/.test(result.followUpDate) || A.key(new Date(result.followUpDate + 'T12:00:00')) !== result.followUpDate)) throw new Error('请填写有效的跟进日期。');
    const validInstant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
    for (const key of ['createdAt', 'updatedAt']) if (result[key] && !validInstant(result[key])) throw new Error('记录的更新时间格式不正确。');
    if (record.favorite != null && typeof record.favorite !== 'boolean') throw new Error('收藏标记格式不正确。');
    result.favorite = record.favorite === true;
    result.matchScore = record.matchScore ?? null;
    if (result.matchScore !== null && (!Number.isInteger(result.matchScore) || result.matchScore < 0 || result.matchScore > 100)) throw new Error('匹配度请填写 0 到 100 的整数，或留空。');
    const history = record.stageHistory ?? [];
    if (!Array.isArray(history) || history.length > 1000) throw new Error('阶段历史格式不正确或过长。');
    result.stageHistory = history.map(entry => {
      if (!entry || !Object.hasOwn(A.stages, entry.stage) || !validInstant(entry.at)) throw new Error('阶段历史中有无效的阶段或时间。');
      return { stage: entry.stage, at: entry.at };
    });
    if (result.stageHistory.some((entry, index) => index && entry.at < result.stageHistory[index - 1].at)) throw new Error('阶段历史的时间顺序不正确。');
    return result;
  }
  function prepare(record, existing) {
    const now = new Date().toISOString(), history = [...(existing?.stageHistory || [])];
    if (!existing || record.stage !== existing.stage) history.push({ stage: record.stage, at: now });
    return { ...record, createdAt: existing ? existing.createdAt || '' : now, updatedAt: now, stageHistory: history };
  }
  function preferences() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ view, aliases })); }
    catch { host?.toast('视图已切换，但浏览器未能保存显示偏好。'); }
  }
  function matches(record) {
    switch (quick) {
      case 'favorite': return record.favorite === true;
      case 'matched': return record.matchScore != null;
      case 'deadline': return A.dueSoon(record);
      case 'high': return record.matchScore != null && record.matchScore >= 80;
      case 'resume': return Boolean(record.resumeVersion);
      case 'unscheduled': return !record.deadline && !record.eventAt && !record.followUpDate;
      default: return true;
    }
  }
  function renderList(visible) {
    if (!host) return;
    document.querySelectorAll('[data-quick]').forEach(button => {
      button.classList.toggle('active', button.dataset.quick === quick);
      button.setAttribute('aria-pressed', String(button.dataset.quick === quick));
    });
    document.querySelectorAll('[data-job-view]').forEach(button => {
      button.classList.toggle('active', button.dataset.jobView === view);
      button.setAttribute('aria-pressed', String(button.dataset.jobView === view));
    });
    $('job-board').hidden = $('board-toolbar').hidden = view !== 'board';
    $('application-table').hidden = view !== 'table';
    const scroll = $('job-board').scrollLeft;
    $('job-board').innerHTML = Object.entries(A.stages).map(([stage, original]) => {
      const rows = visible.filter(record => record.stage === stage);
      return `<section class="board-column" data-drop-stage="${stage}" aria-label="${esc(label(stage))}"><div class="board-column-heading"><h3 title="原阶段：${original}">${esc(label(stage))} <span>${rows.length}</span></h3><button class="icon-button" data-stage-label="${stage}" aria-label="修改${original}列名称">${host.icon('edit')}</button></div><div class="board-cards">${rows.length ? rows.map(card).join('') : '<p class="board-empty">暂无岗位</p>'}</div></section>`;
    }).join('');
    $('job-board').scrollLeft = scroll;
  }
  function card(record) {
    const tags = (record.tags || '').split(/[,，、\n]/).map(tag => tag.trim()).filter(Boolean);
    return `<article class="job-card" draggable="true" data-job-card="${esc(record.id)}"><div class="job-card-heading"><button class="card-open" data-edit="${esc(record.id)}"><strong>${esc(record.company)}</strong><span>${esc(record.role)}</span></button><button class="favorite-button ${record.favorite ? 'selected' : ''}" data-favorite="${esc(record.id)}" aria-pressed="${record.favorite === true}" aria-label="${record.favorite ? '取消收藏' : '收藏'} ${esc(record.company)}">${record.favorite ? '★' : '☆'}</button></div><p class="card-location">${esc(record.city)}${record.jobType ? ' · ' + esc(record.jobType) : ''}</p>${tags.length ? `<div class="card-tags">${tags.map(tag => `<span>${esc(tag)}</span>`).join('')}</div>` : ''}${record.matchScore != null ? `<p class="card-score">手动匹配度 <b>${record.matchScore}%</b></p>` : ''}${record.deadline ? `<p class="card-date ${A.dueSoon(record) ? 'urgent' : ''}">截止 ${esc(record.deadline)}</p>` : ''}${record.eventTitle ? `<p class="card-date">${esc(record.eventTitle)} · ${esc(record.eventAt?.replace('T', ' ') || '时间待定')}</p>` : ''}${OfferTrackResumes.recordLink(record)}${record.nextAction ? `<p class="card-next">${esc(record.nextAction)}</p>` : ''}<div class="card-controls"><select data-change-stage="${esc(record.id)}" aria-label="${esc(record.company)} 当前阶段">${Object.keys(A.stages).map(stage => `<option value="${stage}" ${stage === record.stage ? 'selected' : ''}>${esc(label(stage))}</option>`).join('')}</select><button class="icon-button delete" data-delete="${esc(record.id)}" aria-label="删除 ${esc(record.company)} ${esc(record.role)}">${host.icon('trash')}</button></div></article>`;
  }
  function changeStage(id, stage) {
    if (!Object.hasOwn(A.stages, stage)) return;
    const record = all.find(item => item.id === id);
    if (!record || record.stage === stage) return;
    update(record, { stage, appliedDate: record.appliedDate || (stage === 'planned' ? '' : A.key(new Date())) });
  }
  function update(record, changes) {
    try {
      const next = host.validateRecord(prepare({ ...record, ...changes }, record));
      if (host.saveRecords(all.map(item => item.id === record.id ? next : item))) host.toast('岗位进展已保存');
      else host.renderTable();
    } catch (error) { host.toast(error.message); host.renderTable(); }
  }
  function trend(id, days) {
    const max = Math.max(1, ...days.map(item => item.count));
    $(id).innerHTML = days.map(item => `<div class="week-bar" aria-label="${item.date} ${item.label}，${item.count} 份投递"><strong>${item.count}</strong><div class="week-bar-track"><i style="height:${item.count / max * 100}%"></i></div><span>${item.label}</span><small>${item.date.slice(5).replace('-', '/')}</small></div>`).join('');
  }
  function action(record, text, kind = '') {
    return `<button class="action-item ${kind}" data-edit="${esc(record.id)}"><span><strong>${esc(record.company)} · ${esc(record.role)}</strong><small>${esc(text)}</small></span><span aria-hidden="true">↗</span></button>`;
  }
  function list(id, rows, message, text) { $(id).innerHTML = rows.length ? rows.map(record => action(record, text(record))).join('') : empty(message); }
  function render(records) {
    if (!host) return;
    all = records;
    const data = A.summarize(records);
    $('overview-total-jobs').textContent = data.total;
    $('overview-planned').textContent = data.stageCounts.planned;
    $('overview-interviews').textContent = data.interviews;
    $('overview-week-count').textContent = `${data.weekly.length} 份`;
    $('overview-deadline-count').textContent = `${data.deadlines.length} 个`;
    $('overview-todo-count').textContent = `${data.todos.length} 项`;
    trend('overview-trend', data.days);
    list('overview-deadlines', data.deadlines, '三天内暂无待投递岗位截止。', record => `${record.deadline} 截止 · ${record.city}`);
    $('overview-todos').innerHTML = data.todos.length ? data.todos.map(item => action(item.record, item.text, item.type)).join('') : empty('今天暂无到期待办，可以继续准备新的机会。');
    $('overview-suggestions').innerHTML = data.suggestions.map(text => `<li>${esc(text)}</li>`).join('');
    renderCalendar(); renderReview();
  }
  function renderCalendar() {
    const events = A.events(all), today = A.key(new Date());
    const start = A.offset(month, -((month.getDay() + 6) % 7));
    $('calendar-month').textContent = `${month.getFullYear()} 年 ${month.getMonth() + 1} 月`;
    $('month-calendar').innerHTML = Array.from({ length: 42 }, (_, index) => {
      const date = A.offset(start, index), key = A.key(date), items = events.filter(event => event.date === key);
      return `<button class="month-day ${date.getMonth() !== month.getMonth() ? 'outside' : ''} ${key === today ? 'today' : ''} ${key === calendarDay ? 'selected' : ''}" data-calendar-day="${key}" aria-pressed="${key === calendarDay}" aria-label="${key}，${items.length} 项记录"><strong>${date.getDate()}</strong><span class="calendar-markers">${items.slice(0, 2).map(item => `<small class="marker-${item.kind}">${esc(item.company)} · ${esc(item.title)}</small>`).join('')}${items.length > 2 ? `<small>另 ${items.length - 2} 项</small>` : ''}</span>${items.length ? `<i class="mobile-calendar-dot">${items.length}</i>` : ''}</button>`;
    }).join('');
    const selected = events.filter(event => event.date === calendarDay);
    $('calendar-selection').textContent = `${calendarDay} · ${selected.length} 项记录`;
    $('calendar-events').innerHTML = selected.length ? selected.map(item => action(item, `${item.at.length > 10 ? item.at.slice(11) + ' · ' : ''}${item.title}`)).join('') : empty('这一天暂无记录。');
  }
  function renderReview() {
    const data = A.summarize(all, new Date(), weekOffset);
    $('review-week-label').textContent = `${data.weekStart} — ${data.weekEnd}${weekOffset === 0 ? ' · 本周' : ''}`;
    $('review-submitted').textContent = data.weekly.length;
    $('review-appointments').textContent = data.appointments.length;
    $('review-progression').textContent = `${data.progression}%`;
    trend('review-trend', data.days);
    $('review-stages').innerHTML = Object.entries(data.stageCounts).map(([stage, count]) => `<div><span>${esc(label(stage))}</span><i><b style="width:${data.total ? count / data.total * 100 : 0}%"></b></i><strong>${count}</strong></div>`).join('');
    const priority = [...new Map([...data.todos.map(item => item.record), ...data.deadlines].map(record => [record.id, record])).values()];
    list('review-priority', priority, '近期暂无截止或跟进到期的岗位。', record => [record.deadline ? `截止 ${record.deadline}` : '', record.followUpDate ? `跟进 ${record.followUpDate}` : '', record.nextAction].filter(Boolean).join(' · ') || record.eventTitle);
    list('review-upcoming', data.upcoming, '未来七天暂无已记录的安排。', record => `${record.eventAt.replace('T', ' ')} · ${record.eventTitle}`);
    list('review-stalled', data.stalled, '暂无超过两周未推进的进行中岗位。', record => `${A.stages[record.stage]} · ${record.nextAction || '确认岗位进度并记录下一次跟进日期'}`);
    $('review-suggestions').innerHTML = data.suggestions.map(text => `<li>${esc(text)}</li>`).join('');
    $('review-notes').innerHTML = data.reviews.length ? data.reviews.map(record => `<article class="review-note"><div><strong>${esc(record.company)} · ${esc(record.role)}</strong><button class="text-button" data-edit="${esc(record.id)}">编辑复盘</button></div><p>${esc(record.reviewNotes)}</p>${record.updatedAt ? `<small>更新于 ${new Date(record.updatedAt).toLocaleString('zh-CN')}</small>` : ''}</article>`).join('') : empty('还没有复盘记录。打开一个岗位，在“投递进展”里写下经验和下次改进。');
  }
  function formHistory(record) {
    const entries = record?.stageHistory || [];
    $('record-stage-history').innerHTML = entries.length ? `<span class="field-label">阶段变更记录</span><ol class="stage-history">${entries.slice().reverse().map(entry => `<li><strong>${A.stages[entry.stage]}</strong><time datetime="${entry.at}">${new Date(entry.at).toLocaleString('zh-CN')}</time></li>`).join('')}</ol>` : '<small>保存后会记录阶段变化；已有岗位的历史不会被补造。</small>';
  }
  function exportCSV(records) {
    const columns = { company: '公司', role: '岗位', city: '城市', jobType: '岗位类型', stage: '当前阶段', appliedDate: '投递日期', deadline: '截止日期', eventTitle: '最近安排', eventAt: '安排时间', followUpDate: '跟进日期', nextAction: '下一步行动', resumeVersion: '绑定简历', tags: '标签', favorite: '收藏', matchScore: '手动匹配度', sourceUrl: '投递链接', jd: 'JD', notes: '备注', reviewNotes: '复盘记录' };
    const cell = value => { let text = String(value ?? ''); if (/^[\s]*[=+\-@]|^[\t\r\n]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
    const lines = [Object.values(columns).map(cell).join(',')];
    records.forEach(record => lines.push(Object.keys(columns).map(key => cell(key === 'stage' ? A.stages[record.stage] : key === 'favorite' ? record.favorite ? '是' : '否' : record[key])).join(',')));
    const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `OfferTrack-投递记录-${A.key(new Date())}.csv`; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000); host.toast(`已导出当前筛选的 ${records.length} 条记录`);
  }
  function init(options) {
    host = options;
    try {
      const saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
      view = saved.view === 'table' ? 'table' : 'board';
      for (const [stage, value] of Object.entries(saved.aliases || {})) if (Object.hasOwn(A.stages, stage) && typeof value === 'string' && value.trim() && value.length <= 30) aliases[stage] = value.trim();
    } catch { /* A damaged display preference must not prevent record access. */ }
    document.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button) return;
      if (button.dataset.quick) { quick = button.dataset.quick; host.renderTable(); }
      if (button.dataset.jobView) { view = button.dataset.jobView; preferences(); host.renderTable(); }
      if (button.dataset.favorite) { const record = all.find(item => item.id === button.dataset.favorite); if (record) update(record, { favorite: !record.favorite }); }
      if (button.dataset.calendarDay) { calendarDay = button.dataset.calendarDay; renderCalendar(); }
      if (button.dataset.stageLabel) { editingStage = button.dataset.stageLabel; $('stage-label-input').value = label(editingStage); host.show('stage-label-dialog'); $('stage-label-input').select(); }
    });
    $('job-board').addEventListener('change', event => { if (event.target.dataset.changeStage) changeStage(event.target.dataset.changeStage, event.target.value); });
    $('job-board').addEventListener('dragstart', event => { const card = event.target.closest('[data-job-card]'); if (!card || event.target.closest('a,select')) return event.preventDefault(); dragging = card.dataset.jobCard; event.dataTransfer.setData('text/plain', dragging); event.dataTransfer.effectAllowed = 'move'; });
    $('job-board').addEventListener('dragover', event => { if (dragging && event.target.closest('[data-drop-stage]')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } });
    $('job-board').addEventListener('drop', event => { const column = event.target.closest('[data-drop-stage]'); if (column && dragging) { event.preventDefault(); changeStage(dragging, column.dataset.dropStage); } dragging = ''; });
    $('job-board').addEventListener('dragend', () => { dragging = ''; });
    $('board-prev').addEventListener('click', () => $('job-board').scrollBy({ left: -560, behavior: 'smooth' }));
    $('board-next').addEventListener('click', () => $('job-board').scrollBy({ left: 560, behavior: 'smooth' }));
    $('stage-label-form').addEventListener('submit', event => { event.preventDefault(); const value = $('stage-label-input').value.trim(); if (!value) { $('stage-label-input').focus(); return; } aliases[editingStage] = value; preferences(); host.close('stage-label-dialog'); host.renderTable(); renderReview(); });
    $('stage-label-reset').addEventListener('click', () => { delete aliases[editingStage]; preferences(); host.close('stage-label-dialog'); host.renderTable(); renderReview(); });
    for (const [id, amount] of [['calendar-prev', -1], ['calendar-next', 1]]) $(id).addEventListener('click', () => { month = new Date(month.getFullYear(), month.getMonth() + amount, 1); calendarDay = A.key(month); renderCalendar(); });
    $('calendar-today').addEventListener('click', () => { month = new Date(new Date().getFullYear(), new Date().getMonth(), 1); calendarDay = A.key(new Date()); renderCalendar(); });
    for (const [id, amount] of [['review-prev', -1], ['review-next', 1]]) $(id).addEventListener('click', () => { weekOffset += amount; renderReview(); });
    $('review-this-week').addEventListener('click', () => { weekOffset = 0; renderReview(); });
    window.addEventListener('hashchange', () => { const name = location.hash.slice(1); if (['overview', 'applications', 'resumes', 'review'].includes(name)) host.setNav(name); });
    render(host.getRecords()); host.renderTable();
  }
  return { init, validate, prepare, matches, render, renderList, formHistory, exportCSV, resetQuick() { quick = 'all'; }, navigate(name) { document.body.dataset.page = name; $('page-title').textContent = name === 'applications' ? '我的投递' : '我的秋招工作台'; } };
})();
