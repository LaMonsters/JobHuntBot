/* Resume management embedded in the existing OfferTrack workbench. */
globalThis.OfferTrackResumes = (() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const filePattern = /^upload:([0-9a-f-]{36})$/;
  let items = [], token = '', ready = false, busy = false, selected = null, currentBinding = null, dragDepth = 0;
  let host = { getRecords: () => [], changed: () => {}, toast: () => {}, show: id => $(id).showModal(), close: id => $(id).close(), icon: () => '' };
  const size = bytes => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(0, bytes / 1024).toFixed(1)} KB`;
  const get = id => items.find(item => item.id === id);
  const fileURL = id => `/api/resumes/${encodeURIComponent(id)}/file`;
  function controls() { document.querySelectorAll('[data-resume-upload]').forEach(button => { button.disabled = busy || !ready; }); }
  async function api(url, options = {}) {
    let response;
    try { response = await fetch(url, { ...options, headers: { 'X-Resume-Token': token, ...options.headers }, signal: AbortSignal.timeout(90000) }); }
    catch { throw new Error('工作台服务暂时无法连接，请重新连接后再试。'); }
    let result;
    try { result = await response.json(); } catch { throw new Error('简历服务尚未就绪，请重新启动工作台后刷新页面。'); }
    if (!response.ok) { const error = new Error(result.error || '操作失败，请重试。'); error.duplicate = result.duplicate; throw error; }
    return result;
  }
  async function refresh() {
    if (location.protocol === 'file:') {
      $('resume-service-message').replaceChildren(document.createTextNode('上传简历需要从本地工作台网址打开。'));
      const link = document.createElement('a'); link.href = 'http://localhost:8420/dashboard.html#resumes'; link.textContent = '打开完整工作台 ↗';
      $('resume-service-message').append(link);
      $('resume-service-error').hidden = false;
      return false;
    }
    try {
      const data = await api('/api/resumes');
      items = data.resumes; token = data.token; ready = true;
      $('resume-service-error').hidden = true;
      render(); refreshSelect(); host.changed(); return true;
    } catch (error) {
      ready = false;
      $('resume-service-message').textContent = error.message;
      $('resume-service-error').hidden = false;
      return false;
    } finally { controls(); }
  }
  function render() {
    ['resume-nav-count', 'resume-total', 'resume-list-count'].forEach(id => { $(id).textContent = items.length; });
    $('resume-total-size').textContent = size(items.reduce((sum, item) => sum + item.size, 0));
    $('resume-empty').hidden = items.length !== 0;
    const records = host.getRecords();
    $('resume-cards').innerHTML = items.map(item => {
      const count = records.filter(record => record.resumeId === item.id).length;
      return `<article class="resume-file-card panel" data-resume-id="${esc(item.id)}"><div class="resume-card-top"><span class="resume-pdf-icon">${host.icon('file')}</span><span class="resume-format">PDF</span></div><h3>${esc(item.name)}</h3><p class="resume-original" title="${esc(item.originalName)}">${esc(item.originalName)}</p><div class="resume-card-meta"><time datetime="${item.uploadedAt}">${new Date(item.uploadedAt).toLocaleDateString('zh-CN')} 上传</time><span>${size(item.size)}</span></div><p class="resume-use-count">${count ? `已绑定 ${count} 条岗位记录` : '可在添加岗位时选择此版本'}</p><div class="resume-card-actions"><a class="resume-view" href="${fileURL(item.id)}" target="_blank" rel="noopener" aria-label="查看简历：${esc(item.name)}">查看简历 ↗</a><a class="icon-button" href="${fileURL(item.id)}?download=1" download="${esc(item.originalName)}" title="下载简历" aria-label="下载简历：${esc(item.name)}">${host.icon('download')}</a><button class="icon-button" data-resume-rename="${item.id}" title="重命名" aria-label="重命名：${esc(item.name)}">${host.icon('edit')}</button><button class="icon-button delete" data-resume-remove="${item.id}" title="删除" aria-label="删除简历：${esc(item.name)}">${host.icon('trash')}</button></div></article>`;
    }).join('');
  }
  function refreshSelect(job) {
    const select = $('field-resume');
    if (!select) return;
    if (job) currentBinding = { resumeId: job.resumeId || '', resumeVersion: job.resumeVersion || '' };
    let value = job?.resumeId ? `upload:${job.resumeId}` : select.value;
    select.querySelectorAll('optgroup[data-resume-files], option[data-missing-file]').forEach(option => option.remove());
    if (items.length) {
      const group = document.createElement('optgroup'); group.label = '已上传的 PDF 简历'; group.dataset.resumeFiles = 'true';
      items.forEach(item => {
        const duplicates = items.filter(other => other.name === item.name).length > 1;
        group.append(new Option(item.name + (duplicates ? ` · ${item.id.slice(-6)}` : ''), `upload:${item.id}`));
      });
      select.append(group);
      if (!select.options[0].value) select.options[0].textContent = '暂不绑定简历版本';
    }
    if (filePattern.test(value) && ![...select.options].some(option => option.value === value)) {
      const missing = new Option(`${currentBinding?.resumeVersion || '原简历版本'}（${ready ? '文件已删除或未恢复' : '文件尚未连接'}）`, value);
      missing.dataset.missingFile = 'true'; select.append(missing);
    }
    if ([...select.options].some(option => option.value === value)) select.value = value;
    updateBindingLink();
  }
  function updateBindingLink() {
    const match = filePattern.exec($('field-resume').value);
    const file = match && get(match[1]);
    $('resume-bound-link').hidden = !file;
    if (file) $('resume-bound-link').href = fileURL(file.id); else $('resume-bound-link').removeAttribute('href');
    $('resume-binding-hint').textContent = match && !file ? '原来的版本名称会保留；请重新上传文件并选择绑定，或继续保留历史记录。' : '可选择已上传的 PDF；已有的版本名称仍可继续使用。';
  }
  function binding(value) {
    const match = filePattern.exec(value);
    if (!match) return { resumeId: '', resumeVersion: value };
    if (currentBinding?.resumeId === match[1] && currentBinding.resumeVersion) return { ...currentBinding };
    const item = get(match[1]);
    if (item) return { resumeId: item.id, resumeVersion: item.name };
    if (currentBinding?.resumeId === match[1]) return { ...currentBinding };
    throw new Error('所选简历已不存在，请重新选择简历版本。');
  }
  function recordLink(record) {
    if (!record.resumeVersion) return '';
    const item = get(record.resumeId);
    return item ? `<a class="record-resume-link" href="${fileURL(item.id)}" target="_blank" rel="noopener" title="查看绑定的简历">简历：${esc(record.resumeVersion)} ↗</a>` : `<span class="record-resume-link unavailable">简历：${esc(record.resumeVersion)}${record.resumeId && ready ? '（文件已删除或未恢复）' : ''}</span>`;
  }
  async function uploadFiles(fileList) {
    const files = Array.from(fileList);
    if (!files.length || busy) return;
    if (!ready) { host.toast('请先连接简历服务。'); return; }
    busy = true; controls();
    $('resume-batch').hidden = false; $('resume-dismiss').hidden = true;
    $('resume-batch-results').replaceChildren(); $('resume-progress').value = 0;
    let success = 0, duplicate = 0, failed = 0;
    try {
      for (const [index, file] of files.entries()) {
        $('resume-batch-summary').textContent = `正在上传 ${index + 1} / ${files.length}：${file.name}`;
        const line = document.createElement('li');
        try {
          if (!/\.pdf$/i.test(file.name)) throw new Error('仅支持 PDF 文件。');
          if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('文件不能为空，单份不能超过 20 MB。');
          await api(`/api/resumes?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/pdf' } });
          success++; line.className = 'success'; line.textContent = `${file.name} · 已保存`;
        } catch (error) {
          if (error.duplicate) duplicate++; else failed++;
          line.className = error.duplicate ? 'duplicate' : 'failed'; line.textContent = `${file.name} · ${error.message}`;
        }
        $('resume-batch-results').append(line);
        $('resume-progress').value = (index + 1) / files.length * 100;
      }
    } finally {
      busy = false; $('resume-file-input').value = ''; $('resume-dismiss').hidden = false;
      $('resume-batch-summary').textContent = `上传完成 · 成功 ${success} 份${duplicate ? `，重复 ${duplicate} 份` : ''}${failed ? `，失败 ${failed} 份` : ''}`;
      await refresh(); controls();
    }
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-resume-upload')) $('resume-file-input').click();
    if (button.dataset.resumeRename) {
      selected = get(button.dataset.resumeRename); if (!selected) return;
      $('resume-edit-name').value = selected.name; $('resume-edit-error').hidden = true;
      host.show('resume-edit-dialog'); $('resume-edit-name').focus(); $('resume-edit-name').select();
    }
    if (button.dataset.resumeRemove) {
      selected = get(button.dataset.resumeRemove); if (!selected) return;
      $('resume-remove-message').textContent = `“${selected.name}”将从本地简历库删除。已有岗位会保留绑定的版本名称；你最初上传的原文件不受影响。`;
      $('resume-remove-error').hidden = true; host.show('resume-remove-dialog');
      $('resume-remove-dialog').querySelector('[data-close]').focus();
    }
  });
  $('resume-edit-form').addEventListener('submit', async event => {
    event.preventDefault(); const id = selected?.id; if (!id) return;
    $('resume-edit-save').disabled = true;
    try {
      await api(`/api/resumes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('resume-edit-name').value.trim() }) });
      host.close('resume-edit-dialog'); await refresh(); host.toast('简历名称已保存，历史投递中的版本名称仍会保留');
    } catch (error) { $('resume-edit-error').textContent = error.message; $('resume-edit-error').hidden = false; }
    finally { $('resume-edit-save').disabled = false; }
  });
  $('resume-remove-confirm').addEventListener('click', async () => {
    const id = selected?.id; if (!id) return;
    $('resume-remove-confirm').disabled = true;
    try { await api(`/api/resumes/${id}`, { method: 'DELETE' }); host.close('resume-remove-dialog'); await refresh(); host.toast('简历文件已删除，岗位记录已保留'); }
    catch (error) { $('resume-remove-error').textContent = error.message; $('resume-remove-error').hidden = false; }
    finally { $('resume-remove-confirm').disabled = false; }
  });
  $('resume-file-input').addEventListener('change', event => uploadFiles(event.target.files));
  $('resume-retry').addEventListener('click', refresh);
  $('resume-dismiss').addEventListener('click', () => { $('resume-batch').hidden = true; });
  $('field-resume').addEventListener('change', updateBindingLink);
  $('field-resume').addEventListener('input', updateBindingLink);
  const zone = $('resume-dropzone');
  zone.addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; if (!busy && ready) zone.classList.add('dragover'); });
  zone.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = busy || !ready ? 'none' : 'copy'; });
  zone.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) zone.classList.remove('dragover'); });
  zone.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; zone.classList.remove('dragover'); uploadFiles(event.dataTransfer.files); });
  window.addEventListener('dragover', event => { if (!$('resume-manager').hidden) event.preventDefault(); });
  window.addEventListener('drop', event => { if (!$('resume-manager').hidden) event.preventDefault(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !busy && !$('resume-manager').hidden) refresh(); });
  return { init(options) { host = { ...host, ...options }; refresh(); }, open() { render(); if (!busy) refresh(); }, render, refreshSelect, binding, recordLink };
})();
