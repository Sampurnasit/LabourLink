const db = require('../database');
const { getIvrConfig, webhookUrl, SPECIAL_DIGITS } = require('./ivrConfig');
const { getTelephonyAdapter } = require('./telephony');
const { toE164, last10Digits } = require('./telephony/phone');

const DEFAULT_CATEGORIES = [
  { digit: '1', category_name: 'Construction', hiring_agency_name: 'LabourLink Construction Desk' },
  { digit: '2', category_name: 'Driving', hiring_agency_name: 'LabourLink Driving Desk' },
  { digit: '3', category_name: 'Delivery', hiring_agency_name: 'LabourLink Delivery Desk' },
  { digit: '4', category_name: 'Housekeeping', hiring_agency_name: 'LabourLink Housekeeping Desk' },
  { digit: '5', category_name: 'Security', hiring_agency_name: 'LabourLink Security Desk' },
  { digit: '6', category_name: 'Factory/Warehouse', hiring_agency_name: 'LabourLink Warehouse Desk' },
  { digit: '7', category_name: 'Cooking/Kitchen staff', hiring_agency_name: 'LabourLink Kitchen Desk' },
  { digit: '8', category_name: 'Electrician/Plumber', hiring_agency_name: 'LabourLink Trades Desk' }
];

function defaultAgencyPhone() {
  return process.env.IVR_DEFAULT_AGENCY_PHONE || process.env.IVR_OPERATOR_PHONE || '9999900000';
}

async function seedDefaultCategoriesIfEmpty() {
  const row = await db.getAsync('SELECT COUNT(*) as count FROM job_categories');
  if (row && row.count > 0) return;
  const phone = defaultAgencyPhone();
  for (const cat of DEFAULT_CATEGORIES) {
    await db.runAsync(
      `INSERT OR IGNORE INTO job_categories (digit, category_name, hiring_agency_name, hiring_agency_phone, active)
       VALUES (?, ?, ?, ?, 1)`,
      [cat.digit, cat.category_name, cat.hiring_agency_name, phone]
    );
  }
  console.log('✓ Seeded default IVR job_categories (update hiring_agency_phone via admin API)');
}

async function listActiveCategories() {
  return db.allAsync(
    `SELECT * FROM job_categories WHERE active = 1 AND digit IN ('1','2','3','4','5','6','7','8')
     ORDER BY digit ASC`
  );
}

async function getCategoryByDigit(digit) {
  if (!digit) return null;
  return db.getAsync(
    'SELECT * FROM job_categories WHERE digit = ? AND active = 1',
    [String(digit)]
  );
}

function buildMenuPrompt(categories, cfg) {
  const lines = [cfg.welcomeMessage];
  for (const cat of categories) {
    lines.push(`Press ${cat.digit} for ${cat.category_name}.`);
  }
  lines.push('Press 9 to repeat the menu.');
  lines.push('Press 0 to talk to a human operator.');
  return lines.join(' ');
}

async function insertCallLog(fields) {
  const result = await db.runAsync(
    `INSERT INTO call_logs (
       call_sid, caller_number, called_number, digit_selected, category_name,
       agency_name, agency_phone, routed, outcome, connect_mode
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fields.call_sid || null,
      fields.caller_number || null,
      fields.called_number || null,
      fields.digit_selected || null,
      fields.category_name || null,
      fields.agency_name || null,
      fields.agency_phone || null,
      fields.routed ? 1 : 0,
      fields.outcome || 'started',
      fields.connect_mode || getIvrConfig().connectMode
    ]
  );
  return result.lastID;
}

async function updateCallLogBySid(callSid, fields) {
  if (!callSid) return;
  const existing = await db.getAsync(
    'SELECT * FROM call_logs WHERE call_sid = ? ORDER BY id DESC LIMIT 1',
    [callSid]
  );
  if (!existing) {
    await insertCallLog({ call_sid: callSid, ...fields });
    return;
  }
  const merged = { ...existing, ...fields };
  await db.runAsync(
    `UPDATE call_logs SET
       caller_number = ?, called_number = ?, digit_selected = ?, category_name = ?,
       agency_name = ?, agency_phone = ?, routed = ?, outcome = ?, connect_mode = ?,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      merged.caller_number,
      merged.called_number,
      merged.digit_selected,
      merged.category_name,
      merged.agency_name,
      merged.agency_phone,
      merged.routed ? 1 : 0,
      merged.outcome,
      merged.connect_mode,
      existing.id
    ]
  );
}

function callPartyFields(call) {
  return {
    caller_number: call.callerNumber || null,
    called_number: call.calledNumber || null
  };
}

function gatherActionUrl(attempt) {
  return webhookUrl(`/webhooks/voice/gather?attempt=${attempt}`);
}

