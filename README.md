# LabourLink

**LabourLink** is a comprehensive platform designed to bridge the gap between daily-wage / skilled blue-collar workers and local employers or contractors. It provides an automated matching engine, instant SMS notification dispatch (powered by Twilio), an intuitive web interface, and a cross-platform Flutter mobile application.

---

## 🚀 Key Features

- **For Workers**:
  - Quick mobile and web registration (Skills, Hourly/Daily Wage, Location, Contact).
  - Worker dashboard to manage availability status, skillsets, and view incoming job matches.
  - Automated SMS notifications when a matching job is posted in their area.

- **For Employers**:
  - Post urgent or scheduled job openings specifying trade/skill, location, wage offer, and required worker count.
  - Instant matching algorithm that identifies and ranks available nearby workers.
  - Employer dashboard with direct applicant contact options and job status tracking.

- **Public Job Board**:
  - Live view of open labour opportunities categorized by skill and location.

- **Toll-free IVR**:
  - Workers dial a Twilio number, pick a job category on the keypad, and are bridged to a hiring agency (or the agency is notified with the worker's number).

---

## 🛠️ Technology Stack

- **Backend & Web Portal**:
  - **Runtime & Server**: Node.js & Express.js
  - **Database**: Supabase (PostgreSQL with `@supabase/supabase-js`)
  - **Templating**: EJS with custom modern CSS styling
  - **SMS Integration**: Twilio REST API

- **Mobile Application (`labourlink_app/`)**:
  - **Framework**: Flutter (Dart)
  - **Target Platforms**: Android, iOS, Web, Desktop

---

## 📁 Repository Structure

```
LabourLink/
├── labourlink_app/         # Flutter mobile application
│   ├── lib/
│   │   ├── models/        # Job and Worker data models
│   │   ├── screens/       # Mobile UI screens (Worker/Employer dashboards, etc.)
│   │   ├── services/      # REST API client services
│   │   └── main.dart      # Flutter app entry point
│   ├── pubspec.yaml       # Flutter dependencies
│   └── ...
├── public/                # Static assets (CSS stylesheets, client JS)
├── views/                 # EJS templates (Web portal pages & partials)
├── database.js            # Supabase client connection initialization
├── supabase-schema.sql    # PostgreSQL DDL table schemas & RLS policies
├── seed.js                # Database seeding utility for testing
├── server.js              # Express application with REST API endpoints
├── routes/                # IVR webhooks and admin IVR APIs
├── services/              # IVR business logic + telephony provider adapter
├── test-flow.js           # End-to-end API test workflow script
├── .env.example           # Template for environment variables
└── README.md              # Project documentation
```

---

## ⚡ Getting Started

### 1. Backend & Web Portal Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Set Up Database in Supabase**:
   - Create a free project at [supabase.com](https://supabase.com).
   - Open the **SQL Editor** in your Supabase project dashboard.
   - Paste and run the contents of `supabase-schema.sql` to create `workers`, `jobs`, and `job_interests` tables with proper indexes and RLS policies.

3. **Configure Environment Variables**:
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   Fill in your Supabase credentials:
   ```env
   PORT=3000
   SUPABASE_URL=https://your-project-ref.supabase.co
   SUPABASE_ANON_KEY=your-anon-public-key
   TWILIO_ACCOUNT_SID=your_twilio_account_sid
   TWILIO_AUTH_TOKEN=your_twilio_auth_token
   TWILIO_PHONE_NUMBER=your_twilio_phone_number
   PUBLIC_BASE_URL=https://your-host.example
   IVR_CONNECT_MODE=bridge
   IVR_OPERATOR_PHONE=+91XXXXXXXXXX
   ADMIN_API_KEY=change-me
   ```

4. **Seed Database (Optional)**:
   ```bash
   node seed.js
   ```

5. **Start the Server**:
   ```bash
   npm start
   # or for development:
   node server.js
   ```
   The portal will be available at `http://localhost:3000`.

---

### 2. Flutter Mobile Application Setup

1. Navigate to the app directory:
   ```bash
   cd labourlink_app
   ```

2. Fetch Flutter dependencies:
   ```bash
   flutter pub get
   ```

3. Run on connected device or emulator:
   ```bash
   flutter run
   ```

---

## ☎️ Toll-free IVR (worker → hiring agency)

Workers can dial a Twilio number (including a toll-free number once provisioned) and use the keypad to reach a hiring desk by job category.

**Why Twilio here:** this repo already depends on the Twilio SDK for SMS. Voice webhooks use the same credentials and TwiML. For high-volume **India-only** toll-free/short codes, Exotel is often cheaper and smoother with TRAI KYC; provider-specific code is isolated in `services/telephony/` so you can add an Exotel adapter later without changing IVR logic.

### Env vars

Copy from `.env.example`. Important keys:

| Variable | Purpose |
|---|---|
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` | Twilio account + the number callers hear as caller ID when bridging |
| `PUBLIC_BASE_URL` | HTTPS origin Twilio can reach (production domain or ngrok) |
| `IVR_CONNECT_MODE` | `bridge` live-connects the agency; `notify` hangs up and SMS/webhooks the agency with the worker's caller ID |
| `IVR_OPERATOR_PHONE` / `IVR_FALLBACK_PHONE` | Digit `0` and exhausted-retry / unreachable-agency routing |
| `IVR_DEFAULT_AGENCY_PHONE` | Phone seeded onto default categories until you set real desks |
| `IVR_AGENCY_WEBHOOK_URL` | Optional CRM/lead POST in notify mode |
| `IVR_SKIP_SIGNATURE` | `true` only for local tests without Twilio |
| `ADMIN_API_KEY` | Required header `X-Admin-Key` for admin APIs |

### Point the toll-free number at these webhooks

1. Buy or port a voice-enabled number in [Twilio Console](https://console.twilio.com/) (India toll-free needs Twilio India / local regulatory docs).
2. Number configuration → Voice → **A call comes in** → Webhook, HTTP `POST`:
   - Voice URL: `https://YOUR_PUBLIC_HOST/webhooks/voice/incoming`
   - Status callback (optional): `https://YOUR_PUBLIC_HOST/webhooks/voice/status`
3. The gather and dial callbacks are returned inside TwiML (`/webhooks/voice/gather` and `/webhooks/voice/dial-status`). You do not paste those in the console.

Menu: **1** Construction, **2** Driving, **3** Delivery, **4** Housekeeping, **5** Security, **6** Factory/Warehouse, **7** Cooking/Kitchen, **8** Electrician/Plumber, **9** repeat, **0** operator. Invalid/timeout retries twice (`IVR_MAX_RETRIES`), then fallback.

### Add or change job categories

Default rows are created in `job_categories` on first boot. Update without code changes:

```bash
# List
curl -H "X-Admin-Key: $ADMIN_API_KEY" http://localhost:3000/api/admin/ivr/categories

# Create
curl -X POST http://localhost:3000/api/admin/ivr/categories \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: $ADMIN_API_KEY" \
  -d "{\"digit\":\"1\",\"category_name\":\"Construction\",\"hiring_agency_name\":\"ABC Staffing\",\"hiring_agency_phone\":\"+919876543210\",\"active\":true}"

# Update agency number
curl -X PUT http://localhost:3000/api/admin/ivr/categories/1 \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: $ADMIN_API_KEY" \
  -d "{\"hiring_agency_phone\":\"+919811122233\"}"

# Deactivate
curl -X PATCH http://localhost:3000/api/admin/ivr/categories/1/deactivate \
  -H "X-Admin-Key: $ADMIN_API_KEY"

# Call logs
curl -H "X-Admin-Key: $ADMIN_API_KEY" "http://localhost:3000/api/admin/ivr/call-logs?limit=50"
```

Supabase/Postgres: run `migrations/002_ivr_tables.sql` (also appended in `supabase-schema.sql`). Local SQLite creates the tables automatically.

### Local webhook testing (ngrok)

```bash
npm start
ngrok http 3000
```

Set `PUBLIC_BASE_URL` to the ngrok HTTPS URL (no trailing slash) and `IVR_SKIP_SIGNATURE=false` once Twilio is hitting you. For XML-only tests without Twilio:

```bash
# .env: IVR_SKIP_SIGNATURE=true
curl -X POST http://localhost:3000/webhooks/voice/incoming \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "CallSid=CAtest1&From=%2B919812345678&To=%2B18001234567"

curl -X POST "http://localhost:3000/webhooks/voice/gather?attempt=1" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "CallSid=CAtest1&From=%2B919812345678&Digits=1"
```

Twilio also has a [Function / webhook debugger](https://console.twilio.com/us1/monitor/logs/calls) and the CLI `twilio phone-numbers:update` to set the voice URL.

Code map: `routes/ivr.js` webhooks, `routes/adminIvr.js` admin, `services/ivrService.js` menu/routing, `services/telephony/twilioAdapter.js` TwiML/SMS.

---

## 📄 License
This project is licensed under the MIT License.