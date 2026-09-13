/**
 * voice-agent.js
 * Telephony & ElevenLabs Conversational AI Integration Layer for LabourLink.
 *
 * Architecture:
 *   Caller -> Existing Toll-Free Number -> Twilio -> /api/voice/incoming
 *          -> Backend Identifies Caller & Builds Dynamic Context
 *          -> Twilio <Connect><Stream> connects to ElevenLabs Conversational AI
 *          -> ElevenLabs Agent speaks & calls /api/voice/tools/:toolName
 *          -> Graceful Human Escalation fallback via <Dial>
 */

require('dotenv').config();
const db = require('./database');
const twilio = require('twilio');

const ELEVENLABS_API_KEY = (process.env.ELEVENLABS_API_KEY || '').trim();
const ELEVENLABS_AGENT_ID = (process.env.ELEVENLABS_AGENT_ID || '').trim();
const HUMAN_TRANSFER_NUMBER = process.env.HUMAN_TRANSFER_NUMBER || '+919900112233';

// Helper to sanitize phone input
function cleanPhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/[^0-9]/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * Validates Twilio incoming webhook signature in production
 */
function validateTwilioSignature(req) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken || process.env.NODE_ENV !== 'production') {
    return true; // Skip in local/development mode or when token is not provided
  }
  const signature = req.headers['x-twilio-signature'];
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const url = `${protocol}://${req.get('host')}${req.originalUrl}`;
  return twilio.validateRequest(authToken, signature, url, req.body || {});
}

/**
 * Fetches an authenticated Signed WebSocket URL from ElevenLabs Conversational AI
 * Supports dynamic conversation variables for personalized context.
 */
