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

// Request logging
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    console.log(`[API ${req.method}] ${req.path} from ${req.ip}`);
  }
  next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Supabase Connection Status
app.get('/api/supabase/status', async (req, res) => {
  res.json({
    status: db.isSupabaseConfigured ? 'connected' : 'unconfigured',
    isConfigured: db.isSupabaseConfigured,
    supabaseUrl: process.env.SUPABASE_URL || null
  });
});

// Trigger sync to Supabase
app.post('/api/supabase/sync', async (req, res) => {
  try {
    const result = await db.syncToSupabase();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper to sanitize phone input (extracts last 10 digits e.g. for Indian numbers with +91 or leading 0)
function cleanPhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/[^0-9]/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// Helper to check worker active job conflict & cross-zone restrictions
async function checkWorkerActiveConflict(workerId, targetJobId) {
  const worker = await db.getAsync(
    `SELECT w.*, j.location as active_job_location, j.status as active_job_status, j.date_needed as active_job_date
     FROM workers w
     LEFT JOIN jobs j ON w.current_active_job_id = j.id
     WHERE w.id = ?`,
    [workerId]
  );

  if (!worker) {
    return { hasConflict: false, notFound: true };
  }

  // Active if status is 'HIRED' or current_active_job_id exists and is not COMPLETED/CANCELLED
  const isActivelyEmployed = worker.status === 'HIRED' ||
    (worker.current_active_job_id && !['COMPLETED', 'CANCELLED'].includes(worker.active_job_status));

  if (isActivelyEmployed) {
    const targetJob = targetJobId ? await db.getAsync('SELECT * FROM jobs WHERE id = ?', [targetJobId]) : null;
    const activeZone = worker.current_location_zone || worker.active_job_location;
    const isDifferentArea = targetJob && activeZone && targetJob.location !== activeZone;

    return {
      hasConflict: true,
      worker,
      message: isDifferentArea
        ? `You are currently assigned to an active job in another area (${activeZone}).`
        : 'You are currently assigned to an active job and cannot apply for or accept new jobs.'
    };
  }

  return { hasConflict: false, worker };
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

    // Direct matches: same skill + same location
    // Both available workers and workers hired by other employers are returned
    const matchedWorkers = await db.allAsync(
      `SELECT w.*, 
              (CASE WHEN w.status = 'HIRED' OR w.current_active_job_id IS NOT NULL THEN 1 ELSE 0 END) as is_hired_by_other,
              w.current_location_zone as active_zone,
              COALESCE((SELECT ROUND(AVG(rating), 1) FROM worker_ratings WHERE worker_id = w.id), 0.0) as avg_rating,
              COALESCE((SELECT COUNT(*) FROM worker_ratings WHERE worker_id = w.id), 0) as rating_count,
              COALESCE((SELECT COUNT(*) > 0 FROM worker_cv WHERE worker_id = w.id), 0) as has_cv
       FROM workers w
       WHERE w.skill_type = ? AND w.location = ?
       ORDER BY (CASE WHEN w.status = 'HIRED' OR w.current_active_job_id IS NOT NULL THEN 1 ELSE 0 END), w.id DESC`,
      [job.skill_needed, job.location]
    );

    // Nearby citywide workers with same skill
    const nearbyWorkers = await db.allAsync(
      `SELECT w.*, 
              (CASE WHEN w.status = 'HIRED' OR w.current_active_job_id IS NOT NULL THEN 1 ELSE 0 END) as is_hired_by_other,
              w.current_location_zone as active_zone,
              COALESCE((SELECT ROUND(AVG(rating), 1) FROM worker_ratings WHERE worker_id = w.id), 0.0) as avg_rating,
              COALESCE((SELECT COUNT(*) FROM worker_ratings WHERE worker_id = w.id), 0) as rating_count,
              COALESCE((SELECT COUNT(*) > 0 FROM worker_cv WHERE worker_id = w.id), 0) as has_cv
       FROM workers w
       WHERE w.skill_type = ? AND w.location != ?
       ORDER BY (CASE WHEN w.status = 'HIRED' OR w.current_active_job_id IS NOT NULL THEN 1 ELSE 0 END), w.id DESC LIMIT 5`,
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
    const worker = await db.getAsync(
      `SELECT w.*,
              COALESCE((SELECT ROUND(AVG(rating), 1) FROM worker_ratings WHERE worker_id = w.id), 0.0) as avg_rating,
              COALESCE((SELECT COUNT(*) FROM worker_ratings WHERE worker_id = w.id), 0) as rating_count,
              COALESCE((SELECT COUNT(*) > 0 FROM worker_cv WHERE worker_id = w.id), 0) as has_cv
       FROM workers w
       WHERE w.phone_number = ?`,
      [phone]
    );

    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    // Fetch worker CV if exists
    const cvRecord = await db.getAsync('SELECT * FROM worker_cv WHERE worker_id = ?', [worker.id]);
    let cv = null;
    if (cvRecord) {
      let skills = [];
      let previous_work = [];
      try { skills = JSON.parse(cvRecord.skills); } catch (e) { skills = cvRecord.skills ? cvRecord.skills.split(',').map(s => s.trim()) : []; }
      try { previous_work = JSON.parse(cvRecord.previous_work); } catch (e) { previous_work = []; }
      cv = { ...cvRecord, skills, previous_work };
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
      cv,
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

    const conflict = await checkWorkerActiveConflict(worker_id, job_id);
    if (conflict.notFound) {
      return res.status(404).json({ error: 'Worker not found' });
    }
    if (conflict.hasConflict) {
      return res.status(409).json({ error: conflict.message });
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
        `SELECT w.id as worker_id, w.name, w.phone_number, w.skill_type, w.location, w.available, ji.status,
                COALESCE((SELECT ROUND(AVG(rating), 1) FROM worker_ratings WHERE worker_id = w.id), 0.0) as avg_rating,
                COALESCE((SELECT COUNT(*) FROM worker_ratings WHERE worker_id = w.id), 0) as rating_count,
                COALESCE((SELECT COUNT(*) > 0 FROM worker_cv WHERE worker_id = w.id), 0) as has_cv
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

// 10. Employer Confirm Worker (Locks worker to active job)
app.post('/api/employers/confirm-worker', async (req, res) => {
  try {
    const { job_id, worker_id } = req.body;
    if (!job_id || !worker_id) {
      return res.status(400).json({ error: 'job_id and worker_id are required' });
    }

    const job = await db.getAsync('SELECT * FROM jobs WHERE id = ?', [job_id]);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const conflict = await checkWorkerActiveConflict(worker_id, job_id);
    if (conflict.hasConflict) {
      return res.status(409).json({ error: 'This worker is currently assigned to an active job.' });
    }

    await db.runAsync(
      "UPDATE job_interests SET status = 'confirmed' WHERE job_id = ? AND worker_id = ?",
      [job_id, worker_id]
    );
    await db.runAsync("UPDATE jobs SET status = 'filled' WHERE id = ?", [job_id]);
    await db.runAsync(
      `UPDATE workers 
       SET status = 'HIRED', available = 0, current_active_job_id = ?, current_location_zone = ? 
       WHERE id = ?`,
      [job_id, job.location, worker_id]
    );

    res.json({ status: 'ok', message: 'Worker confirmed and assigned to active job' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Complete Job (releases labourer back to available)
app.post('/api/jobs/:id/complete', async (req, res) => {
  try {
    const jobId = req.params.id;
    const job = await db.getAsync('SELECT * FROM jobs WHERE id = ?', [jobId]);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Capture the assigned or confirmed worker before releasing
    const assignedWorker = await db.getAsync(
      `SELECT w.id, w.name, w.phone_number, w.skill_type
       FROM workers w
       WHERE w.current_active_job_id = ?`,
      [jobId]
    );
    const confirmedWorker = assignedWorker || await db.getAsync(
      `SELECT w.id, w.name, w.phone_number, w.skill_type
       FROM job_interests ji
       JOIN workers w ON ji.worker_id = w.id
       WHERE ji.job_id = ? AND ji.status = 'confirmed'`,
      [jobId]
    );

    await db.runAsync("UPDATE jobs SET status = 'completed' WHERE id = ?", [jobId]);
    await db.runAsync(
      `UPDATE workers 
       SET status = 'AVAILABLE', available = 1, current_active_job_id = NULL, current_location_zone = NULL 
       WHERE current_active_job_id = ?`,
      [jobId]
    );

    res.json({
      status: 'ok',
      message: 'Job completed and labourer is now available',
      worker: confirmedWorker || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. Cancel Job (releases labourer back to available)
app.post('/api/jobs/:id/cancel', async (req, res) => {
  try {
    const jobId = req.params.id;
    const job = await db.getAsync('SELECT * FROM jobs WHERE id = ?', [jobId]);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    await db.runAsync("UPDATE jobs SET status = 'cancelled' WHERE id = ?", [jobId]);
    await db.runAsync(
      `UPDATE workers 
       SET status = 'AVAILABLE', available = 1, current_active_job_id = NULL, current_location_zone = NULL 
       WHERE current_active_job_id = ?`,
      [jobId]
    );

    res.json({ status: 'ok', message: 'Job cancelled and labourer is now available' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. Get Worker CV (Structured form data)
app.get('/api/workers/:id/cv', async (req, res) => {
  try {
    const workerId = req.params.id;
    const worker = await db.getAsync(
      `SELECT w.*,
              COALESCE((SELECT ROUND(AVG(rating), 1) FROM worker_ratings WHERE worker_id = w.id), 0.0) as avg_rating,
              COALESCE((SELECT COUNT(*) FROM worker_ratings WHERE worker_id = w.id), 0) as rating_count
       FROM workers w WHERE w.id = ?`,
      [workerId]
    );
    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    const cv = await db.getAsync('SELECT * FROM worker_cv WHERE worker_id = ?', [workerId]);
    if (!cv) {
      return res.json({
        status: 'ok',
        has_cv: false,
        worker,
        cv: null
      });
    }

    let skills = [];
    let previousWork = [];
    try { skills = JSON.parse(cv.skills); } catch (e) { skills = cv.skills ? cv.skills.split(',').map(s => s.trim()) : []; }
    try { previousWork = JSON.parse(cv.previous_work); } catch (e) { previousWork = []; }

    res.json({
      status: 'ok',
      has_cv: true,
      worker,
      cv: {
        ...cv,
        skills,
        previous_work: previousWork
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. Save / Update Worker CV (Structured Form Submission)
app.post('/api/workers/:id/cv', async (req, res) => {
  try {
    const workerId = parseInt(req.params.id, 10);
    const worker = await db.getAsync('SELECT id, name, phone_number FROM workers WHERE id = ?', [workerId]);
    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    const {
      full_name,
      dob_or_age,
      phone_number,
      skills,
      years_of_experience,
      previous_work,
      work_location,
      daily_wage_expectation,
      availability_type,
      languages,
      about_me
    } = req.body;

    if (!full_name) {
      return res.status(400).json({ error: 'Full name is required for CV' });
    }

    const skillsJson = Array.isArray(skills) ? JSON.stringify(skills) : (skills ? JSON.stringify([skills]) : '[]');
    const prevWorkJson = Array.isArray(previous_work) ? JSON.stringify(previous_work) : '[]';
    const yoe = parseInt(years_of_experience, 10) || 0;

    await db.runAsync(
      `INSERT INTO worker_cv (
         worker_id, full_name, dob_or_age, phone_number, skills,
         years_of_experience, previous_work, work_location,
         daily_wage_expectation, availability_type, languages, about_me, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(worker_id) DO UPDATE SET
         full_name = excluded.full_name,
         dob_or_age = excluded.dob_or_age,
         phone_number = excluded.phone_number,
         skills = excluded.skills,
         years_of_experience = excluded.years_of_experience,
         previous_work = excluded.previous_work,
         work_location = excluded.work_location,
         daily_wage_expectation = excluded.daily_wage_expectation,
         availability_type = excluded.availability_type,
         languages = excluded.languages,
         about_me = excluded.about_me,
         updated_at = CURRENT_TIMESTAMP`,
      [
        workerId,
        full_name.trim(),
        dob_or_age || '',
        cleanPhone(phone_number) || worker.phone_number,
        skillsJson,
        yoe,
        prevWorkJson,
        work_location || '',
        daily_wage_expectation || '',
        availability_type || 'Full-time',
        languages || '',
        about_me || ''
      ]
    );

    res.json({
      status: 'ok',
      message: 'Worker CV saved successfully'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 15. Submit Worker Rating (1-5 stars, preventing duplicate job ratings)
app.post('/api/workers/:id/ratings', async (req, res) => {
  try {
    const workerId = parseInt(req.params.id, 10);
    const { job_id, employer_phone, rating, comment } = req.body;

    if (!job_id) {
      return res.status(400).json({ error: 'job_id is required to rate a worker' });
    }

    const numRating = parseFloat(rating);
    if (isNaN(numRating) || numRating < 1.0 || numRating > 5.0) {
      return res.status(400).json({ error: 'Rating must be a number between 1.0 and 5.0 stars' });
    }

    const job = await db.getAsync('SELECT * FROM jobs WHERE id = ?', [job_id]);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Check duplicate rating for this job & worker
    const existing = await db.getAsync(
      'SELECT id FROM worker_ratings WHERE job_id = ? AND worker_id = ?',
      [job_id, workerId]
    );
    if (existing) {
      return res.status(409).json({ error: 'You have already submitted a rating for this completed job.' });
    }

    const empPhone = cleanPhone(employer_phone || job.employer_phone);

    await db.runAsync(
      `INSERT INTO worker_ratings (worker_id, employer_phone, job_id, rating, comment)
       VALUES (?, ?, ?, ?, ?)`,
      [workerId, empPhone, job_id, Math.round(numRating * 10) / 10, (comment || '').trim()]
    );

    const stats = await db.getAsync(
      `SELECT ROUND(AVG(rating), 1) as avg_rating, COUNT(*) as rating_count
       FROM worker_ratings
       WHERE worker_id = ?`,
      [workerId]
    );

    res.json({
      status: 'ok',
      message: 'Rating submitted successfully',
      avg_rating: stats && stats.avg_rating ? stats.avg_rating : numRating,
      rating_count: stats && stats.rating_count ? stats.rating_count : 1
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 16. Get Worker Ratings & Reviews
app.get('/api/workers/:id/ratings', async (req, res) => {
  try {
    const workerId = req.params.id;
    const stats = await db.getAsync(
      `SELECT ROUND(AVG(rating), 1) as avg_rating, COUNT(*) as rating_count
       FROM worker_ratings
       WHERE worker_id = ?`,
      [workerId]
    );

    const reviews = await db.allAsync(
      `SELECT wr.*, j.skill_needed, j.location as job_location
       FROM worker_ratings wr
       LEFT JOIN jobs j ON wr.job_id = j.id
       WHERE wr.worker_id = ?
       ORDER BY wr.id DESC`,
      [workerId]
    );

    res.json({
      status: 'ok',
      avg_rating: stats && stats.avg_rating ? stats.avg_rating : 0.0,
      rating_count: stats && stats.rating_count ? stats.rating_count : 0,
      reviews
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 17. Check if Job is already rated
app.get('/api/jobs/:id/rating', async (req, res) => {
  try {
    const jobId = req.params.id;
    const workerId = req.query.worker_id;
    let query = 'SELECT * FROM worker_ratings WHERE job_id = ?';
    const params = [jobId];
    if (workerId) {
      query += ' AND worker_id = ?';
      params.push(workerId);
    }
    const rating = await db.getAsync(query, params);
    res.json({ status: 'ok', is_rated: !!rating, rating: rating || null });
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

    const conflict = await checkWorkerActiveConflict(worker_id, job_id);
    if (conflict.hasConflict) {
      return res.redirect(`/worker/dashboard?phone=${encodeURIComponent(phone || '')}&error=${encodeURIComponent(conflict.message)}`);
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

    // Direct matches with is_hired_by_other indicator and ratings
    const matchedWorkers = await db.allAsync(
      `SELECT w.*, 
              (CASE WHEN w.status = 'HIRED' OR w.current_active_job_id IS NOT NULL THEN 1 ELSE 0 END) as is_hired_by_other,
              w.current_location_zone as active_zone,
              COALESCE((SELECT ROUND(AVG(rating), 1) FROM worker_ratings WHERE worker_id = w.id), 0.0) as avg_rating,
              COALESCE((SELECT COUNT(*) FROM worker_ratings WHERE worker_id = w.id), 0) as rating_count,
              COALESCE((SELECT COUNT(*) > 0 FROM worker_cv WHERE worker_id = w.id), 0) as has_cv
       FROM workers w 
       WHERE skill_type = ? AND location = ? 
       ORDER BY (CASE WHEN w.status = 'HIRED' OR w.current_active_job_id IS NOT NULL THEN 1 ELSE 0 END), id DESC`,
      [job.skill_needed, job.location]
    );

    const nearbyWorkers = await db.allAsync(
      `SELECT w.*, 
              (CASE WHEN w.status = 'HIRED' OR w.current_active_job_id IS NOT NULL THEN 1 ELSE 0 END) as is_hired_by_other,
              w.current_location_zone as active_zone,
              COALESCE((SELECT ROUND(AVG(rating), 1) FROM worker_ratings WHERE worker_id = w.id), 0.0) as avg_rating,
              COALESCE((SELECT COUNT(*) FROM worker_ratings WHERE worker_id = w.id), 0) as rating_count,
              COALESCE((SELECT COUNT(*) > 0 FROM worker_cv WHERE worker_id = w.id), 0) as has_cv
       FROM workers w 
       WHERE skill_type = ? AND location != ? 
       ORDER BY (CASE WHEN w.status = 'HIRED' OR w.current_active_job_id IS NOT NULL THEN 1 ELSE 0 END), id DESC LIMIT 4`,
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
    } else if (req.query.completed) {
      successMessage = 'Job marked COMPLETED! The hired labourer is now freed and available for new work.';
    } else if (req.query.cancelled) {
      successMessage = 'Job CANCELLED. The hired labourer is now freed.';
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
        `SELECT w.id as worker_id, w.name, w.phone_number, w.skill_type, w.location, w.available, w.status, ji.status as interest_status,
                COALESCE((SELECT ROUND(AVG(rating), 1) FROM worker_ratings WHERE worker_id = w.id), 0.0) as avg_rating,
                COALESCE((SELECT COUNT(*) FROM worker_ratings WHERE worker_id = w.id), 0) as rating_count,
                COALESCE((SELECT COUNT(*) > 0 FROM worker_cv WHERE worker_id = w.id), 0) as has_cv
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

    const job = await db.getAsync('SELECT * FROM jobs WHERE id = ?', [job_id]);
    if (!job) {
      return res.status(404).send('Job not found');
    }

    const conflict = await checkWorkerActiveConflict(worker_id, job_id);
    if (conflict.hasConflict) {
      return res.redirect(`/employer/dashboard?phone=${encodeURIComponent(employer_phone || '')}&error=${encodeURIComponent(conflict.message)}`);
    }

    await db.runAsync(
      "UPDATE job_interests SET status = 'confirmed' WHERE job_id = ? AND worker_id = ?",
      [job_id, worker_id]
    );
    await db.runAsync("UPDATE jobs SET status = 'filled' WHERE id = ?", [job_id]);
    await db.runAsync(
      `UPDATE workers 
       SET status = 'HIRED', available = 0, current_active_job_id = ?, current_location_zone = ? 
       WHERE id = ?`,
      [job_id, job.location, worker_id]
    );

    res.redirect(`/employer/dashboard?phone=${encodeURIComponent(employer_phone)}&confirmed=1`);
  } catch (err) {
    console.error('Error confirming worker:', err);
    res.redirect(`/employer/dashboard?phone=${encodeURIComponent(req.body.employer_phone || '')}`);
  }
});

// Complete Job (Web route)
app.post('/employer/jobs/:id/complete', async (req, res) => {
  try {
    const jobId = req.params.id;
    const phone = req.body.employer_phone;

    await db.runAsync("UPDATE jobs SET status = 'completed' WHERE id = ?", [jobId]);
    await db.runAsync(
      `UPDATE workers 
       SET status = 'AVAILABLE', available = 1, current_active_job_id = NULL, current_location_zone = NULL 
       WHERE current_active_job_id = ?`,
      [jobId]
    );

    res.redirect(`/employer/dashboard?phone=${encodeURIComponent(phone || '')}&completed=1`);
  } catch (err) {
    console.error('Error completing job:', err);
    res.redirect('/employer/dashboard');
  }
});

// Cancel Job (Web route)
app.post('/employer/jobs/:id/cancel', async (req, res) => {
  try {
    const jobId = req.params.id;
    const phone = req.body.employer_phone;

    await db.runAsync("UPDATE jobs SET status = 'cancelled' WHERE id = ?", [jobId]);
    await db.runAsync(
      `UPDATE workers 
       SET status = 'AVAILABLE', available = 1, current_active_job_id = NULL, current_location_zone = NULL 
       WHERE current_active_job_id = ?`,
      [jobId]
    );

    res.redirect(`/employer/dashboard?phone=${encodeURIComponent(phone || '')}&cancelled=1`);
  } catch (err) {
    console.error('Error cancelling job:', err);
    res.redirect('/employer/dashboard');
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

app.listen(port, '0.0.0.0', () => {
  console.log(`LabourLink server running at http://0.0.0.0:${port} (Local: http://localhost:${port}, Wi-Fi: http://192.168.0.161:${port})`);
});
