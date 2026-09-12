require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const supabase = require('./database');

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

// Helper to sanitize phone input (extracts last 10 digits e.g. for Indian numbers with +91 or leading 0)
function cleanPhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/[^0-9]/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// ==========================================================================
// REST API ENDPOINTS FOR FLUTTER APPLICATION
// ==========================================================================

// 1. Platform Statistics
app.get('/api/stats', async (req, res) => {
  try {
    const [
      { count: totalWorkers, error: err1 },
      { count: availableWorkers, error: err2 },
      { count: openJobs, error: err3 },
      { count: filledJobs, error: err4 },
      { count: totalInterests, error: err5 }
    ] = await Promise.all([
      supabase.from('workers').select('*', { count: 'exact', head: true }),
      supabase.from('workers').select('*', { count: 'exact', head: true }).eq('available', 1),
      supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'open'),
      supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'filled'),
      supabase.from('job_interests').select('*', { count: 'exact', head: true })
    ]);

    const firstErr = err1 || err2 || err3 || err4 || err5;
    if (firstErr) throw firstErr;

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

// 2. Public / Filtered Jobs Feed
app.get('/api/jobs', async (req, res) => {
  try {
    const { skill, location } = req.query;
    let query = supabase.from('jobs').select('*').eq('status', 'open');

    if (skill) {
      query = query.eq('skill_needed', skill);
    }
    if (location) {
      query = query.eq('location', location);
    }

    query = query.order('id', { ascending: false });
    const { data: jobs, error } = await query;
    if (error) throw error;

    res.json({ status: 'ok', jobs: jobs || [] });
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

    const { data: newJob, error } = await supabase
      .from('jobs')
      .insert({
        employer_name: employer_name.trim(),
        employer_phone: phone,
        skill_needed,
        location,
        wage_offered: wage_offered.trim(),
        date_needed: date_needed || 'Today',
        status: 'open'
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ status: 'ok', job: newJob });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Get Single Job and Instant Matching Workers
app.get('/api/jobs/:id/matches', async (req, res) => {
  try {
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (jobError) throw jobError;
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Direct matches: same skill + same location + available = 1
    const { data: matchedWorkers, error: matchErr } = await supabase
      .from('workers')
      .select('*')
      .eq('skill_type', job.skill_needed)
      .eq('location', job.location)
      .eq('available', 1)
      .order('id', { ascending: false });
    if (matchErr) throw matchErr;

    // Nearby citywide workers with same skill
    const { data: nearbyWorkers, error: nearErr } = await supabase
      .from('workers')
      .select('*')
      .eq('skill_type', job.skill_needed)
      .neq('location', job.location)
      .eq('available', 1)
      .order('id', { ascending: false })
      .limit(5);
    if (nearErr) throw nearErr;

    res.json({
      status: 'ok',
      job,
      matchedWorkers: matchedWorkers || [],
      nearbyWorkers: nearbyWorkers || []
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

    const { data: worker, error } = await supabase
      .from('workers')
      .upsert(
        {
          name: name.trim(),
          phone_number: phone,
          skill_type,
          location,
          available: isAvailable
        },
        { onConflict: 'phone_number' }
      )
      .select()
      .single();

    if (error) throw error;
    res.json({ status: 'ok', worker });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Worker Profile & Gigs Lookup by Phone
app.get('/api/workers/:phone', async (req, res) => {
  try {
    const phone = cleanPhone(req.params.phone);
    const { data: worker, error: workerErr } = await supabase
      .from('workers')
      .select('*')
      .eq('phone_number', phone)
      .maybeSingle();

    if (workerErr) throw workerErr;
    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    // Matched open jobs in worker's area
    const { data: matchedJobs, error: mErr } = await supabase
      .from('jobs')
      .select('*')
      .eq('skill_needed', worker.skill_type)
      .eq('location', worker.location)
      .eq('status', 'open')
      .order('id', { ascending: false });
    if (mErr) throw mErr;

    // Other open jobs in that skill citywide
    const { data: otherSkillJobs, error: oErr } = await supabase
      .from('jobs')
      .select('*')
      .eq('skill_needed', worker.skill_type)
      .neq('location', worker.location)
      .eq('status', 'open')
      .order('id', { ascending: false })
      .limit(6);
    if (oErr) throw oErr;

    // Jobs the worker has applied for or been confirmed for
    const { data: interests, error: iErr } = await supabase
      .from('job_interests')
      .select('id, status, created_at, jobs(*)')
      .eq('worker_id', worker.id)
      .order('id', { ascending: false });
    if (iErr) throw iErr;

    const appliedJobs = (interests || []).map((i) => ({
      ...(i.jobs || {}),
      interest_status: i.status,
      interest_date: i.created_at
    }));

    res.json({
      status: 'ok',
      worker,
      matchedJobs: matchedJobs || [],
      otherSkillJobs: otherSkillJobs || [],
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

    const { error } = await supabase
      .from('job_interests')
      .upsert(
        { job_id, worker_id, status: 'interested' },
        { onConflict: 'job_id,worker_id', ignoreDuplicates: true }
      );

    if (error) throw error;
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

    const { data: worker, error } = await supabase
      .from('workers')
      .update({ available })
      .eq('phone_number', phone)
      .select()
      .single();

    if (error) throw error;
    res.json({ status: 'ok', worker });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Employer Dashboard Jobs & Interested Applicants
app.get('/api/employers/:phone/jobs', async (req, res) => {
  try {
    const phone = cleanPhone(req.params.phone);
    const { data: jobs, error: jErr } = await supabase
      .from('jobs')
      .select('*')
      .eq('employer_phone', phone)
      .order('id', { ascending: false });

    if (jErr) throw jErr;

    const jobList = jobs || [];
    for (const job of jobList) {
      const { data: interests, error: iErr } = await supabase
        .from('job_interests')
        .select('id, status, workers(id, name, phone_number, skill_type, location, available)')
        .eq('job_id', job.id)
        .order('id', { ascending: false });

      if (iErr) throw iErr;

      const workersList = (interests || []).map((i) => ({
        worker_id: i.workers?.id,
        name: i.workers?.name,
        phone_number: i.workers?.phone_number,
        skill_type: i.workers?.skill_type,
        location: i.workers?.location,
        available: i.workers?.available,
        status: i.status
      }));

      workersList.sort((a, b) => {
        if (a.status === 'confirmed' && b.status !== 'confirmed') return -1;
        if (a.status !== 'confirmed' && b.status === 'confirmed') return 1;
        return 0;
      });

      job.interestedWorkers = workersList;
    }

    res.json({ status: 'ok', jobs: jobList });
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

    const { error: iErr } = await supabase
      .from('job_interests')
      .update({ status: 'confirmed' })
      .eq('job_id', job_id)
      .eq('worker_id', worker_id);
    if (iErr) throw iErr;

    const { error: jErr } = await supabase
      .from('jobs')
      .update({ status: 'filled' })
      .eq('id', job_id);
    if (jErr) throw jErr;

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
    const [
      { count: totalWorkers },
      { count: availableWorkers },
      { count: openJobs },
      { count: totalInterests },
      { data: recentJobs }
    ] = await Promise.all([
      supabase.from('workers').select('*', { count: 'exact', head: true }),
      supabase.from('workers').select('*', { count: 'exact', head: true }).eq('available', 1),
      supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'open'),
      supabase.from('job_interests').select('*', { count: 'exact', head: true }),
      supabase.from('jobs').select('*').eq('status', 'open').order('id', { ascending: false }).limit(6)
    ]);

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

    const { error } = await supabase
      .from('workers')
      .upsert(
        {
          name: name.trim(),
          phone_number: phone,
          skill_type,
          location,
          available: isAvailable
        },
        { onConflict: 'phone_number' }
      );

    if (error) throw error;

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

    const { data: worker, error: workerErr } = await supabase
      .from('workers')
      .select('*')
      .eq('phone_number', phone)
      .maybeSingle();

    if (workerErr) throw workerErr;

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

    const { data: matchedJobs } = await supabase
      .from('jobs')
      .select('*')
      .eq('skill_needed', worker.skill_type)
      .eq('location', worker.location)
      .eq('status', 'open')
      .order('id', { ascending: false });

    const { data: otherSkillJobs } = await supabase
      .from('jobs')
      .select('*')
      .eq('skill_needed', worker.skill_type)
      .neq('location', worker.location)
      .eq('status', 'open')
      .order('id', { ascending: false })
      .limit(6);

    const { data: interests } = await supabase
      .from('job_interests')
      .select('id, status, created_at, jobs(*)')
      .eq('worker_id', worker.id)
      .order('id', { ascending: false });

    const appliedJobs = (interests || []).map((i) => ({
      ...(i.jobs || {}),
      interest_status: i.status,
      interest_date: i.created_at
    }));

    const interestedJobIds = appliedJobs.map((j) => j.id);

    res.render('worker-dashboard', {
      worker,
      phone,
      matchedJobs: matchedJobs || [],
      otherSkillJobs: otherSkillJobs || [],
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

    await supabase
      .from('job_interests')
      .upsert(
        { job_id, worker_id, status: 'interested' },
        { onConflict: 'job_id,worker_id', ignoreDuplicates: true }
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

    await supabase
      .from('workers')
      .update({ available })
      .eq('phone_number', phone);

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

    const { data: newJob, error } = await supabase
      .from('jobs')
      .insert({
        employer_name: employer_name.trim(),
        employer_phone: phone,
        skill_needed,
        location,
        wage_offered: wage_offered.trim(),
        date_needed: date_needed || 'Today',
        status: 'open'
      })
      .select('id')
      .single();

    if (error) throw error;

    res.redirect(`/employer/post-success/${newJob.id}`);
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
    const { data: job, error: jobErr } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .maybeSingle();

    if (jobErr) throw jobErr;
    if (!job) {
      return res.status(404).send('Job not found');
    }

    const { data: matchedWorkers } = await supabase
      .from('workers')
      .select('*')
      .eq('skill_type', job.skill_needed)
      .eq('location', job.location)
      .eq('available', 1)
      .order('id', { ascending: false });

    const { data: nearbyWorkers } = await supabase
      .from('workers')
      .select('*')
      .eq('skill_type', job.skill_needed)
      .neq('location', job.location)
      .eq('available', 1)
      .order('id', { ascending: false })
      .limit(4);

    res.render('employer-post-success', {
      job,
      matchedWorkers: matchedWorkers || [],
      nearbyWorkers: nearbyWorkers || []
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

    const { data: jobs, error: jErr } = await supabase
      .from('jobs')
      .select('*')
      .eq('employer_phone', phone)
      .order('id', { ascending: false });

    if (jErr) throw jErr;

    const jobList = jobs || [];
    for (const job of jobList) {
      const { data: interests, error: iErr } = await supabase
        .from('job_interests')
        .select('id, status, workers(id, name, phone_number, skill_type, location, available)')
        .eq('job_id', job.id)
        .order('id', { ascending: false });

      if (iErr) throw iErr;

      const workersList = (interests || []).map((i) => ({
        worker_id: i.workers?.id,
        name: i.workers?.name,
        phone_number: i.workers?.phone_number,
        skill_type: i.workers?.skill_type,
        location: i.workers?.location,
        available: i.workers?.available,
        status: i.status
      }));

      workersList.sort((a, b) => {
        if (a.status === 'confirmed' && b.status !== 'confirmed') return -1;
        if (a.status !== 'confirmed' && b.status === 'confirmed') return 1;
        return 0;
      });

      job.interestedWorkers = workersList;
    }

    res.render('employer-dashboard', {
      jobs: jobList,
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

    await supabase
      .from('job_interests')
      .update({ status: 'confirmed' })
      .eq('job_id', job_id)
      .eq('worker_id', worker_id);

    await supabase
      .from('jobs')
      .update({ status: 'filled' })
      .eq('id', job_id);

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
    let query = supabase.from('jobs').select('*').eq('status', 'open');

    if (skill) {
      query = query.eq('skill_needed', skill);
    }
    if (location) {
      query = query.eq('location', location);
    }

    query = query.order('id', { ascending: false });
    const { data: jobs, error } = await query;
    if (error) throw error;

    res.render('jobs-board', {
      jobs: jobs || [],
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

  // Automatically maintain USB reverse port forwarding for connected Android devices
  try {
    const { execFile } = require('child_process');
    const fs = require('fs');
    const defaultAdb = path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe');
    const adbPath = fs.existsSync(defaultAdb) ? defaultAdb : 'adb';

    function maintainAdbReverse() {
      execFile(adbPath, ['reverse', `tcp:${port}`, `tcp:${port}`], () => {
        // Silently succeed when device is connected, ignore if no device
      });
    }

    maintainAdbReverse();
    setInterval(maintainAdbReverse, 3000);
    console.log(`Auto ADB reverse watcher active for Android devices on port ${port}`);
  } catch (e) {
    // Non-fatal if child_process/adb is unavailable
  }
});
