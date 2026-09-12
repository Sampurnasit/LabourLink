# LabourLink — ElevenLabs Voice AI Agent Integration Guide

This guide details how to configure, connect, and run the **ElevenLabs Conversational AI Voice Agent** with LabourLink's existing toll-free number (Twilio).

---

## 1. System Architecture

```
                                    +-----------------------------------------+
                                    |         Incoming Caller (Phone)         |
                                    +--------------------+--------------------+
                                                         |
                                                         v
                                    +--------------------+--------------------+
                                    |   Existing Toll-Free Number (Twilio)    |
                                    +--------------------+--------------------+
                                                         |  HTTP POST
                                                         |  (Webhook with Caller SID & From)
                                                         v
                                    +--------------------+--------------------+
                                    |      LabourLink Backend (server.js)     |
                                    |         /api/voice/incoming             |
                                    +--------------------+--------------------+
                                       |                                   |
              (1) Pre-Call Database    |                                   | (2) If ElevenLabs
                  Lookup & Context     |                                   |     Fails / Down
                  Enrichment           v                                   v
             +------------------------------+             +------------------------------+
             | Identify Caller, Name & Role |             |  Fallback Polly TwiML Say    |
             | in Supabase / SQLite DB      |             |  & Dial Human Transfer No.   |
             +--------------+---------------+             +------------------------------+
                            |
                            | (3) Returns TwiML <Connect><Stream>
                            v
+-------------------------------------------------------+
|  Twilio Audio Media Stream wss://                     |
|  Direct bidirectional WebSocket                       |
+---------------------------+---------------------------+
                            |
                            v
+-------------------------------------------------------+
|          ElevenLabs Conversational AI Agent           |
|       (Dynamic Context: phone, name, role)            |
|       Speaks bilingual English & Hindi                |
+---------------------------+---------------------------+
                            |
                            | (4) Webhook Tool Calls
                            |     POST /api/voice/tools/:toolName
                            v
+-------------------------------------------------------+
|              LabourLink Backend Tools                 |
|  - lookup_caller                                      |
|  - get_open_jobs                                      |
|  - toggle_worker_availability                         |
|  - check_job_application_status                       |
|  - post_urgent_job                                    |
|  - request_human_escalation                           |
+-------------------------------------------------------+
```

---

## 2. Environment Variables Configuration

Ensure the following variables are configured in your `.env` file:

```env
# Telephony (Twilio)
TWILIO_ACCOUNT_SID=ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
TWILIO_AUTH_TOKEN=your_twilio_auth_token_here
TWILIO_PHONE_NUMBER=+18001234567

# ElevenLabs Conversational AI
ELEVENLABS_API_KEY=xi_api_key_xxxxxxxxxxxxxxxxxxxxxxxx
ELEVENLABS_AGENT_ID=your_elevenlabs_agent_id_here
ELEVENLABS_WEBHOOK_SECRET=your_optional_webhook_secret

# Human Escalation Fallback (Indian Coordinator Number or Toll-Free Support)
HUMAN_TRANSFER_NUMBER=+919900112233
```

---

## 3. Twilio Console Setup

