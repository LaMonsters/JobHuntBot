/* Shared form controls. Keep dashboard/job-fields.js in sync with this file. */
globalThis.OfferTrackFields = (() => {
  const jobTypes = ['产品岗', '技术岗', '数据岗', '研发岗', '科研岗', '工程岗', '运营岗', '销售岗', '市场岗', '职能岗', '设计岗', '管培生', '通用校招'];
  function choose(select, values, value = '', placeholder = '请选择') {
    const options = [...new Set([...values, value].filter(Boolean))];
    select.replaceChildren(new Option(placeholder, ''), ...options.map(text => new Option(text, text)));
    select.value = value;
  }
  function resumeControl(select, editor, input, openButton, applyButton) {
    const resetEditor = () => { editor.hidden = true; input.value = ''; input.setCustomValidity(''); };
    openButton.addEventListener('click', () => { if (!editor.hidden) resetEditor(); else { editor.hidden = false; input.focus(); } });
    const apply = () => {
      const name = input.value.trim();
      if (!name) { input.setCustomValidity('请填写简历版本名称。'); input.reportValidity(); return; }
      if (![...select.options].some(o => o.value === name)) select.add(new Option(name, name));
      select.value = name;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      resetEditor();
    };
    applyButton.addEventListener('click', apply);
    input.addEventListener('input', () => input.setCustomValidity(''));
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); apply(); } });
    return { set(value = '', names = []) { choose(select, names, value, names.length || value ? '暂不绑定简历版本' : '暂无简历版本'); resetEditor(); } };
  }
  return { jobTypes, choose, resumeControl };
})();
