require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const db = require('./database');
const supabase = db.supabase || db;
const ivrRoutes = require('./routes/ivr');
const adminIvrRoutes = require('./routes/adminIvr');
const ivrService = require('./services/ivrService');
const voiceAgent = require('./voice-agent');
const voiceTools = require('./voice-tools');
let ngrokTunnel; try { ngrokTunnel = require('./ngrok-tunnel'); } catch (_) { ngrokTunnel = null; }

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
  if (req.path.startsWith('/api') || req.path.startsWith('/webhooks')) {
    console.log(`[API ${req.method}] ${req.path} from ${req.ip}`);
  }
  next();
});

// IVR telephony webhooks (Twilio by default) and internal admin APIs
app.use('/webhooks/voice', ivrRoutes);
app.use('/api/admin/ivr', adminIvrRoutes);

// Process-level crash prevention for dropped connections and unhandled promises
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ [Server] Unhandled Promise Rejection (Prevented Crash):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ [Server] Uncaught Exception (Prevented Crash):', err.message || err);
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Database Connection & Pooler Diagnostics
app.get('/api/db/diagnostics', (req, res) => {
  res.json({
    status: 'ok',
    diagnostics: db.getDiagnostics(),
    timestamp: new Date().toISOString()
  });
});

// Supabase Connection Status
app.get('/api/supabase/status', async (req, res) => {
  res.json({
    status: db.isSupabaseConfigured ? 'connected' : 'unconfigured',
    isConfigured: db.isSupabaseConfigured,
    supabaseUrl: process.env.SUPABASE_URL || null,
    diagnostics: db.getDiagnostics()
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
  try {
    const worker = await db.getAsync('SELECT * FROM workers WHERE id = ?', [workerId]);

    if (!worker) {
      return { hasConflict: false, notFound: true };
    }

    // A worker is actively hired if available is 0/false or status is HIRED
    const isActivelyEmployed = worker.available === 0 || worker.available === false || worker.status === 'HIRED' || worker.current_active_job_id !== null;

    if (isActivelyEmployed) {
      let targetJob = null;
      if (targetJobId) {
        targetJob = await db.getAsync('SELECT * FROM jobs WHERE id = ?', [targetJobId]);
      }
      const activeZone = worker.current_location_zone || worker.location;
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
  } catch (err) {
    console.error('Error checking active conflict:', err);
    return { hasConflict: false };
  }
}

// Helper: parse wage string into a numeric value (e.g. "₹850/day" -> 850)
function parseWage(wageStr) {
  if (!wageStr) return 0;
  const num = parseInt(String(wageStr).replace(/[^0-9]/g, ''), 10);
  return isNaN(num) ? 0 : num;
}

// Helper: mask display name -> first name + last initial (e.g. "Ramesh Kumar" -> "Ramesh K.")
function maskName(fullName) {
  if (!fullName) return 'Worker';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

// Helper: mask phone number -> show only last 2 digits (e.g. ******89)
function maskPhone(phone) {
  if (!phone) return '******00';
  const digits = String(phone).replace(/[^0-9]/g, '');
  if (digits.length < 4) return '******';
  return '•'.repeat(Math.max(0, digits.length - 2)) + digits.slice(-2);
}

/**
 * Validation function to prevent duplicate user registrations.
 * Supports Option B (Role-Based Uniqueness: same phone cannot register twice in same role)
 * and optional Option A (Global Uniqueness).
 *
 * @param {string} identifier - Phone number or email
 * @param {'worker' | 'hirer' | 'employer'} role
 * @param {boolean} [globalCheck=false]
 * @returns {Promise<{ exists: boolean, role?: string, user?: object }>}
 */
async function checkExistingUser(identifier, role, globalCheck = false) {
  try {
    const phone = cleanPhone(identifier);
    if (!phone) return { exists: false };

    // 1. Check Worker role
    if (role === 'worker') {
      if (supabase) {
        const { data: worker } = await supabase
          .from('workers')
          .select('id, name, phone_number, skill_type, location')
          .eq('phone_number', phone)
          .maybeSingle();

        if (worker) {
          return { exists: true, role: 'worker', user: worker };
        }
      }
      const localWorker = await db.getAsync('SELECT * FROM workers WHERE phone_number = ?', [phone]);
      if (localWorker) {
        return { exists: true, role: 'worker', user: localWorker };
      }
    }

    // 2. Check Hirer / Employer role
    if (role === 'hirer' || role === 'employer') {
      if (supabase) {
        try {
          const { data: employer } = await supabase
            .from('employers')
            .select('id, name, phone_number')
            .eq('phone_number', phone)
            .maybeSingle();

          if (employer) {
            return { exists: true, role: 'hirer', user: employer };
          }
        } catch (_) {}

        const { data: job } = await supabase
          .from('jobs')
          .select('id, employer_name, employer_phone')
          .eq('employer_phone', phone)
          .limit(1)
          .maybeSingle();

        if (job) {
          return {
            exists: true,
            role: 'hirer',
            user: { name: job.employer_name, phone_number: job.employer_phone }
          };
        }
      }

      const localJob = await db.getAsync('SELECT * FROM jobs WHERE employer_phone = ? LIMIT 1', [phone]);
      if (localJob) {
        return {
          exists: true,
          role: 'hirer',
          user: { name: localJob.employer_name, phone_number: localJob.employer_phone }
        };
      }
    }

    // 3. Optional cross-role check (Option A: Global uniqueness)
    if (globalCheck) {
      if (role !== 'worker') {
        const w = await db.getAsync('SELECT id, name FROM workers WHERE phone_number = ?', [phone]);
        if (w) return { exists: true, role: 'worker', user: w };
      }
      if (role !== 'hirer' && role !== 'employer') {
        const j = await db.getAsync('SELECT id, employer_name FROM jobs WHERE employer_phone = ? LIMIT 1', [phone]);
        if (j) return { exists: true, role: 'hirer', user: j };
      }
    }

    return { exists: false };
  } catch (err) {
    console.error('Error checking existing user:', err);
    return { exists: false };
  }
}

// ==========================================================================
// REST API ENDPOINTS FOR FLUTTER APPLICATION
// ==========================================================================

// 1. Platform Statistics
app.get('/api/stats', async (req, res) => {
  try {
    const totalWorkers = (await db.getAsync('SELECT COUNT(*) as count FROM workers')).count;
    const availableWorkers = (await db.getAsync('SELECT COUNT(*) as count FROM workers WHERE available = 1')).count;
    const openJobs = (await db.getAsync("SELECT COUNT(*) as count FROM jobs WHERE status = 'open'")).count;
    const filledJobs = (await db.getAsync("SELECT COUNT(*) as count FROM jobs WHERE status = 'filled'")).count;
    const totalInterests = (await db.getAsync('SELECT COUNT(*) as count FROM job_interests')).count;

    res.json({
      status: 'ok',
      totalWorkers: totalWorkers || 0,
      availableWorkers: availableWorkers || 0,
      openJobs: openJobs || 0,
      filledJobs: filledJobs || 0,
      totalInterests: totalInterests || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2a. Public Jobs Feed — masked data, no auth required
app.get('/api/public/jobs', async (req, res) => {
  try {
    const { skill, location, minWage, maxWage } = req.query;
    let sql = "SELECT * FROM jobs WHERE status = 'open'";
    const params = [];

    if (skill) {
      sql += " AND skill_needed = ?";
      params.push(skill);
    }
    if (location) {
      sql += " AND location = ?";
      params.push(location);
    }
    sql += " ORDER BY id DESC LIMIT 50";

    let rawJobs = await db.allAsync(sql, params);
    if (minWage || maxWage) {
      const min = minWage ? parseInt(minWage, 10) : 0;
      const max = maxWage ? parseInt(maxWage, 10) : Infinity;
      rawJobs = rawJobs.filter(j => {
        const num = parseWage(j.wage_offered);
        return num >= min && num <= max;
      });
    }

    const publicJobs = rawJobs.map(j => ({
      id: j.id,
      employer_name: maskName(j.employer_name),
      employer_phone_masked: maskPhone(j.employer_phone),
      skill_needed: j.skill_needed,
      location: j.location,
      wage_offered: j.wage_offered,
      date_needed: j.date_needed,
      status: j.status,
      created_at: j.created_at || null,
    }));

    res.json({ status: 'ok', count: publicJobs.length, jobs: publicJobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2b. Public Workers Feed — masked data, no auth required
app.get('/api/public/workers', async (req, res) => {
  try {
    const { skill, location, availableOnly } = req.query;
    let sql = "SELECT * FROM workers WHERE 1=1";
    const params = [];

    if (availableOnly === 'true') {
      sql += " AND available = 1";
    }
    if (skill) {
      sql += " AND skill_type = ?";
      params.push(skill);
    }
    if (location) {
      sql += " AND location = ?";
      params.push(location);
    }
    sql += " ORDER BY available DESC, id DESC LIMIT 50";

    const rawWorkers = await db.allAsync(sql, params);
    const publicWorkers = rawWorkers.map(w => ({
      id: w.id,
      display_name: maskName(w.name),
      skill_type: w.skill_type,
      location: w.location,
      available: w.available === 1 || w.available === true,
      registered_at: w.registered_at || null,
    }));

    res.json({ status: 'ok', count: publicWorkers.length, workers: publicWorkers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Open / Filtered Jobs Feed (Internal / Authenticated)
app.get('/api/jobs', async (req, res) => {
  try {
    const { skill, location } = req.query;
    let sql = "SELECT * FROM jobs WHERE status = 'open'";
    const params = [];

    if (skill) {
      sql += " AND skill_needed = ?";
      params.push(skill);
    }
    if (location) {
      sql += " AND location = ?";
      params.push(location);
    }
    sql += " ORDER BY id DESC";

    const jobs = await db.allAsync(sql, params);
    res.json({ status: 'ok', jobs: jobs || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/available-jobs
 * Used by the ElevenLabs voice agent to fetch open jobs matching a caller's
 * skill type and location.
 *
 * Query params:
 *   skill_type  – matched against jobs.skill_needed  (case-insensitive, trimmed)
 *   location    – matched against jobs.location       (case-insensitive, trimmed)
 *
 * Auth:
 *   If ELEVENLABS_WEBHOOK_SECRET is set, the request must include it via
 *   x-api-key header (or Authorization: Bearer <secret>).
 *
 * Response shape:
 *   { "count": N, "jobs": [ { "employer_name", "wage_offered", "date_needed" } ] }
 *   On no match: { "count": 0, "jobs": [] }
 */
app.all(['/api/available-jobs', '/api/voice/available-jobs', '/api/voice/tools/available_jobs'], async (req, res) => {
  try {
    // ── Auth check (mirrors /api/voice/tools/:toolName pattern) ──────────
    const webhookSecret = process.env.ELEVENLABS_WEBHOOK_SECRET || process.env.INTERNAL_API_KEY;
    if (webhookSecret) {
      const headerSecret =
        req.headers['x-api-key'] ||
        req.headers['x-webhook-secret'] ||
        (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
      if (headerSecret && headerSecret !== webhookSecret && headerSecret !== process.env.ELEVENLABS_API_KEY) {
        console.warn('[available-jobs] Unauthorized request — invalid x-api-key');
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    // ── Extract inputs (supports both GET query params and POST JSON body) ──
    const src = (req.method === 'POST' && req.body && Object.keys(req.body).length > 0)
      ? { ...req.query, ...req.body }
      : req.query;

    const rawSkill = (src.skill_type || src.skill || src.trade || '').trim().toLowerCase();
    const rawLoc   = (src.location   || src.area  || src.city  || '').trim().toLowerCase();

    // Ignore generic wildcards like 'all', 'any', 'none'
    const skillType = (rawSkill === 'all' || rawSkill === 'any' || rawSkill === 'none') ? '' : rawSkill;
    const location  = (rawLoc === 'all'   || rawLoc === 'any'   || rawLoc === 'none')   ? '' : rawLoc;

    // ── Build query — case-insensitive trimmed equality + substring match ──
    let sql = "SELECT employer_name, wage_offered, date_needed FROM jobs WHERE status = 'open'";
    const params = [];

    if (skillType) {
      sql += ' AND (LOWER(TRIM(skill_needed)) = ? OR LOWER(skill_needed) LIKE ?)';
      params.push(skillType, `%${skillType}%`);
    }
    if (location) {
      sql += ' AND (LOWER(TRIM(location)) = ? OR LOWER(location) LIKE ?)';
      params.push(location, `%${location}%`);
    }

    sql += ' ORDER BY id DESC';

    const rows = await db.allAsync(sql, params);
    const result = (rows || []).map(r => {
      // Parse numeric wage if stored as string e.g. "₹850/day" or "Rs. 950/day"
      let wage = r.wage_offered;
      if (typeof wage === 'string') {
        const num = parseInt(wage.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(num)) wage = num;
      }
      return {
        employer_name: r.employer_name,
        wage_offered:  wage,
        date_needed:   r.date_needed || 'Today'
      };
    });

    console.log(`[available-jobs] [${req.method}] skill="${skillType}" location="${location}" → ${result.length} result(s)`);
    res.json({ count: result.length, jobs: result });

  } catch (err) {
    console.error('[available-jobs] Error:', err.message);
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

// 4. Instant Matches for a Job (Explorer View with Hired-by-Other indicator)
app.get('/api/jobs/:id/matches', async (req, res) => {
  try {
    const jobId = req.params.id;
    const job = await db.getAsync('SELECT * FROM jobs WHERE id = ?', [jobId]);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Direct matches: same skill + same location (excluding workers rejected for this job)
    const matchedWorkers = await db.allAsync(
      `SELECT w.*, 
              (CASE WHEN w.status = 'HIRED' OR w.current_active_job_id IS NOT NULL THEN 1 ELSE 0 END) as is_hired_by_other,
              w.current_location_zone as active_zone,
              COALESCE((SELECT ROUND(AVG(rating), 1) FROM worker_ratings WHERE worker_id = w.id), 0.0) as avg_rating,
              COALESCE((SELECT COUNT(*) FROM worker_ratings WHERE worker_id = w.id), 0) as rating_count,
              COALESCE((SELECT COUNT(*) > 0 FROM worker_cv WHERE worker_id = w.id), 0) as has_cv
       FROM workers w
       WHERE w.skill_type = ? AND w.location = ?
         AND w.id NOT IN (
           SELECT worker_id FROM job_rejections WHERE job_id = ?
           UNION
           SELECT worker_id FROM job_interests WHERE job_id = ? AND status = 'rejected'
         )
       ORDER BY (CASE WHEN w.status = 'HIRED' OR w.current_active_job_id IS NOT NULL THEN 1 ELSE 0 END), w.id DESC`,
      [job.skill_needed, job.location, job.id, job.id]
    );

    // Nearby citywide workers with same skill (excluding workers rejected for this job)
    const nearbyWorkers = await db.allAsync(
      `SELECT w.*, 
              (CASE WHEN w.status = 'HIRED' OR w.current_active_job_id IS NOT NULL THEN 1 ELSE 0 END) as is_hired_by_other,
              w.current_location_zone as active_zone,
              COALESCE((SELECT ROUND(AVG(rating), 1) FROM worker_ratings WHERE worker_id = w.id), 0.0) as avg_rating,
              COALESCE((SELECT COUNT(*) FROM worker_ratings WHERE worker_id = w.id), 0) as rating_count,
              COALESCE((SELECT COUNT(*) > 0 FROM worker_cv WHERE worker_id = w.id), 0) as has_cv
       FROM workers w
       WHERE w.skill_type = ? AND w.location != ?
         AND w.id NOT IN (
           SELECT worker_id FROM job_rejections WHERE job_id = ?
           UNION
           SELECT worker_id FROM job_interests WHERE job_id = ? AND status = 'rejected'
         )
       ORDER BY (CASE WHEN w.status = 'HIRED' OR w.current_active_job_id IS NOT NULL THEN 1 ELSE 0 END), w.id DESC LIMIT 5`,
      [job.skill_needed, job.location, job.id, job.id]
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

// 5. Worker Registration (enforces uniqueness; returns 409 Conflict on duplicate)
app.post('/api/workers/register', async (req, res) => {
  try {
    const { name, phone_number, skill_type, location, available } = req.body;
    const phone = cleanPhone(phone_number);
    const isAvailable = available !== undefined ? (available ? 1 : 0) : 1;

    if (!name || !phone || !skill_type || !location) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        message: 'Please provide all required worker fields (name, phone, skill, location)'
      });
    }

    // Step 1: Pre-Registration Validation — check if phone number already registered as worker
    const existing = await checkExistingUser(phone, 'worker');
    if (existing.exists) {
      return res.status(409).json({
        success: false,
        error: 'Conflict',
        message: 'An account with this phone number already exists. Please log in instead.',
        role: 'worker'
      });
    }

    // Insert locally for offline & fallback sync
    try {
      await db.runAsync(
        `INSERT INTO workers (name, phone_number, skill_type, location, available) VALUES (?, ?, ?, ?, ?)`,
        [name.trim(), phone, skill_type, location, isAvailable]
      );
    } catch (_) {}

    // Step 2: Insert new worker record in Supabase
    let worker = null;
    if (supabase) {
      const { data: sbWorker, error } = await supabase
        .from('workers')
        .insert([
          {
            name: name.trim(),
            phone_number: phone,
            skill_type,
            location,
            available: isAvailable === 1
          }
        ])
        .select()
        .single();

      if (error) {
        if (error.code === '23505' || (error.message && error.message.toLowerCase().includes('duplicate'))) {
          return res.status(409).json({
            success: false,
            error: 'Conflict',
            message: 'An account with this phone number already exists. Please log in instead.',
            role: 'worker'
          });
        }
        console.warn('Supabase insert note:', error.message);
      }
      worker = sbWorker;
    }

    if (!worker) {
      worker = await db.getAsync('SELECT * FROM workers WHERE phone_number = ?', [phone]);
    }

    res.status(200).json({
      success: true,
      status: 'ok',
      message: 'Worker profile successfully registered.',
      worker
    });
  } catch (err) {
    console.error('Error registering worker:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to register worker'
    });
  }
});

// 5a. Employer / Hirer Registration (enforces uniqueness; returns 409 Conflict on duplicate)
app.post(['/api/employers/register', '/api/hirers/register'], async (req, res) => {
  try {
    const { name, phone_number, company_name, location } = req.body;
    const phone = cleanPhone(phone_number);

    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        message: 'Please provide your name and phone number'
      });
    }

    // Pre-Registration Validation
    const existing = await checkExistingUser(phone, 'hirer');
    if (existing.exists) {
      return res.status(409).json({
        success: false,
        error: 'Conflict',
        message: 'An account with this phone number already exists. Please log in instead.',
        role: 'hirer'
      });
    }

    // Try inserting into employers table
    const { data: employer, error } = await supabase
      .from('employers')
      .insert([
        {
          name: name.trim(),
          phone_number: phone,
          company_name: company_name || null,
          location: location || null
        }
      ])
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === '23505' || (error.message && error.message.toLowerCase().includes('duplicate'))) {
        return res.status(409).json({
          success: false,
          error: 'Conflict',
          message: 'An account with this phone number already exists. Please log in instead.',
          role: 'hirer'
        });
      }
      console.warn('Notice: employers table insert skipped:', error.message);
    }

    res.status(200).json({
      success: true,
      status: 'ok',
      message: 'Hirer profile registered successfully.',
      employer: employer || { name, phone_number: phone }
    });
  } catch (err) {
    console.error('Error registering employer:', err);
    res.status(500).json({ success: false, error: err.message });
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

    // Matched open jobs in worker's area (excluding jobs already applied to or rejected from)
    const matchedJobs = await db.allAsync(
      `SELECT * FROM jobs 
       WHERE skill_needed = ? AND location = ? AND status = 'open' 
         AND id NOT IN (
           SELECT job_id FROM job_rejections WHERE worker_id = ?
           UNION
           SELECT job_id FROM job_interests WHERE worker_id = ?
         )
       ORDER BY id DESC`,
      [worker.skill_type, worker.location, worker.id, worker.id]
    );

    // Other open jobs in that skill citywide (excluding jobs already applied to or rejected from)
    const otherSkillJobs = await db.allAsync(
      `SELECT * FROM jobs 
       WHERE skill_needed = ? AND location != ? AND status = 'open' 
         AND id NOT IN (
           SELECT job_id FROM job_rejections WHERE worker_id = ?
           UNION
           SELECT job_id FROM job_interests WHERE worker_id = ?
         )
       ORDER BY id DESC LIMIT 6`,
      [worker.skill_type, worker.location, worker.id, worker.id]
    );

    // Jobs the worker has applied for, been confirmed for, or rejected from (retains transparent history)
    const appliedJobs = await db.allAsync(
      `SELECT j.*, ji.status as interest_status, ji.reason, ji.rejected_at, ji.created_at as interest_date
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
      matchedJobs: matchedJobs || [],
      otherSkillJobs: otherSkillJobs || [],
      appliedJobs: appliedJobs || []
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

    const worker = await db.getAsync('SELECT * FROM workers WHERE id = ?', [worker_id]);
    const job = await db.getAsync('SELECT * FROM jobs WHERE id = ?', [job_id]);

    if (!worker || !job) {
      return res.status(404).json({ error: 'Worker or Job not found' });
    }

    const conflict = await checkWorkerActiveConflict(worker_id, job_id);
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

// 8. Worker Availability Toggle
app.post('/api/workers/toggle-availability', async (req, res) => {
  try {
    const { phone, available } = req.body;
    const cleanP = cleanPhone(phone);
    const isAvail = available ? 1 : 0;

    await db.runAsync('UPDATE workers SET available = ? WHERE phone_number = ?', [isAvail, cleanP]);
    const worker = await db.getAsync('SELECT * FROM workers WHERE phone_number = ?', [cleanP]);

    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    res.json({ status: 'ok', worker });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Employer Dashboard Jobs & Interested Applicants (excludes workers rejected for that specific job)
app.get('/api/employers/:phone/jobs', async (req, res) => {
  try {
    const phone = cleanPhone(req.params.phone);
    const jobs = await db.allAsync(
      'SELECT * FROM jobs WHERE employer_phone = ? ORDER BY id DESC',
      [phone]
    );

    for (const job of jobs) {
      const interestedWorkers = await db.allAsync(
        `SELECT w.id as worker_id, w.name, w.phone_number, w.skill_type, w.location, w.available, ji.status, ji.reason, ji.created_at,
                COALESCE((SELECT ROUND(AVG(rating), 1) FROM worker_ratings WHERE worker_id = w.id), 0.0) as avg_rating,
                COALESCE((SELECT COUNT(*) FROM worker_ratings WHERE worker_id = w.id), 0) as rating_count,
                COALESCE((SELECT COUNT(*) > 0 FROM worker_cv WHERE worker_id = w.id), 0) as has_cv
         FROM job_interests ji
         JOIN workers w ON ji.worker_id = w.id
         WHERE ji.job_id = ? AND ji.status != 'rejected'
         ORDER BY (CASE WHEN ji.status = 'confirmed' THEN 0 ELSE 1 END), ji.id DESC`,
        [job.id]
      );
      job.interestedWorkers = interestedWorkers;
    }

    res.json({ status: 'ok', jobs: jobs || [] });
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
      `UPDATE job_interests SET status = 'confirmed' WHERE job_id = ? AND worker_id = ?`,
      [job_id, worker_id]
    );
    await db.runAsync("UPDATE jobs SET status = 'filled' WHERE id = ?", [job_id]);
    await db.runAsync(
      `UPDATE workers SET available = 0, status = 'HIRED', current_active_job_id = ?, current_location_zone = ? WHERE id = ?`,
      [job_id, job.location, worker_id]
    );

    res.json({ status: 'ok', message: 'Worker confirmed and assigned to active job' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10b. Employer Reject Worker for a Specific Job
app.post(['/api/employers/reject-worker', '/api/jobs/:jobId/workers/:workerId/reject', '/api/jobs/:jobId/reject-worker'], async (req, res) => {
  try {
    const jobId = req.params.jobId || req.body.job_id;
    const workerId = req.params.workerId || req.body.worker_id;
    const reason = req.body.reason || null;
    let employerPhone = req.body.employer_phone ? cleanPhone(req.body.employer_phone) : null;

    if (!jobId || !workerId) {
      return res.status(400).json({ success: false, error: 'job_id and worker_id are required' });
    }

    const job = await db.getAsync('SELECT * FROM jobs WHERE id = ?', [jobId]);
    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    if (!employerPhone) {
      employerPhone = job.employer_phone;
    }

    // 1. Record rejection in job_rejections table (indexed by job_id & worker_id)
    await db.runAsync(
      `INSERT INTO job_rejections (hirer_phone, job_id, worker_id, reason, rejected_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(job_id, worker_id) DO UPDATE SET reason = excluded.reason, rejected_at = CURRENT_TIMESTAMP`,
      [employerPhone, jobId, workerId, reason]
    );

    // 2. Set status to 'rejected' in job_interests
    await db.runAsync(
      `INSERT INTO job_interests (job_id, worker_id, status, reason, rejected_at)
       VALUES (?, ?, 'rejected', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(job_id, worker_id) DO UPDATE SET status = 'rejected', reason = excluded.reason, rejected_at = CURRENT_TIMESTAMP`,
      [jobId, workerId, reason]
    );

    // 3. Sync to Supabase if configured
    if (supabase) {
      try {
        await supabase
          .from('job_rejections')
          .upsert([
            {
              hirer_phone: employerPhone,
              job_id: Number(jobId),
              worker_id: Number(workerId),
              reason: reason,
              rejected_at: new Date().toISOString()
            }
          ], { onConflict: 'job_id,worker_id' });

        await supabase
          .from('job_interests')
          .upsert([
            {
              job_id: Number(jobId),
              worker_id: Number(workerId),
              status: 'rejected',
              reason: reason,
              rejected_at: new Date().toISOString()
            }
          ], { onConflict: 'job_id,worker_id' });
      } catch (sbErr) {
        console.warn('Supabase rejection sync note:', sbErr.message);
      }
    }

    res.status(200).json({
      success: true,
      status: 'ok',
      message: 'Worker rejected for this specific job successfully.',
      job_id: Number(jobId),
      worker_id: Number(workerId)
    });
  } catch (err) {
    console.error('Error rejecting worker:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10c. Undo Worker Rejection (Optional)
app.post(['/api/employers/unreject-worker', '/api/jobs/:jobId/workers/:workerId/unreject'], async (req, res) => {
  try {
    const jobId = req.params.jobId || req.body.job_id;
    const workerId = req.params.workerId || req.body.worker_id;

    if (!jobId || !workerId) {
      return res.status(400).json({ success: false, error: 'job_id and worker_id are required' });
    }

    await db.runAsync('DELETE FROM job_rejections WHERE job_id = ? AND worker_id = ?', [jobId, workerId]);
    await db.runAsync("UPDATE job_interests SET status = 'interested', reason = NULL WHERE job_id = ? AND worker_id = ? AND status = 'rejected'", [jobId, workerId]);

    if (supabase) {
      try {
        await supabase.from('job_rejections').delete().match({ job_id: jobId, worker_id: workerId });
      } catch (_) {}
    }

    res.status(200).json({ success: true, status: 'ok', message: 'Rejection removed successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11. Complete Job (releases labourer back to available pool)
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

// 12. Cancel Job (releases labourer back to available pool)
app.post('/api/jobs/:id/cancel', async (req, res) => {
  try {
    const jobId = req.params.id;
    const job = await db.getAsync('SELECT * FROM jobs WHERE id = ?', [jobId]);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    await db.runAsync("UPDATE jobs SET status = 'cancelled' WHERE id = ?", [jobId]);
    await db.runAsync(
      `UPDATE workers SET available = 1, status = 'AVAILABLE', current_active_job_id = NULL, current_location_zone = NULL WHERE current_active_job_id = ?`,
      [jobId]
    );

    res.json({ status: 'ok', message: 'Job cancelled and labourer is now available' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. Get Worker CV (Structured form data)
// 13. Get Worker CV (Structured Form Data)
app.get(['/api/workers/:id/cv', '/api/workers/cv/:id'], async (req, res) => {
  try {
    const rawId = req.params.id;
    let worker = null;
    if (/^\d{10}$/.test(rawId)) {
      worker = await db.getAsync(
        `SELECT w.*,
                COALESCE((SELECT ROUND(AVG(rating), 1) FROM worker_ratings WHERE worker_id = w.id), 0.0) as avg_rating,
                COALESCE((SELECT COUNT(*) FROM worker_ratings WHERE worker_id = w.id), 0) as rating_count
         FROM workers w WHERE w.phone_number = ?`,
        [cleanPhone(rawId)]
      );
    } else {
      const workerId = parseInt(rawId, 10);
      if (!isNaN(workerId) && workerId > 0) {
        worker = await db.getAsync(
          `SELECT w.*,
                  COALESCE((SELECT ROUND(AVG(rating), 1) FROM worker_ratings WHERE worker_id = w.id), 0.0) as avg_rating,
                  COALESCE((SELECT COUNT(*) FROM worker_ratings WHERE worker_id = w.id), 0) as rating_count
           FROM workers w WHERE w.id = ?`,
          [workerId]
        );
      }
    }

    if (!worker && supabase) {
      try {
        let query = supabase.from('workers').select('*');
        if (/^\d{10}$/.test(rawId)) {
          query = query.eq('phone_number', cleanPhone(rawId));
        } else {
          query = query.eq('id', parseInt(rawId, 10));
        }
        const { data: sbW } = await query.maybeSingle();
        if (sbW) {
          await db.runAsync(
            'INSERT OR IGNORE INTO workers (id, name, phone_number, skill_type, location, available) VALUES (?, ?, ?, ?, ?, ?)',
            [sbW.id, sbW.name, sbW.phone_number, sbW.skill_type, sbW.location, sbW.available ? 1 : 0]
          );
          worker = sbW;
        }
      } catch (_) {}
    }

    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    const cv = await db.getAsync('SELECT * FROM worker_cv WHERE worker_id = ?', [worker.id]);
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
app.post(['/api/workers/:id/cv', '/api/workers/cv'], async (req, res) => {
  try {
    const rawId = req.params.id || req.body.worker_id;
    const phone = req.body.phone_number ? cleanPhone(req.body.phone_number) : null;

    let worker = null;
    if (rawId && rawId !== '0' && rawId !== 0) {
      if (/^\d{10}$/.test(String(rawId))) {
        worker = await db.getAsync('SELECT id, name, phone_number FROM workers WHERE phone_number = ?', [cleanPhone(String(rawId))]);
      } else {
        const workerId = parseInt(rawId, 10);
        if (!isNaN(workerId) && workerId > 0) {
          worker = await db.getAsync('SELECT id, name, phone_number FROM workers WHERE id = ?', [workerId]);
        }
      }
    }

    if (!worker && phone) {
      worker = await db.getAsync('SELECT id, name, phone_number FROM workers WHERE phone_number = ?', [phone]);
    }

    if (!worker && supabase && (phone || rawId)) {
      try {
        let query = supabase.from('workers').select('*');
        if (phone) {
          query = query.eq('phone_number', phone);
        } else if (rawId) {
          query = query.eq('id', parseInt(rawId, 10));
        }
        const { data: sbW } = await query.maybeSingle();
        if (sbW) {
          await db.runAsync(
            'INSERT OR IGNORE INTO workers (id, name, phone_number, skill_type, location, available) VALUES (?, ?, ?, ?, ?, ?)',
            [sbW.id, sbW.name, sbW.phone_number, sbW.skill_type, sbW.location, sbW.available ? 1 : 0]
          );
          worker = sbW;
        }
      } catch (_) {}
    }

    if (!worker) {
      if (phone && req.body.full_name) {
        const ins = await db.runAsync(
          'INSERT INTO workers (name, phone_number, skill_type, location, available) VALUES (?, ?, ?, ?, 1)',
          [req.body.full_name.trim(), phone, req.body.skills ? (Array.isArray(req.body.skills) ? req.body.skills[0] : req.body.skills) : 'General', req.body.work_location || 'Citywide']
        );
        worker = await db.getAsync('SELECT id, name, phone_number FROM workers WHERE id = ?', [ins.lastID]);
      } else {
        return res.status(404).json({ error: 'Worker not found. Please register as a worker first.' });
      }
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
        worker.id,
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

    if (supabase) {
      try {
        await supabase
          .from('worker_cv')
          .upsert([
            {
              worker_id: worker.id,
              full_name: full_name.trim(),
              dob_or_age: dob_or_age || '',
              phone_number: cleanPhone(phone_number) || worker.phone_number,
              skills: skillsJson,
              years_of_experience: yoe,
              previous_work: prevWorkJson,
              work_location: work_location || '',
              daily_wage_expectation: daily_wage_expectation || '',
              availability_type: availability_type || 'Full-time',
              languages: languages || '',
              about_me: about_me || '',
              updated_at: new Date().toISOString()
            }
          ], { onConflict: 'worker_id' });
      } catch (sbErr) {
        console.warn('Supabase worker_cv sync note:', sbErr.message);
      }
    }

    res.json({
      status: 'ok',
      success: true,
      message: 'Worker CV saved successfully',
      worker_id: worker.id
    });
  } catch (err) {
    console.error('Error saving CV:', err);
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
    const totalWorkers = (await db.getAsync('SELECT COUNT(*) as count FROM workers')).count;
    const availableWorkers = (await db.getAsync('SELECT COUNT(*) as count FROM workers WHERE available = 1')).count;
    const openJobs = (await db.getAsync("SELECT COUNT(*) as count FROM jobs WHERE status = 'open'")).count;
    const totalInterests = (await db.getAsync('SELECT COUNT(*) as count FROM job_interests')).count;
    const recentJobs = await db.allAsync("SELECT * FROM jobs WHERE status = 'open' ORDER BY id DESC LIMIT 6");

    const stats = {
      totalWorkers: totalWorkers || 0,
      availableWorkers: availableWorkers || 0,
      openJobs: openJobs || 0,
      totalInterests: totalInterests || 0
    };

    res.render('index', { stats, recentJobs: recentJobs || [] });
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

    // Pre-Registration Validation: Check if worker already registered
    const existing = await checkExistingUser(phone, 'worker');
    if (existing.exists) {
      return res.status(409).render('worker-register', {
        errorMessage: 'An account with this phone number already exists. Please log in instead.'
      });
    }

    try {
      await db.runAsync(
        `INSERT INTO workers (name, phone_number, skill_type, location, available) VALUES (?, ?, ?, ?, ?)`,
        [name.trim(), phone, skill_type, location, isAvailable]
      );
    } catch (_) {}

    if (supabase) {
      const { error } = await supabase
        .from('workers')
        .insert([
          {
            name: name.trim(),
            phone_number: phone,
            skill_type,
            location,
            available: isAvailable === 1
          }
        ]);

      if (error) {
        if (error.code === '23505' || (error.message && error.message.toLowerCase().includes('duplicate'))) {
          return res.status(409).render('worker-register', {
            errorMessage: 'An account with this phone number already exists. Please log in instead.'
          });
        }
        console.warn('Supabase insert note:', error.message);
      }
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
    let errorMessage = req.query.error || null;

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
        successMessage,
        errorMessage
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
        successMessage,
        errorMessage
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
      matchedJobs: matchedJobs || [],
      otherSkillJobs: otherSkillJobs || [],
      appliedJobs,
      interestedJobIds,
      successMessage,
      errorMessage
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

    // Direct matches with is_hired_by_other indicator and ratings (excluding workers rejected for this job)
    const matchedWorkers = await db.allAsync(
      `SELECT w.*, 
              (CASE WHEN w.status = 'HIRED' OR w.current_active_job_id IS NOT NULL THEN 1 ELSE 0 END) as is_hired_by_other,
              w.current_location_zone as active_zone,
              COALESCE((SELECT ROUND(AVG(rating), 1) FROM worker_ratings WHERE worker_id = w.id), 0.0) as avg_rating,
              COALESCE((SELECT COUNT(*) FROM worker_ratings WHERE worker_id = w.id), 0) as rating_count,
              COALESCE((SELECT COUNT(*) > 0 FROM worker_cv WHERE worker_id = w.id), 0) as has_cv
       FROM workers w 
       WHERE skill_type = ? AND location = ? 
         AND id NOT IN (
           SELECT worker_id FROM job_rejections WHERE job_id = ?
           UNION
           SELECT worker_id FROM job_interests WHERE job_id = ? AND status = 'rejected'
         )
       ORDER BY (CASE WHEN w.status = 'HIRED' OR w.current_active_job_id IS NOT NULL THEN 1 ELSE 0 END), id DESC`,
      [job.skill_needed, job.location, job.id, job.id]
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
         AND id NOT IN (
           SELECT worker_id FROM job_rejections WHERE job_id = ?
           UNION
           SELECT worker_id FROM job_interests WHERE job_id = ? AND status = 'rejected'
         )
       ORDER BY (CASE WHEN w.status = 'HIRED' OR w.current_active_job_id IS NOT NULL THEN 1 ELSE 0 END), id DESC LIMIT 4`,
      [job.skill_needed, job.location, job.id, job.id]
    );

    res.render('employer-post-success', {
      job,
      matchedWorkers,
      nearbyWorkers
    });
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
    let errorMessage = req.query.error || null;

    if (req.query.confirmed) {
      successMessage = 'Worker confirmed successfully! The job has been marked filled.';
    } else if (req.query.rejected) {
      successMessage = 'Worker passed/rejected for this job. They will no longer appear in this job listing.';
    } else if (req.query.completed) {
      successMessage = 'Job marked completed and labourer released back to available pool.';
    } else if (req.query.cancelled) {
      successMessage = 'Job cancelled and labourer released back to available pool.';
    }

    if (!phone) {
      return res.render('employer-dashboard', {
        jobs: [],
        phone: '',
        successMessage,
        errorMessage
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
         WHERE ji.job_id = ? AND ji.status != 'rejected'
         ORDER BY (CASE WHEN ji.status = 'confirmed' THEN 0 ELSE 1 END), ji.id DESC`,
        [job.id]
      );
      job.interestedWorkers = interestedWorkers;
    }

    res.render('employer-dashboard', {
      jobs: jobs || [],
      phone,
      successMessage,
      errorMessage
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
      `UPDATE job_interests SET status = 'confirmed' WHERE job_id = ? AND worker_id = ?`,
      [job_id, worker_id]
    );
    await db.runAsync("UPDATE jobs SET status = 'filled' WHERE id = ?", [job_id]);
    await db.runAsync(
      `UPDATE workers SET available = 0, status = 'HIRED', current_active_job_id = ?, current_location_zone = ? WHERE id = ?`,
      [job_id, job.location, worker_id]
    );

    res.redirect(`/employer/dashboard?phone=${encodeURIComponent(employer_phone)}&confirmed=1`);
  } catch (err) {
    console.error('Error confirming worker:', err);
    res.redirect(`/employer/dashboard?phone=${encodeURIComponent(req.body.employer_phone || '')}`);
  }
});

// Reject / Pass Worker for a Specific Job (Web Form)
app.post('/employer/reject-worker', async (req, res) => {
  try {
    const { job_id, worker_id, employer_phone, reason, redirect_to } = req.body;
    const phone = cleanPhone(employer_phone);
    if (!job_id || !worker_id) {
      return res.redirect(`/employer/dashboard?phone=${encodeURIComponent(phone)}&error=Missing+parameters`);
    }

    await db.runAsync(
      `INSERT INTO job_rejections (hirer_phone, job_id, worker_id, reason, rejected_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(job_id, worker_id) DO UPDATE SET reason = excluded.reason, rejected_at = CURRENT_TIMESTAMP`,
      [phone || null, job_id, worker_id, reason || null]
    );

    await db.runAsync(
      `INSERT INTO job_interests (job_id, worker_id, status, reason, rejected_at)
       VALUES (?, ?, 'rejected', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(job_id, worker_id) DO UPDATE SET status = 'rejected', reason = excluded.reason, rejected_at = CURRENT_TIMESTAMP`,
      [job_id, worker_id, reason || null]
    );

    if (redirect_to === 'post-success') {
      res.redirect(`/employer/post-success/${job_id}?rejected=1`);
    } else {
      res.redirect(`/employer/dashboard?phone=${encodeURIComponent(phone)}&rejected=1`);
    }
  } catch (err) {
    console.error('Error rejecting worker:', err);
    res.redirect('/employer/dashboard');
  }
});

// Web routes for complete and cancel job
app.post('/employer/jobs/:id/complete', async (req, res) => {
  try {
    const jobId = req.params.id;
    const employerPhone = req.body.employer_phone || '';

    await db.runAsync("UPDATE jobs SET status = 'completed' WHERE id = ?", [jobId]);
    await db.runAsync(
      `UPDATE workers SET available = 1, status = 'AVAILABLE', current_active_job_id = NULL, current_location_zone = NULL WHERE current_active_job_id = ?`,
      [jobId]
    );

    res.redirect(`/employer/dashboard?phone=${encodeURIComponent(employerPhone)}&completed=1`);
  } catch (err) {
    console.error('Error completing job:', err);
    res.redirect('/employer/dashboard');
  }
});

app.post('/employer/jobs/:id/cancel', async (req, res) => {
  try {
    const jobId = req.params.id;
    const employerPhone = req.body.employer_phone || '';

    await db.runAsync("UPDATE jobs SET status = 'cancelled' WHERE id = ?", [jobId]);
    await db.runAsync(
      `UPDATE workers SET available = 1, status = 'AVAILABLE', current_active_job_id = NULL, current_location_zone = NULL WHERE current_active_job_id = ?`,
      [jobId]
    );

    res.redirect(`/employer/dashboard?phone=${encodeURIComponent(employerPhone)}&cancelled=1`);
  } catch (err) {
    console.error('Error cancelling job:', err);
    res.redirect('/employer/dashboard');
  }
});

// Public Job Board (Digital Labor Chowk)
app.get(['/jobs', '/chowk-feed'], async (req, res) => {
  try {
    const { tab = 'jobs', skill, location, minWage, maxWage, availableOnly } = req.query;

    let jobsSql = "SELECT * FROM jobs WHERE status = 'open'";
    const jobsParams = [];
    if (skill) {
      jobsSql += " AND skill_needed = ?";
      jobsParams.push(skill);
    }
    if (location) {
      jobsSql += " AND location = ?";
      jobsParams.push(location);
    }
    jobsSql += " ORDER BY id DESC";

    const rawJobs = await db.allAsync(jobsSql, jobsParams);
    const min = minWage ? parseInt(minWage, 10) : null;
    const max = maxWage ? parseInt(maxWage, 10) : null;

    const jobs = (rawJobs || [])
      .filter(j => {
        const wage = parseWage(j.wage_offered);
        if (min !== null && wage < min) return false;
        if (max !== null && wage > max) return false;
        return true;
      })
      .map(j => ({
        id: j.id,
        employer_name: maskName(j.employer_name),
        skill_needed: j.skill_needed,
        location: j.location,
        wage_offered: j.wage_offered,
        date_needed: j.date_needed,
        status: j.status,
        created_at: j.created_at || null
      }));

    let workersSql = "SELECT * FROM workers WHERE 1=1";
    const workersParams = [];
    if (availableOnly !== 'false') {
      workersSql += " AND available = 1";
    }
    if (skill) {
      workersSql += " AND skill_type = ?";
      workersParams.push(skill);
    }
    if (location) {
      workersSql += " AND location = ?";
      workersParams.push(location);
    }
    workersSql += " ORDER BY available DESC, id DESC LIMIT 50";

    const rawWorkers = await db.allAsync(workersSql, workersParams);
    const workers = (rawWorkers || []).map(w => ({
      id: w.id,
      display_name: maskName(w.name),
      skill_type: w.skill_type,
      location: w.location,
      available: w.available === 1 || w.available === true,
      registered_at: w.registered_at || null
    }));

    res.render('jobs-board', {
      jobs,
      workers,
      activeTab: tab,
      selectedSkill: skill || '',
      selectedLocation: location || '',
      minWage: minWage || '',
      maxWage: maxWage || '',
      availableOnly: availableOnly !== 'false'
    });
  } catch (err) {
    console.error('Error fetching public jobs/workers:', err);
    res.status(500).send('Internal Server Error');
  }
});

db.initSchema()
  .then(() => ivrService.seedDefaultCategoriesIfEmpty())
  .catch((err) => console.warn('IVR category seed skipped:', err.message));
/**
 * Inbound Voice Webhook from Twilio (Media Stream Bridge to ElevenLabs)
 * When a call is received on the toll-free number, Twilio hits this endpoint.
 */
app.post('/api/voice/incoming', async (req, res) => {
  try {
    if (!voiceAgent.validateTwilioSignature(req)) {
      console.warn('⚠️ [Voice Webhook] Invalid Twilio signature detected.');
      return res.status(403).send('Invalid Twilio signature');
    }

    const twiml = await voiceAgent.handleIncomingCall(req);
    res.setHeader('Content-Type', 'text/xml');
    res.send(twiml);
  } catch (err) {
    console.error('❌ [Voice Webhook Error]', err);
    res.setHeader('Content-Type', 'text/xml');
    res.send(voiceAgent.generateFallbackTwiml({ reason: err.message, transferToHuman: true }));
  }
});

/**
 * Twilio Call Status Callback (records call duration, completion, disconnect)
 */
app.post('/api/voice/status', async (req, res) => {
  try {
    await voiceAgent.handleCallStatus(req);
    res.status(200).send('OK');
  } catch (err) {
    console.error('⚠️ [Voice Status Error]', err);
    res.status(200).send('OK');
  }
});

/**
 * Twilio Escalation Endpoint (transfers caller directly to human coordinator)
 */
app.post('/api/voice/escalate', (req, res) => {
  try {
    const twiml = voiceAgent.handleEscalateCall();
    res.setHeader('Content-Type', 'text/xml');
    res.send(twiml);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/**
 * ElevenLabs Agent Tool Dispatcher Webhook
 * ElevenLabs Conversational AI invokes backend tools via HTTP POST
 */
app.post('/api/voice/tools/:toolName', async (req, res) => {
  try {
    const { toolName } = req.params;
    const webhookSecret = process.env.ELEVENLABS_WEBHOOK_SECRET;

    // Verify webhook secret if configured
    if (webhookSecret) {
      const headerSecret = req.headers['x-webhook-secret'] || req.headers['authorization'] || '';
      const cleanHeaderSecret = headerSecret.replace(/^Bearer\s+/i, '');
      if (cleanHeaderSecret !== webhookSecret) {
        console.warn(`⚠️ [Voice Tools] Unauthorized tool invocation attempt for "${toolName}"`);
        return res.status(401).json({ error: 'Unauthorized webhook request' });
      }
    }

    const result = await voiceTools.executeTool(toolName, req.body || {});
    res.json(result);
  } catch (err) {
    console.error(`❌ [Voice Tools Route Error]`, err);
    res.status(500).json({ error: 'Internal tool execution error' });
  }
});

/**
 * GET /api/voice/signed-url
 * Returns an authenticated ElevenLabs ConvAI WebSocket URL for the mobile app.
 * The API key stays on the server; the client just gets a short-lived signed URL.
 */
app.get('/api/voice/signed-url', async (req, res) => {
  try {
    const agentId = process.env.ELEVENLABS_AGENT_ID || 'agent_6901m2bhp41ze2fvesjbry7ngh4m';
    const apiKey  = process.env.ELEVENLABS_API_KEY;

    if (!apiKey) {
      return res.status(503).json({ error: 'ElevenLabs API key not configured on server' });
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${encodeURIComponent(agentId)}`,
      { headers: { 'xi-api-key': apiKey } }
    );

    if (!response.ok) {
      const text = await response.text();
      console.error('[SignedURL] ElevenLabs error:', response.status, text);
      return res.status(response.status).json({ error: `ElevenLabs: ${text}` });
    }

    const { signed_url } = await response.json();
    console.log('[SignedURL] Issued signed URL for agent', agentId);
    res.json({ signed_url, agent_id: agentId });
  } catch (err) {
    console.error('[SignedURL] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/voice/config
 * Returns ElevenLabs API key and agent ID for mobile WebSocket auth.
 * The app uses this key to authenticate the WebSocket connection directly.
 */
app.get('/api/voice/config', (req, res) => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID || 'agent_6901m2bhp41ze2fvesjbry7ngh4m';
  if (!apiKey) {
    return res.status(503).json({ error: 'ElevenLabs not configured' });
  }
  res.json({ api_key: apiKey, agent_id: agentId });
});

app.all(['/api/lookup-caller', '/api/lookup_caller'], async (req, res) => {
  const params = req.method === 'POST' ? { ...req.query, ...req.body } : req.query;
  const result = await voiceTools.executeTool('lookup_caller', params);
  res.json(result);
});

app.all(['/api/toggle-availability', '/api/toggle_worker_availability'], async (req, res) => {
  const params = req.method === 'POST' ? { ...req.query, ...req.body } : req.query;
  const result = await voiceTools.executeTool('toggle_worker_availability', params);
  res.json(result);
});

// These are the exact URLs you paste into ElevenLabs agent Tools config.
// ElevenLabs calls these via HTTP POST with the parameter names below.
// ==========================================================================

/**
 * ElevenLabs Tool 1: register_worker
 *
 * Configure in ElevenLabs Agent → Tools → Add Tool:
 *   Method: POST
 *   URL:    {ngrok_or_deployed_url}/api/register-worker
 *   Parameters:
 *     - name         (string, required)  — worker's full name
 *     - phone_number (string, required)  — 10-digit mobile number
 *     - skill_type   (string, required)  — e.g. "Carpenter", "Plumber", "Mason"
 *     - location     (string, required)  — area/city, e.g. "Indiranagar Bangalore"
 *     - available    (boolean, optional) — true = available for work (default: true)
 */
app.post('/api/register-worker', async (req, res) => {
  try {
    const { name, phone_number, skill_type, location, available } = req.body;
    const phone = cleanPhone(phone_number);
    const isAvailable = available !== undefined ? (available ? 1 : 0) : 1;

    // Validate required fields
    if (!name || !phone || !skill_type || !location) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'Please provide name, phone_number, skill_type, and location to register the worker.'
      });
    }

    // Check for duplicate registration
    const existing = await checkExistingUser(phone, 'worker');
    if (existing.exists) {
      return res.status(409).json({
        success: false,
        already_registered: true,
        message: `Good news! ${name} is already registered on LabourLink with this phone number. No need to register again.`
      });
    }

    // Insert into SQLite (local + offline fallback)
    try {
      await db.runAsync(
        `INSERT INTO workers (name, phone_number, skill_type, location, available) VALUES (?, ?, ?, ?, ?)`,
        [name.trim(), phone, skill_type.trim(), location.trim(), isAvailable]
      );
    } catch (_) {}

    // Sync to Supabase
    let worker = null;
    if (supabase) {
      const { data: sbWorker, error } = await supabase
        .from('workers')
        .insert([{ name: name.trim(), phone_number: phone, skill_type: skill_type.trim(), location: location.trim(), available: isAvailable === 1 }])
        .select()
        .single();

      if (error && (error.code === '23505' || (error.message && error.message.toLowerCase().includes('duplicate')))) {
        return res.status(409).json({
          success: false,
          already_registered: true,
          message: `This phone number is already registered on LabourLink. No need to register again.`
        });
      }
      worker = sbWorker;
    }

    if (!worker) {
      worker = await db.getAsync('SELECT * FROM workers WHERE phone_number = ?', [phone]);
    }

    // Count open jobs in the area matching this skill
    const matchedJobs = await db.getAsync(
      `SELECT COUNT(*) as count FROM jobs WHERE LOWER(skill_needed) = LOWER(?) AND LOWER(location) = LOWER(?) AND status = 'open'`,
      [skill_type.trim(), location.trim()]
    );
    const jobCount = (matchedJobs && matchedJobs.count) ? matchedJobs.count : 0;

    console.log(`✅ [register-worker] Registered: ${name} | ${skill_type} | ${location} | Matched jobs: ${jobCount}`);

    res.status(201).json({
      success: true,
      message: `Successfully registered ${name} as a ${skill_type} in ${location}. ${jobCount > 0 ? `Great news — there are currently ${jobCount} open job(s) matching their skill in that area!` : 'We will notify them as matching jobs are posted.'}`,
      worker_id: worker ? worker.id : null,
      worker_name: name,
      skill_type,
      location,
      available: isAvailable === 1,
      matched_open_jobs: jobCount
    });
  } catch (err) {
    console.error('❌ [register-worker] Error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Registration failed due to a server error.',
      message: 'Sorry, we could not complete the registration right now. Please try again in a moment.'
    });
  }
});

/**
 * ElevenLabs Tool 2: post_job
 *
 * Configure in ElevenLabs Agent → Tools → Add Tool:
 *   Method: POST
 *   URL:    {ngrok_or_deployed_url}/api/post-job
 *   Parameters:
 *     - employer_name  (string, required)  — name of the employer/contractor
 *     - employer_phone (string, required)  — employer's 10-digit mobile number
 *     - skill_needed   (string, required)  — trade required, e.g. "Electrician"
 *     - location       (string, required)  — work site area/city
 *     - wage_offered   (number, optional)  — daily wage in rupees, e.g. 800
 *     - date_needed    (string, optional)  — when work is needed, e.g. "Tomorrow", "2026-09-15"
 *
 * Returns: matched_workers_count so the agent can tell the employer how many workers are available.
 */
app.post('/api/post-job', async (req, res) => {
  try {
    const { employer_name, employer_phone, skill_needed, location, wage_offered, date_needed } = req.body;
    const phone = cleanPhone(employer_phone);

    // Validate required fields
    if (!employer_name || !phone || !skill_needed || !location) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'Please provide employer_name, employer_phone, skill_needed, and location to post the job.'
      });
    }

    // Format wage string
    const wage = wage_offered
      ? (typeof wage_offered === 'number' ? `₹${wage_offered}/day` : String(wage_offered))
      : 'Negotiable';
    const date = date_needed || 'Today';

    // Insert job into SQLite
    const result = await db.runAsync(
      `INSERT INTO jobs (employer_name, employer_phone, skill_needed, location, wage_offered, date_needed, status)
       VALUES (?, ?, ?, ?, ?, ?, 'open')`,
      [employer_name.trim(), phone, skill_needed.trim(), location.trim(), wage, date]
    );

    // Sync to Supabase
    if (supabase) {
      try {
        await supabase.from('jobs').insert([{
          employer_name: employer_name.trim(),
          employer_phone: phone,
          skill_needed: skill_needed.trim(),
          location: location.trim(),
          wage_offered: wage,
          date_needed: date,
          status: 'open'
        }]);
      } catch (_) {}
    }

    // Count matching available workers — this is what the agent reads back to the employer
    const matchResult = await db.getAsync(
      `SELECT COUNT(*) as count FROM workers
       WHERE LOWER(skill_type) = LOWER(?) AND LOWER(location) = LOWER(?) AND available = 1`,
      [skill_needed.trim(), location.trim()]
    );
    const matchedWorkersCount = (matchResult && matchResult.count) ? matchResult.count : 0;

    // Also find nearby workers (same skill, different area) as a secondary count
    const nearbyResult = await db.getAsync(
      `SELECT COUNT(*) as count FROM workers
       WHERE LOWER(skill_type) = LOWER(?) AND LOWER(location) != LOWER(?) AND available = 1`,
      [skill_needed.trim(), location.trim()]
    );
    const nearbyCount = (nearbyResult && nearbyResult.count) ? nearbyResult.count : 0;

    console.log(`✅ [post-job] Job ID ${result.lastID} | ${skill_needed} in ${location} | Wage: ${wage} | Matched workers: ${matchedWorkersCount}`);

    res.status(201).json({
      success: true,
      job_id: result.lastID,
      employer_name: employer_name.trim(),
      skill_needed: skill_needed.trim(),
      location: location.trim(),
      wage_offered: wage,
      date_needed: date,
      matched_workers_count: matchedWorkersCount,
      nearby_workers_count: nearbyCount,
      message: matchedWorkersCount > 0
        ? `Job posted successfully! We found ${matchedWorkersCount} available ${skill_needed} worker(s) in ${location} right now. They will be notified. ${nearbyCount > 0 ? `There are also ${nearbyCount} worker(s) in nearby areas if needed.` : ''}`
        : `Job posted successfully with ID ${result.lastID}. There are no ${skill_needed} workers currently available in ${location}, but we will notify you as soon as a match is found. ${nearbyCount > 0 ? `There are ${nearbyCount} worker(s) in nearby areas who may be able to travel.` : ''}`
    });
  } catch (err) {
    console.error('❌ [post-job] Error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Job posting failed due to a server error.',
      message: 'Sorry, we could not post the job right now. Please try again in a moment.'
    });
  }
});

/**
 * API: Get Voice Call History & Telephony Diagnostics (JSON)
 */
app.get('/api/voice/calls', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const calls = await db.getVoiceCalls(limit);
    const stats = await db.getVoiceCallStats();
    const ngrokPublicUrl = ngrokTunnel.getPublicUrl();
    res.json({
      status: 'ok',
      stats,
      calls,
      telephony: {
        elevenLabsConfigured: Boolean(process.env.ELEVENLABS_AGENT_ID),
        agentId: process.env.ELEVENLABS_AGENT_ID ? 'Configured (Hidden)' : 'Not Set',
        twilioConfigured: Boolean(process.env.TWILIO_ACCOUNT_SID),
        twilioNumber: process.env.TWILIO_PHONE_NUMBER || 'Not Set',
        humanTransferNumber: process.env.HUMAN_TRANSFER_NUMBER || '+919900112233',
        ngrokPublicUrl: ngrokPublicUrl || null,
        ngrokConfigured: Boolean(process.env.NGROK_AUTHTOKEN),
        webhookUrlIncoming: ngrokPublicUrl ? `${ngrokPublicUrl}/api/voice/incoming` : null,
        webhookUrlStatus: ngrokPublicUrl ? `${ngrokPublicUrl}/api/voice/status` : null
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * API: Get current ngrok public URL (for dashboard & testing scripts)
 */
app.get('/api/ngrok/url', (req, res) => {
  const url = ngrokTunnel.getPublicUrl();
  res.json({
    status: url ? 'active' : 'inactive',
    public_url: url || null,
    webhook_incoming: url ? `${url}/api/voice/incoming` : null,
    webhook_status: url ? `${url}/api/voice/status` : null,
    ngrok_configured: Boolean(process.env.NGROK_AUTHTOKEN)
  });
});

/**
 * Admin Voice Dashboard (Web UI)
 */
app.get('/admin/voice', async (req, res) => {
  try {
    const calls = await db.getVoiceCalls(50);
    const stats = await db.getVoiceCallStats();
    const ngrokPublicUrl = ngrokTunnel.getPublicUrl();

    res.render('voice-dashboard', {
      title: 'Voice AI Telephony Dashboard',
      activePage: 'voice',
      calls: calls || [],
      stats: stats || { total_calls: 0, completed_calls: 0, escalated_calls: 0, avg_duration_seconds: 0 },
      elevenLabsConfigured: Boolean(process.env.ELEVENLABS_AGENT_ID),
      elevenLabsAgentId: process.env.ELEVENLABS_AGENT_ID || '',
      twilioConfigured: Boolean(process.env.TWILIO_ACCOUNT_SID),
      twilioNumber: process.env.TWILIO_PHONE_NUMBER || '',
      humanTransferNumber: process.env.HUMAN_TRANSFER_NUMBER || '+919900112233',
      serverHost: req.get('host'),
      ngrokPublicUrl: ngrokPublicUrl || null,
      ngrokConfigured: Boolean(process.env.NGROK_AUTHTOKEN)
    });
  } catch (err) {
    console.error('Error rendering voice dashboard:', err);
    res.status(500).send(`Error loading voice dashboard: ${err.message}`);
  }
});

app.listen(port, '0.0.0.0', async () => {
  console.log(`LabourLink server running at http://0.0.0.0:${port} (Local: http://localhost:${port})`);

  // Auto-start ngrok tunnel when NGROK_AUTHTOKEN is configured
  try {
    await ngrokTunnel.startTunnel();
  } catch (ngrokErr) {
    console.warn('⚠️  [ngrok] Auto-tunnel failed (non-fatal):', ngrokErr.message);
  }

  // Automatically maintain USB reverse port forwarding for connected Android devices
  try {
    const { execFile } = require('child_process');
    const fs = require('fs');
    const defaultAdb = path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe');
    const adbPath = fs.existsSync(defaultAdb) ? defaultAdb : 'adb';

    let isChecking = false;

    function maintainAdbReverse() {
      if (isChecking) return;
      isChecking = true;

      // Check if reverse forward is already established
      execFile(adbPath, ['reverse', '--list'], (listErr, stdout) => {
        if (!listErr && stdout && stdout.includes(`tcp:${port}`)) {
          // Port is ALREADY active. Do NOT re-run adb reverse to avoid dropping in-flight requests!
          isChecking = false;
          return;
        }

        // Only run adb reverse if not already forwarded (e.g. freshly connected phone)
        execFile(adbPath, ['reverse', `tcp:${port}`, `tcp:${port}`], () => {
          isChecking = false;
        });
      });
    }

    maintainAdbReverse();
    setInterval(maintainAdbReverse, 4000);
    console.log(`Auto ADB reverse watcher active for Android devices on port ${port}`);
  } catch (e) {
    // Non-fatal if child_process/adb is unavailable
  }
});
