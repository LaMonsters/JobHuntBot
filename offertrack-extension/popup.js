(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const DEFAULT_URL = 'http://localhost:8420/dashboard.html';
  let capture = null, reading = false, resumeVersions = [];
  const resumeControl = OfferTrackFields.resumeControl($('resume-version'), $('resume-editor'), $('resume-name'), $('add-resume'), $('apply-resume'));
  const status = (text, error = false) => { $('status').textContent = text; $('status').className = error ? 'error' : ''; };
  const sendError = message => {
    const el = $('send-error');
    el.textContent = message || '';
    el.hidden = !message;
    if (message) el.scrollIntoView({ block: 'nearest' });
  };
  function dashboardURL() {
    let url;
    try { url = new URL($('dashboard-url').value.trim()); } catch { throw new Error('请填写完整的本地工作台地址。'); }
    if (url.username || url.password || !(/\/dashboard\.html$/i.test(url.pathname)) || !(url.protocol === 'file:' && !url.host || ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('请使用本机 localhost、127.0.0.1 或 file:///…/dashboard.html 地址。');
    url.hash = ''; url.search = '';
    return url;
  }
  function showCapture(value) {
    capture = value;
    sendError('');
    $('preview').reset();
    OfferTrackFields.choose($('job-type'), OfferTrackFields.jobTypes, value.job.jobType || '', '请选择岗位类型');
    resumeControl.set(value.job.resumeVersion || '', resumeVersions);
    for (const [key, val] of Object.entries(value.job)) {
      const field = $('preview').elements.namedItem(key);
      if (field) field.value = val;
    }
    $('preview').hidden = false;
    $('restore-empty').hidden = true;
    $('method').textContent = value.method;
    $('warnings').replaceChildren(...(value.warnings || []).map(message => { const p = document.createElement('p'); p.textContent = message; return p; }));
    $('jd-count').textContent = `${(value.job.jd || '').length} 字`;
  }
  async function read(selectionOnly) {
    if (reading) return;
    reading = true;
    for (const id of ['read', 'selection', 'send']) $(id).disabled = true;
    status(selectionOnly ? '正在读取选中的岗位文字…' : '正在识别当前岗位页面…');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !/^https?:\/\//i.test(tab.url || '')) throw new Error('请在普通网页中的岗位详情页打开插件。浏览器设置页、扩展商店和 PDF 不能直接识别。');
      if (/\/dashboard\.html(?:[?#]|$)/i.test(tab.url)) throw new Error('请先切换到你想应聘的岗位介绍页，再点击插件。');
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractOfferTrackJob, args: [selectionOnly] });
      if (!result?.job) throw new Error('读取失败。请等待岗位内容加载完成，或选中岗位介绍后重试。');
      showCapture(result);
      await chrome.storage.local.set({ lastCapture: result });
      const n = ['company', 'role', 'city', 'jobType', 'sourceUrl', 'jd'].filter(key => result.job[key]).length;
      status(`已识别 ${n} / 6 项主要信息，可修改后导入。`);
    } catch (error) {
      status(error.message.includes('Cannot access') || error.message.includes('permissions') ? '浏览器暂不允许读取此页面。请刷新岗位页并重新点击插件，或换到普通岗位详情页。' : error.message, true);
      $('restore-empty').hidden = !!capture;
    } finally {
      reading = false;
      for (const id of ['read', 'selection', 'send']) $(id).disabled = false;
    }
  }
  function packet() {
    if (!capture) throw new Error('请先读取一个岗位。');
    const job = Object.fromEntries(new FormData($('preview')));
    for (const key of Object.keys(job)) job[key] = job[key].trim();
    if (!job.role && !job.jd) throw new Error('尚未识别到岗位名称或 JD，请在岗位详情页重新读取。');
    return { ...capture, job };
  }
  async function remember() {
    const data = packet();
    resumeVersions = [...new Set([...resumeVersions, data.job.resumeVersion].filter(Boolean))];
    await chrome.storage.local.set({ lastCapture: data, resumeVersions });
    return data;
  }
  async function restore() {
    try {
      const { lastCapture } = await chrome.storage.local.get('lastCapture');
      if (!lastCapture?.job) throw new Error('还没有保存过岗位，请先在岗位详情页点击读取。');
      showCapture(lastCapture);
      status('已恢复上次采集，可以继续导入。');
    } catch (error) { status(error.message, true); }
  }
  $('read').addEventListener('click', () => read(false));
  $('selection').addEventListener('click', () => read(true));
  $('restore').addEventListener('click', restore);
  $('restore-empty').addEventListener('click', restore);
  $('preview').addEventListener('input', () => { $('jd-count').textContent = `${$('preview').elements.namedItem('jd').value.length} 字`; });
  $('save-settings').addEventListener('click', async () => {
    try { const url = dashboardURL().href; await chrome.storage.local.set({ dashboardUrl: url }); $('dashboard-url').value = url; status('工作台地址已保存。'); }
    catch (error) { status(error.message, true); }
  });
  $('preview').addEventListener('submit', async event => {
    event.preventDefault(); $('send').disabled = true; sendError('');
    try {
      const url = dashboardURL();
      const data = await remember();
      await chrome.storage.local.set({ dashboardUrl: url.href });
      const result = await deliverOfferTrackJob(url.href, data);
      status(result.reused ? '已切换到打开的工作台，请核对并保存。' : '已打开工作台，请核对表单并点击“保存岗位”。');
    } catch (error) { status(error.message, true); sendError(error.message); }
    finally { $('send').disabled = false; }
  });
  $('download').addEventListener('click', async () => {
    try {
      sendError('');
      const data = await remember();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = 'OfferTrack-岗位采集.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      status('岗位文件已生成，在工作台点击“导入岗位”即可填入表单。');
    } catch (error) { status(error.message, true); sendError(error.message); }
  });
  (async () => {
    try {
      const settings = await chrome.storage.local.get(['dashboardUrl', 'resumeVersions']);
      $('dashboard-url').value = settings.dashboardUrl || DEFAULT_URL;
      resumeVersions = Array.isArray(settings.resumeVersions) ? settings.resumeVersions.filter(name => typeof name === 'string' && name.length <= 100) : [];
    }
    catch { status('无法读取插件设置，请检查扩展存储权限。', true); }
    await read(false);
  })();
})();
