require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const db = require('./database');

const app = express();
const port = process.env.PORT || 3000;

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

// Helper to sanitize phone input
function cleanPhone(phone) {
  if (!phone) return '';
  return String(phone).replace(/[^0-9]/g, '').slice(0, 10);
}

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
