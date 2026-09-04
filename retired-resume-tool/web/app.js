'use strict';
const $ = (id) => document.getElementById(id);
const uploadButtons = ['header-upload', 'choose-files', 'empty-upload'].map($);
let resumes = [], token = '', uploading = false, connected = false;
let selectedResume = null, dragDepth = 0, toastTimer;

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  svg.setAttribute('aria-hidden', 'true');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fileSize(bytes) {
  if (bytes === 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function notify(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5500);
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { 'X-Resume-Token': token, ...(options.headers || {}) },
      signal: AbortSignal.timeout(90000),
    });
  } catch {
    throw new Error('连接中断。请确认简历管理仍在运行，再重新连接。');
  }
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || '操作失败，请重试。');
    error.duplicate = Boolean(result.duplicate);
    throw error;
  }
  return result;
}

function updateUploadButtons() {
  uploadButtons.forEach((button) => { button.disabled = uploading || !connected; });
}

async function loadResumes() {
  try {
    const data = await api('/api/resumes');
    resumes = data.resumes;
    token = data.token;
    connected = true;
    $('connection-error').hidden = true;
    render();
    return true;
  } catch (error) {
    connected = false;
    $('connection-message').textContent = error.message;
    $('connection-error').hidden = false;
    return false;
  } finally {
    $('loading').hidden = true;
    updateUploadButtons();
  }
}

function actionButton(name, label, callback, extraClass = '') {
  const button = element('button', `icon-button ${extraClass}`);
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.append(icon(name));
  button.addEventListener('click', callback);
  return button;
}

function render() {
  ['nav-count', 'resume-count', 'library-count'].forEach((id) => { $(id).textContent = resumes.length; });
  $('total-size').textContent = fileSize(resumes.reduce((sum, item) => sum + item.size, 0));
  $('empty-state').hidden = resumes.length !== 0;
  $('resume-grid').replaceChildren();
  for (const resume of resumes) {
    const card = element('article', 'resume-card');
    const top = element('div', 'card-top');
    const fileIcon = element('span', 'pdf-icon');
    fileIcon.append(icon('file'));
    top.append(fileIcon, element('span', 'pdf-label', 'PDF'));
    const title = element('h3', '', resume.title);
    const original = element('p', 'original-name', resume.original_name);
    original.title = resume.original_name;
    const meta = element('div', 'card-meta');
    const uploaded = new Date(resume.uploaded_at);
    const date = element('time', '', uploaded.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) + ' 上传');
    date.dateTime = resume.uploaded_at;
    date.title = uploaded.toLocaleString('zh-CN');
    meta.append(date, element('span', '', fileSize(resume.size)));
    const actions = element('div', 'card-actions');
    const view = element('a', 'view-link', '查看简历');
    view.href = `/api/resumes/${resume.id}/file`;
    view.target = '_blank';
    view.rel = 'noopener';
    view.setAttribute('aria-label', `查看简历：${resume.title}（新窗口）`);
    view.append(icon('arrow'));
    const download = element('a', 'icon-button');
    download.href = `/api/resumes/${resume.id}/file?download=1`;
    download.download = resume.original_name;
    download.title = '下载简历';
    download.setAttribute('aria-label', `下载简历：${resume.title}`);
    download.append(icon('download'));
    actions.append(view, download,
      actionButton('edit', `重命名：${resume.title}`, () => openRename(resume)),
      actionButton('trash', `删除：${resume.title}`, () => openDelete(resume), 'delete'));
    card.append(top, title, original, meta, actions);
    $('resume-grid').append(card);
  }
}

