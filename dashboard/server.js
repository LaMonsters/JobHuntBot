// Zero-dependency static file server for the local job-search dashboard.
// Serves this folder on http://localhost:8420 so dashboard.html can fetch()
// the CSV files with fresh data on every reload. Also exposes write
// endpoints so the dashboard can:
//   - mark a job as Offer/Rejected (POST /api/update-status)
//   - add/edit/delete an upcoming calendar event, which also stamps the
//     job's current_stage in job_pool.csv (POST /api/calendar/*)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.OFFERTRACK_PORT || 8420);
const ROOT = __dirname;
const resumeAPI = require('./resume-api')(process.env.OFFERTRACK_RESUME_DIR || path.join(ROOT, '.resume-data'));
const JOB_POOL_PATH = path.join(ROOT, 'job_pool.csv');
const APPLICATION_LOG_PATH = path.join(ROOT, 'application_log.csv');
const FOLLOW_UP_PATH = path.join(ROOT, 'follow_up.csv');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.js': 'text/javascript; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

// Same quoted-field CSV dialect job_pool.csv already uses (every field
// quoted, "" for an embedded quote, CRLF line endings).
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else { field += c; }
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
  return rows;
}

function stringifyField(f) {
  return '"' + String(f == null ? '' : f).replace(/"/g, '""') + '"';
}

function stringifyCSV(rows) {
  return rows.map(r => r.map(stringifyField).join(',')).join('\r\n') + '\r\n';
}

function readCSVRows(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const rows = parseCSV(text);
  return { header: rows[0], dataRows: rows.slice(1) };
}

function writeCSVRows(filePath, header, dataRows) {
  fs.writeFileSync(filePath, stringifyCSV([header, ...dataRows]));
}

function readJSONBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) req.destroy(); // guard against runaway payloads
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, statusCode, obj) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

async function handleUpdateStatus(req, res) {
  let payload;
  try {
    payload = await readJSONBody(req);
  } catch (e) {
    return sendJSON(res, 400, { ok: false, error: e.message });
  }

  const { rowIndex, company, job_title, status } = payload || {};
  if (!['Offer', 'Rejected'].includes(status)) {
    return sendJSON(res, 400, { ok: false, error: 'status must be Offer or Rejected' });
  }
  if (!Number.isInteger(rowIndex) || rowIndex < 0) {
    return sendJSON(res, 400, { ok: false, error: 'rowIndex must be a non-negative integer' });
  }

  let header, dataRows;
  try {
    ({ header, dataRows } = readCSVRows(JOB_POOL_PATH));
  } catch (e) {
    return sendJSON(res, 500, { ok: false, error: 'Could not read job_pool.csv: ' + e.message });
  }

  const companyCol = header.indexOf('company');
  const titleCol = header.indexOf('job_title');
  const statusCol = header.indexOf('status');

  if (statusCol === -1 || companyCol === -1 || titleCol === -1) {
    return sendJSON(res, 500, { ok: false, error: 'job_pool.csv is missing an expected column' });
  }
  if (rowIndex >= dataRows.length) {
    return sendJSON(res, 409, { ok: false, error: 'rowIndex out of range — the file may have changed, please refresh' });
  }

  const target = dataRows[rowIndex];
  // job_pool.csv may have been rewritten (e.g. by the agent) between page
  // load and this click, which would shift row positions — confirm the row
  // at this index is still the same job before overwriting its status.
  if (target[companyCol] !== company || target[titleCol] !== job_title) {
    return sendJSON(res, 409, { ok: false, error: 'This row no longer matches — the dashboard data changed, please refresh and try again' });
  }

  target[statusCol] = status;

  try {
    writeCSVRows(JOB_POOL_PATH, header, dataRows);
  } catch (e) {
    return sendJSON(res, 500, { ok: false, error: 'Could not write job_pool.csv: ' + e.message });
  }

  sendJSON(res, 200, { ok: true });
}

