(function (root) {
  'use strict';
  const engine = root.HalogenEngine;
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const relationshipsNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const modes = { known: 'Known halogen content', compliant: 'Material is compliant to EN50642', estimated: 'No information', unknown: '' };
  const categories = { plastic: '塑料', metal: '金属', cable: '线缆', pcb: 'PCB', consumable: '耗材', electronic: '电子元件', packaging: '包装（产品范围外）', other: '其他' };
  const fields = [
    { key: 'name', label: '零件名称', aliases: ['name', 'partname', 'description', 'componentname', '名称', '物料名称', '零件名称', '零件描述', '物料描述'] },
    { key: 'spn', label: '物料编码 / SPN', aliases: ['spn', 'partnumber', 'partno', 'materialnumber', 'materialcode', '物料编码', '物料号', '零件号', '编码'] },
    { key: 'material', label: '材料牌号', aliases: ['isodesignation', 'material', 'materialdesignation', '材料', '材料名称', '材料牌号'] },
    { key: 'category', label: '零件类别', aliases: ['category', 'type', 'materialtype', 'parttype', '类别', '材料类型', '零件类别'] },
    { key: 'quantity', label: '数量', aliases: ['quantity', 'qty', 'count', '数量', '用量'] },
    { key: 'unitMass', label: '质量', aliases: ['mass', 'massg', 'masskg', 'massmg', 'weight', 'weightg', 'weightkg', 'unitmass', 'unitmassg', 'unitweight', 'totalmass', 'totalmassg', 'totalweight', '质量', '质量g', '质量kg', '单重', '单重g', '单件质量g', '单件质量', '总质量', '总质量g', '重量', '重量g'] },
    { key: 'mode', label: '数据依据', aliases: ['mode', 'halogencontentinformation', 'source', '数据依据', '含量信息', '卤素含量信息'] },
    ...engine.ELEMENTS.map(element => ({ key: element, label: element.toUpperCase() + ' 含量', aliases: [element, element + 'ppm', element + 'g', element + 'massg', element + 'content', { cl: '氯', br: '溴', f: '氟', i: '碘' }[element]] })),
    { key: 'resin', label: '树脂', aliases: ['resin', '树脂', '基础树脂'] },
    { key: 'fr', label: '阻燃剂', aliases: ['fr', 'flameretardant', '阻燃剂'] },
    { key: 'additive', label: '添加剂', aliases: ['additive', '添加剂'] },
    { key: 'evidence', label: '证据 / 来源', aliases: ['evidence', '证据', '证据来源', '检测报告', '备注'] },
    { key: 'level', label: 'BOM 层级', aliases: ['level', 'bomlevel', '层级', 'bom层级'] }
  ];
  const normalize = value => String(value ?? '').toLowerCase().replace(/[\s_()（）\[\]%.\-/]/g, '');
  function parseNumber(value) {
    if (typeof value === 'string') {
      value = value.trim();
      if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(value)) value = value.replaceAll(',', '');
    }
    return engine.number(value);
  }
  function findHeader(rows) {
    let best = { row: 0, score: -1, mapping: {} };
    rows.slice(0, 30).forEach((row, index) => {
      const mapping = {};
      fields.forEach(field => { mapping[field.key] = row.findIndex(value => field.aliases.includes(normalize(value))); });
      const score = Object.values(mapping).filter(value => value >= 0).length + (mapping.name >= 0 ? 2 : 0) + (mapping.unitMass >= 0 ? 3 : 0);
      if (score > best.score) best = { row: index, score, mapping };
    });
    return best;
  }
  function identifyCategory(value, fallback = 'plastic') {
    if (!String(value ?? '').trim()) return fallback;
    const category = normalize(value);
    const aliases = { plastic: ['plastic', 'plastics', 'polymer', '塑料', '塑料件', '塑胶'], metal: ['metal', 'metals', 'steel', '金属', '金属件'], cable: ['cable', 'cables', 'wire', '线缆', '电线', '电缆'], pcb: ['pcb', 'printedcircuitboard', '电路板', '印刷电路板'], consumable: ['consumable', 'consumables', '电子耗材', '耗材'], electronic: ['electronic', 'electronics', 'electroniccomponent', '电子元件', '电子件'], other: ['other', 'others', '其他'] };
    return Object.keys(aliases).find(key => aliases[key].includes(category)) || 'unmapped';
  }
  function findMaterial(spn) {
    const needle = String(spn || '').trim().toUpperCase();
    const primary = (root.MATERIALS_DB?.records || []).map(record => ({ spn: record.spn, resin: record.resin, fr: record.fr, additive: record.additive, name: record.name || '', rohs: record.rohs || '' }));
    const legacy = root.HALOGEN_DATA?.materials || [];
    const matches = [...primary, ...legacy].filter(material => String(material.spn || '').toUpperCase() === needle);
    const seen = new Map();
    for (const material of matches) { const key = JSON.stringify([material.resin, material.fr, material.additive]); if (!seen.has(key)) seen.set(key, material); }
    const unique = [...seen.values()];
    return unique.length === 1 ? unique[0] : null;
  }
  function originalParts(book) {
    const sheet = book.Sheets.Calculation;
    if (!sheet || sheet.B7?.v !== 'Name' || sheet.C7?.v !== 'Mass (g)') return null;
    const parts = [];
    const last = Math.min(XLSX.utils.decode_range(sheet['!ref']).e.r + 1, 20000);
    const get = address => sheet[address]?.t === 'e' ? null : sheet[address]?.v ?? null;
    for (let row = 8; row <= last; row++) {
      if (!get(`B${row}`)) continue;
      const mass = parseNumber(get(`C${row}`));
      const mode = Object.keys(modes).find(key => modes[key] === get(`F${row}`)) || 'unknown';
      parts.push({ id: crypto.randomUUID(), name: String(get(`B${row}`)), spn: String(get(`D${row}`) || ''), material: String(get(`E${row}`) || ''), category: 'plastic', quantity: 1, unitMass: mass, mode, values: Object.fromEntries(engine.ELEMENTS.map((element, index) => {
        const grams = parseNumber(get(`${['G', 'I', 'K', 'N'][index]}${row}`));
        return [element, grams !== null && mass > 0 ? grams / mass * 1000000 : null];
      })), resin: get(`O${row}`) || '', fr: get(`P${row}`) || '', additive: get(`Q${row}`) || '', evidence: `Calculation!${row}` });
    }
    return parts;
  }
  function engineeringStructure(sheet, options = {}) {
    const headerRow = sheet.rows.findIndex(row => row.some(value => normalize(value) === 'structurelevel') && row.some(value => normalize(value) === 'objecttype'));
    if (headerRow < 0) return null;
    const headers = sheet.rows[headerRow].map(normalize);
    const column = name => headers.indexOf(normalize(name));
    for (const name of ['Structure Level', 'Number', 'Name', 'Object Type', 'Quantity', 'Mass']) if (column(name) < 0) throw new Error(`工程 BOM 缺少 ${name} 列。`);
    const nodes = [];
    const stack = [];
    const massValue = value => {
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      const match = String(value ?? '').trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(kg|mg|g)?$/i);
      return match ? Number(match[1]) * ({ g: 1, kg: 1000, mg: 0.001 }[(match[2] || 'g').toLowerCase()]) : null;
    };
    sheet.rows.slice(headerRow + 1).forEach((cells, index) => {
      const get = name => column(name) >= 0 ? cells[column(name)] ?? '' : '';
      if (!String(get('Number')).trim() && !String(get('Name')).trim()) return;
      const level = parseNumber(get('Structure Level'));
      if (level === null || !Number.isInteger(level) || level < 0) throw new Error(`第 ${headerRow + index + 2} 行结构层级无效。`);
      while (stack.length && stack.at(-1).level >= level) stack.pop();
      const parent = stack.at(-1);
      if (parent && level !== parent.level + 1) throw new Error(`第 ${headerRow + index + 2} 行层级跳跃，无法确定所属零件。`);
      const type = String(get('Object Type')).trim();
      const material = /^(Raw Material|Treatment) Part$/i.test(type);
      const localQuantity = parent ? parseNumber(get('Quantity')) : parseNumber(get('Quantity')) ?? 1;
      const quantity = options.quantityBasis === 'expanded' || !parent ? localQuantity : localQuantity !== null && parent.quantity !== null ? localQuantity * parent.quantity : null;
      const node = { level, number: String(get('Number')).trim(), name: String(get('Name')).trim(), type, material, row: headerRow + index + 2, revision: String(get('Revision')), parent, children: [], quantity, localQuantity, unit: String(get('Unit')), mass: massValue(String(get('Mass')).trim() ? get('Mass') : get('Mass For Crescendo')), materialFileNumber: String(get('Material File Number')).trim(), rohs: String(get('RoHS Verdict')), context: String(get('Context')), classification: String(get('Technical Classification')) };
      if (parent) parent.children.push(node);
      nodes.push(node); stack.push(node);
    });
    const physical = nodes.filter(node => !node.material);
    const assemblies = physical.filter(node => node.children.some(child => !child.material));
    const parts = physical.filter(node => !node.children.some(child => !child.material)).map(node => {
      const rawMaterials = node.children.filter(child => /^Raw Material Part$/i.test(child.type)).map(child => ({ number: child.number, name: child.name, revision: child.revision, row: child.row, quantity: child.localQuantity, unit: child.unit }));
      const sourceCells = sheet.rows[node.row - 1];
      const volumeText = String(sourceCells[column('Volume')] || '');
      const volumeMatch = volumeText.trim().match(/^([\d.eE+-]+)\s*cm\*\*3$/);
      const volume = volumeMatch ? Number(volumeMatch[1]) : null;
      const massIssue = volume > 0 && node.mass > volume * 30 ? '原始 Mass / Volume 超过 30 g/cm3 人工确认门槛；不猜测修正值' : '';
      return { id: crypto.randomUUID(), name: node.name, spn: node.number, material: rawMaterials.map(material => material.name).join(' | '), category: 'unmapped', quantity: node.quantity, unitMass: massIssue ? null : node.mass, mode: 'unknown', values: Object.fromEntries(engine.ELEMENTS.map(element => [element, null])), resin: '', fr: '', additive: '', evidence: `${sheet.name}:${node.row}; Engineering/Catalog Mass (g); Quantity ${options.quantityBasis === 'expanded' ? 'expanded' : 'parent multiplied'}`, engineering: { row: node.row, level: node.level, type: node.type, context: node.context, classification: node.classification, revision: node.revision, localQuantity: node.localQuantity, materialFileNumber: node.materialFileNumber, rawMaterials, treatments: node.children.filter(child => /^Treatment Part$/i.test(child.type)).map(child => ({ number: child.number, name: child.name, row: child.row })), rohs: node.rohs, quantityBasis: options.quantityBasis || 'relative', reportedMass: node.mass, volume, massIssue } };
    });
    if (parts.length > 5000) throw new Error('一次最多导入 5,000 个零件。');
    return { parts, assemblies: assemblies.length, materialRows: nodes.filter(node => /^Raw Material Part$/i.test(node.type)).length, treatmentRows: nodes.filter(node => /^Treatment Part$/i.test(node.type)).length, rowCount: nodes.length, root: physical[0] ? { name: physical[0].name, number: physical[0].number } : null, mixedAssemblies: assemblies.filter(node => node.children.some(child => /^Raw Material Part$/i.test(child.type))).map(node => node.row) };
  }
  async function read(file) {
    if (file.size > 25 * 1024 * 1024) throw new Error('文件超过 25 MB，请拆分后导入。');
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error('请选择 XLSX、XLS 或 CSV 文件。');
    const buffer = await file.arrayBuffer();
    let input = buffer;
    let type = 'array';
    if (/\.csv$/i.test(file.name)) {
      input = new TextDecoder('utf-8').decode(buffer);
      if (input.includes('\uFFFD')) input = new TextDecoder('gb18030').decode(buffer);
      type = 'string';
    }
    const book = XLSX.read(input, { type, cellDates: false, cellNF: true, sheetRows: 20002, raw: true });
    if (book.SheetNames.some(name => book.Sheets[name]['!fullref'] && XLSX.utils.decode_range(book.Sheets[name]['!fullref']).e.r >= 20002)) throw new Error('工作表超过 20,000 行，请按单个产品拆分后导入；不会截断数据进行计算。');
    const sheets = book.SheetNames.map(name => ({ name, rows: XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: '', raw: true, blankrows: true }) }));
    const original = originalParts(book);
    if (original && original.length > 5000) throw new Error('一次最多导入 5,000 个 BOM 行，请按产品拆分。');
    const engineeringSheet = sheets.find(sheet => sheet.rows.slice(0, 30).some(row => row.some(value => normalize(value) === 'structurelevel') && row.some(value => normalize(value) === 'objecttype')));
    return { book, sheets, original, engineering: engineeringSheet ? engineeringStructure(engineeringSheet) : null, engineeringSheet, filename: file.name };
  }
  function importRows(sheet, mapping, options) {
    if (mapping.name < 0 || mapping.unitMass < 0) throw new Error('必须指定零件名称和质量列。');
    const mappedColumns = Object.values(mapping).filter(index => index >= 0);
    if (new Set(mappedColumns).size !== mappedColumns.length) throw new Error('同一列不能映射到多个字段，请检查列映射。');
    let rows = sheet.rows.slice(options.headerRow + 1).map((cells, index) => ({ cells, sourceRow: options.headerRow + index + 2 })).filter(row => mappedColumns.some(index => String(row.cells[index] ?? '').trim()));
    if (rows.length > 5000) throw new Error('一次最多导入 5,000 个 BOM 行，请按产品拆分。');
    let excludedParents = 0;
    if (mapping.level >= 0) {
      const levels = rows.map(row => parseNumber(row.cells[mapping.level]));
      if (levels.some(level => level === null || level < 0 || !Number.isInteger(level))) throw new Error('层级列必须全部为非负整数；请先整理多级 BOM，或取消层级映射。');
      rows = rows.filter((row, index) => { const parent = index < rows.length - 1 && levels[index + 1] > levels[index]; if (parent) excludedParents++; return !parent; });
    }
    const parts = rows.map(({ cells, sourceRow }) => {
      const get = key => mapping[key] >= 0 ? cells[mapping[key]] ?? '' : '';
      const quantity = mapping.quantity >= 0 ? parseNumber(get('quantity')) : 1;
      const rawMass = parseNumber(get('unitMass'));
      const massInGrams = rawMass === null ? null : rawMass * ({ g: 1, kg: 1000, mg: 0.001 }[options.massUnit] || 1);
      const unitMass = options.massBasis === 'total' ? quantity > 0 && massInGrams !== null ? massInGrams / quantity : null : massInGrams;
      const spn = String(get('spn')).trim();
      const materialMatch = findMaterial(spn);
      const values = Object.fromEntries(engine.ELEMENTS.map(element => {
        let raw = get(element);
        let unit = options.concentrationUnit;
        if (typeof raw === 'string' && raw.trim().endsWith('%')) { unit = 'percent'; raw = raw.trim().slice(0, -1); }
        const cellAddress = mapping[element] >= 0 ? XLSX.utils.encode_cell({ r: sourceRow - 1, c: mapping[element] }) : '';
        if (options.concentrationUnit === 'auto' && sheet.source?.[cellAddress]?.z?.includes('%')) unit = 'fraction';
        if (unit === 'auto') { const header = String(sheet.rows[options.headerRow][mapping[element]] || ''); unit = /%/.test(header) ? 'percent' : /\(g\)|（g）/i.test(header) ? 'grams' : 'ppm'; }
        const value = parseNumber(raw);
        return [element, value === null ? null : unit === 'percent' ? value * 10000 : unit === 'fraction' ? value * 1000000 : unit === 'grams' ? quantity > 0 && unitMass > 0 ? value / (quantity * unitMass) * 1000000 : null : value];
      }));
      const rawMode = String(get('mode')).trim();
      const namedMode = rawMode && (Object.keys(modes).find(key => key === rawMode.toLowerCase() || modes[key] === rawMode) || ({ '已知含量': 'known', '已知实测': 'known', '保守估算': 'estimated', '材料库估算': 'estimated', '无信息': 'estimated', 'EN50642声明': 'compliant', '待补全': 'unknown' }[rawMode]));
      const explicitModel = get('resin') && get('fr') && get('additive');
      const mode = namedMode || (rawMode ? 'unknown' : engine.ELEMENTS.every(element => values[element] !== null) ? 'known' : materialMatch || explicitModel ? 'estimated' : 'unknown');
      return { id: crypto.randomUUID(), name: String(get('name')).trim(), spn, material: String(get('material')).trim(), category: identifyCategory(get('category'), options.defaultCategory), quantity, unitMass, values, mode, resin: String(get('resin') || materialMatch?.resin || ''), fr: String(get('fr') || materialMatch?.fr || ''), additive: String(get('additive') || materialMatch?.additive || ''), evidence: String(get('evidence') || `${options.filename} / ${sheet.name}:${sourceRow}`) };
    });
    if (!parts.length) throw new Error('未识别到 BOM 数据行，请检查工作表及表头行。');
    return { parts, excludedParents };
  }
  const parseXml = text => {
    const document = new DOMParser().parseFromString(text, 'application/xml');
    if (document.querySelector('parsererror')) throw new Error('模板 XML 无法解析。');
    return document;
  };
  const serialize = document => new XMLSerializer().serializeToString(document);
  function writeCell(document, address, value) {
    const rowIndex = Number(address.match(/\d+$/)[0]);
    const sheetData = document.getElementsByTagNameNS(ns, 'sheetData')[0];
    let row = [...sheetData.children].find(item => Number(item.getAttribute('r')) === rowIndex);
    if (!row) {
      row = document.createElementNS(ns, 'row'); row.setAttribute('r', rowIndex);
      sheetData.insertBefore(row, [...sheetData.children].find(item => Number(item.getAttribute('r')) > rowIndex) || null);
    }
    let cell = [...row.children].find(item => item.getAttribute('r') === address);
    if (!cell) {
      cell = document.createElementNS(ns, 'c'); cell.setAttribute('r', address);
      const column = XLSX.utils.decode_cell(address).c;
      row.insertBefore(cell, [...row.children].find(item => XLSX.utils.decode_cell(item.getAttribute('r')).c > column) || null);
      if (rowIndex > 62) {
        const styleCell = document.querySelector(`c[r="${address.replace(/\d+$/, '8')}"]`);
        if (styleCell?.hasAttribute('s')) cell.setAttribute('s', styleCell.getAttribute('s'));
      }
    }
    cell.replaceChildren(); cell.removeAttribute('t'); cell.removeAttribute('cm');
    if (value === null || value === undefined || value === '') return;
    if (typeof value === 'number' && Number.isFinite(value)) {
      const numeric = document.createElementNS(ns, 'v'); numeric.textContent = String(value); cell.append(numeric);
    } else {
      cell.setAttribute('t', 'inlineStr'); const inline = document.createElementNS(ns, 'is'); const text = document.createElementNS(ns, 't');
      text.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve'); text.textContent = String(value).slice(0, 32767); inline.append(text); cell.append(inline);
    }
  }
  async function exportWorkbook(snapshot) {
    const version = snapshot.methodVersion || engine.version;
    const result = engine.calculate(snapshot.parts, snapshot.audits,version);
    const zip = await JSZip.loadAsync(root.HALOGEN_TEMPLATE, { base64: true });
    const calculation = parseXml(await zip.file('xl/worksheets/sheet3.xml').async('string'));
    const verification = parseXml(await zip.file('xl/worksheets/sheet2.xml').async('string'));
    const plastics = result.rows.filter(part => part.category === 'plastic');
    const lastRow = Math.max(62, plastics.length + 7);
    for (let row = 8; row <= lastRow; row++) {
      for (let column = 0; column < 28; column++) writeCell(calculation, `${XLSX.utils.encode_col(column)}${row}`, null);
      const part = plastics[row - 8]; if (!part) continue;
      const rawMaterials = part.engineering?.rawMaterials || [];
      const primaryRaw = rawMaterials.find(m => String(m.number) === String(part.engineering?.materialFileNumber)) || rawMaterials.find(m => !/COLORANT|MASTERBATCH/i.test(m.name || '')) || rawMaterials[0];
      const values = { A: row - 7, B: part.name, C: part.mass, D: primaryRaw?.number || part.spn, E: primaryRaw?.name || part.material, F: modes[part.mode], O: part.resin, P: part.fr, Q: part.additive, V: 5, AA: result.plasticMass > 0 ? part.totalGrams / result.plasticMass : 0, AB: part.valid ? 0 : 1 };
      engine.ELEMENTS.forEach((element, index) => {
        values[['G', 'I', 'K', 'N'][index]] = part.mode === 'known' && part.values[element] !== null ? part.mass * Number(part.values[element]) / 1000000 : null;
        values[['H', 'J', 'L', 'M'][index]] = part.mode === 'known' && part.values[element] !== null ? Number(part.values[element]) / 10000 : null;
        values[['R', 'S', 'T', 'U'][index]] = part.valid ? part.grams[element] : null;
        values[['W', 'X', 'Y', 'Z'][index]] = part.valid ? part.ppm[element] / 1000000 : null;
      });
      Object.entries(values).forEach(([column, value]) => writeCell(calculation, column + row, value));
    }
    engine.ELEMENTS.forEach((element, index) => { writeCell(calculation, ['R3', 'S3', 'T3', 'U3'][index], result.grams[element]); writeCell(calculation, ['W3', 'X3', 'Y3', 'Z3'][index], result.ppm[element] / 1000000); });
    writeCell(calculation, 'AA3', result.ppm.total / 1000000);
    writeCell(calculation, 'AB6', result.missingCount);
    writeCell(calculation, 'G2', { pass: 'YES', fail: 'NO', review: 'Value close to the limit', incomplete: 'Fill mandatory fields in yellow' }[result.status]);
    calculation.getElementsByTagNameNS(ns, 'dimension')[0].setAttribute('ref', `A1:AK${Math.max(lastRow, 62)}`);
    const filter = calculation.getElementsByTagNameNS(ns, 'autoFilter')[0]; if (filter) filter.setAttribute('ref', `A7:AB${lastRow}`);
    const day = new Date(snapshot.createdAt || Date.now());
    const excelDay = Math.floor(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 86400000) + 25569;
    const claimText = { product: 'Halogen free product', 'plastic-cable': 'Halogen free plastic parts & cables product', plastic: version==='1.0.0'?'Halogen free plastic parts product':'Halogen plastics free', none: result.productStatus === 'fail' ? 'False' : 'Not Determined' }[result.claim];
    writeCell(verification, 'B4', snapshot.product.reviewer || 'Tony ZHUANG');
    writeCell(verification, 'B7', excelDay); writeCell(verification, 'B8', claimText); writeCell(verification, 'F8', result.productStatus === 'pass' ? 'PASS' : result.productStatus === 'fail' ? 'FAIL' : 'Not Determined');
    writeCell(verification, 'B9', `Plastic parts verification: ${result.status === 'pass' ? 'Validated' : 'Not validated'}`);
    ['B11', 'B12', 'B13', 'B14'].forEach(address => writeCell(verification, address, null));
    writeCell(verification, 'E31', snapshot.product.reference || snapshot.product.bom || snapshot.product.name);
    writeCell(verification, 'B31', snapshot.product.reviewer || 'Tony ZHUANG');
    const halogenPartCount = result.rows.filter(part => part.category === 'plastic' && part.valid && part.totalGrams > 0).length;
    const plasticEvidence = `共${result.plasticCount}个塑料件；其中${halogenPartCount}个含有卤素，整体塑料Br含量为${(result.ppm.br / 10000).toFixed(2)}%、F含量为${(result.ppm.f / 10000).toFixed(2)}%、Cl含量为${(result.ppm.cl / 10000).toFixed(2)}%、I含量为${(result.ppm.i / 10000).toFixed(2)}%，总卤素${(result.ppm.total / 10000).toFixed(2)}%。`;
    writeCell(verification, 'C18', result.status === 'pass' ? 'PASS' : ['fail', 'review'].includes(result.status) ? 'FAIL' : '');
    writeCell(verification, 'D18', plasticEvidence);
    writeCell(verification, 'C19', result.pvcStatus === 'fail' ? 'FAIL' : result.pvcStatus === 'pass' ? 'PASS' : '');
    writeCell(verification, 'D19', result.pvcStatus === 'fail' ? 'PVC detected in BOM.' : result.pvcStatus === 'pass' ? 'No PVC parts.' : 'PVC status pending review.');
    const auditRows = { cable: 21, pcb: 23, consumable: 25, electronic: 27, gas: 29 };
    Object.entries(auditRows).forEach(([key, row]) => {
      const audit = snapshot.audits[key] || {};
      const recognizedFailure = snapshot.parts.some(part=>part.category===key && part.recognition?.halogenStatus==='fail');
      const status = recognizedFailure ? 'fail' : audit.status;
      const defaultEvidence = { cable: 'No PVC cables.', pcb: 'No PCB.', consumable: 'Consumables are halogen-free as specified by SE.', electronic: 'No electronic components.', gas: 'No gaz.' }[key];
      writeCell(verification, `C${row}`, status === 'fail' ? 'FAIL' : status === 'pass' && audit.evidence?.trim() ? 'PASS' : '');
      writeCell(verification, `D${row}`, recognizedFailure ? `Component evidence FAIL. ${audit.evidence || ''}` : audit.evidence || defaultEvidence || 'Evidence pending');
    });
    [18, 19, ...Object.values(auditRows)].forEach(row => {
      ['E', 'F', 'G', 'H'].forEach(column => writeCell(verification, column + row, null));
      writeCell(verification, `M${row}`, null);
    });
    writeCell(verification, 'L18', ['plastic', 'plastic-cable', 'product'].includes(result.claim) ? 1 : 0);
    writeCell(verification, 'L19', ['plastic-cable', 'product'].includes(result.claim) ? 1 : 0);
    writeCell(verification, 'L20', result.claim === 'product' ? 1 : 0);
    writeCell(verification, 'L21', result.productStatus === 'fail' ? 1 : 0);
    [18, 19, 20, 21].forEach(row => writeCell(verification, `M${row}`, 0));
    zip.file('xl/worksheets/sheet3.xml', serialize(calculation)); zip.file('xl/worksheets/sheet2.xml', serialize(verification));
    const workbook = parseXml(await zip.file('xl/workbook.xml').async('string'));
    const workbookRels = parseXml(await zip.file('xl/_rels/workbook.xml.rels').async('string'));
    const contentTypes = parseXml(await zip.file('[Content_Types].xml').async('string'));
    zip.remove('xl/calcChain.xml');
    [...workbookRels.documentElement.children].filter(element => element.getAttribute('Type')?.endsWith('/calcChain')).forEach(element => element.remove());
    [...contentTypes.documentElement.children].filter(element => element.getAttribute('PartName') === '/xl/calcChain.xml').forEach(element => element.remove());
    const calcPr = workbook.getElementsByTagNameNS(ns, 'calcPr')[0]; if (calcPr) { calcPr.setAttribute('calcMode', 'auto'); calcPr.setAttribute('fullCalcOnLoad', '1'); }
    const view = workbook.getElementsByTagNameNS(ns, 'workbookView')[0]; if (view) view.setAttribute('activeTab', '1');
    const filterName = [...workbook.getElementsByTagNameNS(ns, 'definedName')].find(item => item.getAttribute('name') === '_xlnm._FilterDatabase' && item.getAttribute('localSheetId') === '2');
    if (filterName) filterName.textContent = `Calculation!$A$7:$AB$${lastRow}`;
    zip.file('xl/workbook.xml', serialize(workbook)); zip.file('xl/_rels/workbook.xml.rels', serialize(workbookRels)); zip.file('[Content_Types].xml', serialize(contentTypes));
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
  }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function downloadImportTemplate() {
    const rows = [['零件名称', 'SPN', '材料牌号', '零件类别', '数量', '单件质量(g)', '数据依据', 'Cl(ppm)', 'Br(ppm)', 'F(ppm)', 'I(ppm)', '树脂', '阻燃剂', '添加剂', '证据'], ['示例零件（导入前删除）', '', '', '塑料', 1, 10, 'known', 0, 0, 0, 0, '', '', '', '请填写检测报告编号']];
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'BOM'); XLSX.writeFile(book, 'BOM_Import_Template.xlsx');
  }
  root.HalogenWorkbook = { fields, modes, categories, findHeader, findMaterial, parseNumber, identifyCategory, originalParts, engineeringStructure, read, importRows, exportWorkbook, download, downloadImportTemplate };
})(globalThis);