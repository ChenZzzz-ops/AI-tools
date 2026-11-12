(() => {
  'use strict';
  const engine = window.HalogenEngine;
  const workbook = window.HalogenWorkbook;
  const recognition = window.HalogenRecognition;
  const engineeringData = window.ENGINEERING_BOM_DATA;
  const data = window.HALOGEN_DATA;
  const materialsDb = window.MATERIALS_DB;
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const format = (value, digits = 2) => Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const date = value => new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const icon = name => `<i data-lucide="${name}"></i>`;
  const icons = () => window.lucide?.createIcons();
  const STORAGE_KEY = 'halogen.audit.history.v1';
  const RULES_KEY = 'halogen.recognition.rules.v1';
  const MODE_LABELS = { known: '已知含量', estimated: '保守估算', compliant: 'EN50642 声明', unknown: '待补全' };
  const MODE_COLORS = { known: 'blue', estimated: 'green', compliant: 'amber', unknown: 'neutral' };
  const STATUS_LABELS = { pass: '通过', fail: '不通过', review: '接近限值，请谨慎声明', incomplete: '待补全 / 待审核' };
  const STATUS_COLORS = { pass: 'green', fail: 'red', review: 'amber', incomplete: 'amber' };
  const CLAIM_LABELS = { product: 'Halogen free product', 'plastic-cable': 'Halogen free plastic parts & cables product', plastic: 'Halogen plastics free', none: '暂无可支持的声明' };
  const ELEMENT_LABELS = { cl: 'Cl 氯', br: 'Br 溴', f: 'F 氟', i: 'I 碘', total: '总卤素' };
  const AUDIT_ITEMS = [
    { key: 'cable', title: '线缆验证', standard: 'IEC 60754-3', description: '线缆符合 IEC 60754-3 无卤要求；不含线缆时需记录核查依据。' },
    { key: 'pcb', title: '印刷电路板验证', standard: 'IPC-4101 · 第 122/126/127/128/130/131 页', description: 'PCB 基材满足低卤要求，保留供应商声明或报告。' },
    { key: 'consumable', title: '电子耗材验证', standard: 'FT50064 · 参照 IEC 61249-2-21 / IPC J-STD-004B', description: '核查电子耗材符合内部清单中的无卤要求。' },
    { key: 'electronic', title: '电子元件验证', standard: 'IEC 61249-2-21 / JST709C', description: '确认全部电子元件的无卤证据，缺少声明不得默认通过。' },
    { key: 'gas', title: '无卤化气体或液体', standard: '产品级声明条件', description: '产品不得使用 SF6 或卤化气体/液体（含氯、溴、氟）。' }
  ];
  const state = { product: structuredClone(data.product), parts: structuredClone(data.parts), audits: structuredClone(data.audits), source: data.source, sample: true, sourceMismatch: true, dirty: false, result: null, calculatedAt: new Date().toISOString(), view: 'overview', unit: 'percent', page: 1, savedId: null };
  let history = [];
  let comparisonChart;
  let sourceChart;
  let importState;
  let recognitionRules = [];
  let rulesStorageReadable = true;
  let databasePage = 1;
  function badge(text, color = 'neutral') { return `<span class="badge ${color}">${escape(text)}</span>`; }
  function toast(message, error = false) {
    const element = document.createElement('div'); element.className = 'toast' + (error ? ' error' : ''); element.innerHTML = icon(error ? 'circle-alert' : 'circle-check') + `<span>${escape(message)}</span>`;
    $('#toast-region').append(element); icons(); setTimeout(() => element.remove(), 6000);
  }
  function openModal(title, content, wide = false, eyebrow = 'WORKSPACE') {
    $('#modal-title').textContent = title; $('#modal-eyebrow').textContent = eyebrow; $('#modal-content').innerHTML = content; $('#modal').classList.toggle('wide', wide);
    if (!$('#modal').open) $('#modal').showModal(); icons();
  }
  function closeModal() { $('#modal').close(); }
  function confirmAction(title, message, action, label = '确认') {
    openModal(title, `<p class="form-hint">${escape(message)}</p><div class="modal-footer"><button class="button secondary" data-close>取消</button><button class="button primary" id="confirm-action">${escape(label)}</button></div>`);
    $('#confirm-action').onclick = () => { closeModal(); action(); };
  }
  function freshAudits() { return Object.fromEntries(engine.AUDIT_KEYS.map(key => [key, { status: 'pending', evidence: '' }])); }
  function markDirty() {
    state.dirty = true; state.savedId = null; renderDirty(); renderProduct();
    if ($('#claim-matrix')) renderClaims();
  }
  function renderDirty() {
    $('#stale-banner').hidden = !state.dirty; $('#view-overview').classList.toggle('dirty-results', state.dirty);
    $('#save-button').disabled = state.dirty; $('#export-button').disabled = state.dirty || state.result?.productStatus === 'incomplete';
    $('#calculation-time').textContent = state.dirty ? '当前结果已失效，等待重新计算' : `计算时间 ${date(state.calculatedAt)} · 方法 v${state.methodVersion || engine.version}`;
    $('#session-state').classList.toggle('dirty', state.dirty);
    $('#session-state').innerHTML = `<span></span>${state.dirty ? '修改未计算' : state.savedId ? '已保存快照' : state.sample ? '附件示例' : '未保存结果'}`;
  }
  function renderProduct() {
    $('#product-name').textContent = state.product.name || '未命名产品'; $('#product-reference').textContent = state.product.reference || '未填写'; $('#product-reviewer').textContent = state.product.reviewer || '未指定';
    $('#nav-bom-count').textContent = state.parts.length; $('#workflow-count').textContent = `${state.parts.length} 个零件`;
    $$('.nav-item').forEach(element => { element.title=element.textContent.trim(); element.setAttribute('aria-label',element.textContent.trim()); });
    if ($('#recognition-summary')) renderRecognition();
  }
  function navigate(view) {
    if (!['overview', 'bom', 'audit', 'history', 'method', 'database'].includes(view)) return;
    state.view = view; $$('.view').forEach(element => { element.hidden = element.id !== 'view-' + view; });
    $$('.main-nav [data-view]').forEach(button => { button.classList.toggle('active', button.dataset.view === view); button.setAttribute('aria-current', button.dataset.view === view ? 'page' : 'false'); });
    const titles = { overview: ['产品卤素含量审核', '工程 BOM 自动识别 · 材料模型 · 分级声明'], bom: ['产品 BOM 明细', '工程零件质量 + 下级原材料牌号'], audit: ['产品级合规审核', '条件 1–6 · 三类独立声明范围'], history: ['审核历史记录', '结果快照 · 查询与追溯'], method: ['计算方法学', '计算边界、公式与判定依据'], database: ['材料与型号识别数据库', '附件材料库 · 牌号规则 · 本地确认记录'] };
    $('#page-title').textContent = titles[view][0]; $('#page-subtitle').textContent = titles[view][1]; $('#breadcrumb-current').textContent = titles[view][0];
    const referenceView = ['history', 'method', 'database'].includes(view);
    $('#product-strip').hidden = referenceView; $('#workflow').hidden = referenceView; $('.heading-actions').hidden = referenceView;
    if (view === 'bom') renderBom(); if (view === 'audit') renderAudit(); if (view === 'history') renderHistory(); if (view === 'method') renderCoefficients();
    if (view === 'database') renderDatabase();
    $('#recognition-summary').hidden = referenceView;
    $('#claim-matrix').hidden = !['overview', 'audit'].includes(view);
    if (view === 'overview') { comparisonChart?.resize(); sourceChart?.resize(); }
    icons();
  }
  function concentration(value) { return state.unit === 'ppm' ? `${format(value, 2)}` : `${format(value / 10000, 2)}%`; }
  function renderOverview() {
    const result = state.result;
    renderClaims();
    const failing = Object.keys(engine.LIMITS).filter(element => result.ppm[element] > engine.LIMITS[element]);
    const maxRatio = Math.max(...Object.keys(engine.LIMITS).map(element => result.ppm[element] / engine.LIMITS[element]));
    const title = { pass: '塑料件通过模板安全筛查', fail: '塑料件卤素含量超出限值', review: '塑料件含量接近限值，请谨慎声明', incomplete: '数据尚未完整，暂不能给出通过结论' }[result.status];
    const detail = { pass: `所有项目处于 80% 安全范围内。产品级结论：${STATUS_LABELS[result.productStatus]}。`, fail: `${failing.map(element => ELEMENT_LABELS[element]).join('、')}超限；最高为标准限值的 ${format(maxRatio, 2)} 倍。请核查高贡献材料及供应商证据。`, review: '至少一项超过 80% 安全线，但未超过标准限值。当前不支持直接作出无卤声明。', incomplete: `${result.missingCount} 行存在缺项或无效值。以下为已知部分的暂计值，不能视为完整产品含量。` }[result.status];
    $('#verdict-banner').className = 'verdict-banner ' + result.status;
    $('#verdict-banner').innerHTML = `<span class="verdict-icon">${icon(result.status === 'pass' ? 'shield-check' : result.status === 'fail' ? 'shield-x' : 'triangle-alert')}</span><div class="verdict-copy"><div class="verdict-title"><h2>${title}</h2>${badge('塑料件 · ' + STATUS_LABELS[result.status], STATUS_COLORS[result.status])}</div><p>${escape(detail)}</p></div><button class="text-button" data-view="audit">查看产品级审核${icon('arrow-right')}</button>`;
    const measured = result.rows.filter(part => part.category === 'plastic' && part.mode === 'known').length;
    $('#metrics').innerHTML = [
      { label: '塑料件已录入质量', value: format(result.plasticMass), unit: 'g', detail: `BOM 已录入质量 ${format(result.totalMass)} g · 不含缺失项/包装`, symbol: 'weight' },
      { label: '纳入计算的塑料件', value: result.plasticCount, unit: '项', detail: `共 ${state.parts.length} 行 BOM · 已知含量 ${measured} 项`, symbol: 'layers-3' },
      { label: result.complete ? '总卤素质量含量' : '总卤素暂计含量', value: format(result.ppm.total / 10000, 2), unit: '%', detail: `标准限值 0.40% · ${format(result.ppm.total, 2)} ppm`, symbol: 'flask-conical', flagged: result.ppm.total > 4000 },
      { label: '可计算质量覆盖率', value: format(result.coverage, 2), unit: '%', detail: `保守估算 ${result.estimatedCount} 项 · 缺项 ${result.missingCount} 行`, symbol: 'scan-line' }
    ].map(metric => `<div class="metric ${metric.flagged ? 'flagged' : ''}"><div class="metric-label">${metric.label}${icon(metric.symbol)}</div><div class="metric-value">${metric.value}<span>${metric.unit}</span></div><div class="metric-detail">${metric.detail}</div></div>`).join('');
    $('#element-readings').innerHTML = Object.keys(engine.LIMITS).map(element => `<div class="element-reading ${result.ppm[element] > engine.LIMITS[element] ? 'danger-reading' : ''}"><span>${ELEMENT_LABELS[element]}</span><strong>${concentration(result.ppm[element])}</strong><small>限值 ${concentration(engine.LIMITS[element])}${state.unit === 'ppm' ? ' ppm' : ''}</small></div>`).join('');
    const sourceCounts = ['known', 'estimated', 'compliant', 'unknown'].map(mode => result.rows.filter(part => part.category === 'plastic' && (part.mode || 'unknown') === mode).length);
    $('#donut-count').textContent = result.plasticCount; $('#coverage-value').textContent = format(result.coverage, 2) + '%'; $('#coverage-progress').value = result.coverage;
    $('#source-legend').innerHTML = ['known', 'estimated', 'compliant', 'unknown'].map((mode, index) => `<div><b class="legend-dot ${MODE_COLORS[mode]}"></b><span>${MODE_LABELS[mode]}</span><strong>${sourceCounts[index]}</strong></div>`).join('');
    renderCharts(sourceCounts);
    const topParts = result.rows.filter(part => part.category === 'plastic' && part.valid && part.totalGrams > 0).sort((first, second) => second.totalGrams - first.totalGrams).slice(0, 5);
    $('#contribution-body').innerHTML = topParts.length ? topParts.map(part => {
      const ratio = result.totalGrams > 0 ? part.totalGrams / result.totalGrams * 100 : 0;
      return `<tr><td><strong>${escape(part.name)}</strong><span class="subtext mono">${escape(part.spn || '未填写 SPN')}</span></td><td>${badge(MODE_LABELS[part.mode], MODE_COLORS[part.mode])}</td><td class="numeric">${format(part.mass, 2)}</td><td class="numeric">${format(part.totalGrams, 2)}</td><td><div class="contribution-track"><div><span style="width:${ratio}%"></span></div><b>${format(ratio, 2)}%</b></div></td><td><button class="icon-button" data-edit-part="${escape(part.id)}" title="编辑零件" aria-label="编辑 ${escape(part.name)}">${icon('arrow-up-right')}</button></td></tr>`;
    }).join('') : '<tr><td colspan="6" class="muted">暂无有卤素质量贡献的已知零件。</td></tr>';
    $('#source-warning').hidden = !state.sourceMismatch; renderDirty(); icons();
  }
  function renderCharts(sourceCounts) {
    const result = state.result; const elements = Object.keys(engine.LIMITS);
    const ratios = elements.map(element => result.ppm[element] / engine.LIMITS[element] * 100);
    const colors = ratios.map(value => value > 100 ? '#c66a60' : value > 80 ? '#c49a46' : '#2aa057');
    const valuesPlugin = { id: 'thresholdLines', afterDatasetsDraw(chart) {
      const { ctx, scales, chartArea } = chart; const limitX = scales.x.getPixelForValue(100);
      ctx.save(); ctx.beginPath(); ctx.strokeStyle = '#d9685c'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.moveTo(limitX, chartArea.top - 3); ctx.lineTo(limitX, chartArea.bottom); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#b3473c'; ctx.font = '600 9px Barlow, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('100% 限值', limitX, chartArea.top - 7); ctx.restore();
      ctx.save();
      chart.getDatasetMeta(0).data.forEach((bar, index) => {
        const ratio = ratios[index];
        const label = format(ratio, 2) + '%';
        const exceed = ratio > 100;
        const beyondLimit = bar.x + 10 + ctx.measureText(label).width > chartArea.right;
        const labelX = beyondLimit ? bar.x - 6 : bar.x + 10;
        ctx.font = exceed ? '700 13px Barlow, sans-serif' : '600 11px Barlow, sans-serif';
        if (exceed) { const tw = ctx.measureText(label).width; ctx.fillStyle = 'rgba(192,57,43,.16)'; ctx.fillRect(labelX - 4, bar.y - 11, tw + 8, 22); }
        ctx.fillStyle = exceed ? '#c0392b' : ratio > 80 ? '#a37a22' : '#2e7d52';
        ctx.textAlign = beyondLimit ? 'right' : 'left';
        ctx.fillText(label, labelX, bar.y + 4);
      }); ctx.restore();
    } };
    comparisonChart?.destroy();
    comparisonChart = new Chart($('#comparison-chart'), { type: 'bar', data: { labels: ['Cl  氯', 'Br  溴', 'F   氟', 'I   碘', 'Σ   总卤素'], datasets: [{ data: ratios, backgroundColor: colors, borderRadius: 3, barThickness: 11, minBarLength: 2 }] }, plugins: [valuesPlugin], options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', animation: { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 500 }, layout: { padding: { right: 16, top: 16, left: 4 } }, plugins: { legend: { display: false }, tooltip: { backgroundColor: '#294331', padding: 10, callbacks: { label: context => `${format(result.ppm[elements[context.dataIndex]], 2)} ppm · ${format(result.ppm[elements[context.dataIndex]] / 10000, 2)}%` } } }, scales: { x: { min: 0, max: Math.max(130, Math.ceil(Math.max(...ratios) / 100) * 100 + 50), border: { display: false }, grid: { color: '#e5ece7', drawTicks: false }, ticks: { maxTicksLimit: 6, color: '#96a299', font: { family: 'Barlow', size: 9 }, padding: 9, callback: value => value + '%' } }, y: { border: { display: false }, grid: { display: false }, ticks: { color: '#62786b', font: { family: 'Barlow, Microsoft YaHei', size: 10 }, padding: 10 } } } } });
    sourceChart?.destroy();
    sourceChart = new Chart($('#source-chart'), { type: 'doughnut', data: { labels: ['已知含量', '保守估算', 'EN50642 声明', '待补全'], datasets: [{ data: sourceCounts.some(Boolean) ? sourceCounts : [0, 0, 0, 1], backgroundColor: ['#498a98', '#37a35b', '#d2ab5a', '#dbe3dd'], borderColor: '#f5f7f6', borderWidth: 4, hoverOffset: 3, borderRadius: 3 }] }, options: { cutout: '79%', responsive: true, maintainAspectRatio: false, animation: { duration: 400 }, plugins: { legend: { display: false }, tooltip: { enabled: sourceCounts.some(Boolean), backgroundColor: '#294331', callbacks: { label: context => `${context.label}：${context.raw} 项` } } } } });
  }
  function calculate() {
    state.methodVersion = engine.version;
    state.result = engine.calculate(state.parts, state.audits); state.calculatedAt = new Date().toISOString(); state.dirty = false; state.savedId = null;
    renderProduct(); renderOverview(); navigate('overview'); toast(`计算完成：塑料件${STATUS_LABELS[state.result.status]}，产品级${STATUS_LABELS[state.result.productStatus]}。`);
  }
  function renderClaims() {
    const result = state.dirty ? engine.calculate(state.parts, state.audits) : state.result;
    $('#claim-matrix').innerHTML = `<div class="section-heading"><div><h2>可支持的声明范围</h2><p>① 塑料及 PVC　② 线缆　③ PCB　④ 耗材　⑤ 电子件　⑥ 卤化气液</p></div>${state.dirty ? badge('未保存的预览', 'amber') : badge('独立判定', 'neutral')}</div><div class="claim-grid">${result.claims.map(claim => `<article class="claim-item claim-${claim.id}"><div class="condition-dots">${claim.conditions.map(condition => `<span class="condition-dot condition-${condition}" title="条件 ${condition}：${STATUS_LABELS[result.conditions[condition]]}">${condition}</span>`).join('')}</div><h3>${claim.label}</h3><div>${badge(claim.status === 'pass' ? '可支持此范围声明' : claim.status === 'fail' ? '当前不符合' : '条件待确认', STATUS_COLORS[claim.status])}</div><p>${claim.pending.length ? '未满足条件：' + claim.pending.join('、') : '所需条件均通过；不扩展到其他范围'}</p></article>`).join('')}</div>`;
  }
  function renderRecognition() {
    const counts = Object.fromEntries([...new Set(state.parts.map(part => part.category))].map(category => [category, state.parts.filter(part => part.category === category).length]));
    const pending = state.parts.filter(part => part.category !== 'packaging' && !engine.evaluatePart(part).valid).length;
    $('#recognition-summary').innerHTML = `<div class="recognition-heading"><span>${icon('scan-search')}BOM 自动识别</span><div><button class="text-button" id="show-pending">待确认 ${pending} 项${icon('arrow-right')}</button><button class="text-button" data-view="database">识别数据库${icon('database')}</button></div></div><div class="recognition-counts">${Object.entries(counts).map(([category, count]) => `<span>${escape(workbook.categories[category] || '类别未确认')}<strong>${count}</strong></span>`).join('')}</div>`;
    const massAlerts=state.parts.filter(part=>part.engineering?.massIssue && !engine.evaluatePart(part).valid);
    if (massAlerts.length) $('#recognition-summary').insertAdjacentHTML('beforeend',`<p class="mass-alert">重量异常待确认：${massAlerts.map(part=>`${escape(part.spn)}（源行 ${escape(part.engineering.row)}，原值 ${format(part.engineering.reportedMass)} g）`).join('；')}。异常值未计入质量汇总。</p>`);
    $('#show-pending').onclick = () => { $('#bom-filter').value = 'invalid'; $('#bom-search').value = ''; state.page = 1; navigate('bom'); };
    icons();
  }
  function setupRecognitionUI() {
    $('.main-nav').insertAdjacentHTML('beforeend', `<button data-view="database" class="nav-item">${icon('database')}<span>识别数据库</span></button>`);
    $('#workflow').insertAdjacentHTML('afterend', '<section id="recognition-summary" class="recognition-summary"></section><section id="claim-matrix" class="claim-matrix"></section>');
    $('#view-history').insertAdjacentHTML('afterend', `<div class="view" id="view-database" hidden><div class="section-heading"><div><h2>可追溯的材料与型号记录</h2><p id="database-stats"></p></div><button class="button secondary compact" id="reidentify">${icon('refresh-cw')}重新识别当前 BOM</button></div><div class="filter-bar"><label class="search-field">${icon('search')}<input type="search" id="database-search" placeholder="材料号、牌号、型号或阻燃剂" aria-label="搜索识别数据库"></label><select id="database-filter" aria-label="识别数据库来源"><option value="all" selected>全部内置材料库</option><option value="sample">新 BOM 材料 / 型号</option><option value="custom">本地确认记录</option></select></div><div id="database-content"></div><div class="table-footer"><span id="database-count"></span><div class="pagination"><button class="icon-button" id="database-prev" title="上一页" aria-label="数据库上一页">${icon('chevron-left')}</button><span id="database-page"></span><button class="icon-button" id="database-next" title="下一页" aria-label="数据库下一页">${icon('chevron-right')}</button></div></div></div>`);
    $('#database-search').oninput = () => { databasePage = 1; renderDatabase(); }; $('#database-filter').onchange = () => { databasePage = 1; renderDatabase(); };
    $('#database-prev').onclick = () => { databasePage--; renderDatabase(); }; $('#database-next').onclick = () => { databasePage++; renderDatabase(); };
    $('#view-database .section-heading').insertAdjacentHTML('afterend', `<div class="rule-actions"><button class="button secondary compact" id="backup-rules">${icon('download')}备份确认记录</button><button class="button secondary compact" id="restore-rules">${icon('upload')}导入确认记录</button><input type="file" id="rules-file" accept=".json" hidden></div>`);
    $('#backup-rules').onclick = () => workbook.download(new Blob([JSON.stringify({format:'halogen-recognition-database',version:1,records:recognitionRules},null,2)],{type:'application/json'}),'Halogen_Recognition_Database.json');
    $('#restore-rules').onclick = () => { $('#rules-file').value=''; $('#rules-file').click(); };
    $('#rules-file').onchange = async () => {
      const file = $('#rules-file').files[0]; if (!file) return;
      try {
        if (file.size>5*1024*1024) throw new Error('数据库备份超过 5 MB。');
        const backup = JSON.parse(await file.text());
        if (backup.format!=='halogen-recognition-database' || backup.version!==1 || !Array.isArray(backup.records) || backup.records.length>1000 || !backup.records.every(recognition.validRule)) throw new Error('存在不完整或标准不符的记录，未导入。');
        confirmAction('导入确认记录', `将合并 ${backup.records.length} 条记录。同一型号、版本和材料组合的本地记录优先保留。`, () => {
          try { const keys=new Set(recognitionRules.map(ruleKey)); const additions=backup.records.filter(rule=>!keys.has(ruleKey(rule))).map(rule=>({...rule,id:crypto.randomUUID()})); persistRules([...recognitionRules,...additions]); renderDatabase(); toast(`已导入 ${additions.length} 条确认记录。`); } catch(error) { toast(error.message,true); }
        }, '合并记录');
      } catch(error) { toast(error.message,true); }
    };
    $('#reidentify').onclick = () => confirmAction('重新识别当前 BOM', '将按最新识别数据库替换自动分类和材料模型；未记录到数据库的手工修改可能被替换，审核证据需重新核对。', () => { state.parts = state.parts.map(part => part.engineering ? recognition.recognize(part, recognitionRules) : part); state.audits = recognition.suggestAudits(state.parts); markDirty(); renderRecognition(); toast('已重新识别，请计算并复核声明条件。'); }, '重新识别');
    $('#load-example').insertAdjacentHTML('beforebegin', `<button class="button secondary compact" id="load-engineering-example">${icon('scan-search')}工程 BOM 示例</button>`);
    $('#load-engineering-example').onclick = () => confirmAction('载入工程 BOM 示例', '将替换当前工作区为 C25N45B250，并应用当前识别数据库。', () => { loadEngineering(workbook.engineeringStructure(engineeringData.sheet), engineeringData.source, true); calculate(); }, '载入并计算');
    $('.method-heading .badge').textContent = 'METHOD v1.1.0';
    $('#method-scope p:last-child').textContent = '工程 BOM：以 Structure Level 关联 engineering/catalog 物理零件和其下级 raw material；装配层、原材料行及处理行不重复计重。默认逐层乘父级数量，也可选择数量已展开。Mass 的数字默认 g，带 g/kg/mg 的文本自动转换。普通 BOM 仍使用原字段映射。';
    $('#method-data').insertAdjacentHTML('beforeend', '<p>自动识别优先使用有证据的本地精确型号记录（含版本及材料指纹），其次匹配附件材料号，再按牌号和 FR 代码估算。FR(16)/FR(17) 按模板 Br 9% 保守估算；未标明 FR 时默认按 No FR（0%）处理，需核实实际阻燃体系。未知 FR 代码、色母粒比例及冲突材料保持待确认。RoHS Verdict 仅保存为来源信息，绝不作为无卤证据。</p>');
    $('#method-claim p').innerHTML = '<strong>Halogen plastics free：</strong>① 塑料含量通过及无 PVC + ⑥ 无卤化气体/液体。<br><strong>Halogen free plastic parts & cables product：</strong>① + ② 线缆验证 + ⑥。<br><strong>Halogen free product：</strong>① + ② + ③ PCB + ④ 电子耗材 + ⑤ 电子元件 + ⑥。';
  }
  function renderDatabase() {
    const query = $('#database-search').value.toLowerCase().trim(); const filter = $('#database-filter').value;
    const sampleNumbers = new Set(engineeringData.materials.map(raw => raw.number));
    const rows = engineeringData.materials.map(raw => ({ number: raw.number, name: raw.name, revision: raw.revision, ...recognition.materialInfo(raw), source: '新 BOM 原材料', custom: false }));
    rows.push(...engineeringData.catalog.map(raw => { const part = recognition.recognize({spn:raw.number,name:raw.name,mode:'unknown',values:{},quantity:1,unitMass:1,engineering:{rawMaterials:[]}}); return {...raw,category:part.category,source:'新 BOM 目录零件',basis:part.recognition.basis,custom:false}; }));
    if (filter === 'all') rows.push(...materialsDb.records.filter(raw => !sampleNumbers.has(raw.spn)).map(raw => ({number:raw.spn,name:raw.name || '材料数据库记录',category:'plastic',resin:raw.resin,fr:raw.fr,additive:raw.additive,source:'材料数据库.xlsx',basis:`材料号精确匹配 · RoHS ${raw.rohs || '-'}`,custom:false})));
    rows.push(...recognitionRules.map(rule => ({...rule,source:'本地确认记录',basis:rule.evidence,custom:true})));
    const filtered = rows.filter(row => (filter !== 'custom' || row.custom) && `${row.number} ${row.name} ${row.fr} ${row.resin}`.toLowerCase().includes(query));
    const pages = Math.max(1, Math.ceil(filtered.length / 25)); databasePage = Math.min(Math.max(databasePage,1),pages);
    $('#database-stats').textContent = `新 BOM ${engineeringData.materials.length} 个材料号 · ${engineeringData.catalog.length} 个目录型号 · 材料数据库 ${materialsDb.records.length} 条 · 本地记录 ${recognitionRules.length} 条`;
    $('#database-content').innerHTML = `<div class="table-scroll"><table class="data-table database-table"><thead><tr><th>材料号 / 型号</th><th>牌号 / 类别</th><th>树脂与阻燃剂模型</th><th>来源与证据</th><th></th></tr></thead><tbody>${filtered.slice((databasePage-1)*25,databasePage*25).map(row=>`<tr><td><strong>${escape(row.number)}</strong><span class="subtext">版本 ${escape(row.revision || '-')}</span></td><td>${escape(row.name || '')}<span class="subtext">${escape(workbook.categories[row.category] || '待确认')}</span></td><td>${escape(row.resin || '-')}<span class="subtext">${escape(row.fr || '-')}</span></td><td>${badge(row.source,row.custom?'blue':'neutral')}<span class="subtext">${escape(row.basis || '')}</span></td><td>${row.custom?`<button class="icon-button" data-delete-rule="${escape(row.id)}" title="删除确认记录" aria-label="删除确认记录">${icon('trash-2')}</button>`:''}</td></tr>`).join('') || '<tr><td colspan="5">暂无匹配记录。可在零件编辑页确认材料或型号并记录依据。</td></tr>'}</tbody></table></div>`;
    $('#database-count').textContent = `共 ${filtered.length} 条`; $('#database-page').textContent = `${databasePage} / ${pages}`; $('#database-prev').disabled = databasePage===1; $('#database-next').disabled = databasePage===pages; icons();
  }
  function ruleKey(rule) { return JSON.stringify([String(rule.number).toUpperCase(),String(rule.revision || '').toUpperCase(),rule.fingerprint]); }
  function persistRules(next) {
    if (!rulesStorageReadable) throw new Error('现有数据库无法读取，已保护原数据。请先导出/修复浏览器存储再保存。');
    if (next.length>1000 || !next.every(recognition.validRule)) throw new Error('确认记录无效或超过 1,000 条。');
    try { localStorage.setItem(RULES_KEY,JSON.stringify(next)); } catch { throw new Error('本地数据库存储失败，未记录该型号。'); }
    recognitionRules = next;
  }
  function loadEngineering(structure, filename, sample = false) {
    if (structure.mixedAssemblies.length) throw new Error('装配层同时包含原材料和子零件，无法避免重复计重，请确认行：' + structure.mixedAssemblies.join(', '));
    const result = recognition.analyze(structure, recognitionRules);
    state.parts = result.parts; state.audits = result.audits; state.source = filename; state.sample = sample; state.sourceMismatch = false;
    state.product = {name:structure.root?.name || filename,reference:structure.root?.number || filename.replace(/^BOM_/i,'').replace(/\.xlsx?$/i,''),bom:structure.root?.number || '',reviewer:'Tony ZHUANG',notes:'工程 BOM 自动识别；缺失数据与型号无卤证据需复核。'};
    state.page = 1; $('#bom-search').value = ''; $('#bom-filter').value = 'all'; markDirty();
  }
  function showEngineeringMapping() {
    openModal('工程 BOM 已自动识别', `<div class="import-original"><div><strong>Engineering Part → Raw Material</strong><p>${escape(importState.filename)}</p></div>${badge('专用层级识别','green')}</div><label class="form-field"><span>Quantity 列口径</span><select id="engineering-quantity"><option value="relative">相对于父项（逐层相乘）</option><option value="expanded">已对整机展开（不乘父级）</option></select></label><div id="engineering-preview"></div><div class="notice warning">${icon('info')}<span>工程 Mass 数字按 g 读取；Raw Material 的 as needed/Gram 不当作零件数量。RoHS 合规不视为无卤。导入会替换当前工作区并重置审核证据。</span></div><div class="modal-footer"><button class="button secondary" data-close>取消</button><button class="button primary" id="import-engineering">${icon('scan-search')}导入并计算</button></div>`,true,'AUTOMATIC BOM RECOGNITION');
    const preview = () => { const structure = workbook.engineeringStructure(importState.engineeringSheet,{quantityBasis:$('#engineering-quantity').value}); const result = recognition.analyze(structure,recognitionRules); $('#engineering-preview').innerHTML = `<div class="recognition-counts">${Object.entries(result.categories).map(([category,count])=>`<span>${escape(workbook.categories[category] || '类别待确认')}<strong>${count}</strong></span>`).join('')}</div><p class="form-hint">识别 ${result.parts.length} 个物理零件，排除 ${result.assemblies} 个装配层、${result.materialRows} 个原材料行、${result.treatmentRows} 个处理行。${result.pending} 项需补充类别、质量或材料依据。</p>`; return structure; };
    preview(); $('#engineering-quantity').onchange = preview;
    $('#import-engineering').onclick = () => { try { const structure = preview(); loadEngineering(structure,importState.filename); closeModal(); calculate(); } catch(error) { toast(error.message,true); } };
  }
  function renderBom() {
    const search = $('#bom-search').value.trim().toLowerCase(); const filter = $('#bom-filter').value;
    const evaluated = state.parts.map(engine.evaluatePart);
    const filtered = evaluated.filter(part => `${part.name} ${part.spn} ${part.material}`.toLowerCase().includes(search) && (filter === 'all' || filter === 'plastic' && part.category === 'plastic' || filter === 'invalid' && !part.valid || filter === 'excluded' && part.category !== 'plastic' || filter === part.mode));
    const pages = Math.max(1, Math.ceil(filtered.length / 15)); state.page = Math.min(state.page, pages);
    $('#bom-count').textContent = state.parts.length; $('#bom-source').textContent = state.source || '手工录入'; $('#bom-filter-count').textContent = `${filtered.length} / ${state.parts.length} 行`;
    $('#bom-body').innerHTML = filtered.length ? filtered.slice((state.page - 1) * 15, state.page * 15).map(part => `<tr><td class="muted">${state.parts.findIndex(item => item.id === part.id) + 1}</td><td><strong>${escape(part.name || '未填写名称')}</strong><span class="subtext mono">${escape(part.spn || '未填写 SPN')}</span></td><td><strong>${escape(part.material || '未填写材料')}</strong><span class="subtext">${escape(workbook.categories[part.category] || '类别未识别')}</span></td><td class="numeric">${escape(part.quantity ?? '—')}</td><td class="numeric">${format(part.mass, 2)}</td><td>${part.category === 'plastic' ? badge(MODE_LABELS[part.mode] || '待补全', MODE_COLORS[part.mode]) : badge('不计入塑料分母')}</td>${engine.ELEMENTS.map(element => `<td class="numeric">${part.category !== 'plastic' || part.ppm[element] === null || part.ppm[element] === undefined ? '—' : format(part.ppm[element], 2)}</td>`).join('')}<td>${badge(part.valid ? '完整' : '待补全', part.valid ? 'green' : 'amber')}</td><td><button class="icon-button" data-edit-part="${escape(part.id)}" title="编辑零件" aria-label="编辑 ${escape(part.name)}">${icon('pencil')}</button><button class="icon-button" data-delete-part="${escape(part.id)}" title="删除零件" aria-label="删除 ${escape(part.name)}">${icon('trash-2')}</button></td></tr>`).join('') : '<tr><td colspan="12" class="muted">没有符合筛选条件的零件。</td></tr>';
    const plastics = evaluated.filter(part => part.category === 'plastic'); $('#bom-summary').textContent = `${plastics.length} 项塑料件 · ${format(plastics.reduce((sum, part) => sum + part.mass, 0))} g · ${evaluated.filter(part => !part.valid).length} 行待补全`;
    $$('#bom-body tr').forEach(row=>{
      const part=state.parts.find(item=>item.id===row.querySelector('[data-edit-part]')?.dataset.editPart);
      if (!part?.recognition) return;
      const cell=row.cells[5];
      if (cell) cell.insertAdjacentHTML('beforeend',`<span class="model-summary">${escape([part.recognition.family,part.fr].filter(Boolean).join(' · ') || part.recognition.basis)}</span>`);
    });
    $('#page-indicator').textContent = `${state.page} / ${pages}`; $('#previous-page').disabled = state.page <= 1; $('#next-page').disabled = state.page >= pages; icons();
  }
  function renderAudit() {
    const result = engine.calculate(state.parts, state.audits);
    const completed = engine.AUDIT_KEYS.filter(key => ['pass', 'fail'].includes(state.audits[key]?.status) && state.audits[key]?.evidence?.trim()).length;
    const pvcOverride = state.audits.pvc?.status || (result.pvcPresent ? 'fail' : 'pass');
    const pvcText = result.pvcStatus === 'fail' ? '检出 PVC，不能通过' : result.pvcStatus === 'pass' ? '未检出 PVC，默认通过' : 'PVC 待审核';
    const pvcColor = result.pvcStatus === 'fail' ? 'red' : result.pvcStatus === 'pass' ? 'green' : 'amber';
    $('#audit-progress').textContent = `${completed} / 5 项证据已记录`;
    $('#audit-summary').innerHTML = icon(result.productStatus === 'pass' ? 'shield-check' : 'info') + `<span><strong>产品级结论：${STATUS_LABELS[result.productStatus]}</strong> · ${CLAIM_LABELS[result.claim]}${state.dirty ? ' · 数据已修改，请更新审核结论' : ''}</span>`;
    $('#audit-list').innerHTML = `<div class="audit-item"><span class="audit-item-number">01</span><div class="audit-item-title"><h3>塑料件卤素含量计算</h3><p>IEC 63355 · 四元素质量加权 · 条件 A + 条件 B</p><p>条件 A：塑料件按质量加权计算无卤（金属件不计入）；条件 B：无 PVC 零件。范围外：PCB、电子元件、线缆。PVC 未发现材料牌号时默认通过，可手动调整。</p></div><div>${badge(STATUS_LABELS[result.conditions[1] || result.status], STATUS_COLORS[result.conditions[1] || result.status])}<p class="form-hint">Cl ${format(result.ppm.cl / 10000, 2)}% · Br ${format(result.ppm.br / 10000, 2)}%<br>F ${format(result.ppm.f / 10000, 2)}% · I ${format(result.ppm.i / 10000, 2)}%</p><div class="pvc-line">${badge(pvcText, pvcColor)}<select data-pvc-override aria-label="PVC 核查结论">${[['pass', 'PASS · 未发现 PVC'], ['fail', 'FAIL · 检出 PVC'], ['pending', '待审核']].map(([value, label]) => `<option value="${value}" ${pvcOverride === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div></div></div>` + AUDIT_ITEMS.map((item, index) => {
      const audit = state.audits[item.key] || { status: 'pending', evidence: '' };
      return `<div class="audit-item"><span class="audit-item-number">0${index + 2}</span><div class="audit-item-title"><h3>${item.title}</h3><p>${item.standard}</p><p>${item.description}</p></div><div class="audit-item-controls"><select data-audit-status="${item.key}" data-status="${audit.status}" aria-label="${item.title}结论">${[['pending', '待审核'], ['pass', 'PASS'], ['fail', 'FAIL']].map(([value, label]) => `<option value="${value}" ${audit.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select><textarea data-audit-evidence="${item.key}" maxlength="2000" placeholder="报告编号、供应商声明，或不适用的核查依据" aria-label="${item.title}证据">${escape(audit.evidence)}</textarea></div></div>`;
    }).join(''); icons();
  }
  function editProduct() {
    const field = (key, label, required = false) => `<label class="form-field"><span>${label}</span><input name="${key}" value="${escape(state.product[key])}" maxlength="200" ${required ? 'required' : ''}></label>`;
    openModal('产品与审核信息', `<form id="product-form"><div class="form-grid">${field('name', '产品名称 *', true)}${field('reference', '商业型号')}${field('bom', 'BOM 编号')}${field('reviewer', '审核人')}<label class="form-field full"><span>审核备注</span><textarea name="notes" maxlength="2000">${escape(state.product.notes || '')}</textarea></label></div><div class="modal-footer"><button type="button" class="button secondary" data-close>取消</button><button class="button primary" type="submit">${icon('check')}保存信息</button></div></form>`, false, 'PRODUCT INFORMATION');
    $('#product-form').onsubmit = event => { event.preventDefault(); const values = new FormData(event.currentTarget); state.product = Object.fromEntries(['name', 'reference', 'bom', 'reviewer', 'notes'].map(key => [key, String(values.get(key) || '').trim()])); markDirty(); closeModal(); };
  }
  function editPart(id) {
    const existing = state.parts.find(part => part.id === id);
    const part = existing || { id: crypto.randomUUID(), name: '', spn: '', material: '', category: 'plastic', quantity: 1, unitMass: null, mode: 'unknown', values: { cl: null, br: null, f: null, i: null }, resin: '', fr: '', additive: '', evidence: '' };
    const input = (key, label, type = 'text') => `<label class="form-field"><span>${label}</span><input name="${key}" type="${type}" value="${escape(part[key])}" ${type === 'number' ? 'min="0.000000001" step="any"' : 'maxlength="500"'} ${key === 'name' ? 'required' : ''}></label>`;
    const select = (key, label, options) => `<label class="form-field"><span>${label}</span><select name="${key}">${Object.entries(options).map(([value, text]) => `<option value="${escape(value)}" ${part[key] === value ? 'selected' : ''}>${escape(text)}</option>`).join('')}</select></label>`;
    openModal(existing ? '编辑零件' : '新增 BOM 零件', `<form id="part-form"><div class="form-grid">${input('name', '零件名称 *')}${input('spn', '物料编码 / SPN')}${input('material', '材料牌号')}${select('category', '零件类别', { ...workbook.categories, unmapped: '类别未识别（待确认）' })}${input('quantity', '整机展开数量 *', 'number')}${input('unitMass', '单件质量 / g *', 'number')}<div class="form-field full"><button type="button" class="text-button" id="match-material">${icon('scan-search')}按 SPN 匹配附件材料库</button><small id="material-match-status"></small></div><div class="form-section-title">卤素含量依据</div>${select('mode', '数据依据', MODE_LABELS)}<div class="form-field"><span>浓度单位</span><select id="part-unit"><option value="ppm">ppm（mg/kg）</option><option value="percent">质量百分比 %</option></select></div><div class="concentration-inputs" id="known-inputs">${engine.ELEMENTS.map(element => `<label class="form-field"><span>${ELEMENT_LABELS[element]} * <b class="unit-label">/ ppm</b></span><input name="value-${element}" type="number" min="0" max="1000000" step="any" placeholder="未知请留空" value="${escape(part.values?.[element])}"></label>`).join('')}</div><div class="form-grid form-field full" id="estimated-inputs">${select('resin', '树脂 *', { '': '请选择', ...Object.fromEntries(Object.keys(engine.RESINS).map(value => [value, value])) })}${select('fr', '阻燃剂 *', { '': '请选择', ...Object.fromEntries(Object.keys(engine.RETARDANTS).map(value => [value, value])) })}${select('additive', '添加剂 *', { '': '请选择', ...Object.fromEntries(Object.keys(engine.ADDITIVES).map(value => [value, value])) })}</div><p class="form-hint form-field full" id="mode-hint"></p><label class="form-field full"><span>数据证据 / 来源</span><textarea name="evidence" maxlength="2000" placeholder="检测报告编号、材料数据库版本或供应商声明">${escape(part.evidence)}</textarea></label></div><div class="form-error" id="part-error" role="alert"></div><div class="modal-footer"><button type="button" class="button secondary" data-close>取消</button><button class="button primary" type="submit">${icon('check')}保存零件</button></div></form>`, false, 'BOM COMPONENT');
    const form = $('#part-form'); let previousUnit = 'ppm';
    const metadata = part.recognition || {};
    if (part.engineering || part.recognition) form.insertAdjacentHTML('afterbegin', `<div class="recognition-detail"><strong>${escape(metadata.basis || '工程零件')}</strong><br>原行 ${escape(part.engineering?.row || '-')} · 版本 ${escape(part.engineering?.revision || '-')}<br>原材料：${escape((part.engineering?.rawMaterials || []).map(raw=>`${raw.number} ${raw.name}`).join(' | ') || '未提供')}<br>${escape((metadata.issues || []).join('；'))}</div>`);
    $('#part-error').insertAdjacentHTML('beforebegin', `<div class="evidence-fields"><label class="form-field"><span>PVC 材料身份</span><select name="pvc">${[['unknown','待确认'],['no','非 PVC'],['yes','含 PVC']].map(([key,label])=>`<option value="${key}" ${metadata.pvc===key?'selected':''}>${label}</option>`).join('')}</select></label><label class="form-field"><span>型号无卤证据结论（非塑料项）</span><select name="halogenStatus">${[['pending','待确认'],['pass','PASS · 有专用证据'],['fail','FAIL']].map(([key,label])=>`<option value="${key}" ${metadata.halogenStatus===key?'selected':''}>${label}</option>`).join('')}</select></label><label class="form-field full"><span>证据适用标准（电子件 JS709C / IEC 61249-2-21 等）</span><input name="standard" maxlength="200" value="${escape(metadata.standard || '')}" placeholder="RoHS / 无铅不能替代无卤标准"></label></div><label class="checkbox-field"><input type="checkbox" name="remember"><span>记住此物料/型号判定，按版本和原材料组合自动复用（须填写证据）</span></label>`);
    const modeVisibility = () => { const mode = form.elements.mode.value; const plastic = form.elements.category.value === 'plastic'; $('#known-inputs').hidden = !plastic || mode !== 'known'; $('#estimated-inputs').hidden = !plastic || mode !== 'estimated'; $('#part-unit').disabled = !plastic || mode !== 'known'; $('#mode-hint').textContent = !plastic ? '此类别不进入塑料质量分母；相关合规证据在产品级审核中记录。' : mode === 'compliant' ? '按附件声明上限计算：Cl/Br 各 1,350 ppm，F/I 各 2,700 ppm，总量独立取 3,600 ppm。' : mode === 'estimated' ? '按树脂 + 阻燃剂 + 添加剂的模板系数估算，不代表检测实测值。' : mode === 'known' ? '四项须全部填写，确认为零时请显式输入 0；留空将标记待补全。' : '数据未知，不会作为零含量或合格零件处理。'; };
    form.elements.mode.onchange = modeVisibility; form.elements.category.onchange = modeVisibility; modeVisibility();
    $('#part-unit').onchange = () => { const next = $('#part-unit').value; engine.ELEMENTS.forEach(element => { const inputElement = form.elements['value-' + element]; const value = engine.number(inputElement.value); if (value !== null) inputElement.value = String(previousUnit === 'ppm' && next === 'percent' ? value / 10000 : previousUnit === 'percent' && next === 'ppm' ? value * 10000 : value); inputElement.max = next === 'ppm' ? '1000000' : '100'; }); previousUnit = next; $$('.unit-label').forEach(element => { element.textContent = '/ ' + (next === 'ppm' ? 'ppm' : '%'); }); };
    $('#match-material').onclick = () => { const matched = workbook.findMaterial(form.elements.spn.value); if (!matched) { $('#material-match-status').textContent = '未找到唯一匹配，请手工确认；不会自动设为零。'; return; } ['resin', 'fr', 'additive'].forEach(key => { form.elements[key].value = matched[key] || ''; }); if (form.elements.mode.value !== 'known') form.elements.mode.value = 'estimated'; $('#material-match-status').textContent = '已匹配附件 Plastics 数据库，请核对材料模型。'; modeVisibility(); };
    form.onsubmit = event => {
      event.preventDefault(); const values = new FormData(form); const updated = { id: part.id, engineering: part.engineering ? structuredClone(part.engineering) : undefined };
      ['name', 'spn', 'material', 'category', 'mode', 'resin', 'fr', 'additive', 'evidence'].forEach(key => { updated[key] = String(values.get(key) || '').trim(); });
      updated.quantity = engine.number(values.get('quantity')); updated.unitMass = engine.number(values.get('unitMass'));
      updated.values = Object.fromEntries(engine.ELEMENTS.map(element => { const value = engine.number(values.get('value-' + element)); return [element, value === null ? null : value * ($('#part-unit').value === 'percent' ? 10000 : 1)]; }));
      updated.recognition = {...metadata,source:'manual',basis:'人工确认（原材料关联已保留）',pvc:String(values.get('pvc')),halogenStatus:String(values.get('halogenStatus')),standard:String(values.get('standard') || '').trim(),evidence:updated.evidence,issues:[]};
      const rule = {id:crypto.randomUUID(),number:updated.spn,name:updated.name,revision:updated.engineering?.revision || '',fingerprint:recognition.fingerprint(updated),category:updated.category,mode:updated.mode,values:updated.values,resin:updated.resin,fr:updated.fr,additive:updated.additive,pvc:updated.recognition.pvc,halogenStatus:updated.recognition.halogenStatus,standard:updated.recognition.standard,evidence:updated.evidence,updatedAt:new Date().toISOString()};
      if (updated.recognition.halogenStatus==='pass' && ['electronic','pcb','cable','consumable'].includes(updated.category) && !recognition.validRule(rule)) { $('#part-error').textContent='PASS 必须有型号证据及对应无卤标准；RoHS、无铅或 V0 不能替代。'; return; }
      const evaluated = engine.evaluatePart(updated);
      if (evaluated.errors.includes('concentration-sum')) { $('#part-error').textContent = '四种元素含量合计不能超过 100%。'; return; }
      if (values.get('remember')) {
        if (!recognition.validRule(rule)) { $('#part-error').textContent='记录前须填写物料号、明确类别与证据；含量/模型必须有效。'; return; }
        try { persistRules([...recognitionRules.filter(item=>ruleKey(item)!==ruleKey(rule)),rule]); updated.recognition.ruleId=rule.id; } catch(error) { $('#part-error').textContent=error.message; return; }
      }
      if (existing) state.parts[state.parts.findIndex(item => item.id === id)] = updated; else state.parts.push(updated);
      markDirty(); closeModal(); renderBom(); toast(evaluated.valid ? '零件已保存，请重新计算。' : '零件已保存为待补全，请补齐必填数据。');
    };
  }
  function importDialog() {
    openModal('导入产品 BOM', `<div class="import-dropzone" id="dropzone" role="button" tabindex="0" aria-label="选择 BOM 文件">${icon('file-up')}<strong>选择文件，或拖放至此处</strong><span>XLSX / XLS / CSV · 最大 25 MB</span><button class="button primary compact" type="button" id="choose-bom">${icon('folder-open')}选择 BOM 文件</button></div><div class="import-meta"><span>支持工程 BOM 及原始审核模板直接导入</span></div><div class="notice neutral">${icon('lock-keyhole')}<span>文件只在本机浏览器解析，不上传至服务器。</span></div><div class="form-error" id="import-error" role="alert"></div>`, false, 'IMPORT PRODUCT BOM');
    const pick = () => { $('#bom-file').value = ''; $('#bom-file').click(); };
    $('#choose-bom').onclick = event => { event.stopPropagation(); pick(); }; $('#dropzone').onclick = pick;
    $('#dropzone').onkeydown = event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); pick(); } };
    $('#dropzone').ondragover = event => { event.preventDefault(); $('#dropzone').classList.add('dragover'); };
    $('#dropzone').ondragleave = () => $('#dropzone').classList.remove('dragover');
    $('#dropzone').ondrop = event => { event.preventDefault(); if (event.dataTransfer.files[0]) prepareImport(event.dataTransfer.files[0]); };
  }
  async function prepareImport(file) {
    try {
      toast('正在识别工作表和 BOM 字段…'); importState = await workbook.read(file);
      if (importState.engineering) { showEngineeringMapping(); return; }
      const candidates = importState.sheets.map((sheet, index) => ({ index, score: workbook.findHeader(sheet.rows).score })); candidates.sort((first, second) => second.score - first.score);
      importState.sheetIndex = candidates[0]?.index || 0; showMapping();
    } catch (error) { const field = $('#import-error'); if (field) field.textContent = error.message; toast('导入失败：' + error.message, true); }
  }
  function showMapping() {
    const sheet = importState.sheets[importState.sheetIndex]; const header = workbook.findHeader(sheet.rows); importState.header = header;
    const massHeader = String(sheet.rows[header.row]?.[header.mapping.unitMass] || '');
    openModal('确认 BOM 字段映射', `${importState.original ? `<div class="import-original"><div><strong>已识别原始 Halogen 审核模板</strong><p>Calculation 工作表 · ${importState.original.length} 个塑料件 · 已识别质量与四元素输入列</p></div><button class="button primary compact" id="use-original">${icon('file-check-2')}按审核模板导入</button></div>` : ''}<div class="import-controls"><label class="form-field"><span>工作表</span><select id="import-sheet">${importState.sheets.map((item, index) => `<option value="${index}" ${index === importState.sheetIndex ? 'selected' : ''}>${escape(item.name)}</option>`).join('')}</select></label><label class="form-field"><span>表头所在行</span><input id="import-header" type="number" min="1" max="${Math.min(sheet.rows.length, 100)}" value="${header.row + 1}"></label><label class="form-field"><span>质量单位</span><select id="import-mass-unit"><option value="g">g</option><option value="kg" ${/kg/i.test(massHeader) ? 'selected' : ''}>kg</option><option value="mg" ${/mg/i.test(massHeader) ? 'selected' : ''}>mg</option></select></label><label class="form-field"><span>质量口径</span><select id="import-mass-basis"><option value="unit">单件质量 × 数量</option><option value="total" ${/total|总|整行/i.test(massHeader) ? 'selected' : ''}>整行总质量（已含数量）</option></select></label><label class="form-field"><span>四元素含量单位</span><select id="import-concentration"><option value="auto">按表头 / Excel 格式识别</option><option value="ppm">ppm / mg/kg</option><option value="percent">百分数（0.15 表示 0.15%）</option><option value="fraction">质量分数（0.0015 = 0.15%）</option><option value="grams">整行元素质量 / g</option></select></label><label class="form-field"><span>未映射类别时按</span><select id="import-default-category"><option value="unmapped" selected>待确认（推荐）</option>${Object.entries(workbook.categories).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></label></div><div class="mapping-grid" id="mapping-grid"></div><div class="notice warning">${icon('info')}<span>无单位列按 ppm；未知值留空，不替换为 0。层级列须为整数，且叶节点数量须已对整机展开。只有明确映射层级才会排除父装配行。</span></div><div class="import-preview" id="import-preview"></div><div class="form-error" id="mapping-error" role="alert"></div><div class="modal-footer"><span class="form-hint left-action">将替换当前 BOM，重置产品级证据。</span><button class="button secondary" data-close>取消</button><button class="button primary" id="confirm-import">${icon('check')}确认导入</button></div>`, true, 'FIELD MAPPING');
    $('#import-sheet').onchange = () => { importState.sheetIndex = Number($('#import-sheet').value); showMapping(); };
    $('#import-header').onchange = () => { const index = Number($('#import-header').value) - 1; if (!Number.isInteger(index) || index < 0 || index >= sheet.rows.length) return; importState.header = { ...workbook.findHeader([sheet.rows[index]]), row: index }; renderMappingFields(); };
    $('#confirm-import').onclick = () => {
      try {
        const mapping = Object.fromEntries(workbook.fields.map(field => [field.key, Number($(`#map-${field.key}`).value)]));
        const options = { headerRow: importState.header.row, massUnit: $('#import-mass-unit').value, massBasis: $('#import-mass-basis').value, concentrationUnit: $('#import-concentration').value, defaultCategory: $('#import-default-category').value, filename: importState.filename };
        const imported = workbook.importRows({ ...sheet, source: importState.book.Sheets[sheet.name] }, mapping, options);
        commitImport(imported.parts, false); toast(`已导入 ${imported.parts.length} 行${imported.excludedParents ? `，排除 ${imported.excludedParents} 个父装配行` : ''}，请核查后计算。`);
      } catch (error) { $('#mapping-error').textContent = error.message; }
    };
    if ($('#use-original')) $('#use-original').onclick = () => commitImport(importState.original, true);
    renderMappingFields();
  }
  function renderMappingFields() {
    const sheet = importState.sheets[importState.sheetIndex]; const header = importState.header; const columns = sheet.rows[header.row] || [];
    $('#mapping-grid').innerHTML = workbook.fields.map(field => `<label class="form-field"><span>${field.label}${['name', 'unitMass'].includes(field.key) ? ' *' : ''}</span><select id="map-${field.key}"><option value="-1">不映射</option>${columns.map((value, index) => `<option value="${index}" ${header.mapping[field.key] === index ? 'selected' : ''}>${XLSX.utils.encode_col(index)} · ${escape(String(value || '无表头').slice(0, 55))}</option>`).join('')}</select></label>`).join('');
    $('#import-preview').innerHTML = `<table class="data-table"><thead><tr>${columns.slice(0, 12).map(value => `<th>${escape(value)}</th>`).join('')}</tr></thead><tbody>${sheet.rows.slice(header.row + 1, header.row + 5).map(row => `<tr>${columns.slice(0, 12).map((value, index) => `<td>${escape(String(row[index] ?? '').slice(0, 80))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  function commitImport(parts, original) {
    state.parts = structuredClone(parts); state.audits = freshAudits(); state.source = importState.filename; state.sample = false; state.sourceMismatch = false;
    state.product = { name: importState.filename.replace(/\.[^.]+$/, ''), reference: '', bom: '', reviewer: 'Tony ZHUANG', notes: '' };
    if (original) {
      const reportName = importState.book.SheetNames.find(name => name.trim() === 'Halogen Verification'); const report = importState.book.Sheets[reportName] || {};
      state.product.reference = String(report.E31?.v || ''); state.product.reviewer = String(report.B4?.v || '');
      const rowMap = { cable: 21, pcb: 23, consumable: 25, electronic: 27, gas: 29 };
      Object.entries(rowMap).forEach(([key, row]) => { const status = String(report[`C${row}`]?.v || '').toLowerCase(); state.audits[key] = { status: ['pass', 'fail'].includes(status) ? status : 'pending', evidence: String(report[`D${row}`]?.v || '') }; });
      state.sourceMismatch = String(report.C18?.v || '').toUpperCase() === 'PASS' && engine.calculate(parts, state.audits).status !== 'pass';
    }
    state.page = 1; $('#bom-search').value = ''; $('#bom-filter').value = 'all'; markDirty(); closeModal(); navigate('bom');
  }
  function snapshot() { return { id: crypto.randomUUID(), schemaVersion: 1, methodVersion: state.methodVersion || engine.version, createdAt: state.calculatedAt, savedAt: new Date().toISOString(), product: structuredClone(state.product), parts: structuredClone(state.parts), audits: structuredClone(state.audits), source: state.source, sourceMismatch: state.sourceMismatch, sample: state.sample }; }
  function safeSnapshot(record) {
    if (!record || record.schemaVersion !== 1 || !['1.0.0',engine.version].includes(record.methodVersion) || !record.product || !Array.isArray(record.parts) || record.parts.length > 5000 || !Number.isFinite(Date.parse(record.createdAt))) throw new Error('备份格式或方法版本不兼容。');
    const text = value => typeof value === 'string' ? value.slice(0, 2000) : '';
    const parts = record.parts.map(part => {
      if (!part || typeof part !== 'object') throw new Error('备份中存在无效 BOM 行。');
      const metadata = {};
      if (part.engineering && typeof part.engineering==='object') {
        const original = part.engineering;
        const links = value => (Array.isArray(value)?value:[]).slice(0,500).filter(item=>item && typeof item==='object').map(item=>({...Object.fromEntries(['number','name','revision','unit'].map(key=>[key,text(item[key])])),row:engine.number(item.row),quantity:engine.number(item.quantity)}));
        metadata.engineering={...Object.fromEntries(['type','context','classification','revision','materialFileNumber','rohs','quantityBasis','massIssue'].map(key=>[key,text(original[key])])),...Object.fromEntries(['row','level','localQuantity','reportedMass','volume'].map(key=>[key,engine.number(original[key])])),rawMaterials:links(original.rawMaterials),treatments:links(original.treatments)};
      }
      if (part.recognition && typeof part.recognition==='object') metadata.recognition={...Object.fromEntries(['source','basis','family','pvc','halogenStatus','standard','evidence','ruleId'].map(key=>[key,text(part.recognition[key])])),issues:(Array.isArray(part.recognition.issues)?part.recognition.issues:[]).map(text),rawNumbers:(Array.isArray(part.recognition.rawNumbers)?part.recognition.rawNumbers:[]).map(text)};
      return { id: crypto.randomUUID(), ...metadata, ...Object.fromEntries(['name', 'spn', 'material', 'category', 'mode', 'resin', 'fr', 'additive', 'evidence'].map(key => [key, text(part[key])])), quantity: engine.number(part.quantity), unitMass: engine.number(part.unitMass), values: Object.fromEntries(engine.ELEMENTS.map(element => [element, engine.number(part.values?.[element])])) };
    });
    return { id: typeof record.id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(record.id) ? record.id : crypto.randomUUID(), schemaVersion: 1, methodVersion: record.methodVersion, createdAt: new Date(record.createdAt).toISOString(), savedAt: Number.isFinite(Date.parse(record.savedAt)) ? new Date(record.savedAt).toISOString() : record.createdAt, product: Object.fromEntries(['name', 'reference', 'bom', 'reviewer', 'notes'].map(key => [key, text(record.product[key])])), parts, audits: { pvc: { status: ['pass', 'fail', 'pending'].includes(record.audits?.pvc?.status) ? record.audits.pvc.status : 'pass', evidence: text(record.audits?.pvc?.evidence) }, ...Object.fromEntries(engine.AUDIT_KEYS.map(key => [key, { status: ['pass', 'fail'].includes(record.audits?.[key]?.status) ? record.audits[key].status : 'pending', evidence: text(record.audits?.[key]?.evidence) }])) }, source: text(record.source), sourceMismatch: record.sourceMismatch === true, sample: record.sample === true };
  }
  function persistHistory(next) {
    if (next.length > 100) throw new Error('最多保留 100 条本地记录，请备份并删除旧记录后重试。');
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { throw new Error('浏览器本地存储不可用或空间不足。请先备份历史，或直接导出 Excel。'); }
    history = next; $('#nav-history-count').textContent = history.length;
  }
  function saveResult() {
    if (state.dirty) return toast('请先重新计算。', true);
    if (state.savedId && history.some(record => record.id === state.savedId)) return toast('当前结果已保存，无需重复保存。');
    try { const record = snapshot(); persistHistory([record, ...history]); state.savedId = record.id; renderDirty(); toast('已保存完整审核快照至当前浏览器。'); } catch (error) { toast(error.message, true); }
  }
  async function exportResult(record = null, button = $('#export-button')) {
    if (!record && state.dirty) return toast('数据已修改，请重新计算后导出。', true);
    const selected = record || snapshot();
    const verdict = engine.calculate(selected.parts, selected.audits, selected.methodVersion || engine.version);
    if (verdict.productStatus === 'incomplete') return toast('审核尚未完成，未形成明确声明结果，暂不能导出。请先完成审核并重新计算。', true);
    if (button?.disabled) return;
    const previous = button?.innerHTML;
    if (button) { button.disabled = true; button.innerHTML = icon('loader-circle') + '正在生成'; button.classList.add('busy'); icons(); }
    try {
      const blob = await workbook.exportWorkbook(selected); const reference = (selected.product.reference || selected.product.bom || 'Product').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100);
      workbook.download(blob, `Halogen verification_${reference}_${selected.createdAt.slice(0, 10)}.xlsx`); toast('已生成审核报告，证据与结果已写入模板。');
    } catch (error) { toast('导出失败：' + error.message, true); }
    finally { if (button) { button.innerHTML = previous; button.disabled = false; button.classList.remove('busy'); icons(); } }
  }
  function renderHistory() {
    const query = $('#history-search').value.trim().toLowerCase(); const filter = $('#history-filter').value;
    const selected = history.map(record => ({ record, result: engine.calculate(record.parts, record.audits,record.methodVersion) })).filter(({ record, result }) => `${record.product.name} ${record.product.reference} ${record.product.bom} ${record.product.reviewer}`.toLowerCase().includes(query) && (filter === 'all' || result.productStatus === filter));
    $('#nav-history-count').textContent = history.length;
    $('#history-content').innerHTML = !selected.length ? `<div class="empty-state">${icon('folder-clock')}<h3>${history.length ? '没有匹配的审核记录' : '尚无已保存的审核记录'}</h3><p>${history.length ? '调整产品关键字或结论筛选条件。' : '完成计算后保存审核快照。'}</p><button class="button secondary" data-view="overview">${icon('arrow-left')}返回计算总览</button></div>` : `<div class="table-scroll"><table class="data-table history-table"><thead><tr><th>产品 / 商业型号</th><th>BOM</th><th>保存时间</th><th>审核人</th><th>总卤素</th><th>产品级结论</th><th>操作</th></tr></thead><tbody>${selected.map(({ record, result }) => `<tr><td><strong>${escape(record.product.name)}</strong><span class="subtext">${escape(record.product.reference)}</span></td><td>${escape(record.product.bom || '—')}</td><td>${date(record.savedAt)}</td><td>${escape(record.product.reviewer || '未指定')}</td><td class="numeric">${format(result.ppm.total / 10000, 2)}%</td><td>${badge(STATUS_LABELS[result.productStatus], STATUS_COLORS[result.productStatus])}</td><td><button class="icon-button" data-history-view="${record.id}" title="查看快照" aria-label="查看快照">${icon('eye')}</button><button class="icon-button" data-history-load="${record.id}" title="载入工作区" aria-label="载入工作区">${icon('folder-open')}</button><button class="icon-button" data-history-export="${record.id}" title="导出报告" aria-label="导出报告">${icon('download')}</button><button class="icon-button" data-history-delete="${record.id}" title="删除记录" aria-label="删除记录">${icon('trash-2')}</button></td></tr>`).join('')}</tbody></table></div>`; icons();
  }
  function showSnapshot(record) {
    const result = engine.calculate(record.parts, record.audits,record.methodVersion);
    openModal('审核结果快照', `<div>${badge(STATUS_LABELS[result.productStatus], STATUS_COLORS[result.productStatus])}<h3 style="margin-top:12px">${escape(record.product.name)}</h3><p class="form-hint">${escape(record.product.reference)} · ${date(record.savedAt)} · ${escape(record.product.reviewer || '未指定审核人')}</p></div><div class="snapshot-details"><div><strong>${format(result.plasticMass)} g</strong><span>塑料件总质量</span></div><div><strong>${result.plasticCount}</strong><span>塑料件数量</span></div><div><strong>${format(result.ppm.total / 10000, 2)}%</strong><span>总卤素含量</span></div>${engine.ELEMENTS.map(element => `<div><strong>${format(result.ppm[element], 2)} ppm</strong><span>${ELEMENT_LABELS[element]}</span></div>`).join('')}<div><strong>v${escape(record.methodVersion)}</strong><span>方法版本</span></div></div><p class="form-hint">声明范围：${CLAIM_LABELS[result.claim]}<br>来源：${escape(record.source)}</p><div class="snapshot-audits">${AUDIT_ITEMS.map(item => `<div><strong>${item.title}</strong> ${badge(record.audits[item.key].status.toUpperCase(), record.audits[item.key].status === 'pass' ? 'green' : 'amber')}<p class="muted">${escape(record.audits[item.key].evidence || '证据待补全')}</p></div>`).join('')}</div><div class="modal-footer"><button class="button secondary" data-history-load="${record.id}">${icon('folder-open')}载入工作区</button><button class="button primary" data-history-export="${record.id}">${icon('download')}导出原模板</button></div>`, false, 'SAVED ASSESSMENT');
  }
  function loadSnapshot(record) {
    const apply = () => { state.product = structuredClone(record.product); state.parts = structuredClone(record.parts); state.audits = structuredClone(record.audits); state.source = record.source; state.sourceMismatch = record.sourceMismatch; state.sample = record.sample; state.methodVersion=record.methodVersion; state.result = engine.calculate(state.parts, state.audits,state.methodVersion); state.calculatedAt = record.createdAt; state.savedId = record.id; state.dirty = false; state.page = 1; closeModal(); renderProduct(); renderOverview(); navigate('overview'); toast('已载入历史快照，原方法版本保留；重新计算将使用当前版本。'); };
    confirmAction('载入历史结果', '将替换当前工作区的数据。未保存的编辑不会保留，原历史快照不变。', apply, '载入快照');
  }
  function backupHistory() {
    if (!history.length) return toast('暂无可备份记录。');
    workbook.download(new Blob([JSON.stringify({ format: 'halogen-audit-backup', schemaVersion: 1, exportedAt: new Date().toISOString(), records: history }, null, 2)], { type: 'application/json' }), `Halogen_Audit_Backup_${new Date().toISOString().slice(0, 10)}.json`);
  }
  async function restoreHistory(file) {
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('备份文件超过 20 MB。');
      const backup = JSON.parse(await file.text());
      if (backup.format !== 'halogen-audit-backup' || backup.schemaVersion !== 1 || !Array.isArray(backup.records)) throw new Error('不是有效的审核备份文件。');
      const validated = backup.records.map(safeSnapshot); const existing = new Set(history.map(record => record.id)); const additions = validated.filter(record => !existing.has(record.id));
      confirmAction('恢复历史备份', `已校验 ${validated.length} 条记录，将合并 ${additions.length} 条新记录。现有历史不会被覆盖。`, () => { try { persistHistory([...additions, ...history]); renderHistory(); toast(`已恢复 ${additions.length} 条记录。`); } catch (error) { toast(error.message, true); } }, '合并记录');
    } catch (error) { toast('恢复失败：' + error.message, true); }
  }
  function renderCoefficients() {
    $('#model-coefficients').innerHTML = '<table class="data-table"><thead><tr><th>类型 / 模型</th><th>Cl ppm</th><th>Br ppm</th><th>F ppm</th><th>I ppm</th></tr></thead><tbody>' + Object.entries({ '树脂': engine.RESINS, '阻燃剂': engine.RETARDANTS, '添加剂': engine.ADDITIVES }).flatMap(([group, models]) => Object.entries(models).map(([name, values]) => `<tr><td>${escape(group)} · ${escape(name)}</td>${values.map(value => `<td class="numeric">${format(value, 2)}</td>`).join('')}</tr>`)).join('') + '</tbody></table>';
  }
  document.addEventListener('click', event => {
    const target = event.target.closest('button, a'); if (!target) return;
    if (target.dataset.view) { if (target.tagName === 'A') event.preventDefault(); navigate(target.dataset.view); }
    if (target.hasAttribute('data-close')) closeModal();
    if (target.dataset.editPart) editPart(target.dataset.editPart);
    if (target.dataset.deleteRule) confirmAction('删除确认记录','删除后不会修改已保存的历史快照。当前工作区需重新识别才会应用数据库变化。',()=>{try{persistRules(recognitionRules.filter(rule=>rule.id!==target.dataset.deleteRule));renderDatabase();toast('确认记录已删除。');}catch(error){toast(error.message,true);}},'删除记录');
    if (target.dataset.deletePart) { const part = state.parts.find(item => item.id === target.dataset.deletePart); if (part) confirmAction('删除 BOM 零件', `确认删除“${part.name}”？删除后需重新计算。`, () => { state.parts = state.parts.filter(item => item.id !== part.id); markDirty(); renderBom(); }, '删除零件'); }
    if (target.dataset.unit) { state.unit = target.dataset.unit; $$('[data-unit]').forEach(button => button.classList.toggle('active', button === target)); renderOverview(); }
    for (const [attribute, action] of Object.entries({ historyView: showSnapshot, historyLoad: loadSnapshot, historyExport: record => exportResult(record, target), historyDelete: record => confirmAction('删除审核记录', `将删除“${record.product.name}”的本地记录，建议先备份。`, () => { try { persistHistory(history.filter(item => item.id !== record.id)); renderHistory(); toast('记录已删除。'); } catch (error) { toast(error.message, true); } }, '删除记录') })) { if (target.dataset[attribute]) { const record = history.find(item => item.id === target.dataset[attribute]); if (record) action(record); } }
  });
  $('#close-modal').onclick = closeModal;
  $('#edit-product').onclick = editProduct;
  $('#import-button').onclick = importDialog;
  $('#bom-file').onchange = () => { if ($('#bom-file').files[0]) prepareImport($('#bom-file').files[0]); };
  $('#history-file').onchange = () => { if ($('#history-file').files[0]) restoreHistory($('#history-file').files[0]); };
  $('#calculate-button').onclick = calculate; $('#recalculate-inline').onclick = calculate; $('#audit-calculate').onclick = calculate;
  $('#clear-data-button').onclick = () => confirmAction('一键清除数据', '将清除当前工作区全部数据、本地历史记录与识别数据库确认记录，且无法恢复。建议先导出备份。', () => {
    state.parts = []; state.audits = freshAudits(); state.product = { name: '', reference: '', bom: '', reviewer: 'Tony ZHUANG', notes: '' };
    state.source = ''; state.sample = false; state.sourceMismatch = false; state.dirty = false; state.savedId = null; state.page = 1;
    state.methodVersion = engine.version; state.result = engine.calculate(state.parts, state.audits); state.calculatedAt = new Date().toISOString();
    history = []; recognitionRules = []; importState = null; rulesStorageReadable = true;
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(RULES_KEY); } catch {}
    $('#nav-history-count').textContent = '0'; $('#nav-bom-count').textContent = '0';
    navigate('overview'); renderProduct(); renderOverview(); renderBom(); renderHistory();
    toast('已清除全部数据。');
  }, '清除数据');
  $('#save-button').onclick = saveResult; $('#export-button').onclick = () => exportResult();
  $('#workflow-export').onclick = () => { navigate('overview'); $('.result-toolbar').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  $('#add-part').onclick = () => editPart();
  $('#load-example').onclick = () => confirmAction('载入附件示例', '将以原始附件的 13 个塑料件和审核证据替换当前工作区。未保存内容不会保留。', () => { state.parts = structuredClone(data.parts); state.product = structuredClone(data.product); state.audits = structuredClone(data.audits); state.source = data.source; state.sample = true; state.sourceMismatch = true; state.page = 1; $('#bom-search').value = ''; $('#bom-filter').value = 'all'; markDirty(); renderBom(); }, '载入示例');
  $('#bom-search').oninput = () => { state.page = 1; renderBom(); }; $('#bom-filter').onchange = () => { state.page = 1; renderBom(); };
  $('#previous-page').onclick = () => { state.page--; renderBom(); }; $('#next-page').onclick = () => { state.page++; renderBom(); };
  $('#history-search').oninput = renderHistory; $('#history-filter').onchange = renderHistory;
  $('#backup-history').onclick = backupHistory; $('#restore-history').onclick = () => { $('#history-file').value = ''; $('#history-file').click(); };
  $('#audit-list').addEventListener('change', event => { if (event.target.dataset.auditStatus) { const key = event.target.dataset.auditStatus; state.audits[key].status = event.target.value; event.target.dataset.status = event.target.value; markDirty(); renderAudit(); } if (event.target.dataset.pvcOverride !== undefined) { const value = event.target.value; const pvcPresent = engine.calculate(state.parts, state.audits).pvcPresent; state.audits.pvc = { status: value, evidence: value === 'fail' ? '人工判定检出 PVC' : value === 'pending' ? 'PVC 待审核' : 'BOM 未发现 PVC 材料牌号' }; if (pvcPresent && value !== 'fail') toast('BOM 中已识别到 PVC 材料，无法改为通过。', true); markDirty(); renderAudit(); } });
  $('#audit-list').addEventListener('input', event => { if (event.target.dataset.auditEvidence) { state.audits[event.target.dataset.auditEvidence].evidence = event.target.value; markDirty(); const completed = engine.AUDIT_KEYS.filter(key => ['pass', 'fail'].includes(state.audits[key]?.status) && state.audits[key]?.evidence?.trim()).length; $('#audit-progress').textContent = `${completed} / 6 项证据已记录`; $('#audit-summary').innerHTML = icon('refresh-cw') + '<span>证据已修改，当前结论已失效。请更新审核结论。</span>'; icons(); } });
  window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('storage', event => { if (event.key === STORAGE_KEY) { try { const records = JSON.parse(event.newValue || '[]'); history = records.map(safeSnapshot); $('#nav-history-count').textContent = history.length; if (state.view === 'history') renderHistory(); } catch { toast('其他窗口的历史记录无法读取，请检查备份。', true); } } });
  try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); if (!Array.isArray(saved)) throw new Error('invalid history'); history = saved.map(safeSnapshot); } catch { toast('本地历史无法读取，未覆盖原数据；可使用 JSON 备份恢复。', true); }
  $$('.nav-item').forEach(element => { element.title = element.textContent.trim(); element.setAttribute('aria-label', element.textContent.trim()); });
  try { const savedRules=JSON.parse(localStorage.getItem(RULES_KEY) || '[]'); if (!Array.isArray(savedRules) || savedRules.length>1000 || !savedRules.every(recognition.validRule)) throw new Error('invalid rules'); recognitionRules=savedRules; } catch { rulesStorageReadable=false; toast('本地识别数据库无法读取，未覆盖原数据。',true); }
  setupRecognitionUI();
  const initial = recognition.analyze(workbook.engineeringStructure(engineeringData.sheet), recognitionRules);
  state.parts = initial.parts; state.audits = initial.audits; state.product = {name:initial.root.name,reference:initial.root.number,bom:initial.root.number,reviewer:'Tony ZHUANG',notes:'工程 BOM 自动识别示例'}; state.source = engineeringData.source; state.sourceMismatch = false;
  state.result = engine.calculate(state.parts, state.audits); $('#nav-history-count').textContent = history.length; renderProduct(); renderOverview(); navigate('overview'); icons();
})();