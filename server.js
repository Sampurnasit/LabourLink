require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const db = require('./database');

const app = express();
const port = process.env.PORT || 3000;

// Exotel Cloud Communication API Configuration
const EXOTEL_SID = (process.env.EXOTEL_SID || '').trim();
const EXOTEL_API_KEY = (process.env.EXOTEL_API_KEY || '').trim();
const EXOTEL_API_TOKEN = (process.env.EXOTEL_API_TOKEN || '').trim();
const EXOTEL_PHONE_NUMBER = (process.env.EXOTEL_PHONE_NUMBER || '').trim();

// Enable CORS for Flutter apps (Web, Desktop, Mobile)
app.use(cors());

// Set EJS view engine for existing browser pages
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static assets
app.use(express.static(path.join(__dirname, 'public')));

// Serve compiled Flutter mobile web app on /app
const flutterBuildDir = path.join(__dirname, 'labourlink_app', 'build', 'web');
app.use('/app', express.static(flutterBuildDir));

// Middleware for parsing body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Helper to sanitize phone input (extracts last 10 digits e.g. for Indian numbers with +91 or leading 0)
function cleanPhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/[^0-9]/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * Reusable function to send SMS via Exotel Cloud Communication REST API
 * POST https://api.exotel.com/v1/Accounts/{EXOTEL_SID}/Sms/send.json
 * Auth: Basic Auth (API_KEY : API_TOKEN)
 * Body: From, To, Body (application/x-www-form-urlencoded)
 */
async function sendSms(toNumber, messageBody) {
  if (!EXOTEL_SID || !EXOTEL_API_KEY || !EXOTEL_API_TOKEN) {
    console.warn('[Exotel SMS] Missing Exotel configuration in .env. Skipping SMS to:', toNumber);
    return { success: false, error: 'Exotel credentials not configured in environment' };
  }

  const recipient = cleanPhone(toNumber) || String(toNumber).trim();
  if (!recipient) {
    console.warn('[Exotel SMS] Empty or invalid recipient phone number:', toNumber);
    return { success: false, error: 'Empty recipient phone number' };
  }

  try {
    const endpoint = `https://api.exotel.com/v1/Accounts/${EXOTEL_SID}/Sms/send.json`;
    const params = new URLSearchParams();
    params.append('From', EXOTEL_PHONE_NUMBER);
    params.append('To', recipient);
    params.append('Body', messageBody);

    console.log(`[Exotel SMS] Sending message to ${recipient} via Exotel from ${EXOTEL_PHONE_NUMBER}...`);
    const response = await axios.post(endpoint, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      auth: {
        username: EXOTEL_API_KEY,
        password: EXOTEL_API_TOKEN
      },
      timeout: 10000
    });

    console.log(`[Exotel SMS] Successfully sent to ${recipient}. Response:`, JSON.stringify(response.data));
    return { success: true, data: response.data };
  } catch (error) {
    const errorDetails = error.response
      ? { status: error.response.status, data: error.response.data }
      : error.message;
    console.error(`[Exotel SMS Error] Failed to send SMS to ${recipient}:`, errorDetails);
    return { success: false, error: errorDetails };
  }
}

// ==========================================================================
// EXOTEL SMS WEBHOOK & TEST ROUTES
// ==========================================================================

// Webhook route to receive incoming SMS notifications from Exotel
function handleIncomingExotelSms(req, res) {
  console.log('====================================================');
  console.log('       [EXOTEL INCOMING SMS WEBHOOK RECEIVED]       ');
  console.log('====================================================');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Method:', req.method);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Query Params:', JSON.stringify(req.query, null, 2));
  console.log('Request Body:', JSON.stringify(req.body, null, 2));

  // Extract common Exotel incoming SMS fields
  const sender = req.body.From || req.body.from || req.body.CallFrom || req.query.From || req.query.from || 'Unknown';
  const text = req.body.Body || req.body.body || req.body.SmsBody || req.query.Body || req.query.body || '';
  const messageSid = req.body.SmsSid || req.body.smsSid || req.query.SmsSid || req.query.smsSid || '';

  console.log(`[Exotel Webhook Parsed] Sender: "${sender}", Body: "${text}", Sid: "${messageSid}"`);
  console.log('====================================================');

  res.status(200).json({
    status: 'received',
    timestamp: new Date().toISOString(),
    sender,
    text,
    messageSid
  });
}

