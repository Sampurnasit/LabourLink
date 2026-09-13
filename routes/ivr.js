const express = require('express');
const { getTelephonyAdapter } = require('../services/telephony');
const ivrService = require('../services/ivrService');

const router = express.Router();

function parseAttempt(req) {
  return req.query.attempt || req.body.attempt || 1;
}

function requireValidWebhook(req, res, next) {
  try {
    const adapter = getTelephonyAdapter();
    const check = adapter.validateWebhook(req);
    if (!check.ok) {
      console.warn('[IVR] Webhook auth failed:', check.error);
      return res.status(403).send('Forbidden');
    }
    next();
  } catch (err) {
    console.error('[IVR] Webhook validation error:', err.message);
    return res.status(500).send('Webhook validation error');
  }
}

function sendProviderXml(res, xml) {
  const adapter = getTelephonyAdapter();
  return adapter.sendXml(res, xml);
}

router.use((req, res, next) => {
  console.log(`[IVR ${req.method}] ${req.originalUrl} from ${req.ip}`);
  next();
});

router.use(requireValidWebhook);

router.post('/incoming', async (req, res) => {
  try {
    const adapter = getTelephonyAdapter();
    const call = adapter.parseIncomingCall(req);
    const xml = await ivrService.handleIncoming(call);
    return sendProviderXml(res, xml);
  } catch (err) {
    console.error('[IVR] incoming error:', err);
    try {
      const adapter = getTelephonyAdapter();
      return sendProviderXml(
        res,
        adapter.sayAndHangup('Sorry, we are experiencing a technical problem. Please try again later. Goodbye.')
      );
    } catch (inner) {
      res.status(500).send('IVR error');
    }
  }
});

router.post('/gather', async (req, res) => {
  try {
    const adapter = getTelephonyAdapter();
    const call = adapter.parseIncomingCall(req);
    const xml = await ivrService.handleGather(call, parseAttempt(req));
    return sendProviderXml(res, xml);
  } catch (err) {
    console.error('[IVR] gather error:', err);
    try {
      const adapter = getTelephonyAdapter();
      return sendProviderXml(
        res,
        adapter.sayAndHangup('Sorry, we could not process your selection. Please call again. Goodbye.')
      );
    } catch (inner) {
      res.status(500).send('IVR error');
    }
  }
});

router.post('/dial-status', async (req, res) => {
  try {
    const adapter = getTelephonyAdapter();
    const call = adapter.parseIncomingCall(req);
    const xml = await ivrService.handleDialStatus(call);
    return sendProviderXml(res, xml);
  } catch (err) {
    console.error('[IVR] dial-status error:', err);
    try {
      const adapter = getTelephonyAdapter();
      return sendProviderXml(
        res,
        adapter.sayAndHangup('Sorry, the call could not be completed. Goodbye.')
      );
    } catch (inner) {
      res.status(500).send('IVR error');
    }
  }
});

router.post('/status', async (req, res) => {
  try {
    const adapter = getTelephonyAdapter();
    const call = adapter.parseIncomingCall(req);
    await ivrService.handleCallStatus(call);
    res.status(204).end();
  } catch (err) {
    console.error('[IVR] status callback error:', err);
    res.status(204).end();
  }
});

module.exports = router;
