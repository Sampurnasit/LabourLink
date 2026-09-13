const { getIvrConfig } = require('../ivrConfig');
const twilioAdapter = require('./twilioAdapter');

/**
 * Provider-specific telephony lives behind this factory so Exotel/Plivo
 * can be added later without changing IVR business logic.
 */
function getTelephonyAdapter() {
  const { provider } = getIvrConfig();
  if (provider === 'twilio') {
    return twilioAdapter;
  }
  if (provider === 'exotel' || provider === 'plivo') {
    throw new Error(
      `Telephony provider "${provider}" is not implemented yet. ` +
      'Keep IVR logic in services/ivrService.js and add an adapter under services/telephony/.'
    );
  }
  throw new Error(`Unknown TELEPHONY_PROVIDER "${provider}". Supported: twilio`);
}

module.exports = { getTelephonyAdapter };