async function handleIncoming(call) {
  const adapter = getTelephonyAdapter();
  const cfg = getIvrConfig();
  const attempt = 1;

  await insertCallLog({
    call_sid: call.callSid,
    caller_number: call.callerNumber,
    called_number: call.calledNumber,
    outcome: 'menu_played',
    connect_mode: cfg.connectMode
  });

  const categories = await listActiveCategories();
  if (!categories.length) {
    const fallback = cfg.fallbackPhone || cfg.operatorPhone;
    if (fallback) {
      await updateCallLogBySid(call.callSid, { outcome: 'no_categories_fallback' });
      return adapter.connectCall({
        introText: 'Our job menu is not available right now. Connecting you to an operator.',
        destinationPhone: fallback,
        actionUrl: webhookUrl('/webhooks/voice/dial-status'),
        callerId: cfg.callerId
      });
    }
    await updateCallLogBySid(call.callSid, { outcome: 'no_categories_configured' });
    return adapter.sayAndHangup(
      'Sorry, our job matching line is not configured yet. Please try again later. Goodbye.'
    );
  }

  return adapter.gatherMenu({
    menuText: buildMenuPrompt(categories, cfg),
    actionUrl: gatherActionUrl(attempt),
    timeoutSec: cfg.gatherTimeoutSec
  });
}

async function replayMenu(call, attempt, prefixMessage) {
  const adapter = getTelephonyAdapter();
  const cfg = getIvrConfig();
  const categories = await listActiveCategories();
  const prompt = `${prefixMessage || ''} ${buildMenuPrompt(categories, cfg)}`.trim();
  return adapter.gatherMenu({
    menuText: prompt,
    actionUrl: gatherActionUrl(attempt),
    timeoutSec: cfg.gatherTimeoutSec
  });
}

async function routeToNumber(call, { phone, introText, outcome, agencyName, categoryName, digit }) {
  const adapter = getTelephonyAdapter();
  const cfg = getIvrConfig();
  const dest = toE164(phone);
  if (!dest) {
    await updateCallLogBySid(call.callSid, {
      ...callPartyFields(call),
      digit_selected: digit || null,
      category_name: categoryName || null,
      agency_name: agencyName || null,
      routed: 0,
      outcome: 'no_destination_number'
    });
    return adapter.sayAndHangup(
      'Sorry, we could not connect your call because no phone number is configured. Please try again later.'
    );
  }

    await updateCallLogBySid(call.callSid, {
      ...callPartyFields(call),
      digit_selected: digit || null,
      category_name: categoryName || null,
      agency_name: agencyName || null,
      agency_phone: dest,
      routed: 1,
      outcome: outcome || 'bridging',
      connect_mode: 'bridge'
    });

  return adapter.connectCall({
    introText,
    destinationPhone: dest,
    actionUrl: webhookUrl('/webhooks/voice/dial-status'),
    callerId: cfg.callerId
  });
}

async function notifyAgency({ callerNumber, category, agency }) {
  const adapter = getTelephonyAdapter();
  const cfg = getIvrConfig();
  const workerPhone = callerNumber || 'unknown';
  const categoryName = category ? category.category_name : 'unspecified';
  const agencyName = agency ? agency.hiring_agency_name : 'agency';
  const agencyPhone = agency ? agency.hiring_agency_phone : '';
  const body =
    `LabourLink lead: worker ${workerPhone} selected "${categoryName}". ` +
    `Please call them back. Agency: ${agencyName}.`;

  const results = { sms: null, webhook: null };

  if (agencyPhone) {
    try {
      results.sms = await adapter.sendSms({ to: agencyPhone, body });
    } catch (err) {
      console.error('[IVR] Agency SMS failed:', err.message);
      results.sms = { error: err.message };
    }
  }

  if (cfg.agencyWebhookUrl) {
    try {
      const res = await fetch(cfg.agencyWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'labourlink-ivr',
          caller_number: workerPhone,
          caller_number_local: last10Digits(workerPhone),
          category_name: categoryName,
          digit: category ? category.digit : null,
          agency_name: agencyName,
          agency_phone: agencyPhone,
          received_at: new Date().toISOString()
        })
      });
      results.webhook = { status: res.status };
    } catch (err) {
      console.error('[IVR] Agency webhook failed:', err.message);
      results.webhook = { error: err.message };
    }
  }

  return results;
}

async function handleNotifyAndHangup(call, category) {
  const adapter = getTelephonyAdapter();
  await updateCallLogBySid(call.callSid, {
    ...callPartyFields(call),
    digit_selected: category.digit,
    category_name: category.category_name,
    agency_name: category.hiring_agency_name,
    agency_phone: category.hiring_agency_phone,
    routed: 1,
    outcome: 'notified',
    connect_mode: 'notify'
  });

  setImmediate(() => {
    notifyAgency({
      callerNumber: call.callerNumber,
      category,
      agency: category
    }).catch((err) => console.error('[IVR] notifyAgency error:', err.message));
  });

  return adapter.sayAndHangup(
    `Thank you. We have notified ${category.hiring_agency_name} about ${category.category_name} work. ` +
    'They will contact you shortly on this number. Goodbye.'
  );
}

