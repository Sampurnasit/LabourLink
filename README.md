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

## 📄 License
This project is licensed under the MIT License.