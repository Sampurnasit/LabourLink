const supabase = require('./database');

async function seed() {
  console.log('Seeding demo data for LabourLink in Supabase...');

  // Clear existing records
  const { error: delErr1 } = await supabase.from('job_interests').delete().neq('id', 0);
  if (delErr1) console.warn('Note deleting job_interests:', delErr1.message);

  const { error: delErr2 } = await supabase.from('jobs').delete().neq('id', 0);
  if (delErr2) console.warn('Note deleting jobs:', delErr2.message);

  const { error: delErr3 } = await supabase.from('workers').delete().neq('id', 0);
  if (delErr3) console.warn('Note deleting workers:', delErr3.message);

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

  const { data: insertedWorkers, error: wErr } = await supabase
    .from('workers')
    .insert(workers)
    .select();

  if (wErr) {
    throw new Error(`Failed to seed workers: ${wErr.message}`);
  }
  console.log(`✓ Seeded ${insertedWorkers ? insertedWorkers.length : 0} workers`);

  const workerMap = {};
  if (insertedWorkers) {
    for (const w of insertedWorkers) {
      workerMap[w.phone_number] = w.id;
    }
  }

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

  const { data: insertedJobs, error: jErr } = await supabase
    .from('jobs')
    .insert(jobs)
    .select();

  if (jErr) {
    throw new Error(`Failed to seed jobs: ${jErr.message}`);
  }
  console.log(`✓ Seeded ${insertedJobs ? insertedJobs.length : 0} jobs`);

  // 3. Seed sample interests using dynamic IDs
  if (insertedJobs && insertedJobs.length >= 5 && insertedWorkers) {
    const interests = [
      {
        job_id: insertedJobs[0].id,
        worker_id: workerMap['9876500001'],
        status: 'interested'
      },
      {
        job_id: insertedJobs[3].id,
        worker_id: workerMap['9876500003'],
        status: 'interested'
      },
      {
        job_id: insertedJobs[4].id,
        worker_id: workerMap['9876500005'],
        status: 'confirmed'
      }
    ];

    const { error: iErr } = await supabase
      .from('job_interests')
      .insert(interests);

    if (iErr) {
      throw new Error(`Failed to seed job interests: ${iErr.message}`);
    }

    console.log('✓ Seeded sample job interests');
  }

  console.log('Supabase database seeding complete!');
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