async function handleGather(call, attempt) {
  const adapter = getTelephonyAdapter();
  const cfg = getIvrConfig();
  const digit = String(call.digit || '').trim();
  const currentAttempt = Math.max(1, parseInt(attempt, 10) || 1);

  if (digit === SPECIAL_DIGITS.REPEAT) {
    await updateCallLogBySid(call.callSid, { ...callPartyFields(call), digit_selected: '9', outcome: 'menu_repeated' });
    return replayMenu(call, currentAttempt, '');
  }

  if (digit === SPECIAL_DIGITS.OPERATOR) {
    if (!cfg.operatorPhone) {
      await updateCallLogBySid(call.callSid, { ...callPartyFields(call), digit_selected: '0', outcome: 'operator_unconfigured' });
      return adapter.sayAndHangup(
        'Sorry, no operator is available at the moment. Please try again later. Goodbye.'
      );
    }
    return routeToNumber(call, {
      phone: cfg.operatorPhone,
      introText: 'Please wait while we connect you to an operator.',
      outcome: 'bridging_operator',
      agencyName: 'Operator',
      digit: '0',
      categoryName: 'Operator'
    });
  }

  if (/^[1-8]$/.test(digit)) {
    const category = await getCategoryByDigit(digit);
    if (!category) {
      await updateCallLogBySid(call.callSid, {
        ...callPartyFields(call),
        digit_selected: digit,
        outcome: 'category_inactive_or_missing'
      });
      return retryOrFallback(
        call,
        currentAttempt,
        'Sorry, that job category is not available right now.'
      );
    }
    if (!category.hiring_agency_phone) {
      await updateCallLogBySid(call.callSid, {
        ...callPartyFields(call),
        digit_selected: digit,
        category_name: category.category_name,
        agency_name: category.hiring_agency_name,
        routed: 0,
        outcome: 'agency_phone_missing'
      });
      return retryOrFallback(
        call,
        currentAttempt,
        `Sorry, no hiring agency is configured for ${category.category_name} yet.`
      );
    }

    if (cfg.connectMode === 'notify') {
      return handleNotifyAndHangup(call, category);
    }

    return routeToNumber(call, {
      phone: category.hiring_agency_phone,
      introText: `Connecting you to ${category.hiring_agency_name} for ${category.category_name} jobs. Please wait.`,
      outcome: 'bridging_agency',
      agencyName: category.hiring_agency_name,
      categoryName: category.category_name,
      digit
    });
  }

  // Timeout (empty digit) or invalid key
  const reason = digit ? 'invalid_digit' : 'timeout';
  await updateCallLogBySid(call.callSid, { ...callPartyFields(call), digit_selected: digit || null, outcome: reason });
  const prefix = digit
    ? 'Sorry, that was not a valid option.'
    : 'Sorry, we did not receive your selection.';
  return retryOrFallback(call, currentAttempt, prefix);
}

async function retryOrFallback(call, currentAttempt, prefixMessage) {
  const cfg = getIvrConfig();
  if (currentAttempt < cfg.maxRetries) {
    return replayMenu(call, currentAttempt + 1, prefixMessage);
  }

  const fallback = cfg.fallbackPhone || cfg.operatorPhone;
  if (fallback) {
    return routeToNumber(call, {
      phone: fallback,
      introText: `${prefixMessage} Connecting you to an available desk.`,
      outcome: 'fallback_operator',
      agencyName: 'Fallback',
      categoryName: 'Fallback',
      digit: call.digit || null
    });
  }

  const adapter = getTelephonyAdapter();
  await updateCallLogBySid(call.callSid, { ...callPartyFields(call), routed: 0, outcome: 'max_retries_hangup' });
  return adapter.sayAndHangup(
    `${prefixMessage} We could not complete your request. Please call again later. Goodbye.`
  );
}

