const db = require('./database');

async function seed() {
  console.log('Seeding demo data for LabourLink...');

  // Clear existing records in local SQLite
  await db.runAsync('DELETE FROM worker_ratings');
  await db.runAsync('DELETE FROM worker_cv');
  await db.runAsync('DELETE FROM job_interests');
  await db.runAsync('DELETE FROM jobs');
  await db.runAsync('DELETE FROM workers');
  try {
    await db.runAsync("DELETE FROM sqlite_sequence WHERE name IN ('workers', 'jobs', 'job_interests', 'worker_cv', 'worker_ratings')");
  } catch (e) {
    // sqlite_sequence may not exist yet if fresh, ignore
  }

  // 1. Seed Workers
  const workers = [
    { name: 'Ramesh Kumar', phone_number: '9876500001', skill_type: 'Construction', location: 'Koramangala', available: 1 },
    { name: 'Suresh Patel', phone_number: '9876500002', skill_type: 'Painting', location: 'Indiranagar', available: 1 },
    { name: 'Mohammed Rafiq', phone_number: '9876500003', skill_type: 'Plumbing', location: 'Koramangala', available: 1 },
    { name: 'Anil Yadav', phone_number: '9876500004', skill_type: 'Loading', location: 'Whitefield', available: 1 },
    { name: 'Sunita Devi', phone_number: '9876500005', skill_type: 'Domestic Help', location: 'HSR Layout', available: 0 },
    { name: 'Vijay Sharma', phone_number: '9876500006', skill_type: 'Construction', location: 'HSR Layout', available: 1 },
    { name: 'Dinesh Verma', phone_number: '9876500007', skill_type: 'Painting', location: 'Koramangala', available: 1 },
    { name: 'Rajesh Goud', phone_number: '9876500008', skill_type: 'Plumbing', location: 'Indiranagar', available: 1 },
    { name: 'Gopal Mondal', phone_number: '9876500009', skill_type: 'Loading', location: 'Koramangala', available: 0 },
    { name: 'Geeta Kumari', phone_number: '9876500010', skill_type: 'Domestic Help', location: 'Koramangala', available: 1 },
    { name: 'Manoj Paswan', phone_number: '9876500011', skill_type: 'Construction', location: 'Whitefield', available: 1 },
    { name: 'Santosh Naik', phone_number: '9876500012', skill_type: 'Other', location: 'Indiranagar', available: 1 }
  ];

  const workerMap = {};
  for (const w of workers) {
    const result = await db.runAsync(
      `INSERT INTO workers (name, phone_number, skill_type, location, available) VALUES (?, ?, ?, ?, ?)`,
      [w.name, w.phone_number, w.skill_type, w.location, w.available]
    );
    workerMap[w.phone_number] = result.lastID;
  }
  console.log(`✓ Seeded ${workers.length} workers`);

  // 2. Seed Jobs
  const jobs = [
    {
      employer_name: 'Anand Buildcon',
      employer_phone: '9900112233',
      skill_needed: 'Construction',
      location: 'Koramangala',
      wage_offered: '₹850/day',
      date_needed: 'Today',
      status: 'open'
    },
    {
      employer_name: 'Pooja Hegde (Homeowner)',
      employer_phone: '9900112244',
      skill_needed: 'Painting',
      location: 'Indiranagar',
      wage_offered: '₹950/day',
      date_needed: 'Tomorrow',
      status: 'open'
    },
    {
      employer_name: 'Metro Warehousing',
      employer_phone: '9900112255',
      skill_needed: 'Loading',
      location: 'Whitefield',
      wage_offered: '₹750/day',
      date_needed: 'Today',
      status: 'open'
    },
    {
      employer_name: 'Arun Mehra',
      employer_phone: '9900112266',
      skill_needed: 'Plumbing',
      location: 'Koramangala',
      wage_offered: '₹1000/day',
      date_needed: 'Today',
      status: 'open'
    },
    {
      employer_name: 'Kavita Reddy',
      employer_phone: '9900112277',
      skill_needed: 'Domestic Help',
      location: 'HSR Layout',
      wage_offered: '₹650/day',
      date_needed: 'Today',
      status: 'filled'
    },
    {
      employer_name: 'Anand Buildcon',
      employer_phone: '9900112233',
      skill_needed: 'Construction',
      location: 'Koramangala',
      wage_offered: '₹850/day',
      date_needed: 'Yesterday',
      status: 'completed'
    },
    {
      employer_name: 'Suresh Interiors',
      employer_phone: '9900112255',
      skill_needed: 'Painting',
      location: 'Indiranagar',
      wage_offered: '₹900/day',
      date_needed: '3 days ago',
      status: 'completed'
    }
  ];

  const jobIds = [];
  for (const j of jobs) {
    const result = await db.runAsync(
      `INSERT INTO jobs (employer_name, employer_phone, skill_needed, location, wage_offered, date_needed, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [j.employer_name, j.employer_phone, j.skill_needed, j.location, j.wage_offered, j.date_needed, j.status]
    );
    jobIds.push(result.lastID);
  }
  console.log(`✓ Seeded ${jobs.length} jobs`);

  // 3. Seed sample interests using dynamic IDs
  const interests = [
    {
      job_id: jobIds[0],
      worker_id: workerMap['9876500001'],
      status: 'interested'
    },
    {
      job_id: jobIds[3],
      worker_id: workerMap['9876500003'],
      status: 'interested'
    },
    {
      job_id: jobIds[4],
      worker_id: workerMap['9876500005'],
      status: 'confirmed'
    }
  ];

  for (const item of interests) {
    if (item.worker_id && item.job_id) {
      await db.runAsync(
        `INSERT INTO job_interests (job_id, worker_id, status) VALUES (?, ?, ?)`,
        [item.job_id, item.worker_id, item.status]
      );
    }
  }

  // Set worker 5 current active job for demo
  const sunitaId = workerMap['9876500005'];
  if (sunitaId && jobIds[4]) {
    await db.runAsync(
      `UPDATE workers SET status = 'HIRED', current_active_job_id = ?, current_location_zone = 'HSR Layout' WHERE id = ?`,
      [jobIds[4], sunitaId]
    );
  }

  // 4. Seed sample Worker CVs
  const rameshId = workerMap['9876500001'];
  if (rameshId) {
    await db.runAsync(
      `INSERT INTO worker_cv (worker_id, full_name, dob_or_age, phone_number, skills, years_of_experience, previous_work, work_location, daily_wage_expectation, availability_type, languages, about_me)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rameshId,
        'Ramesh Kumar',
        '32',
        '9876500001',
        JSON.stringify(['Mason', 'Bricklayer', 'Plastering', 'Tiling']),
        6,
        JSON.stringify([
          { company: 'Prestige Builders', duration: '2021 - 2023', role: 'Lead Mason' },
          { company: 'Sobha Developers', duration: '2019 - 2021', role: 'Bricklayer' }
        ]),
        'Koramangala, Bangalore',
        '₹850/day',
        'Full-time (Immediate)',
        'Hindi, Kannada, Basic English',
        'Experienced senior mason with precision plastering and tiling skills. Reliable and punctual on site.'
      ]
    );
  }

  const sureshId = workerMap['9876500002'];
  if (sureshId) {
    await db.runAsync(
      `INSERT INTO worker_cv (worker_id, full_name, dob_or_age, phone_number, skills, years_of_experience, previous_work, work_location, daily_wage_expectation, availability_type, languages, about_me)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sureshId,
        'Suresh Patel',
        '29',
        '9876500002',
        JSON.stringify(['Interior Painting', 'Exterior Texture', 'Waterproofing']),
        4,
        JSON.stringify([
          { company: 'Asian Paints Color Ideas', duration: '2022 - 2024', role: 'Certified Painter' }
        ]),
        'Indiranagar, Bangalore',
        '₹950/day',
        'Full-time',
        'Hindi, Gujarati, English',
        'Specialist in luxury wall finishes, weather-proof exterior coats, and neat clean work.'
      ]
    );
  }

  const rafiqId = workerMap['9876500003'];
  if (rafiqId) {
    await db.runAsync(
      `INSERT INTO worker_cv (worker_id, full_name, dob_or_age, phone_number, skills, years_of_experience, previous_work, work_location, daily_wage_expectation, availability_type, languages, about_me)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rafiqId,
        'Mohammed Rafiq',
        '35',
        '9876500003',
        JSON.stringify(['Master Plumber', 'Pipe Fitting', 'Bathroom Sanity']),
        8,
        JSON.stringify([
          { company: 'Apex Plumbing Solutions', duration: '2018 - 2023', role: 'Senior Plumber' }
        ]),
        'Koramangala, Bangalore',
        '₹1000/day',
        'Full-time',
        'Hindi, Urdu, Kannada',
        'Certified plumber with commercial and residential expertise. Expert in emergency leak fixes.'
      ]
    );
  }

  // 5. Seed sample Worker Ratings
  if (rameshId && jobIds[5]) {
    await db.runAsync(
      `INSERT INTO worker_ratings (worker_id, employer_phone, job_id, rating, comment)
       VALUES (?, '9900112233', ?, 4.8, 'Ramesh did an outstanding job on our wall plastering. Very punctual and hard working!')`,
      [rameshId, jobIds[5]]
    );
  }

  if (sureshId && jobIds[6]) {
    await db.runAsync(
      `INSERT INTO worker_ratings (worker_id, employer_phone, job_id, rating, comment)
       VALUES (?, '9900112255', ?, 4.6, 'Very clean painter, no drips or mess left behind. Highly recommend.')`,
      [sureshId, jobIds[6]]
    );
  }

  // Also sync to Supabase if configured
  if (db.isSupabaseConfigured) {
    try {
      console.log('Syncing seeded records to Supabase...');
      const syncRes = await db.syncToSupabase();
      console.log('Supabase sync status:', syncRes);
    } catch (sErr) {
      console.warn('Note syncing to Supabase:', sErr.message);
    }
  }

  console.log('✓ Seeded sample job interests, active bookings, worker CVs, and ratings');

  const ivrService = require('./services/ivrService');
  await ivrService.seedDefaultCategoriesIfEmpty();
  const cats = await db.allAsync('SELECT digit, category_name FROM job_categories ORDER BY digit');
  console.log(`✓ IVR job categories: ${cats.map((c) => `${c.digit}:${c.category_name}`).join(', ')}`);

  console.log('Database seeding complete!');
}

if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seeding error:', err);
      process.exit(1);
    });
}

module.exports = seed;
