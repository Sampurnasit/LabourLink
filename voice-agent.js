/**
 * voice-agent.js
 * Telephony & ElevenLabs Conversational AI Integration Layer for LabourLink.
 *
 * Supports both:
 *   - Twilio  â†’ TwiML <Connect><Stream>
 *   - Exotel  â†’ ExoML <Connect><Stream>  (same XML structure, different validation)
 *
 * Architecture:
 *   Caller â†’ Exotel/Twilio Number â†’ POST /api/voice/incoming
 *          â†’ Backend looks up caller & builds dynamic context
 *          â†’ Returns XML <Connect><Stream wss://elevenlabs...> 
 *          â†’ ElevenLabs Agent speaks & calls /api/voice/tools/:toolName
 *          â†’ Human escalation via <Dial> fallback
 */

require('dotenv').config();
const db = require('./database');

const ELEVENLABS_API_KEY  = (process.env.ELEVENLABS_API_KEY  || '').trim();
const ELEVENLABS_AGENT_ID = (process.env.ELEVENLABS_AGENT_ID || '').trim();
const HUMAN_TRANSFER_NUMBER = process.env.HUMAN_TRANSFER_NUMBER || '+919900112233';
const EXOTEL_ACCOUNT_SID  = (process.env.EXOTEL_ACCOUNT_SID  || '').trim();
const EXOTEL_API_KEY      = (process.env.EXOTEL_API_KEY      || '').trim();

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function cleanPhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/[^0-9]/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * Detects which telephony platform sent this request.
 * Exotel sends X-Exotel-SID or CallSid in query params with their format.
 * Returns: 'exotel' | 'twilio' | 'unknown'
 */
function detectProvider(req) {
  if (req.headers['x-exotel-sid'] || req.query.ExotelSid || req.body.ExotelSid) return 'exotel';
  if (req.headers['x-twilio-signature'] || req.body.CallSid?.startsWith('CA')) return 'twilio';
  // Fallback: if Exotel account is configured, assume Exotel
  if (EXOTEL_ACCOUNT_SID && !process.env.TWILIO_ACCOUNT_SID) return 'exotel';
  return 'unknown';
}

/**
 * Validates Exotel webhook authenticity.
 * Exotel sends requests from known IPs â€” in production, verify via HMAC.
 */
function validateExotelRequest(req) {
  if (process.env.NODE_ENV !== 'production') return true;
  // TODO: Exotel webhook HMAC validation when they add it
  // Currently Exotel does not sign webhook payloads, so we skip
  return true;
}

/**
 * Validates Twilio webhook signature (production only).
 */
function validateTwilioSignature(req) {
  if (!process.env.TWILIO_AUTH_TOKEN || process.env.NODE_ENV !== 'production') return true;
  try {
    const twilio = require('twilio');
    const signature = req.headers['x-twilio-signature'];
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const url = `${protocol}://${req.get('host')}${req.originalUrl}`;
    return twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, signature, url, req.body || {});
  } catch (_) { return true; }
}

// â”€â”€â”€ ElevenLabs Signed URL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Gets an authenticated signed WebSocket URL from ElevenLabs.
 * Required when using a private agent (enable_auth: true).
 */
async function getElevenLabsSignedUrl(agentId) {
  if (!agentId || !ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_AGENT_ID or ELEVENLABS_API_KEY is not configured');
  }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${encodeURIComponent(agentId)}`,
    {
      method: 'GET',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' }
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ElevenLabs API ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.signed_url;
}

// â”€â”€â”€ XML Response Builders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Builds XML to stream the call into ElevenLabs via WebSocket.
 * Works for BOTH Twilio TwiML and Exotel ExoML (identical XML structure).
 */
function buildStreamXml({ streamUrl, callerPhone, callerName, callerRole, callSid }) {
  const safeUrl = (streamUrl || `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${encodeURIComponent(ELEVENLABS_AGENT_ID)}`).replace(/&/g, '&amp;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${safeUrl}">
      <Parameter name="caller_phone" value="${callerPhone || ''}"/>
      <Parameter name="caller_name" value="${(callerName || 'Caller').replace(/"/g, '&quot;')}"/>
      <Parameter name="user_role" value="${callerRole || 'guest'}"/>
      <Parameter name="call_sid" value="${callSid || ''}"/>
    </Stream>
  </Connect>
</Response>`;
}

/**
 * Builds a fallback XML response â€” says a message then dials human support.
 */