async function uploadFiles(fileList) {
  const files = Array.from(fileList);
  if (!files.length || uploading) return;
  if (!connected) { notify('请先重新连接简历管理。'); return; }
  uploading = true;
  updateUploadButtons();
  $('upload-status').hidden = false;
  $('dismiss-upload').hidden = true;
  $('upload-results').replaceChildren();
  $('upload-progress').value = 0;
  let succeeded = 0, skipped = 0, failed = 0;
  try {
    for (const [index, file] of files.entries()) {
      $('upload-summary').textContent = `正在上传 ${index + 1} / ${files.length}：${file.name}`;
      const result = element('li');
      try {
        if (!/\.pdf$/i.test(file.name)) throw new Error('仅支持 PDF 文件');
        if (file.size === 0) throw new Error('文件为空');
        if (file.size > 20 * 1024 * 1024) throw new Error('超过单份 20 MB 上限');
        await api(`/api/resumes?name=${encodeURIComponent(file.name)}`, {
          method: 'POST', body: file, headers: { 'Content-Type': 'application/pdf' },
        });
        succeeded++;
        result.className = 'success';
        result.textContent = `✓ ${file.name} · 已保存`;
      } catch (error) {
        if (error.duplicate) skipped++; else failed++;
        result.className = error.duplicate ? 'duplicate' : 'failed';
        result.textContent = `${file.name} · ${error.message}`;
      }
      $('upload-results').append(result);
      $('upload-progress').value = Math.round((index + 1) / files.length * 100);
    }
  } finally {
    uploading = false;
    $('file-input').value = '';
    $('dismiss-upload').hidden = false;
    $('upload-summary').textContent = `上传完成 · 成功 ${succeeded} 份${skipped ? `，重复 ${skipped} 份` : ''}${failed ? `，失败 ${failed} 份` : ''}`;
    await loadResumes();
    updateUploadButtons();
  }
}

uploadButtons.forEach((button) => button.addEventListener('click', () => $('file-input').click()));
$('file-input').addEventListener('change', (event) => uploadFiles(event.target.files));
$('dismiss-upload').addEventListener('click', () => { $('upload-status').hidden = true; });
$('retry').addEventListener('click', loadResumes);

const dropzone = $('dropzone');
dropzone.addEventListener('dragenter', (event) => {
  event.preventDefault();
  dragDepth++;
  if (!uploading && connected) dropzone.classList.add('dragover');
});
dropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = uploading || !connected ? 'none' : 'copy';
});
dropzone.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropzone.classList.remove('dragover');
});
dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  dropzone.classList.remove('dragover');
  uploadFiles(event.dataTransfer.files);
});
// A misplaced file drop must not navigate away from the library.
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

function openRename(resume) {
  selectedResume = resume;
  $('resume-title').value = resume.title;
  $('rename-error').textContent = '';
  $('rename-dialog').showModal();
  $('resume-title').focus();
  $('resume-title').select();
}
$('cancel-rename').addEventListener('click', () => $('rename-dialog').close());
$('rename-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = $('resume-title').value.trim();
  if (!title) { $('rename-error').textContent = '请填写简历名称。'; return; }
  $('save-rename').disabled = true;
  $('cancel-rename').disabled = true;
  try {
    await api(`/api/resumes/${selectedResume.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
    $('rename-dialog').close();
    await loadResumes();
    notify('简历名称已保存');
  } catch (error) { $('rename-error').textContent = error.message; }
  finally { $('save-rename').disabled = false; $('cancel-rename').disabled = false; }
});

function openDelete(resume) {
  selectedResume = resume;
  $('delete-name').textContent = resume.title;
  $('delete-error').textContent = '';
  $('delete-dialog').showModal();
  $('cancel-delete').focus();
}
$('cancel-delete').addEventListener('click', () => $('delete-dialog').close());
$('confirm-delete').addEventListener('click', async () => {
  $('confirm-delete').disabled = true;
  $('cancel-delete').disabled = true;
  try {
    const result = await api(`/api/resumes/${selectedResume.id}`, { method: 'DELETE' });
    $('delete-dialog').close();
    await loadResumes();
    notify(result.warning || '简历已删除');
  } catch (error) { $('delete-error').textContent = error.message; }
  finally { $('confirm-delete').disabled = false; $('cancel-delete').disabled = false; }
});
for (const [dialogId, submitId] of [['rename-dialog', 'save-rename'], ['delete-dialog', 'confirm-delete']]) {
  $(dialogId).addEventListener('cancel', (event) => { if ($(submitId).disabled) event.preventDefault(); });
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !uploading && !$('rename-dialog').open && !$('delete-dialog').open) loadResumes();
});
loadResumes();