app.post('/exotel/sms-incoming', handleIncomingExotelSms);
app.get('/exotel/sms-incoming', handleIncomingExotelSms);

// Test route to verify Exotel SMS sending directly
app.get('/exotel/test-sms', async (req, res) => {
  try {
    const verifiedNumber = process.env.EXOTEL_VERIFIED_NUMBER || process.env.TEST_PHONE_NUMBER || '9876543210';
    const recipient = req.query.to || verifiedNumber;
    const testMessage = req.query.msg || `LabourLink Test: Exotel SMS integration verified successfully at ${new Date().toLocaleTimeString('en-IN')}.`;

    console.log(`[Exotel Test Route] Triggering test SMS to: ${recipient}`);
    const result = await sendSms(recipient, testMessage);

    res.json({
      testRoute: '/exotel/test-sms',
      status: result.success ? 'success' : 'failed',
      recipient,
      message: testMessage,
      result,
      tip: 'You can test any number by passing ?to=YOUR_10_DIGIT_NUMBER in the URL (e.g., /exotel/test-sms?to=9876543210)'
    });
  } catch (err) {
    console.error('[Exotel Test Route Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================================================
// REST API ENDPOINTS FOR FLUTTER APPLICATION
// ==========================================================================

// 1. Platform Statistics
app.get('/api/stats', async (req, res) => {
  try {
    const totalWorkers = await db.getAsync('SELECT COUNT(*) as count FROM workers');
    const availableWorkers = await db.getAsync('SELECT COUNT(*) as count FROM workers WHERE available = 1');
    const openJobs = await db.getAsync("SELECT COUNT(*) as count FROM jobs WHERE status = 'open'");
    const filledJobs = await db.getAsync("SELECT COUNT(*) as count FROM jobs WHERE status = 'filled'");
    const totalInterests = await db.getAsync('SELECT COUNT(*) as count FROM job_interests');

    res.json({
      status: 'ok',
      totalWorkers: totalWorkers ? totalWorkers.count : 0,
      availableWorkers: availableWorkers ? availableWorkers.count : 0,
      openJobs: openJobs ? openJobs.count : 0,
      filledJobs: filledJobs ? filledJobs.count : 0,
      totalInterests: totalInterests ? totalInterests.count : 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Public / Filtered Jobs Feed
app.get('/api/jobs', async (req, res) => {
  try {
    const { skill, location } = req.query;
    let sql = "SELECT * FROM jobs WHERE status = 'open'";
    const params = [];

    if (skill) {
      sql += ' AND skill_needed = ?';
      params.push(skill);
    }
    if (location) {
      sql += ' AND location = ?';
      params.push(location);
    }

    sql += ' ORDER BY id DESC';
    const jobs = await db.allAsync(sql, params);
    res.json({ status: 'ok', jobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Post a Job (Employer)
app.post('/api/jobs', async (req, res) => {
  try {
    const { employer_name, employer_phone, skill_needed, location, wage_offered, date_needed } = req.body;
    const phone = cleanPhone(employer_phone);

    if (!employer_name || !phone || !skill_needed || !location || !wage_offered) {
      return res.status(400).json({ error: 'Please provide all required job fields' });
    }

    const result = await db.runAsync(
      `INSERT INTO jobs (employer_name, employer_phone, skill_needed, location, wage_offered, date_needed, status)
       VALUES (?, ?, ?, ?, ?, ?, 'open')`,
      [employer_name.trim(), phone, skill_needed, location, wage_offered.trim(), date_needed || 'Today']
    );

    const newJob = await db.getAsync('SELECT * FROM jobs WHERE id = ?', [result.lastID]);

    // Dispatch Exotel SMS notifications to matching workers
    try {
      const matchedWorkers = await db.allAsync(
        'SELECT * FROM workers WHERE skill_type = ? AND location = ? AND available = 1',
        [skill_needed, location]
      );
      console.log(`[Job Alert] Found ${matchedWorkers.length} matching worker(s) for Job #${newJob.id} (${skill_needed} in ${location})`);

      for (const worker of matchedWorkers) {
        const workerMsg = `LabourLink Alert: New ${skill_needed} job in ${location}! Wage: ${wage_offered.trim()}, Date: ${date_needed || 'Today'}. Employer: ${employer_name.trim()} (${phone}). Contact employer to accept.`;
        sendSms(worker.phone_number, workerMsg);
      }

      // Confirmation SMS to Employer
      const employerMsg = `LabourLink: Your job #${newJob.id} for ${skill_needed} in ${location} has been posted. We alerted ${matchedWorkers.length} matching worker(s).`;
      sendSms(phone, employerMsg);
    } catch (smsErr) {
      console.error('[Job Alert SMS Error]:', smsErr);
    }

    res.status(201).json({ status: 'ok', job: newJob });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Get Single Job and Instant Matching Workers
app.get('/api/jobs/:id/matches', async (req, res) => {
  try {
    const job = await db.getAsync('SELECT * FROM jobs WHERE id = ?', [req.params.id]);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Direct matches: same skill + same location + available = 1
    const matchedWorkers = await db.allAsync(
      'SELECT * FROM workers WHERE skill_type = ? AND location = ? AND available = 1 ORDER BY id DESC',
      [job.skill_needed, job.location]
    );

    // Nearby citywide workers with same skill
    const nearbyWorkers = await db.allAsync(
      'SELECT * FROM workers WHERE skill_type = ? AND location != ? AND available = 1 ORDER BY id DESC LIMIT 5',
      [job.skill_needed, job.location]
    );

    res.json({
      status: 'ok',
      job,
      matchedWorkers,
      nearbyWorkers
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Worker Registration / Update
app.post('/api/workers/register', async (req, res) => {
  try {
    const { name, phone_number, skill_type, location, available } = req.body;
    const phone = cleanPhone(phone_number);
    const isAvailable = available !== undefined ? (available ? 1 : 0) : 1;

    if (!name || !phone || !skill_type || !location) {
      return res.status(400).json({ error: 'Please provide all required worker fields' });
    }

    await db.runAsync(
      `INSERT INTO workers (name, phone_number, skill_type, location, available)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(phone_number) DO UPDATE SET
         name = excluded.name,
         skill_type = excluded.skill_type,
         location = excluded.location,
         available = excluded.available`,
      [name.trim(), phone, skill_type, location, isAvailable]
    );

    const worker = await db.getAsync('SELECT * FROM workers WHERE phone_number = ?', [phone]);

    // Send Exotel SMS confirmation to worker
    try {
      const welcomeMsg = `Welcome ${name.trim()} to LabourLink! Your profile for ${skill_type} in ${location} is active. You will receive SMS alerts when matching 1-day gigs are posted in your area.`;
      sendSms(phone, welcomeMsg);
    } catch (smsErr) {
      console.error('[Worker Reg SMS Error]:', smsErr);
    }

    res.json({ status: 'ok', worker });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Worker Profile & Gigs Lookup by Phone
app.get('/api/workers/:phone', async (req, res) => {
  try {
    const phone = cleanPhone(req.params.phone);
    const worker = await db.getAsync('SELECT * FROM workers WHERE phone_number = ?', [phone]);

    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    // Matched open jobs in worker's area
    const matchedJobs = await db.allAsync(
      "SELECT * FROM jobs WHERE skill_needed = ? AND location = ? AND status = 'open' ORDER BY id DESC",
      [worker.skill_type, worker.location]
    );

    // Other open jobs in that skill citywide
    const otherSkillJobs = await db.allAsync(
      "SELECT * FROM jobs WHERE skill_needed = ? AND location != ? AND status = 'open' ORDER BY id DESC LIMIT 6",
      [worker.skill_type, worker.location]
    );

    // Jobs the worker has applied for or been confirmed for
    const appliedJobs = await db.allAsync(
      `SELECT j.*, ji.status as interest_status, ji.created_at as interest_date
       FROM job_interests ji
       JOIN jobs j ON ji.job_id = j.id
       WHERE ji.worker_id = ?
       ORDER BY ji.id DESC`,
      [worker.id]
    );

    res.json({
      status: 'ok',
      worker,
      matchedJobs,
      otherSkillJobs,
      appliedJobs
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Worker Express Interest in Job
app.post('/api/workers/interest', async (req, res) => {
  try {
    const { worker_id, job_id } = req.body;
    if (!worker_id || !job_id) {
      return res.status(400).json({ error: 'worker_id and job_id are required' });
    }

    await db.runAsync(
      `INSERT INTO job_interests (job_id, worker_id, status)
       VALUES (?, ?, 'interested')
       ON CONFLICT(job_id, worker_id) DO NOTHING`,
      [job_id, worker_id]
    );

    res.json({ status: 'ok', message: 'Interest registered successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Toggle Worker Availability
app.post('/api/workers/toggle-availability', async (req, res) => {
  try {
    const phone = cleanPhone(req.body.phone);
    const available = req.body.available ? 1 : 0;

    await db.runAsync('UPDATE workers SET available = ? WHERE phone_number = ?', [available, phone]);
    const worker = await db.getAsync('SELECT * FROM workers WHERE phone_number = ?', [phone]);

    res.json({ status: 'ok', worker });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Employer Dashboard Jobs & Interested Applicants
app.get('/api/employers/:phone/jobs', async (req, res) => {
  try {
    const phone = cleanPhone(req.params.phone);
    const jobs = await db.allAsync(
      'SELECT * FROM jobs WHERE employer_phone = ? ORDER BY id DESC',
      [phone]
    );

    for (const job of jobs) {
      const interestedWorkers = await db.allAsync(
        `SELECT w.id as worker_id, w.name, w.phone_number, w.skill_type, w.location, w.available, ji.status
         FROM job_interests ji
         JOIN workers w ON ji.worker_id = w.id
         WHERE ji.job_id = ?
         ORDER BY (CASE WHEN ji.status = 'confirmed' THEN 0 ELSE 1 END), ji.id DESC`,
        [job.id]
      );
      job.interestedWorkers = interestedWorkers;
    }

    res.json({ status: 'ok', jobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Employer Confirm Worker
app.post('/api/employers/confirm-worker', async (req, res) => {
  try {
    const { job_id, worker_id } = req.body;
    if (!job_id || !worker_id) {
      return res.status(400).json({ error: 'job_id and worker_id are required' });
    }

    await db.runAsync(
      "UPDATE job_interests SET status = 'confirmed' WHERE job_id = ? AND worker_id = ?",
      [job_id, worker_id]
    );
    await db.runAsync("UPDATE jobs SET status = 'filled' WHERE id = ?", [job_id]);

    // Notify worker of confirmation via Exotel SMS
    try {
      const job = await db.getAsync('SELECT * FROM jobs WHERE id = ?', [job_id]);
      const worker = await db.getAsync('SELECT * FROM workers WHERE id = ?', [worker_id]);
      if (job && worker) {
        const confirmMsg = `LabourLink Update: You have been confirmed for the ${job.skill_needed} gig in ${job.location}! Wage: ${job.wage_offered}. Contact employer ${job.employer_name} at ${job.employer_phone}.`;
        sendSms(worker.phone_number, confirmMsg);
      }
    } catch (smsErr) {
      console.error('[Confirm Worker SMS Error]:', smsErr);
    }

    res.json({ status: 'ok', message: 'Worker confirmed and job marked filled' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================================================
// SERVER-RENDERED WEB PAGES (EJS TEMPLATES FOR BROWSER / DEMO)
// ==========================================================================

// Home Page
app.get('/', async (req, res) => {
  try {
    const totalWorkersRow = await db.getAsync('SELECT COUNT(*) as count FROM workers');
    const availWorkersRow = await db.getAsync('SELECT COUNT(*) as count FROM workers WHERE available = 1');
    const openJobsRow = await db.getAsync("SELECT COUNT(*) as count FROM jobs WHERE status = 'open'");
    const totalInterestsRow = await db.getAsync('SELECT COUNT(*) as count FROM job_interests');

    const stats = {
      totalWorkers: totalWorkersRow ? totalWorkersRow.count : 0,
      availableWorkers: availWorkersRow ? availWorkersRow.count : 0,
      openJobs: openJobsRow ? openJobsRow.count : 0,
      totalInterests: totalInterestsRow ? totalInterestsRow.count : 0
    };

    const recentJobs = await db.allAsync(
      "SELECT * FROM jobs WHERE status = 'open' ORDER BY id DESC LIMIT 6"
    );

    res.render('index', { stats, recentJobs });
  } catch (err) {
    console.error('Error rendering home page:', err);
    res.status(500).send('Internal Server Error');
  }
});

// Worker Registration & Flow
app.get('/worker/register', (req, res) => {
  res.render('worker-register');
});

app.post('/worker/register', async (req, res) => {
  try {
    const { name, phone_number, skill_type, location, available } = req.body;
    const phone = cleanPhone(phone_number);
    const isAvailable = available ? 1 : 0;

    if (!name || !phone || !skill_type || !location) {
      return res.status(400).render('worker-register', {
        errorMessage: 'Please fill in all required fields.'
      });
    }

    await db.runAsync(
      `INSERT INTO workers (name, phone_number, skill_type, location, available)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(phone_number) DO UPDATE SET
         name = excluded.name,
         skill_type = excluded.skill_type,
         location = excluded.location,
         available = excluded.available`,
      [name.trim(), phone, skill_type, location, isAvailable]
    );

    // Send Exotel SMS confirmation to worker
    try {
      const welcomeMsg = `Welcome ${name.trim()} to LabourLink! Your profile for ${skill_type} in ${location} is active. You will receive SMS alerts when matching 1-day gigs are posted in your area.`;
      sendSms(phone, welcomeMsg);
    } catch (smsErr) {
      console.error('[Web Worker Reg SMS Error]:', smsErr);
    }

    res.redirect(`/worker/dashboard?phone=${encodeURIComponent(phone)}&registered=1`);
  } catch (err) {
    console.error('Error registering worker:', err);
    res.status(500).render('worker-register', {
      errorMessage: 'Database error while registering worker. Please try again.'
    });
  }
});

// Worker Dashboard
app.get('/worker/dashboard', async (req, res) => {
  try {
    const phone = cleanPhone(req.query.phone);
    let successMessage = null;

    if (req.query.registered) {
      successMessage = 'Welcome to LabourLink! Your profile is registered and ready for matching.';
    } else if (req.query.interested) {
      successMessage = 'Interest registered! The employer has been notified and can confirm you.';
    } else if (req.query.avail_updated) {
      successMessage = 'Availability status updated successfully!';
    }

    if (!phone) {
      return res.render('worker-dashboard', {
        worker: null,
        phone: '',
        matchedJobs: [],
        otherSkillJobs: [],
        appliedJobs: [],
        interestedJobIds: [],
        successMessage
      });
    }

    const worker = await db.getAsync('SELECT * FROM workers WHERE phone_number = ?', [phone]);

    if (!worker) {
      return res.render('worker-dashboard', {
        worker: null,
        phone,
        matchedJobs: [],
        otherSkillJobs: [],
        appliedJobs: [],
        interestedJobIds: [],
        successMessage
      });
    }

    const matchedJobs = await db.allAsync(
      "SELECT * FROM jobs WHERE skill_needed = ? AND location = ? AND status = 'open' ORDER BY id DESC",
      [worker.skill_type, worker.location]
    );

    const otherSkillJobs = await db.allAsync(
      "SELECT * FROM jobs WHERE skill_needed = ? AND location != ? AND status = 'open' ORDER BY id DESC LIMIT 6",
      [worker.skill_type, worker.location]
    );

    const appliedJobs = await db.allAsync(
      `SELECT j.*, ji.status as interest_status, ji.created_at as interest_date
       FROM job_interests ji
       JOIN jobs j ON ji.job_id = j.id
       WHERE ji.worker_id = ?
       ORDER BY ji.id DESC`,
      [worker.id]
    );

    const interestedJobIds = appliedJobs.map((j) => j.id);

    res.render('worker-dashboard', {
      worker,
      phone,
      matchedJobs,
      otherSkillJobs,
      appliedJobs,
      interestedJobIds,
      successMessage
    });
  } catch (err) {
    console.error('Error rendering worker dashboard:', err);
    res.status(500).send('Internal Server Error');
  }
});

// Worker expresses interest
app.post('/worker/interest', async (req, res) => {
  try {
    const { worker_id, job_id, phone } = req.body;
    if (!worker_id || !job_id) {
      return res.status(400).redirect('/worker/dashboard');
    }

    await db.runAsync(
      `INSERT INTO job_interests (job_id, worker_id, status)
       VALUES (?, ?, 'interested')
       ON CONFLICT(job_id, worker_id) DO NOTHING`,
      [job_id, worker_id]
    );

    res.redirect(`/worker/dashboard?phone=${encodeURIComponent(phone)}&interested=1`);
  } catch (err) {
    console.error('Error expressing interest:', err);
    res.redirect(`/worker/dashboard?phone=${encodeURIComponent(req.body.phone || '')}`);
  }
});

// Toggle worker availability
app.post('/worker/toggle-availability', async (req, res) => {
  try {
    const phone = cleanPhone(req.body.phone);
    const available = req.body.available === '1' ? 1 : 0;

    await db.runAsync('UPDATE workers SET available = ? WHERE phone_number = ?', [available, phone]);
    res.redirect(`/worker/dashboard?phone=${encodeURIComponent(phone)}&avail_updated=1`);
  } catch (err) {
    console.error('Error toggling availability:', err);
    res.redirect('/worker/dashboard');
  }
});

// Employer Post Job
app.get('/employer/post-job', (req, res) => {
  res.render('employer-post-job');
});

app.post('/employer/post-job', async (req, res) => {
  try {
    const { employer_name, employer_phone, skill_needed, location, wage_offered, date_needed } = req.body;
    const phone = cleanPhone(employer_phone);

    if (!employer_name || !phone || !skill_needed || !location || !wage_offered) {
      return res.status(400).render('employer-post-job', {
        errorMessage: 'Please fill in all required job fields.'
      });
    }

    const result = await db.runAsync(
      `INSERT INTO jobs (employer_name, employer_phone, skill_needed, location, wage_offered, date_needed, status)
       VALUES (?, ?, ?, ?, ?, ?, 'open')`,
      [employer_name.trim(), phone, skill_needed, location, wage_offered.trim(), date_needed || 'Today']
    );

    // Dispatch Exotel SMS notifications to matching workers
    try {
      const matchedWorkers = await db.allAsync(
        'SELECT * FROM workers WHERE skill_type = ? AND location = ? AND available = 1',
        [skill_needed, location]
      );
      console.log(`[Job Alert] Found ${matchedWorkers.length} matching worker(s) for Job #${result.lastID} (${skill_needed} in ${location})`);

      for (const worker of matchedWorkers) {
        const workerMsg = `LabourLink Alert: New ${skill_needed} work in ${location}! Wage: ${wage_offered.trim()}, Date: ${date_needed || 'Today'}. Employer: ${employer_name.trim()} (${phone}). Call employer to accept.`;
        sendSms(worker.phone_number, workerMsg);
      }

      // Confirmation to Employer
      const employerMsg = `LabourLink: Your job #${result.lastID} for ${skill_needed} in ${location} has been posted. We alerted ${matchedWorkers.length} matching worker(s).`;
      sendSms(phone, employerMsg);
    } catch (smsErr) {
      console.error('[Web Post Job SMS Error]:', smsErr);
    }

    res.redirect(`/employer/post-success/${result.lastID}`);
  } catch (err) {
    console.error('Error creating job:', err);
    res.status(500).render('employer-post-job', {
      errorMessage: 'Database error creating job. Please try again.'
    });
  }
});

// Instant Matching Results Page
app.get('/employer/post-success/:id', async (req, res) => {
  try {
    const jobId = req.params.id;
    const job = await db.getAsync('SELECT * FROM jobs WHERE id = ?', [jobId]);

    if (!job) {
      return res.status(404).send('Job not found');
    }

    const matchedWorkers = await db.allAsync(
      'SELECT * FROM workers WHERE skill_type = ? AND location = ? AND available = 1 ORDER BY id DESC',
      [job.skill_needed, job.location]
    );

    const nearbyWorkers = await db.allAsync(
      'SELECT * FROM workers WHERE skill_type = ? AND location != ? AND available = 1 ORDER BY id DESC LIMIT 4',
      [job.skill_needed, job.location]
    );

    res.render('employer-post-success', { job, matchedWorkers, nearbyWorkers });
  } catch (err) {
    console.error('Error loading post success:', err);
    res.status(500).send('Internal Server Error');
  }
});

// Employer Dashboard
app.get('/employer/dashboard', async (req, res) => {
  try {
    const phone = cleanPhone(req.query.phone);
    let successMessage = null;

    if (req.query.confirmed) {
      successMessage = 'Worker confirmed successfully! The job has been marked filled.';
    }

    if (!phone) {
      return res.render('employer-dashboard', {
        jobs: [],
        phone: '',
        successMessage
      });
    }

    const jobs = await db.allAsync(
      'SELECT * FROM jobs WHERE employer_phone = ? ORDER BY id DESC',
      [phone]
    );

    for (const job of jobs) {
      const interestedWorkers = await db.allAsync(
        `SELECT w.id as worker_id, w.name, w.phone_number, w.skill_type, w.location, w.available, ji.status
         FROM job_interests ji
         JOIN workers w ON ji.worker_id = w.id
         WHERE ji.job_id = ?
         ORDER BY (CASE WHEN ji.status = 'confirmed' THEN 0 ELSE 1 END), ji.id DESC`,
        [job.id]
      );
      job.interestedWorkers = interestedWorkers;
    }

    res.render('employer-dashboard', {
      jobs,
      phone,
      successMessage
    });
  } catch (err) {
    console.error('Error rendering employer dashboard:', err);
    res.status(500).send('Internal Server Error');
  }
});

// Confirm Worker
app.post('/employer/confirm-worker', async (req, res) => {
  try {
    const { job_id, worker_id, employer_phone } = req.body;
    if (!job_id || !worker_id) {
      return res.status(400).redirect('/employer/dashboard');
    }

    await db.runAsync(
      "UPDATE job_interests SET status = 'confirmed' WHERE job_id = ? AND worker_id = ?",
      [job_id, worker_id]
    );
    await db.runAsync("UPDATE jobs SET status = 'filled' WHERE id = ?", [job_id]);

    // Notify worker of confirmation via Exotel SMS
    try {
      const job = await db.getAsync('SELECT * FROM jobs WHERE id = ?', [job_id]);
      const worker = await db.getAsync('SELECT * FROM workers WHERE id = ?', [worker_id]);
      if (job && worker) {
        const confirmMsg = `LabourLink Update: You have been confirmed for the ${job.skill_needed} gig in ${job.location}! Wage: ${job.wage_offered}. Contact employer ${job.employer_name} at ${job.employer_phone}.`;
        sendSms(worker.phone_number, confirmMsg);
      }
    } catch (smsErr) {
      console.error('[Web Confirm Worker SMS Error]:', smsErr);
    }

    res.redirect(`/employer/dashboard?phone=${encodeURIComponent(employer_phone)}&confirmed=1`);
  } catch (err) {
    console.error('Error confirming worker:', err);
    res.redirect(`/employer/dashboard?phone=${encodeURIComponent(req.body.employer_phone || '')}`);
  }
});

// Public Job Board (Digital Labor Chowk)
app.get('/jobs', async (req, res) => {
  try {
    const { skill, location } = req.query;
    let sql = "SELECT * FROM jobs WHERE status = 'open'";
    const params = [];

    if (skill) {
      sql += ' AND skill_needed = ?';
      params.push(skill);
    }
    if (location) {
      sql += ' AND location = ?';
      params.push(location);
    }

    sql += ' ORDER BY id DESC';
    const jobs = await db.allAsync(sql, params);

    res.render('jobs-board', {
      jobs,
      selectedSkill: skill || '',
      selectedLocation: location || ''
    });
  } catch (err) {
    console.error('Error fetching public jobs:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.listen(port, () => {
  console.log(`LabourLink server running at http://localhost:${port}`);
});
