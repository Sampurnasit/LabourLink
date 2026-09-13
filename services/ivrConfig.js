require('dotenv').config();

const SPECIAL_DIGITS = {
  OPERATOR: '0',
  REPEAT: '9'
};

function envFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function getIvrConfig() {
  const port = process.env.PORT || 3000;
  const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, '');

  return {
    provider: (process.env.TELEPHONY_PROVIDER || 'twilio').toLowerCase(),
    publicBaseUrl,
    connectMode: (process.env.IVR_CONNECT_MODE || 'bridge').toLowerCase() === 'notify' ? 'notify' : 'bridge',
    gatherTimeoutSec: parseInt(process.env.IVR_GATHER_TIMEOUT, 10) || 8,
    maxRetries: parseInt(process.env.IVR_MAX_RETRIES, 10) || 2,
    dialTimeoutSec: parseInt(process.env.IVR_DIAL_TIMEOUT, 10) || 25,
    voice: process.env.IVR_VOICE || 'Polly.Aditi',
    language: process.env.IVR_LANGUAGE || 'en-IN',
    operatorPhone: process.env.IVR_OPERATOR_PHONE || '',
    fallbackPhone: process.env.IVR_FALLBACK_PHONE || process.env.IVR_OPERATOR_PHONE || '',
    callerId: process.env.TWILIO_PHONE_NUMBER || process.env.IVR_CALLER_ID || '',
    agencyWebhookUrl: process.env.IVR_AGENCY_WEBHOOK_URL || '',
    skipSignature: envFlag('IVR_SKIP_SIGNATURE', false),
    adminApiKey: process.env.ADMIN_API_KEY || '',
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
    twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
    welcomeMessage: process.env.IVR_WELCOME_MESSAGE ||
      'Welcome to Labour Link. Please select the job category you are looking for.'
  };
}

function webhookUrl(pathnameAndQuery) {
  const cfg = getIvrConfig();
  const path = pathnameAndQuery.startsWith('/') ? pathnameAndQuery : `/${pathnameAndQuery}`;
  return `${cfg.publicBaseUrl}${path}`;
}

module.exports = {
  SPECIAL_DIGITS,
  getIvrConfig,
  webhookUrl,
  envFlag
};