1. **Log in to Twilio Console**: Go to [twilio.com/console](https://console.twilio.com/).
2. **Navigate to Phone Numbers**: Go to **Phone Numbers** -> **Manage** -> **Active Numbers**.
3. **Select your Toll-Free Number**: Click on the number you are using for LabourLink.
4. **Configure Voice & Fax**:
   - Under **Voice Configuration**:
     - **A CALL COMES IN**: Select `Webhook`.
     - **URL**: `https://<YOUR-PUBLIC-DOMAIN>/api/voice/incoming` (HTTP POST).
     - **STATUS CALLBACK URL**: `https://<YOUR-PUBLIC-DOMAIN>/api/voice/status` (HTTP POST).
   - Under **Call Status Changes**:
     - Check: *Call initiated*, *Ringing*, *Answered*, *Completed*.
5. **Save Configuration**.

> **Note for Local Testing:** If testing locally, expose port 3000 using ngrok or localtunnel:
> ```bash
> ngrok http 3000
> ```
> Use the HTTPS forwarding URL (e.g. `https://xxxx.ngrok-free.app/api/voice/incoming`).

---

## 4. ElevenLabs Conversational AI Setup

### Step 4.1: Create an Agent
1. Go to [elevenlabs.io/app/conversational-ai](https://elevenlabs.io/app/conversational-ai).
2. Click **Create Agent** (Choose **Blank Agent** or **Customer Support**).
3. Copy the **Agent ID** from the URL or agent settings and add it to `.env` as `ELEVENLABS_AGENT_ID`.

### Step 4.2: First Message
Set the introductory message in ElevenLabs:
```text
Namaste and welcome to LabourLink! I am your AI chowk assistant. Are you looking for daily-wage work today, or are you an employer looking to hire skilled workers?
```

### Step 4.3: System Prompt
Paste the following prompt into the **Prompt / System Instructions** box:

```markdown
# Identity & Mission
You are the voice assistant for LabourLink (Digital Labor Chowk). Your purpose is to assist daily-wage laborers, contractors, and local employers over the phone.
You are warm, respectful, concise, and clear. Many callers are working outdoors in noisy environments, so speak clearly, directly, and keep your responses short (under 2 sentences when possible).

# Language & Tone
- Understand and speak both English and Hindi (Hinglish). If the caller speaks Hindi, reply naturally in conversational Hindi/Hinglish.
- Always be polite and address workers and employers with respect (e.g., "Ji", "Bhaiya", "Sir/Madam").
- Never use complicated jargon. Use familiar terms like "Chowk", "Majdoori", "Dihadi", "Thekedaar", "Karigar".

# Dynamic Context
You are provided with dynamic variables from the caller's telephony session:
- caller_phone: The caller's 10-digit phone number.
- caller_name: The registered name of the user (or "Valued Caller" if guest).
- user_role: "worker", "employer", or "guest".

# Workflow Capabilities
1. IDENTIFY CALLER:
   - If user_role is "guest" or caller asks about their account, call `lookup_caller` with caller_phone or the number they state.
   - If they are a registered worker, greet them by name.

2. FOR WORKERS:
   - "Find Jobs": Ask for their trade/skill (Mason, Painter, Helper, Plumber, Electrician) and location/city. Call `get_open_jobs`. Read back the wage offered and date needed.
   - "Toggle Availability": If a worker wants to indicate they are ready for work today or busy, call `toggle_worker_availability`.
   - "Check Status": If they applied for a job and want to know if they were approved or hired, call `check_job_application_status`.

3. FOR EMPLOYERS & CONTRACTORS:
   - "Post Urgent Job": If an employer needs labor urgently today or tomorrow, collect:
     a) Skill needed (e.g., 2 Helpers, Mason)
     b) Location / area
     c) Wage offered (e.g., ₹750/day)
     Then invoke `post_urgent_job`.
   - "Find Workers": Read open worker profiles matching their needs.

4. ESCALATION TO HUMAN:
   - If the caller is confused, angry, facing a payment dispute, or explicitly requests a human manager, invoke `request_human_escalation`. Inform them calmly that they are being transferred to a coordinator.
```

---

## 5. Tool Definitions (Webhooks)

Configure the following 6 tools under **Agent Settings -> Tools** in ElevenLabs. Set the webhook URL to:
`https://<YOUR-DOMAIN>/api/voice/tools/<tool_name>` (HTTP POST)

### Tool 1: `lookup_caller`
- **Description:** Look up the caller's registration profile, role, and active status by phone number.
- **URL:** `https://<YOUR-DOMAIN>/api/voice/tools/lookup_caller`
- **Parameters Schema:**
```json
{
  "type": "object",
  "properties": {
    "phone_number": {
      "type": "string",
      "description": "The 10-digit mobile number of the caller"
    }
  },
  "required": ["phone_number"]
}
```

### Tool 2: `get_open_jobs`
- **Description:** Search available daily-wage jobs by skill trade and location.
- **URL:** `https://<YOUR-DOMAIN>/api/voice/tools/get_open_jobs`
- **Parameters Schema:**
```json
{
  "type": "object",
  "properties": {
    "skill": {
      "type": "string",
      "description": "Worker trade needed (e.g. Mason, Helper, Painter, Carpenter, Electrician, Plumber)"
    },
    "location": {
      "type": "string",
      "description": "Area, city or locality (e.g. Indiranagar, Whitefield, Delhi)"
    },
    "min_wage": {
      "type": "number",
      "description": "Minimum acceptable daily wage in INR"
    }
  }
}
```

### Tool 3: `toggle_worker_availability`
- **Description:** Turn worker daily availability ON (ready for work) or OFF (busy/rest).
- **URL:** `https://<YOUR-DOMAIN>/api/voice/tools/toggle_worker_availability`
- **Parameters Schema:**
```json
{
  "type": "object",
  "properties": {
    "phone_number": {
      "type": "string",
      "description": "The worker's 10-digit mobile number"
    },
    "available": {
      "type": "boolean",
      "description": "true if worker is ready for work today; false if taking day off"
    }
  },
  "required": ["phone_number", "available"]
}
```

### Tool 4: `check_job_application_status`
- **Description:** Check status of recent job applications for a worker.
- **URL:** `https://<YOUR-DOMAIN>/api/voice/tools/check_job_application_status`
- **Parameters Schema:**
```json
{
  "type": "object",
  "properties": {
    "phone_number": {
      "type": "string",
      "description": "The worker's 10-digit mobile number"
    }
  },
  "required": ["phone_number"]
}
```

### Tool 5: `post_urgent_job`
- **Description:** Post a new urgent labor job listing for an employer.
- **URL:** `https://<YOUR-DOMAIN>/api/voice/tools/post_urgent_job`
- **Parameters Schema:**
```json
{
  "type": "object",
  "properties": {
    "employer_phone": {
      "type": "string",
      "description": "Employer's 10-digit phone number"
    },
    "employer_name": {
      "type": "string",
      "description": "Name of employer or contractor"
    },
    "skill_needed": {
      "type": "string",
      "description": "Trade/skill required (e.g., Helper, Mason, Painter)"
    },
    "location": {
      "type": "string",
      "description": "Worksite location or locality"
    },
    "wage_offered": {
      "type": "string",
      "description": "Wage offered per day (e.g., 750 or ₹800/day)"
    },
    "date_needed": {
      "type": "string",
      "description": "Date needed (e.g., 2026-09-13 or Today/Tomorrow)"
    }
  },
  "required": ["employer_phone", "skill_needed", "location", "wage_offered"]
}
```

### Tool 6: `request_human_escalation`
- **Description:** Escalate the call to a human support coordinator when caller requests a real person or has an unresolved dispute.
- **URL:** `https://<YOUR-DOMAIN>/api/voice/tools/request_human_escalation`
- **Parameters Schema:**
```json
{
  "type": "object",
  "properties": {
    "call_sid": {
      "type": "string",
      "description": "Twilio Call SID"
    },
    "reason": {
      "type": "string",
      "description": "Reason for human escalation"
    }
  },
  "required": ["reason"]
}
```

---

## 6. Admin Telephony Dashboard

LabourLink provides a built-in Telephony & Voice Agent Dashboard at:
**`http://localhost:3000/admin/voice`**

Features:
- **Real-Time Telephony Status**: Monitors Twilio number connection and ElevenLabs API / Agent state.
- **Call Volume & KPIs**: Displays total calls, completed conversations, escalation rate, and average call duration.
- **Live Call Log**: Lists recent incoming calls with caller phone, role, timestamp, duration, and status.
- **Tool Directory & Quick Test**: Documents all active webhook tools and allows verifying tool endpoints.

---

## 7. Verification & Testing

### Test 1: Verify Inbound Webhook (TwiML Response)
Test that Twilio receives valid TwiML with fallback or Media Stream:
```bash
curl -X POST http://localhost:3000/api/voice/incoming \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "CallSid=CA_TEST_12345&From=%2B919876543210&To=%2B18001234567"
```

Expected output: Valid XML `<Response><Say>...</Say><Dial>...</Dial></Response>` (if credentials not yet set) or `<Response><Connect><Stream .../></Connect></Response>`.

### Test 2: Verify Tool Execution (`get_open_jobs`)
```bash
curl -X POST http://localhost:3000/api/voice/tools/get_open_jobs \
  -H "Content-Type: application/json" \
  -d '{"skill": "Mason"}'
```

Expected output:
```json
{
  "count": 1,
  "jobs": [ ... ],
  "message": "Found 1 open Mason job..."
}
```

### Test 3: Verify Caller Lookup (`lookup_caller`)
```bash
curl -X POST http://localhost:3000/api/voice/tools/lookup_caller \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "9876543210"}'
```

### Test 4: Verify Call Status Recording
```bash
curl -X POST http://localhost:3000/api/voice/status \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "CallSid=CA_TEST_12345&CallStatus=completed&CallDuration=45"
```
Check `http://localhost:3000/admin/voice` to confirm the call appears with duration `45s`.
