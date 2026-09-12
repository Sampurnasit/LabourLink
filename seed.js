const db = require('./database');

async function seed() {
  console.log('Seeding demo data for LabourLink...');

  // Clear existing records
  await db.runAsync('DELETE FROM job_interests');
  await db.runAsync('DELETE FROM jobs');
  await db.runAsync('DELETE FROM workers');
  try {
    await db.runAsync("DELETE FROM sqlite_sequence WHERE name IN ('workers', 'jobs', 'job_interests')");
  } catch (e) {
    // sqlite_sequence may not exist yet if fresh, ignore
  }

  // 1. Seed Workers
  const workers = [
    { name: 'Ramesh Kumar', phone_number: '9876500001', skill_type: 'Construction', location: 'Koramangala', available: 1 },
    { name: 'Suresh Patel', phone_number: '9876500002', skill_type: 'Painting', location: 'Indiranagar', available: 1 },
    { name: 'Mohammed Rafiq', phone_number: '9876500003', skill_type: 'Plumbing', location: 'Koramangala', available: 1 },
    { name: 'Anil Yadav', phone_number: '9876500004', skill_type: 'Loading', location: 'Whitefield', available: 1 },
    { name: 'Sunita Devi', phone_number: '9876500005', skill_type: 'Domestic Help', location: 'HSR Layout', available: 1 },
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
    const res = await db.runAsync(
      `INSERT INTO workers (name, phone_number, skill_type, location, available) VALUES (?, ?, ?, ?, ?)`,
      [w.name, w.phone_number, w.skill_type, w.location, w.available]
    );
    workerMap[w.phone_number] = res.lastID;
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
    }
  ];

  const jobIds = [];
  for (const j of jobs) {
    const res = await db.runAsync(
      `INSERT INTO jobs (employer_name, employer_phone, skill_needed, location, wage_offered, date_needed, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [j.employer_name, j.employer_phone, j.skill_needed, j.location, j.wage_offered, j.date_needed, j.status]
    );
    jobIds.push(res.lastID);
  }
  console.log(`✓ Seeded ${jobs.length} jobs`);

  // 3. Seed sample interests using dynamic IDs
  // Anand Buildcon (Job 0) has Ramesh Kumar (9876500001) interested
  await db.runAsync(
    `INSERT INTO job_interests (job_id, worker_id, status) VALUES (?, ?, 'interested')`,
    [jobIds[0], workerMap['9876500001']]
  );
  // Arun Mehra (Job 3) has Mohammed Rafiq (9876500003) interested
  await db.runAsync(
    `INSERT INTO job_interests (job_id, worker_id, status) VALUES (?, ?, 'interested')`,
    [jobIds[3], workerMap['9876500003']]
  );
  // Kavita Reddy (Job 4) confirmed Sunita Devi (9876500005)
  await db.runAsync(
    `INSERT INTO job_interests (job_id, worker_id, status) VALUES (?, ?, 'confirmed')`,
    [jobIds[4], workerMap['9876500005']]
  );

  console.log('✓ Seeded sample job interests');
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