function buildFallbackXml({ transferToHuman = true } = {}) {
  if (transferToHuman && HUMAN_TRANSFER_NUMBER) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en-IN">Namaste and welcome to LabourLink. Our automated assistant is currently busy. Connecting you to our support coordinator now.</Say>
  <Dial>${HUMAN_TRANSFER_NUMBER}</Dial>
</Response>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en-IN">Namaste and welcome to LabourLink. We cannot connect your call right now. Please visit our app or website. Thank you.</Say>
  <Hangup/>
</Response>`;
}

/**
 * Builds XML to transfer to human coordinator (for /api/voice/escalate).
 */
function buildEscalateXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en-IN">Transferring you to a LabourLink coordinator. Please stay on the line.</Say>
  <Dial>${HUMAN_TRANSFER_NUMBER}</Dial>
</Response>`;
}

// â”€â”€â”€ Main Call Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Handles incoming voice call webhook (Exotel or Twilio).
 * Called from POST /api/voice/incoming
 */
async function handleIncomingCall(req) {
  // Support both Exotel and Twilio field names
  const callSid    = req.body.CallSid || req.body.ExotelSid || `CALL_${Date.now()}`;
  const fromRaw    = req.body.From || req.body.CallFrom || req.body.Caller || req.body.Direction === 'inbound' ? req.body.From : '';
  const toRaw      = req.body.To   || req.body.CallTo   || req.body.Called || '';
  const callerPhone = cleanPhone(fromRaw);
  const provider   = detectProvider(req);

  console.log(`ðŸ“ž [Incoming Call] Provider: ${provider} | SID: ${callSid} | From: ${fromRaw} (${callerPhone}) | To: ${toRaw}`);

  let callerName = null;
  let callerRole = 'guest';

  // Pre-call DB lookup to enrich AI context
  try {
    if (callerPhone) {
      const worker = await db.getAsync('SELECT name FROM workers WHERE phone_number = ?', [callerPhone]);
      if (worker) {
        callerRole = 'worker';
        callerName = worker.name;
      } else {
        const employer = await db.getAsync('SELECT employer_name FROM jobs WHERE employer_phone = ? LIMIT 1', [callerPhone]);
        if (employer) {
          callerRole = 'employer';
          callerName = employer.employer_name;
        }
      }
    }
  } catch (dbErr) {
    console.warn('âš ï¸ [Voice] DB lookup warning:', dbErr.message);
  }

  // Log call record
  try {
    await db.logVoiceCall({ callSid, callerPhone: callerPhone || fromRaw, callerRole, callerName, status: 'in-progress' });
  } catch (logErr) {
    console.warn('âš ï¸ [Voice] Call log warning:', logErr.message);
  }

  // If no agent configured â†’ fallback immediately
  if (!ELEVENLABS_AGENT_ID) {
    console.warn('âš ï¸ [Voice] ELEVENLABS_AGENT_ID not set. Run: node setup-elevenlabs-agent.js');
    return buildFallbackXml({ transferToHuman: true });
  }

  // Build ElevenLabs stream URL
  try {
    let streamUrl;
    if (ELEVENLABS_API_KEY) {
      try {
        streamUrl = await getElevenLabsSignedUrl(ELEVENLABS_AGENT_ID);
        console.log('âœ… [Voice] Acquired ElevenLabs signed URL');
      } catch (signErr) {
        console.warn(`âš ï¸ [Voice] Signed URL failed (${signErr.message}). Using public agent URL.`);
        streamUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${encodeURIComponent(ELEVENLABS_AGENT_ID)}`;
      }
    } else {
      streamUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${encodeURIComponent(ELEVENLABS_AGENT_ID)}`;
    }

    return buildStreamXml({ streamUrl, callerPhone, callerName, callerRole, callSid });

  } catch (err) {
    console.error('âŒ [Voice] ElevenLabs connection failed:', err.message);
    try {
      await db.updateVoiceCall({ callSid, status: 'failed_fallback', summary: err.message });
    } catch (_) {}
    return buildFallbackXml({ transferToHuman: true });
  }
}

/**
 * Handles Twilio/Exotel call status callback (completed, failed, busy, etc.)
 */
async function handleCallStatus(req) {
  const callSid  = req.body.CallSid || req.body.ExotelSid;
  const duration = req.body.CallDuration || req.body.Duration;
  const status   = req.body.CallStatus  || req.body.Status || 'completed';

  console.log(`ðŸ“´ [Call Status] SID: ${callSid} | Status: ${status} | Duration: ${duration || 0}s`);

  if (callSid) {
    await db.updateVoiceCall({ callSid, durationSeconds: duration, status });
  }
}

/**
 * Handles human escalation â€” returns XML to dial support coordinator.
 */
function handleEscalateCall() {
  return buildEscalateXml();
}

module.exports = {
  handleIncomingCall,
  handleCallStatus,
  handleEscalateCall,
  getElevenLabsSignedUrl,
  buildStreamXml,
  buildFallbackXml,
  detectProvider,
  validateExotelRequest,
  validateTwilioSignature
};