// ---------- add / edit application records ----------
const JOB_POOL_FIELDS = [
  'date_found', 'company', 'job_title', 'role_family', 'level', 'location',
  'remote_policy', 'source', 'job_url', 'posted_date', 'priority', 'status',
  'resume_variant', 'skip_reason', 'blocker', 'next_action', 'notes',
  'cohort_match_status', 'current_stage',
];
const APPLICATION_LOG_FIELDS = [
  'attempt_date', 'company', 'job_title', 'job_url', 'platform', 'status',
  'submission_evidence', 'resume_used', 'answers_used', 'confirmation_url',
  'confirmation_text', 'notes',
];
const VALID_JOB_STATUSES = new Set(['Submitted', 'Skipped', 'Blocked', 'Needs user', 'Pending', 'Offer', 'Rejected']);
const VALID_PRIORITIES = new Set(['High', 'Medium', 'Low', 'Stretch']);

function httpError(message, statusCode = 400) {
  const e = new Error(message);
  e.httpStatus = statusCode;
  return e;
}

function payloadString(payload, key, maxLength = 4000) {
  const value = payload && payload[key] != null ? String(payload[key]).trim() : '';
  if (value.length > maxLength) throw httpError(`${key} 超过 ${maxLength} 个字符`);
  return value;
}

