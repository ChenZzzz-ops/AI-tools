(function (root) {
  'use strict';
  const ELEMENTS = ['cl', 'br', 'f', 'i'];
  const LIMITS = { cl: 1500, br: 1500, f: 3000, i: 3000, total: 4000 };
  const RESINS = {
    'Rigid PVC': [520000, 0, 0, 0],
    'Soft PVC': [280000, 0, 0, 0],
    'PPS': [2000, 0, 0, 0],
    'PTFE part': [0, 0, 760000, 0],
    'PC': [0, 0, 3000, 0],
    'Other resin': [0, 0, 0, 0]
  };
  const RETARDANTS = {
    'FR(16), FR(17) or no info about FR': [0, 90000, 0, 0],
    'FR (40), FR(52), FR(30), FR(60)': [0, 0, 0, 0],
    'No FR': [0, 0, 0, 0]
  };
  const ADDITIVES = {
    'PTFE lubricated part': [0, 0, 76000, 0],
    'Other or no additif': [0, 0, 0, 0]
  };
  const AUDIT_KEYS = ['cable', 'pcb', 'consumable', 'electronic', 'gas'];
  const CLAIM_RULES = [
    { id: 'plastic', label: 'Halogen plastics free', conditions: [1, 6] },
    { id: 'plastic-cable', label: 'Halogen free plastic parts & cables product', conditions: [1, 2, 6] },
    { id: 'product', label: 'Halogen free product', conditions: [1, 2, 3, 4, 5, 6] }
  ];
  function number(value) {
    if (!['string', 'number'].includes(typeof value) || typeof value === 'string' && !value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  function evaluatePart(part) {
    const quantity = number(part.quantity);
    const unitMass = number(part.unitMass);
    const errors = [];
    if (!String(part.name || '').trim()) errors.push('name');
    if (part.category === 'plastic' && (quantity === null || quantity <= 0)) errors.push('quantity');
    if (part.category === 'plastic' && (unitMass === null || unitMass <= 0)) errors.push('mass');
    if (!['plastic', 'metal', 'cable', 'pcb', 'consumable', 'electronic', 'other', 'packaging'].includes(part.category)) errors.push('category');
    const mass = quantity > 0 && unitMass > 0 ? quantity * unitMass : 0;
    const ppm = {};
    if (part.category === 'plastic') {
      if (part.mode === 'known') {
        ELEMENTS.forEach(element => {
          ppm[element] = number(part.values && part.values[element]);
          if (ppm[element] === null || ppm[element] < 0 || ppm[element] > 1000000) errors.push(element);
        });
      } else if (part.mode === 'compliant') {
        ELEMENTS.forEach(element => { ppm[element] = LIMITS[element] * 0.9; });
      } else if (part.mode === 'estimated') {
        const resin = RESINS[part.resin];
        const retardant = RETARDANTS[part.fr];
        const additive = ADDITIVES[part.additive];
        if (!resin || !retardant || !additive) errors.push('material-model');
        else ELEMENTS.forEach((element, index) => { ppm[element] = resin[index] + retardant[index] + additive[index]; });
      } else errors.push('halogen-data');
      if (ELEMENTS.every(element => ppm[element] !== null && ppm[element] !== undefined) && ELEMENTS.reduce((sum, element) => sum + ppm[element], 0) > 1000000) errors.push('concentration-sum');
    }
    if (!Number.isFinite(mass)) errors.push('mass');
    const valid = errors.length === 0;
    const grams = Object.fromEntries(ELEMENTS.map(element => [element, valid && part.category === 'plastic' ? mass * ppm[element] / 1000000 : 0]));
    const totalGrams = part.mode === 'compliant' && valid ? mass * 0.0036 : ELEMENTS.reduce((sum, element) => sum + grams[element], 0);
    return { ...part, mass: Number.isFinite(mass) ? mass : 0, ppm, grams, totalGrams, valid, errors };
  }
  function calculate(parts, audits = {}, methodVersion = '1.1.0') {
    const rows = parts.map(evaluatePart);
    const plastics = rows.filter(part => part.category === 'plastic');
    const plasticMass = plastics.reduce((sum, part) => sum + part.mass, 0);
    const coveredMass = plastics.filter(part => part.valid).reduce((sum, part) => sum + part.mass, 0);
    const legacy = methodVersion === '1.0.0';
    const scopeComplete = rows.every(part => !part.errors.includes('category'));
    const complete = plastics.length > 0 && plasticMass > 0 && Number.isFinite(plasticMass) && (legacy ? rows.every(part => part.valid) : scopeComplete && plastics.every(part => part.valid));
    const grams = Object.fromEntries(ELEMENTS.map(element => [element, plastics.reduce((sum, part) => sum + part.grams[element], 0)]));
    const totalGrams = plastics.reduce((sum, part) => sum + part.totalGrams, 0);
    const ppm = Object.fromEntries(ELEMENTS.map(element => [element, plasticMass > 0 ? grams[element] / plasticMass * 1000000 : 0]));
    ppm.total = plasticMass > 0 ? totalGrams / plasticMass * 1000000 : 0;
    const exceeds = Object.keys(LIMITS).some(element => ppm[element] > LIMITS[element] + 1e-8);
    const near = Object.keys(LIMITS).some(element => ppm[element] > LIMITS[element] * 0.8 + 1e-8);
    const status = !complete ? 'incomplete' : exceeds ? 'fail' : near ? 'review' : 'pass';
    const auditFailed = key => audits[key]?.status === 'fail' || !legacy && rows.some(part => part.category === key && part.recognition?.halogenStatus === 'fail');
    const auditPass = key => !auditFailed(key) && audits[key]?.status === 'pass' && !!String(audits[key]?.evidence || '').trim();
    const pvcPresent = plastics.some(part => part.recognition?.pvc === 'yes' || /\bPVC\b/i.test(`${part.material || ''} ${part.resin || ''}`));
    const pvcAudit = audits.pvc?.status;
    const pvcStatus = pvcPresent ? 'fail' : pvcAudit === 'fail' ? 'fail' : pvcAudit === 'pending' ? 'incomplete' : 'pass';
    const plasticClaim = status === 'pass' && pvcStatus === 'pass' && auditPass('gas');
    const cableClaim = plasticClaim && auditPass('cable');
    const productClaim = cableClaim && ['pcb', 'consumable', 'electronic'].every(auditPass);
    const anyAuditFail = AUDIT_KEYS.some(auditFailed) || pvcPresent;
    const productStatus = status === 'fail' || anyAuditFail ? 'fail' : productClaim ? 'pass' : 'incomplete';
    const claim = productClaim ? 'product' : cableClaim ? 'plastic-cable' : plasticClaim ? 'plastic' : 'none';
    const conditionKeys = { 2: 'cable', 3: 'pcb', 4: 'consumable', 5: 'electronic', 6: 'gas' };
    const conditions = { 1: status === 'fail' || pvcStatus === 'fail' ? 'fail' : status === 'pass' && pvcStatus === 'pass' ? 'pass' : status === 'review' ? 'review' : 'incomplete' };
    Object.entries(conditionKeys).forEach(([condition, key]) => { conditions[condition] = auditFailed(key) ? 'fail' : auditPass(key) ? 'pass' : 'incomplete'; });
    const claims = CLAIM_RULES.map(rule => ({ ...rule, status: rule.conditions.some(condition => conditions[condition] === 'fail') ? 'fail' : rule.conditions.every(condition => conditions[condition] === 'pass') ? 'pass' : 'incomplete', pending: rule.conditions.filter(condition => conditions[condition] !== 'pass') }));
    return { rows, plasticMass, totalMass: rows.filter(part => part.category !== 'packaging').reduce((sum, part) => sum + part.mass, 0), coveredMass, coverage: plasticMass > 0 ? coveredMass / plasticMass * 100 : 0, complete, grams, totalGrams, ppm, status, productStatus, claim, claims, conditions, pvcPresent, pvcStatus, plasticCount: plastics.length, estimatedCount: plastics.filter(part => part.mode === 'estimated').length, missingCount: rows.filter(part => !part.valid).length, scopeUnknownCount: rows.filter(part => part.errors.includes('category')).length };
  }
  root.HalogenEngine = { ELEMENTS, LIMITS, RESINS, RETARDANTS, ADDITIVES, AUDIT_KEYS, CLAIM_RULES, number, evaluatePart, calculate, version: '1.1.0' };
})(globalThis);