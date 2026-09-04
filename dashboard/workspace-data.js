/* Shared, deterministic calculations for overview, board and review. */
((root, factory) => {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.OfferTrackAnalytics = value;
})(globalThis, () => {
  'use strict';
  const stages = { planned: '待投递', applied: '已投递', screening: '筛选中', test: '笔试', interview1: '一面', interview2: '二面', hr: 'HR 面', offer: '已获 Offer', rejected: '已结束', withdrawn: '已撤回' };
  const ended = new Set(['rejected', 'withdrawn']);
  const progressed = new Set(['test', 'interview1', 'interview2', 'hr', 'offer']);
  const interviews = new Set(['interview1', 'interview2', 'hr']);
  const day = value => { const d = new Date(value); d.setHours(0, 0, 0, 0); return d; };
  const key = value => { const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const offset = (date, amount) => { const result = new Date(date); result.setDate(result.getDate() + amount); return result; };
  const active = record => !['planned', 'offer'].includes(record.stage) && !ended.has(record.stage);
  const within = (date, begin, end) => Boolean(date && date.slice(0, 10) >= begin && date.slice(0, 10) <= end);
  function dueSoon(record, now = new Date()) {
    return record.stage === 'planned' && within(record.deadline, key(now), key(offset(day(now), 2)));
  }
  function events(records) {
    const result = [];
    for (const record of records) {
      const add = (at, kind, title) => { if (at) result.push({ id: record.id, at, date: at.slice(0, 10), kind, title, company: record.company, role: record.role }); };
      add(record.appliedDate, 'applied', '已记录投递');
      add(record.deadline, 'deadline', '投递截止');
      add(record.eventAt, 'appointment', record.eventTitle || '笔面安排');
      add(record.followUpDate, 'followup', record.nextAction || '跟进岗位');
      for (const entry of record.stageHistory || []) {
        if (['offer', 'rejected', 'withdrawn'].includes(entry.stage)) add(key(entry.at), 'result', stages[entry.stage]);
      }
    }
    return result.sort((a, b) => a.at.localeCompare(b.at));
  }
  function summarize(records, now = new Date(), weekOffset = 0) {
    const today = day(now), todayKey = key(today);
    const monday = offset(today, -((today.getDay() + 6) % 7) + weekOffset * 7);
    const weekStart = key(monday), weekEnd = key(offset(monday, 6));
    const submitted = records.filter(record => record.stage !== 'planned' && record.appliedDate);
    const weekly = submitted.filter(record => within(record.appliedDate, weekStart, weekEnd));
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = key(offset(monday, index));
      return { date, label: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][index], count: weekly.filter(record => record.appliedDate === date).length };
    });
    const deadlines = records.filter(record => dueSoon(record, now)).sort((a, b) => a.deadline.localeCompare(b.deadline));
    const upcoming = records.filter(record => record.eventAt && !ended.has(record.stage) && record.eventAt >= todayKey && record.eventAt < key(offset(today, 7))).sort((a, b) => a.eventAt.localeCompare(b.eventAt));
    const appointments = records.filter(record => within(record.eventAt, weekStart, weekEnd) && (progressed.has(record.stage) || /笔试|面试|沟通|测评/.test(record.eventTitle)));
    const advanced = submitted.filter(record => progressed.has(record.stage) || (record.stageHistory || []).some(entry => progressed.has(entry.stage)));
    const stalled = records.filter(record => {
      if (!active(record)) return false;
      const history = record.stageHistory || [];
      const last = history.length ? key(history[history.length - 1].at) : record.appliedDate;
      return Boolean(last && last <= key(offset(today, -14)));
    });
    const todos = [];
    for (const record of records) {
      if (ended.has(record.stage)) continue;
      if (record.stage === 'planned' && record.deadline && record.deadline <= todayKey) todos.push({ record, type: 'deadline', text: record.deadline === todayKey ? '今天截止，请确认是否投递' : '截止已过，请更新岗位状态' });
      if (record.eventAt && record.eventAt.startsWith(todayKey)) todos.push({ record, type: 'appointment', text: `${record.eventAt.slice(11)} · ${record.eventTitle}` });
      if (record.followUpDate && record.followUpDate <= todayKey) todos.push({ record, type: 'followup', text: record.nextAction || '跟进岗位进展' });
    }
    const suggestions = [];
    if (deadlines.length) suggestions.push(`优先处理 ${deadlines.length} 个三天内截止的待投递岗位。`);
    if (upcoming.length) suggestions.push(`为未来七天的 ${upcoming.length} 项安排预留准备时间。`);
    if (stalled.length) suggestions.push(`跟进 ${stalled.length} 个至少 14 天没有阶段进展的岗位。`);
    const unbound = records.filter(record => record.stage === 'planned' && !record.resumeVersion);
    if (unbound.length) suggestions.push(`为 ${unbound.length} 个待投递岗位选择合适的简历版本。`);
    const noTime = records.filter(record => record.eventTitle && !record.eventAt && !ended.has(record.stage));
    if (noTime.length) suggestions.push(`确认 ${noTime.length} 项时间待定的笔面安排。`);
    if (!suggestions.length) suggestions.push(records.length ? '更新岗位状态、跟进日期和个人复盘，让下一步行动更清楚。' : '先添加目标岗位，再记录投递日期与后续安排。');
    return { todayKey, weekStart, weekEnd, days, weekly, deadlines, upcoming, appointments, stalled, todos, suggestions,
      total: records.length, submitted: submitted.length, active: records.filter(active).length,
      interviews: records.filter(record => interviews.has(record.stage)).length,
      offers: records.filter(record => record.stage === 'offer').length,
      progression: submitted.length ? Math.round(advanced.length / submitted.length * 100) : 0,
      stageCounts: Object.fromEntries(Object.keys(stages).map(stage => [stage, records.filter(record => record.stage === stage).length])),
      reviews: records.filter(record => record.reviewNotes).sort((a, b) => (b.updatedAt || b.appliedDate).localeCompare(a.updatedAt || a.appliedDate))
    };
  }
  return { stages, key, day, offset, active, dueSoon, events, summarize };
});