function validateJobPayload(payload, isEdit) {
  const record = {};
  JOB_POOL_FIELDS.forEach(field => {
    const limit = field === 'job_url' ? 1000 : field === 'notes' ? 4000 : 1200;
    record[field] = payloadString(payload, field, limit);
  });
  record.application_date = payloadString(payload, 'application_date', 40);
  record.platform = payloadString(payload, 'platform', 100);
  record.submission_evidence = payloadString(payload, 'submission_evidence', 500);
  record.confirmation_url = payloadString(payload, 'confirmation_url', 1000);
  record.confirmation_text = payloadString(payload, 'confirmation_text', 2000);
  record.answers_used = payloadString(payload, 'answers_used', 300);

  if (!record.company || !record.job_title) throw httpError('公司和岗位都要填写');
  if (!record.status || !VALID_JOB_STATUSES.has(record.status)) throw httpError('投递状态不合法');
  if (record.priority && !VALID_PRIORITIES.has(record.priority)) throw httpError('优先级不合法');
  if (!record.date_found && !isEdit) throw httpError('发现日期不能为空');
  for (const [field, value] of [['date_found', record.date_found], ['posted_date', record.posted_date], ['application_date', record.application_date]]) {
    if (value && !DATE_RE.test(value)) throw httpError(`${field} 必须是 YYYY-MM-DD`);
  }
  if (record.job_url && !/^https?:\/\//i.test(record.job_url)) throw httpError('岗位链接必须以 http:// 或 https:// 开头');
  if (record.confirmation_url && !/^https?:\/\//i.test(record.confirmation_url)) throw httpError('确认页链接必须以 http:// 或 https:// 开头');
  if (['Yes', 'No', 'Unclear'].indexOf(record.cohort_match_status) === -1) record.cohort_match_status = 'Unclear';
  if (isRealApplicationStatus(record.status) && payload.submission_confirmed !== true) {
    throw httpError('状态为已投递、Offer 或已挂时，请确认这是真实提交的申请');
  }
  return record;
}

function isRealApplicationStatus(status) {
  return status === 'Submitted' || status === 'Offer' || status === 'Rejected';
}

function rowObject(header, row) {
  const obj = {};
  header.forEach((field, index) => { obj[field] = row[index] == null ? '' : row[index]; });
  return obj;
}

function makeJobRow(header, record, existingRow) {
  return header.map((field, index) => {
    if (Object.prototype.hasOwnProperty.call(record, field)) return record[field];
    return existingRow && existingRow[index] != null ? existingRow[index] : '';
  });
}

function duplicateJobIndex(header, dataRows, record, ignoreIndex = -1) {
  const companyCol = header.indexOf('company');
  const titleCol = header.indexOf('job_title');
  const locationCol = header.indexOf('location');
  const urlCol = header.indexOf('job_url');
  return dataRows.findIndex((row, index) => {
    if (index === ignoreIndex) return false;
    const sameUrl = record.job_url && urlCol !== -1 && row[urlCol] === record.job_url;
    const sameRole = companyCol !== -1 && titleCol !== -1 &&
      row[companyCol] === record.company && row[titleCol] === record.job_title &&
      (!record.location || locationCol === -1 || !row[locationCol] || row[locationCol] === record.location);
    return sameUrl || sameRole;
  });
}

function findApplicationLogIndex(header, dataRows, record, previous) {
  const companyCol = header.indexOf('company');
  const titleCol = header.indexOf('job_title');
  const urlCol = header.indexOf('job_url');
  const target = previous || record;
  return dataRows.findIndex(row => {
    if (companyCol === -1 || titleCol === -1) return false;
    if (row[companyCol] !== target.company || row[titleCol] !== target.job_title) return false;
    return !target.job_url || urlCol === -1 || !row[urlCol] || row[urlCol] === target.job_url;
  });
}

function prepareApplicationLogUpdate(record, previous) {
  if (!isRealApplicationStatus(record.status)) return null;
  let parsed;
  try {
    parsed = readCSVRows(APPLICATION_LOG_PATH);
  } catch (e) {
    parsed = { header: APPLICATION_LOG_FIELDS.slice(), dataRows: [] };
  }
  let header = parsed.header && parsed.header.length ? parsed.header : APPLICATION_LOG_FIELDS.slice();
  const dataRows = parsed.dataRows || [];
  let index = findApplicationLogIndex(header, dataRows, record, previous);
  if (index === -1) {
    index = dataRows.length;
    dataRows.push(new Array(header.length).fill(''));
  }
  const row = dataRows[index];
  const values = {
    attempt_date: record.application_date || record.date_found,
    company: record.company,
    job_title: record.job_title,
    job_url: record.job_url,
    platform: record.platform,
    status: record.status,
    submission_evidence: record.submission_evidence || '用户自行投递；用户在看板中确认真实提交',
    resume_used: record.resume_variant,
    answers_used: record.answers_used,
    confirmation_url: record.confirmation_url,
    confirmation_text: record.confirmation_text,
    notes: record.notes,
  };
  header.forEach((field, fieldIndex) => {
    if (Object.prototype.hasOwnProperty.call(values, field)) row[fieldIndex] = values[field];
  });
  return { header, dataRows };
}

function prepareFollowUpRename(previous, record) {
  if (!previous || (previous.company === record.company && previous.job_title === record.job_title)) return null;
  let parsed;
  try {
    parsed = readCSVRows(FOLLOW_UP_PATH);
  } catch (e) {
    return null;
  }
  const header = parsed.header;
  const dataRows = parsed.dataRows || [];
  const companyCol = header.indexOf('company');
  const titleCol = header.indexOf('job_title');
  if (companyCol === -1 || titleCol === -1) return null;
  dataRows.forEach(row => {
    if (row[companyCol] === previous.company && row[titleCol] === previous.job_title) {
      row[companyCol] = record.company;
      row[titleCol] = record.job_title;
    }
  });
  return { header, dataRows };
}

async function handleJobAdd(req, res) {
  let payload;
  try { payload = await readJSONBody(req); } catch (e) { return sendJSON(res, 400, { ok: false, error: e.message }); }
  let record;
  try { record = validateJobPayload(payload, false); } catch (e) { return sendJSON(res, e.httpStatus || 400, { ok: false, error: e.message }); }

  let header, dataRows;
  try { ({ header, dataRows } = readCSVRows(JOB_POOL_PATH)); }
  catch (e) { return sendJSON(res, 500, { ok: false, error: 'Could not read job_pool.csv: ' + e.message }); }
  if (!header || !header.length) return sendJSON(res, 500, { ok: false, error: 'job_pool.csv 没有表头' });
  const duplicate = duplicateJobIndex(header, dataRows, record);
  if (duplicate !== -1) return sendJSON(res, 409, { ok: false, error: '已经存在相同公司/岗位或相同链接的记录，请使用“编辑投递”' });

  const row = makeJobRow(header, record);
  dataRows.push(row);
  const appLog = prepareApplicationLogUpdate(record, null);
  try {
    writeCSVRows(JOB_POOL_PATH, header, dataRows);
    if (appLog) writeCSVRows(APPLICATION_LOG_PATH, appLog.header, appLog.dataRows);
  } catch (e) {
    return sendJSON(res, 500, { ok: false, error: '写入看板数据失败：' + e.message });
  }
  sendJSON(res, 201, { ok: true, rowIndex: dataRows.length - 1 });
}

async function handleJobUpdate(req, res) {
  let payload;
  try { payload = await readJSONBody(req); } catch (e) { return sendJSON(res, 400, { ok: false, error: e.message }); }
  const rowIndex = payload && payload.rowIndex;
  if (!Number.isInteger(rowIndex) || rowIndex < 0) return sendJSON(res, 400, { ok: false, error: 'rowIndex 必须是非负整数' });
  let record;
  try { record = validateJobPayload(payload, true); } catch (e) { return sendJSON(res, e.httpStatus || 400, { ok: false, error: e.message }); }

  let header, dataRows;
  try { ({ header, dataRows } = readCSVRows(JOB_POOL_PATH)); }
  catch (e) { return sendJSON(res, 500, { ok: false, error: 'Could not read job_pool.csv: ' + e.message }); }
  if (rowIndex >= dataRows.length) return sendJSON(res, 409, { ok: false, error: '记录位置已变化，请刷新后重试' });
  const oldRow = dataRows[rowIndex];
  const previous = rowObject(header, oldRow);
  const original = payload.original || {};
  if ((original.company && previous.company !== String(original.company)) ||
      (original.job_title && previous.job_title !== String(original.job_title)) ||
      (original.job_url && previous.job_url !== String(original.job_url))) {
    return sendJSON(res, 409, { ok: false, error: '这条记录已被其他操作修改，请刷新后重试' });
  }
  const duplicate = duplicateJobIndex(header, dataRows, record, rowIndex);
  if (duplicate !== -1) return sendJSON(res, 409, { ok: false, error: '修改后会与另一条公司/岗位或链接重复' });

  dataRows[rowIndex] = makeJobRow(header, record, oldRow);
  const appLog = prepareApplicationLogUpdate(record, previous);
  const followUp = prepareFollowUpRename(previous, record);
  try {
    writeCSVRows(JOB_POOL_PATH, header, dataRows);
    if (appLog) writeCSVRows(APPLICATION_LOG_PATH, appLog.header, appLog.dataRows);
    if (followUp) writeCSVRows(FOLLOW_UP_PATH, followUp.header, followUp.dataRows);
  } catch (e) {
    return sendJSON(res, 500, { ok: false, error: '写入看板数据失败：' + e.message });
  }
  sendJSON(res, 200, { ok: true, rowIndex });
}

// Locate + verify a job_pool.csv row by index, checking it still matches the
// company/job_title the client last saw (same staleness guard as above).
// Returns { header, dataRows, companyCol, titleCol, stageCol, target } or
// throws an Error with an httpStatus property for the caller to relay.
function locateJobRow(jobRowIndex, company, job_title) {
  if (!Number.isInteger(jobRowIndex) || jobRowIndex < 0) {
    const e = new Error('jobRowIndex must be a non-negative integer'); e.httpStatus = 400; throw e;
  }
  let header, dataRows;
  try {
    ({ header, dataRows } = readCSVRows(JOB_POOL_PATH));
  } catch (err) {
    const e = new Error('Could not read job_pool.csv: ' + err.message); e.httpStatus = 500; throw e;
  }
  const companyCol = header.indexOf('company');
  const titleCol = header.indexOf('job_title');
  const statusCol = header.indexOf('status');
  const stageCol = header.indexOf('current_stage');
  if ([companyCol, titleCol, statusCol, stageCol].includes(-1)) {
    const e = new Error('job_pool.csv is missing an expected column (company/job_title/status/current_stage)'); e.httpStatus = 500; throw e;
  }
  if (jobRowIndex >= dataRows.length) {
    const e = new Error('jobRowIndex out of range — the file may have changed, please refresh'); e.httpStatus = 409; throw e;
  }
  const target = dataRows[jobRowIndex];
  if (target[companyCol] !== company || target[titleCol] !== job_title) {
    const e = new Error('This job row no longer matches — the dashboard data changed, please refresh and try again'); e.httpStatus = 409; throw e;
  }
  if (target[statusCol] !== 'Submitted') {
    const e = new Error('This job is not in the Submitted/Applied bucket — calendar events are only for already-applied jobs'); e.httpStatus = 409; throw e;
  }
  return { header, dataRows, statusCol, stageCol, target };
}

async function handleCalendarAdd(req, res) {
  let payload;
  try {
    payload = await readJSONBody(req);
  } catch (e) {
    return sendJSON(res, 400, { ok: false, error: e.message });
  }

  const { jobRowIndex, company, job_title, date, time, event_type } = payload || {};
  if (!DATE_RE.test(date)) return sendJSON(res, 400, { ok: false, error: 'date must be YYYY-MM-DD' });
  if (!TIME_RE.test(time)) return sendJSON(res, 400, { ok: false, error: 'time must be HH:MM' });
  if (typeof event_type !== 'string' || !event_type.trim()) {
    return sendJSON(res, 400, { ok: false, error: 'event_type is required' });
  }

  let jobRow;
  try {
    jobRow = locateJobRow(jobRowIndex, company, job_title);
  } catch (e) {
    return sendJSON(res, e.httpStatus || 500, { ok: false, error: e.message });
  }

  // current_stage is the event content verbatim — no auto-suffix. Every
  // company's process reads differently, so don't guess a shared phrasing
  // convention on top of what the user typed.
  const stage = event_type.trim();
  jobRow.target[jobRow.stageCol] = stage;

  let fuHeader, fuDataRows;
  try {
    ({ header: fuHeader, dataRows: fuDataRows } = readCSVRows(FOLLOW_UP_PATH));
  } catch (e) {
    return sendJSON(res, 500, { ok: false, error: 'Could not read follow_up.csv: ' + e.message });
  }
  const cols = ['date', 'company', 'job_title', 'contact', 'channel', 'event_type', 'deadline', 'next_action', 'status', 'notes', 'time'];
  if (cols.some(c => fuHeader.indexOf(c) === -1)) {
    return sendJSON(res, 500, { ok: false, error: 'follow_up.csv is missing an expected column' });
  }
  const newRow = new Array(fuHeader.length).fill('');
  newRow[fuHeader.indexOf('date')] = date;
  newRow[fuHeader.indexOf('company')] = company;
  newRow[fuHeader.indexOf('job_title')] = job_title;
  newRow[fuHeader.indexOf('event_type')] = event_type.trim();
  newRow[fuHeader.indexOf('status')] = 'Scheduled';
  newRow[fuHeader.indexOf('time')] = time;
  fuDataRows.push(newRow);
  const followUpRowIndex = fuDataRows.length - 1;

  try {
    writeCSVRows(JOB_POOL_PATH, jobRow.header, jobRow.dataRows);
    writeCSVRows(FOLLOW_UP_PATH, fuHeader, fuDataRows);
  } catch (e) {
    return sendJSON(res, 500, { ok: false, error: 'Could not write dashboard files: ' + e.message });
  }

  sendJSON(res, 200, { ok: true, followUpRowIndex, current_stage: stage });
}

async function handleCalendarUpdate(req, res) {
  let payload;
  try {
    payload = await readJSONBody(req);
  } catch (e) {
    return sendJSON(res, 400, { ok: false, error: e.message });
  }

  const { followUpRowIndex, jobRowIndex, company, job_title, date, time, event_type } = payload || {};
  if (!Number.isInteger(followUpRowIndex) || followUpRowIndex < 0) {
    return sendJSON(res, 400, { ok: false, error: 'followUpRowIndex must be a non-negative integer' });
  }
  if (!DATE_RE.test(date)) return sendJSON(res, 400, { ok: false, error: 'date must be YYYY-MM-DD' });
  if (!TIME_RE.test(time)) return sendJSON(res, 400, { ok: false, error: 'time must be HH:MM' });
  if (typeof event_type !== 'string' || !event_type.trim()) {
    return sendJSON(res, 400, { ok: false, error: 'event_type is required' });
  }

  let fuHeader, fuDataRows;
  try {
    ({ header: fuHeader, dataRows: fuDataRows } = readCSVRows(FOLLOW_UP_PATH));
  } catch (e) {
    return sendJSON(res, 500, { ok: false, error: 'Could not read follow_up.csv: ' + e.message });
  }
  const fuCompanyCol = fuHeader.indexOf('company');
  const fuTitleCol = fuHeader.indexOf('job_title');
  if (followUpRowIndex >= fuDataRows.length) {
    return sendJSON(res, 409, { ok: false, error: 'This event no longer exists — the calendar may have changed, please refresh' });
  }
  const fuTarget = fuDataRows[followUpRowIndex];
  if (fuTarget[fuCompanyCol] !== company || fuTarget[fuTitleCol] !== job_title) {
    return sendJSON(res, 409, { ok: false, error: 'This event no longer matches — the calendar may have changed, please refresh' });
  }

  let jobRow;
  try {
    jobRow = locateJobRow(jobRowIndex, company, job_title);
  } catch (e) {
    return sendJSON(res, e.httpStatus || 500, { ok: false, error: e.message });
  }

  fuTarget[fuHeader.indexOf('date')] = date;
  fuTarget[fuHeader.indexOf('time')] = time;
  fuTarget[fuHeader.indexOf('event_type')] = event_type.trim();

  // Same rule as add: current_stage is the event content verbatim.
  const stage = event_type.trim();
  jobRow.target[jobRow.stageCol] = stage;

  try {
    writeCSVRows(FOLLOW_UP_PATH, fuHeader, fuDataRows);
    writeCSVRows(JOB_POOL_PATH, jobRow.header, jobRow.dataRows);
  } catch (e) {
    return sendJSON(res, 500, { ok: false, error: 'Could not write dashboard files: ' + e.message });
  }

  sendJSON(res, 200, { ok: true, current_stage: stage });
}

async function handleCalendarDelete(req, res) {
  let payload;
  try {
    payload = await readJSONBody(req);
  } catch (e) {
    return sendJSON(res, 400, { ok: false, error: e.message });
  }

  const { followUpRowIndex, company, job_title, event_type, date, time } = payload || {};
  if (!Number.isInteger(followUpRowIndex) || followUpRowIndex < 0) {
    return sendJSON(res, 400, { ok: false, error: 'followUpRowIndex must be a non-negative integer' });
  }

  let fuHeader, fuDataRows;
  try {
    ({ header: fuHeader, dataRows: fuDataRows } = readCSVRows(FOLLOW_UP_PATH));
  } catch (e) {
    return sendJSON(res, 500, { ok: false, error: 'Could not read follow_up.csv: ' + e.message });
  }
  if (followUpRowIndex >= fuDataRows.length) {
    return sendJSON(res, 409, { ok: false, error: 'This event no longer exists — the calendar may have changed, please refresh' });
  }
  const fuTarget = fuDataRows[followUpRowIndex];
  const matches = (col, val) => fuTarget[fuHeader.indexOf(col)] === val;
  if (!matches('company', company) || !matches('job_title', job_title) || !matches('event_type', event_type) || !matches('date', date) || !matches('time', time)) {
    return sendJSON(res, 409, { ok: false, error: 'This event no longer matches — the calendar may have changed, please refresh' });
  }

  fuDataRows.splice(followUpRowIndex, 1);

  try {
    writeCSVRows(FOLLOW_UP_PATH, fuHeader, fuDataRows);
  } catch (e) {
    return sendJSON(res, 500, { ok: false, error: 'Could not write follow_up.csv: ' + e.message });
  }

  // Deliberately does not revert job_pool.csv's current_stage — there's no
  // reliable "previous stage" to roll back to. Edit the stage manually if
  // deleting this event should also change what's shown on the job card.
  sendJSON(res, 200, { ok: true });
}

const ROUTES = {
  '/api/update-status': handleUpdateStatus,
  '/api/job/add': handleJobAdd,
  '/api/job/update': handleJobUpdate,
  '/api/calendar/add': handleCalendarAdd,
  '/api/calendar/update': handleCalendarUpdate,
  '/api/calendar/delete': handleCalendarDelete,
};

const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); }
  catch { res.writeHead(400); res.end('Invalid URL'); return; }

  if (urlPath.startsWith('/api/resumes')) {
    resumeAPI.handle(req, res);
    return;
  }

  if (req.method === 'POST' && ROUTES[urlPath]) {
    ROUTES[urlPath](req, res);
    return;
  }

  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end('Method not allowed');
    return;
  }

  const servedPath = urlPath === '/' ? '/dashboard.html' : urlPath;
  const filePath = path.join(ROOT, servedPath);

  // Prevent escaping the dashboard folder.
  const relativePath = path.relative(ROOT, filePath);
  const privatePath = path.relative(resumeAPI.root, filePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath) || relativePath.split(path.sep).some(part => part.startsWith('.')) || (!privatePath.startsWith('..') && !path.isAbsolute(privatePath))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found: ' + urlPath);
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(content);
  });
});

// Bind to localhost only — this server can now write to job_pool.csv, so it
// shouldn't be reachable from other devices on the network.
server.listen(PORT, '127.0.0.1', () => {
  console.log('Dashboard running / 仪表盘已启动: http://localhost:' + PORT + '/dashboard.html');
  console.log('Keep this window open to keep serving; close it or press Ctrl+C to stop.');
  console.log('保持这个窗口开着；关掉窗口或按 Ctrl+C 即可停止服务。');
});
