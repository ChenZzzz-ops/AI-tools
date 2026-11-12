(function (root) {
  'use strict';
  const engine = root.HalogenEngine;
  const workbook = root.HalogenWorkbook;
  const upper = value => String(value ?? '').trim().toUpperCase();
  const nullValues = () => Object.fromEntries(engine.ELEMENTS.map(element => [element, null]));
  const worstFR = 'FR(16), FR(17) or no info about FR';
  const nonHalogenFR = 'FR (40), FR(52), FR(30), FR(60)';
  const noAdditive = 'Other or no additif';
  function fingerprint(part) {
    return JSON.stringify((part.engineering?.rawMaterials || []).map(raw => [upper(raw.number), upper(raw.revision), upper(raw.name)]).sort((first, second) => JSON.stringify(first).localeCompare(JSON.stringify(second))));
  }
  function materialInfo(raw) {
    const name = upper(raw.name);
    const record = { category: 'unmapped', mode: 'unknown', resin: '', fr: '', additive: '', family: '', pvc: 'unknown', basis: '材料类型未识别', issues: [], number: String(raw.number || ''), name: String(raw.name || '') };
    if (/^(1STE|1ALU|1CU|1LAT|1ZAM|1INOX|1CPR|1BRO|1LAI|1BRS)/.test(record.number)) return { ...record, category: 'metal', pvc: 'no', basis: '金属材料号前缀识别', issues: [] };
    const metalPattern = /\b(EN\s+(?:10\d{3}|12\d{3}|13601|10346)|ASTM\s+[AB]\d+|JIS\s+G\s*\d+|ISO\s+(?:6931|898)|IS\s+4454|GB(?:\/T)?\s*(?:4423|3522)|CW\d{3}[A-Z]|CARBON STEEL|STAINLESS STEEL|STL|DX\d{2}[A-Z]{0,3}|S\d{3}[A-Z]{0,3}|DC\d{2}(?:\s*\+[A-Z])?|HC\d{3}[A-Z]{0,3}|X\d{1,3}Cr[A-Za-z0-9-]*)\b/;
    if (metalPattern.test(name)) return { ...record, category: 'metal', pvc: 'no', basis: '明确金属牌号/金属标准', issues: [] };
    const polymer = name.match(/\b(PVC|PTFE|PPS|PC|PBT|PET|PA\d*(?:\/\d+)?|PAA|PE|PP|ABS|POM|PMMA|UP|TPV|TPE|PUR|PU)\b/);
    if (!polymer) return { ...record, issues: [/COLORANT|MASTERBATCH/.test(name) ? '色母粒成分及添加比例未知' : '牌号不在识别规则中'] };
    record.category = 'plastic'; record.family = polymer[1]; record.pvc = polymer[1] === 'PVC' ? 'yes' : 'no';
    if (/\bPC\s*[+/]\s*(?:ABS|PBT|PET)\b/.test(name)) return { ...record, issues: ['共混材料比例未提供，不能套单一树脂系数'] };
    const codes = [...name.matchAll(/\bFR\s*\(([^)]+)\)/g)].flatMap(match => match[1].match(/\d+/g) || []);
    if (codes.some(code => !['16', '17', '30', '40', '52', '60'].includes(code))) return { ...record, issues: ['阻燃剂代码未收录，需补充声明或实测数据'] };
    const model = workbook.findMaterial(raw.number);
    const codedFR = codes.some(code => ['16', '17'].includes(code)) ? worstFR : codes.length ? nonHalogenFR : null;
    if (model && codedFR && model.fr !== codedFR) return { ...record, issues: ['原材料描述与附件材料库的阻燃剂信息冲突'] };
    record.resin = model?.resin || (polymer[1] === 'PVC' ? /SOFT|FLEXIBLE/.test(name) ? 'Soft PVC' : 'Rigid PVC' : polymer[1] === 'PTFE' ? 'PTFE part' : ['PC', 'PPS'].includes(polymer[1]) ? polymer[1] : 'Other resin');
    record.fr = codedFR || model?.fr || 'No FR';
    record.additive = /PTFE/.test(name) && polymer[1] !== 'PTFE' ? 'PTFE lubricated part' : model?.additive || noAdditive;
    record.mode = 'estimated';
    record.basis = model ? `材料数据库精确材料号匹配 ${raw.number}` : '材料牌号规则 + 原模板保守系数';
    if (!model && !codedFR) record.issues.push('未标明阻燃剂，默认按 No FR（0%）处理，请核实实际阻燃体系');
    if (!model) record.issues.push('添加剂按模板模型处理，需核对实际配方');
    return record;
  }
  function recognize(part, rules = []) {
    const result = { ...part, mode: 'unknown', values: nullValues(), resin: '', fr: '', additive: '' };
    const engineering = part.engineering || {};
    let materials = engineering.rawMaterials || [];
    const rule = rules.find(item => validRule(item) && upper(item.number) === upper(part.spn) && upper(item.revision) === upper(engineering.revision) && item.fingerprint === fingerprint(part));
    if (rule) {
      for (const key of ['category', 'mode', 'resin', 'fr', 'additive']) result[key] = rule[key];
      result.values = { ...rule.values }; result.evidence = rule.evidence;
      result.recognition = { source: 'user-database', basis: `本地确认记录 ${rule.number} / ${rule.revision || '-'}`, issues: [], family: rule.family || '', pvc: rule.pvc || 'unknown', halogenStatus: rule.halogenStatus || 'pending', standard: rule.standard || '', evidence: rule.evidence, ruleId: rule.id, rawNumbers: materials.map(raw => raw.number) };
      return result;
    }
    if (['user-database','manual'].includes(part.recognition?.source)) result.evidence='';
    if (!materials.length && engineering.materialFileNumber && engineering.materialFileNumber !== '*') {
      const found = (root.ENGINEERING_BOM_DATA?.materials || []).filter(raw => upper(raw.number) === upper(engineering.materialFileNumber));
      if (found.length === 1) materials = found;
    }
    const classifications = materials.map(materialInfo);
    const name = upper(part.name);
    const meta = { source: 'automatic', basis: '', issues: [], family: '', pvc: 'unknown', halogenStatus: 'pending', standard: '', evidence: '', rawNumbers: materials.map(raw => raw.number) };
    meta.family = [...new Set(classifications.map(item=>item.family).filter(Boolean))].join('/');
    const functionalCategory = /\b(PCB|PCBA|PRINTED CIRCUIT BOARD)\b|印刷电路板/.test(name) ? 'pcb' : /\b(RESISTOR|CAPACITOR|DIODE|TRANSISTOR|INTEGRATED CIRCUIT|MICROCONTROLLER|SENSOR|ELECTRONIC)\b|电子元件|电阻器|电容器/.test(name) ? 'electronic' : /\b(CABLE|WIRE|WIRING|CORD)\b|电缆|线缆/.test(name) ? 'cable' : null;
    if (functionalCategory) {
      result.category=functionalCategory; meta.basis='功能件名称识别；原材料不改变电子/线缆审核范围';
      if (functionalCategory==='cable' && /\bPVC\b/.test(name+' '+materials.map(raw=>upper(raw.name)).join(' '))) { meta.pvc='yes'; meta.halogenStatus='fail'; }
      if (materials.length) result.material=materials.map(raw=>`${raw.number} ${raw.name}`).join(' | ');
    } else if (classifications.length) {
      const allMetal = classifications.every(item => item.category === 'metal');
      if (allMetal) { result.category = 'metal'; meta.pvc = 'no'; meta.basis = '下级原材料全部为明确金属牌号'; }
      else {
        const selected = classifications.filter(item => upper(item.number) === upper(engineering.materialFileNumber));
        const candidates = selected.length === 1 && classifications.every(item => item.category === 'plastic') ? selected : classifications;
        result.category = candidates.some(item => item.category === 'plastic') ? 'plastic' : 'other';
        meta.pvc = candidates.some(item => item.pvc === 'yes') ? 'yes' : candidates.every(item => item.pvc === 'no') ? 'no' : 'unknown';
        const sameModel = candidates.every(item => item.category === 'plastic' && item.mode === 'estimated') && new Set(candidates.map(item => JSON.stringify([item.resin, item.fr, item.additive]))).size === 1;
        if (sameModel) {
          const material = candidates[0];
          ['mode', 'resin', 'fr', 'additive'].forEach(key => { result[key] = material[key]; });
          meta.family = [...new Set(candidates.map(item => item.family))].join('/'); meta.basis = material.basis;
          meta.issues = [...new Set(candidates.flatMap(item => item.issues))];
          if (candidates.length > 1) meta.issues.push('多个材料候选采用相同模板系数，实际用料仍需核实');
        } else { result.mode = 'unknown'; meta.basis = result.category === 'plastic' ? '原材料待确认' : '原材料未识别为塑料或金属，按其他件处理，不在卤素核查范围'; meta.issues = [...new Set(candidates.flatMap(item => item.issues))]; if (candidates.length > 1 && result.category === 'plastic') meta.issues.unshift('多个原材料模型或配比不明，未随意选取第一项'); }
      }
      result.material = materials.map(raw => `${raw.number} ${raw.name}`).join(' | ');
    } else if (/\b(CARDBOARD BOX|CARTON|PACKAGING LABEL)\b/.test(name)) { result.category = 'packaging'; meta.pvc = 'no'; meta.basis = '明确包装名称，排除于产品塑料范围'; }
    else if (/\b(GRAISSE|GREASE|LUBRICANT|SOLDER|ADHESIVE)\b/.test(name)) { result.category = 'consumable'; meta.basis = '耗材名称识别，未证明无卤'; }
    else { result.category = 'other'; meta.pvc = 'unknown'; meta.basis = '无 MPN / 材料牌号，默认按非塑料件处理，不在卤素核查范围'; }
    if (['electronic', 'pcb', 'cable', 'consumable'].includes(result.category)) meta.issues.push('未匹配专用无卤声明；RoHS/无铅/V0 均不等于无卤');
    if (result.category === 'plastic' && result.mode === 'unknown') meta.issues.push('缺少完整的四卤素含量或材料模型');
    if (result.unitMass === null) meta.issues.push('工程零件重量缺失，未使用 raw material 的数量代替');
    if (engineering.massIssue) meta.issues.push(engineering.massIssue + `；原值 ${engineering.reportedMass} g`);
    result.recognition = meta;
    return result;
  }
  function suggestAudits(parts) {
    const audits = Object.fromEntries(engine.AUDIT_KEYS.map(key => [key, { status: 'pending', evidence: '' }]));
    const pvcDetected = parts.some(part => part.category === 'plastic' && (part.recognition?.pvc === 'yes' || /\bPVC\b/i.test(`${part.material || ''} ${part.resin || ''}`)));
    audits.pvc = pvcDetected ? { status: 'fail', evidence: 'BOM 中检出 PVC 塑料件' } : { status: 'pass', evidence: 'BOM 未发现 PVC 材料牌号' };
    for (const category of ['cable', 'pcb', 'consumable', 'electronic']) {
      const matching = parts.filter(part => part.category === category);
      const failed = matching.filter(part => part.recognition?.halogenStatus === 'fail');
      const passed = matching.length > 0 && matching.every(part => part.recognition?.halogenStatus === 'pass' && part.recognition?.evidence && part.recognition?.standard);
      audits[category] = { status: failed.length ? 'fail' : passed ? 'pass' : 'pending', evidence: failed.length ? `数据库/材料检出不符合项：${failed.map(part => part.spn).join(', ')}` : passed ? matching.map(part => `${part.spn}: ${part.recognition.standard}; ${part.recognition.evidence}`).join('\n') : matching.length ? `已识别 ${matching.length} 项，仍需无卤标准对应的型号声明：${matching.map(part => part.spn).join(', ')}` : '未识别到此类零件；不自动推断不存在，请确认完整 BOM 范围。' };
    }
    audits.gas = { status: 'pending', evidence: 'BOM 不足以证明无卤化气体/液体（含 SF6），需产品设计确认。' };
    return audits;
  }
  function analyze(structure, rules = []) {
    const parts = structure.parts.map(part => recognize(part, rules));
    const categories = Object.fromEntries([...new Set(parts.map(part => part.category))].map(category => [category, parts.filter(part => part.category === category).length]));
    return { ...structure, parts, audits: suggestAudits(parts), categories, pending: parts.filter(part => part.category !== 'packaging' && !engine.evaluatePart(part).valid).length };
  }
  function validRule(rule) {
    if (!rule || !String(rule.number || '').trim() || !String(rule.evidence || '').trim() || typeof rule.fingerprint !== 'string' || rule.fingerprint.length > 30000 || !Object.hasOwn(workbook.categories,rule.category)) return false;
    if (rule.category === 'plastic' && rule.mode !== 'unknown' && !engine.evaluatePart({...rule,name:'Rule',quantity:1,unitMass:1}).valid) return false;
    const standards = {electronic:/IEC\s*61249[-\s]*2[-\s]*21|JS\s*709/i,pcb:/IPC[-\s]*4101/i,cable:/IEC\s*60754/i,consumable:/FTF\s*50064/i};
    if (rule.halogenStatus === 'pass' && standards[rule.category] && !standards[rule.category].test(rule.standard || '')) return false;
    return true;
  }
  root.HalogenRecognition = { materialInfo, recognize, analyze, suggestAudits, fingerprint, validRule, version: '1.0.0' };
})(globalThis);