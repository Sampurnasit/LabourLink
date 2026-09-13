const twilio = require('twilio');
const { getIvrConfig, webhookUrl } = require('../ivrConfig');
const { toE164 } = require('./phone');

function escapeXml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sayAttrs() {
  const cfg = getIvrConfig();
  return `voice="${escapeXml(cfg.voice)}" language="${escapeXml(cfg.language)}"`;
}

function xmlResponse(inner) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

function say(text) {
  return `<Say ${sayAttrs()}>${escapeXml(text)}</Say>`;
}

function sendXml(res, xml) {
  res.set('Content-Type', 'text/xml');
  return res.status(200).send(xml);
}

function parseIncomingCall(req) {
  const b = req.body || {};
  return {
    callSid: b.CallSid || b.CallUUID || '',
    callerNumber: b.From || b.Caller || '',
    calledNumber: b.To || b.Called || '',
    digit: b.Digits || '',
    callStatus: b.CallStatus || '',
    dialCallStatus: b.DialCallStatus || '',
    dialCallSid: b.DialCallSid || ''
  };
}

function gatherMenu({ menuText, actionUrl, timeoutSec }) {
  const timeout = timeoutSec || getIvrConfig().gatherTimeoutSec;
  return xmlResponse(
    `<Gather numDigits="1" timeout="${timeout}" action="${escapeXml(actionUrl)}" method="POST">` +
      say(menuText) +
    `</Gather>` +
    `<Redirect method="POST">${escapeXml(actionUrl)}</Redirect>`
  );
}

function connectCall({ introText, destinationPhone, actionUrl, callerId, timeoutSec }) {
  const cfg = getIvrConfig();
  const to = toE164(destinationPhone);
  const from = toE164(callerId || cfg.callerId);
  const timeout = timeoutSec || cfg.dialTimeoutSec;
  const callerAttr = from ? ` callerId="${escapeXml(from)}"` : '';
  return xmlResponse(
    say(introText) +
    `<Dial timeout="${timeout}" action="${escapeXml(actionUrl)}" method="POST"${callerAttr}>` +
      `<Number>${escapeXml(to)}</Number>` +
    `</Dial>`
  );
}

function sayAndHangup(text) {
  return xmlResponse(say(text) + '<Hangup/>');
}

function sayAndRedirect({ text, redirectUrl }) {
  return xmlResponse(say(text) + `<Redirect method="POST">${escapeXml(redirectUrl)}</Redirect>`);
}

function hangupOnly() {
  return xmlResponse('<Hangup/>');
}

function validateWebhook(req) {
  const cfg = getIvrConfig();
  const host = (req.get('host') || '').toLowerCase();
  const isLocalHost = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  if (cfg.skipSignature || !cfg.twilioAuthToken || isLocalHost) {
    return { ok: true, skipped: true };
  }
  const signature = req.get('X-Twilio-Signature');
  if (!signature) {
    return { ok: false, error: 'Missing X-Twilio-Signature' };
  }
  const fullUrl = webhookUrl(req.originalUrl || req.url);
  const ok = twilio.validateRequest(cfg.twilioAuthToken, signature, fullUrl, req.body || {});
  return { ok, error: ok ? null : 'Invalid Twilio signature' };
}

async function sendSms({ to, body }) {
  const cfg = getIvrConfig();
  if (!cfg.twilioAccountSid || !cfg.twilioAuthToken || !cfg.twilioPhoneNumber) {
    throw new Error('Twilio SMS is not configured (TWILIO_ACCOUNT_SID / AUTH_TOKEN / PHONE_NUMBER)');
  }
  const client = twilio(cfg.twilioAccountSid, cfg.twilioAuthToken);
  return client.messages.create({
    to: toE164(to),
    from: cfg.twilioPhoneNumber,
    body
  });
}

module.exports = {
  name: 'twilio',
  parseIncomingCall,
  sendXml,
  gatherMenu,
  connectCall,
  sayAndHangup,
  sayAndRedirect,
  hangupOnly,
  validateWebhook,
  sendSms
};