async function handleDialStatus(call) {
  const adapter = getTelephonyAdapter();
  const cfg = getIvrConfig();
  const status = (call.dialCallStatus || call.callStatus || '').toLowerCase();
  const connected = status === 'completed' || status === 'answered';

  if (connected) {
    await updateCallLogBySid(call.callSid, { routed: 1, outcome: `dial_${status || 'completed'}` });
    return adapter.hangupOnly();
  }

  await updateCallLogBySid(call.callSid, {
    routed: 0,
    outcome: `dial_${status || 'failed'}`
  });

  const fallback = cfg.fallbackPhone || cfg.operatorPhone;
  const existing = await db.getAsync(
    'SELECT * FROM call_logs WHERE call_sid = ? ORDER BY id DESC LIMIT 1',
    [call.callSid]
  );
  if (fallback && existing && existing.outcome !== 'fallback_operator' && existing.agency_name !== 'Fallback') {
    return routeToNumber(call, {
      phone: fallback,
      introText: 'The hiring agency could not be reached. Connecting you to an operator.',
      outcome: 'agency_unreachable_fallback',
      agencyName: 'Fallback',
      categoryName: existing.category_name,
      digit: existing.digit_selected
    });
  }

  return adapter.sayAndHangup(
    'Sorry, we could not reach the hiring agency. Please try calling again in a few minutes. Goodbye.'
  );
}

async function handleCallStatus(call) {
  const status = (call.callStatus || '').toLowerCase();
  if (!call.callSid || !status) return;
  const terminal = ['completed', 'busy', 'failed', 'no-answer', 'canceled'];
  if (terminal.includes(status)) {
    const existing = await db.getAsync(
      'SELECT outcome FROM call_logs WHERE call_sid = ? ORDER BY id DESC LIMIT 1',
      [call.callSid]
    );
    if (existing && existing.outcome && String(existing.outcome).startsWith('dial_')) return;
    if (existing && ['notified', 'bridging_agency', 'bridging_operator', 'fallback_operator'].includes(existing.outcome)) {
      return;
    }
    await updateCallLogBySid(call.callSid, { outcome: `call_${status}` });
  }
}

async function listCategoriesAdmin() {
  return db.allAsync('SELECT * FROM job_categories ORDER BY digit ASC');
}

async function createCategory({ digit, category_name, hiring_agency_name, hiring_agency_phone, active }) {
  const d = String(digit);
  if (!/^[0-9]$/.test(d)) {
    throw Object.assign(new Error('digit must be a single key 0-9'), { statusCode: 400 });
  }
  if (!category_name || !hiring_agency_name) {
    throw Object.assign(new Error('category_name and hiring_agency_name are required'), { statusCode: 400 });
  }
  try {
    const result = await db.runAsync(
      `INSERT INTO job_categories (digit, category_name, hiring_agency_name, hiring_agency_phone, active)
       VALUES (?, ?, ?, ?, ?)`,
      [d, category_name.trim(), hiring_agency_name.trim(), hiring_agency_phone || '', active === 0 || active === false ? 0 : 1]
    );
    return db.getAsync('SELECT * FROM job_categories WHERE id = ?', [result.lastID]);
  } catch (err) {
    if (String(err.message || '').toLowerCase().includes('unique')) {
      throw Object.assign(new Error('A category already uses that digit'), { statusCode: 409 });
    }
    throw err;
  }
}

async function updateCategory(id, fields) {
  const existing = await db.getAsync('SELECT * FROM job_categories WHERE id = ?', [id]);
  if (!existing) {
    throw Object.assign(new Error('Job category not found'), { statusCode: 404 });
  }
  const next = {
    digit: fields.digit !== undefined ? String(fields.digit) : existing.digit,
    category_name: fields.category_name !== undefined ? fields.category_name : existing.category_name,
    hiring_agency_name: fields.hiring_agency_name !== undefined ? fields.hiring_agency_name : existing.hiring_agency_name,
    hiring_agency_phone: fields.hiring_agency_phone !== undefined ? fields.hiring_agency_phone : existing.hiring_agency_phone,
    active: fields.active !== undefined ? (fields.active ? 1 : 0) : existing.active
  };
  await db.runAsync(
    `UPDATE job_categories
     SET digit = ?, category_name = ?, hiring_agency_name = ?, hiring_agency_phone = ?, active = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [next.digit, next.category_name, next.hiring_agency_name, next.hiring_agency_phone, next.active, id]
  );
  return db.getAsync('SELECT * FROM job_categories WHERE id = ?', [id]);
}

async function deactivateCategory(id) {
  return updateCategory(id, { active: 0 });
}

async function listCallLogs({ limit = 50, offset = 0 } = {}) {
  const cap = Math.min(parseInt(limit, 10) || 50, 200);
  const skip = parseInt(offset, 10) || 0;
  return db.allAsync(
    'SELECT * FROM call_logs ORDER BY id DESC LIMIT ? OFFSET ?',
    [cap, skip]
  );
}

module.exports = {
  DEFAULT_CATEGORIES,
  seedDefaultCategoriesIfEmpty,
  handleIncoming,
  handleGather,
  handleDialStatus,
  handleCallStatus,
  listCategoriesAdmin,
  createCategory,
  updateCategory,
  deactivateCategory,
  listCallLogs,
  listActiveCategories
};