async function getElevenLabsSignedUrl(agentId, dynamicVariables = {}) {
  if (!agentId || !ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_AGENT_ID or ELEVENLABS_API_KEY is not configured');
  }

  const url = `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${encodeURIComponent(agentId)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json'
    }
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`ElevenLabs API returned ${res.status}: ${errorText}`);
  }

  const data = await res.json();
  return data.signed_url;
}

/**
 * Generates TwiML to connect Twilio call directly to ElevenLabs Agent
 */
function generateElevenLabsConnectTwiml({ streamUrl, agentId, callerPhone, callerName, callerRole, callSid }) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  const connect = twiml.connect();
  // Twilio Media Streams to ElevenLabs WebSocket
  const stream = connect.stream({
    url: streamUrl || `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${agentId}`
  });

  // Inject dynamic caller parameters into the stream
  stream.parameter({ name: 'caller_phone', value: callerPhone || '' });
  stream.parameter({ name: 'caller_name', value: callerName || 'Valued Caller' });
  stream.parameter({ name: 'user_role', value: callerRole || 'guest' });
  stream.parameter({ name: 'call_sid', value: callSid || '' });

  return twiml.toString();
}

/**
 * Generates fallback TwiML when ElevenLabs is unconfigured, down, or fails
 */
function generateFallbackTwiml({ reason = 'temporary service unavailability', transferToHuman = true }) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  if (transferToHuman && HUMAN_TRANSFER_NUMBER) {
    twiml.say(
      { voice: 'Polly.Aditi', language: 'en-IN' },
      'Namaste and welcome to LabourLink. Our automated voice assistant is currently busy. Please stay on the line while we connect you to our support coordinator.'
    );
    twiml.dial(HUMAN_TRANSFER_NUMBER);
  } else {
    twiml.say(
      { voice: 'Polly.Aditi', language: 'en-IN' },
      'Namaste and welcome to LabourLink. We are unable to connect your call right now. Please visit our mobile application or website to find workers and jobs. Thank you.'
    );
    twiml.hangup();
  }

  return twiml.toString();
}

/**
 * Main incoming call orchestrator (called from POST /api/voice/incoming)
 */
async function handleIncomingCall(req) {
  const callSid = req.body.CallSid || `CALL_${Date.now()}`;
  const fromRaw = req.body.From || req.body.Caller || '';
  const toRaw = req.body.To || req.body.Called || '';
  const callerPhone = cleanPhone(fromRaw);

  console.log(`📞 [Incoming Call] SID: ${callSid} | From: ${fromRaw} (${callerPhone || 'unknown'}) | To: ${toRaw}`);

  let callerName = null;
  let callerRole = 'guest';

  // Step 1: Pre-call database lookup to enrich AI conversation context
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
    console.warn('⚠️ [Voice Agent] DB lookup warning (non-fatal):', dbErr.message);
  }

  // Step 2: Log call record in database
  try {
    await db.logVoiceCall({
      callSid,
      callerPhone: callerPhone || fromRaw,
      callerRole,
      callerName,
      status: 'in-progress'
    });
  } catch (logErr) {
    console.warn('⚠️ [Voice Agent] Call log warning:', logErr.message);
  }

  // Step 3: Check if ElevenLabs credentials are fully configured
  if (!ELEVENLABS_AGENT_ID) {
    console.warn('⚠️ [Voice Agent] ELEVENLABS_AGENT_ID is not configured in .env. Falling back to human transfer.');
    return generateFallbackTwiml({ reason: 'ElevenLabs agent ID missing', transferToHuman: true });
  }

  // Step 4: Obtain ElevenLabs signed URL or standard authenticated stream
  try {
    let streamUrl;
    if (ELEVENLABS_API_KEY) {
      try {
        streamUrl = await getElevenLabsSignedUrl(ELEVENLABS_AGENT_ID, {
          caller_phone: callerPhone,
          caller_name: callerName || 'Caller',
          user_role: callerRole
        });
        console.log('✅ [Voice Agent] Acquired ElevenLabs signed conversation URL.');
      } catch (signErr) {
        console.warn(`⚠️ [Voice Agent] Signed URL acquisition failed (${signErr.message}). Using standard stream URL with agent_id...`);
        streamUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${encodeURIComponent(ELEVENLABS_AGENT_ID)}`;
      }
    } else {
      streamUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${encodeURIComponent(ELEVENLABS_AGENT_ID)}`;
    }

    // Step 5: Return TwiML Media Stream connecting Twilio to ElevenLabs
    return generateElevenLabsConnectTwiml({
      streamUrl,
      agentId: ELEVENLABS_AGENT_ID,
      callerPhone,
      callerName,
      callerRole,
      callSid
    });
  } catch (err) {
    console.error('❌ [Voice Agent] Failed to initialize ElevenLabs connection:', err.message);
    // Mark call as failed/fallback in DB
    await db.updateVoiceCall({
      callSid,
      status: 'failed_fallback',
      summary: `Failed to connect ElevenLabs: ${err.message}`
    });
    return generateFallbackTwiml({ reason: err.message, transferToHuman: true });
  }
}

/**
 * Handles Twilio call status callbacks (completed, busy, failed, no-answer)
 */
async function handleCallStatus(req) {
  const callSid = req.body.CallSid;
  const duration = req.body.CallDuration;
  const status = req.body.CallStatus || 'completed';

  console.log(`📴 [Call Status] SID: ${callSid} | Status: ${status} | Duration: ${duration || 0}s`);

  if (callSid) {
    await db.updateVoiceCall({
      callSid,
      durationSeconds: duration,
      status
    });
  }
}

/**
 * Returns TwiML for transferring call directly to human coordinator
 */
function handleEscalateCall() {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  twiml.say(
    { voice: 'Polly.Aditi', language: 'en-IN' },
    'Transferring you to a LabourLink coordinator. Please stay on the line.'
  );
  twiml.dial(HUMAN_TRANSFER_NUMBER);
  return twiml.toString();
}

module.exports = {
  handleIncomingCall,
  handleCallStatus,
  handleEscalateCall,
  getElevenLabsSignedUrl,
  generateElevenLabsConnectTwiml,
  generateFallbackTwiml,
  validateTwilioSignature
};
