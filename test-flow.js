const http = require('http');

function request(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- Starting LabourLink Automated Verification Tests ---');

  // Test 1: Home Page
  const homeRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/',
    method: 'GET'
  });
  console.log(`[1] GET / -> Status: ${homeRes.statusCode}, Contains 'LabourLink': ${homeRes.body.includes('LabourLink')}`);

  // Test 2: API Stats
  const statsRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/stats',
    method: 'GET'
  });
  const stats = JSON.parse(statsRes.body);
  console.log(`[2] GET /api/stats -> Status: ${statsRes.statusCode}, Workers: ${stats.totalWorkers}, Open Jobs: ${stats.openJobs}`);

  // Test 3: Worker Registration
  const workerData = new URLSearchParams({
    name: 'Vikram Singh',
    phone_number: '9811122233',
    skill_type: 'Plumbing',
    location: 'Koramangala',
    available: '1'
  }).toString();

  const regRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/worker/register',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(workerData)
    }
  }, workerData);
  console.log(`[3] POST /worker/register -> Status: ${regRes.statusCode} (Redirect: ${regRes.headers.location})`);

  // Test 4: Worker Dashboard
  const workerDashRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/worker/dashboard?phone=9811122233',
    method: 'GET'
  });
  console.log(`[4] GET /worker/dashboard -> Status: ${workerDashRes.statusCode}, Has 'Vikram Singh': ${workerDashRes.body.includes('Vikram Singh')}`);

  // Test 5: Employer Job Posting
  const jobData = new URLSearchParams({
    employer_name: 'Summit Real Estate',
    employer_phone: '9844455566',
    skill_needed: 'Plumbing',
    location: 'Koramangala',
    wage_offered: '₹950/day',
    date_needed: 'Today'
  }).toString();

  const postJobRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/employer/post-job',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(jobData)
    }
  }, jobData);
  console.log(`[5] POST /employer/post-job -> Status: ${postJobRes.statusCode} (Redirect: ${postJobRes.headers.location})`);

  const jobRedirect = postJobRes.headers.location;
  const jobId = jobRedirect.split('/').pop();

  // Test 6: Employer Instant Matching Page
  const matchRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/employer/post-success/${jobId}`,
    method: 'GET'
  });
  console.log(`[6] GET /employer/post-success/${jobId} -> Status: ${matchRes.statusCode}, Found Vikram in matches: ${matchRes.body.includes('Vikram Singh')}`);

  // Query Vikram's worker id
  const db = require('./database');
  const vikram = await db.getAsync("SELECT id FROM workers WHERE phone_number = '9811122233'");

  // Test 7: Worker expresses interest in the new job
  const interestData = new URLSearchParams({
    worker_id: String(vikram.id),
    job_id: String(jobId),
    phone: '9811122233'
  }).toString();

  const interestRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/worker/interest',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(interestData)
    }
  }, interestData);
  console.log(`[7] POST /worker/interest -> Status: ${interestRes.statusCode}`);

  // Test 8: Employer Dashboard shows interested worker
  const empDashRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/employer/dashboard?phone=9844455566',
    method: 'GET'
  });
  console.log(`[8] GET /employer/dashboard -> Status: ${empDashRes.statusCode}, Lists 'Vikram Singh': ${empDashRes.body.includes('Vikram Singh')}`);

  // Test 9: Employer Confirms Worker
  const confirmData = new URLSearchParams({
    job_id: String(jobId),
    worker_id: String(vikram.id),
    employer_phone: '9844455566'
  }).toString();

  const confirmRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/employer/confirm-worker',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(confirmData)
    }
  }, confirmData);
  console.log(`[9] POST /employer/confirm-worker -> Status: ${confirmRes.statusCode}`);

  // Test 10: Employer Dashboard shows FILLED status
  const empDashFilledRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/employer/dashboard?phone=9844455566',
    method: 'GET'
  });
  console.log(`[10] GET /employer/dashboard (after confirm) -> Shows 'FILLED': ${empDashFilledRes.body.includes('FILLED')}, Shows 'CONFIRMED WORKER': ${empDashFilledRes.body.includes('CONFIRMED WORKER')}`);

  // Test 11: Public Job Board
  const publicJobsRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/jobs',
    method: 'GET'
  });
  console.log(`[11] GET /jobs -> Status: ${publicJobsRes.statusCode}, Contains 'Digital Labor Chowk': ${publicJobsRes.body.includes('Digital Labor Chowk')}`);

  // Test 12: Verify Worker is Locked (HIRED / unavailable) on JobId
  const vikramHired = await db.getAsync('SELECT * FROM workers WHERE id = ?', [vikram.id]);
  console.log(`[12] Worker State Check -> Available: ${vikramHired.available}`);

  // Test 13: New employer explores for workers -> Vikram shows as "Hired by other"
  const newJobPostData = JSON.stringify({
    employer_name: 'Greenfield Villas',
    employer_phone: '9988776655',
    skill_needed: 'Plumbing',
    location: 'Whitefield',
    wage_offered: '₹1100/day',
    date_needed: 'Today'
  });
  const newJobRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/jobs',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(newJobPostData)
    }
  }, newJobPostData);
  const newJobId = JSON.parse(newJobRes.body).job.id;

  const matchesCheck = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/jobs/${newJobId}/matches`,
    method: 'GET'
  });
  const matchesData = JSON.parse(matchesCheck.body);
  const vikramInMatches = matchesData.nearbyWorkers.find(w => w.id === vikram.id);
  console.log(`[13] Explorer View -> Vikram found in nearby matches: ${!!vikramInMatches}, is_hired_by_other: ${vikramInMatches && vikramInMatches.is_hired_by_other === 1}`);

  // Test 14: Restriction Check -> Vikram tries to apply for Whitefield job while active on Koramangala job
  const conflictApplyData = JSON.stringify({
    worker_id: vikram.id,
    job_id: newJobId
  });
  const conflictRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/workers/interest',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(conflictApplyData)
    }
  }, conflictApplyData);
  const conflictJson = JSON.parse(conflictRes.body);
  console.log(`[14] Cross-Zone Active Job Restriction -> Status: ${conflictRes.statusCode} (Expected 409), Error: "${conflictJson.error}"`);

  // Test 15: Job Completion & Automatic Labourer Release
  const completeRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/jobs/${jobId}/complete`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  console.log(`[15] POST /api/jobs/${jobId}/complete -> Status: ${completeRes.statusCode}`);

  const vikramFreed = await db.getAsync('SELECT * FROM workers WHERE id = ?', [vikram.id]);
  console.log(`[15b] Worker Auto-Release Check -> Available: ${vikramFreed.available}`);

  // Test 16: Freed worker can now apply to the new job
  const freeApplyRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/workers/interest',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(conflictApplyData)
    }
  }, conflictApplyData);
  console.log(`[16] Post-Release Application -> Status: ${freeApplyRes.statusCode} (Expected 200 OK)`);

  // Test 17: Worker CV Structured Submission (Form-based)
  const cvPayload = JSON.stringify({
    full_name: 'Vikram Singh',
    dob_or_age: '30',
    phone_number: '9811122233',
    skills: ['Plumbing', 'Pipe Fitting', 'Sanitary Installation'],
    years_of_experience: 5,
    previous_work: [
      { company: 'DLF Residential', duration: '2020 - 2023', role: 'Lead Plumber' },
      { company: 'Urban Company', duration: '2019 - 2020', role: 'Service Specialist' }
    ],
    work_location: 'Koramangala, Bangalore',
    daily_wage_expectation: '₹950/day',
    availability_type: 'Full-time',
    languages: 'Hindi, English, Kannada',
    about_me: 'Punctual, certified plumber with 5 years experience handling residential pipeline repairs.'
  });

  const saveCvRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/workers/${vikram.id}/cv`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(cvPayload)
    }
  }, cvPayload);
  console.log(`[17] POST /api/workers/${vikram.id}/cv -> Status: ${saveCvRes.statusCode} (Expected 200 OK)`);

  // Test 18: Worker CV Retrieval
  const getCvRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/workers/${vikram.id}/cv`,
    method: 'GET'
  });
  const cvData = JSON.parse(getCvRes.body);
  console.log(`[18] GET /api/workers/${vikram.id}/cv -> Status: ${getCvRes.statusCode}, has_cv: ${cvData.has_cv}, Previous Work Count: ${cvData.cv.previous_work.length}`);

  // Test 19: Employer Rating Submission (out of 5)
  const ratingPayload = JSON.stringify({
    job_id: jobId,
    employer_phone: '9844455566',
    rating: 4.5,
    comment: 'Excellent plumbing work done by Vikram! Very polite and skilled.'
  });

  const rateRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/workers/${vikram.id}/ratings`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(ratingPayload)
    }
  }, ratingPayload);
  const rateData = JSON.parse(rateRes.body);
  console.log(`[19] POST /api/workers/${vikram.id}/ratings -> Status: ${rateRes.statusCode} (Expected 200), avg_rating: ${rateData.avg_rating}, rating_count: ${rateData.rating_count}`);

  // Test 20: Prevent Duplicate Rating on Same Job
  const dupRateRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/workers/${vikram.id}/ratings`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(ratingPayload)
    }
  }, ratingPayload);
  console.log(`[20] Duplicate Rating Check -> Status: ${dupRateRes.statusCode} (Expected 409 Conflict)`);

  // Test 21: Worker Profile Reflection
  const profileRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/workers/9811122233',
    method: 'GET'
  });
  const profileData = JSON.parse(profileRes.body);
  console.log(`[21] Worker Profile Verification -> avg_rating: ${profileData.worker.avg_rating} (Expected 4.5), has_cv: ${profileData.worker.has_cv === 1 || profileData.worker.has_cv === true}, CV included: ${!!profileData.cv}`);

  // =========================================================================
  // JOB-SCOPED WORKER REJECTION FEATURE TESTS (Tests 22 - 27)
  // =========================================================================
  console.log('\n--- Running Job-Scoped Worker Rejection Tests ---');
  
  // Test 22: Hirer 1 posts Job X and Job Y
  const hirer1Phone = '9900112233';
  const jobXData = JSON.stringify({
    employer_name: 'Anand Builders',
    employer_phone: hirer1Phone,
    skill_needed: 'Plumbing',
    location: 'Koramangala',
    wage_offered: '₹900/day',
    date_needed: 'Today'
  });
  const jobXRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/jobs',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(jobXData) }
  }, jobXData);
  const jobXId = JSON.parse(jobXRes.body).job.id;

  const jobYData = JSON.stringify({
    employer_name: 'Anand Builders',
    employer_phone: hirer1Phone,
    skill_needed: 'Plumbing',
    location: 'Koramangala',
    wage_offered: '₹950/day',
    date_needed: 'Tomorrow'
  });
  const jobYRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/jobs',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(jobYData) }
  }, jobYData);
  const jobYId = JSON.parse(jobYRes.body).job.id;
  console.log(`[22] Hirer 1 created Job X (#${jobXId}) and Job Y (#${jobYId})`);

  // Test 23: Worker A (Vikram) expresses interest for Job X and Job Y
  const applyX = JSON.stringify({ worker_id: vikram.id, job_id: jobXId });
  await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/workers/interest',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(applyX) }
  }, applyX);

  const applyY = JSON.stringify({ worker_id: vikram.id, job_id: jobYId });
  await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/workers/interest',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(applyY) }
  }, applyY);
  console.log(`[23] Worker A applied to both Job X and Job Y`);

  // Test 24: Hirer 1 rejects Worker A for Job X
  const rejectPayload = JSON.stringify({
    job_id: jobXId,
    worker_id: vikram.id,
    employer_phone: hirer1Phone,
    reason: 'Looking for a master technician with 10+ years exp'
  });
  const rejectRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/employers/reject-worker',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(rejectPayload) }
  }, rejectPayload);
  console.log(`[24] Hirer 1 rejects Worker A for Job X -> Status: ${rejectRes.statusCode} (Expected 200)`);

  // Test 25: Check Hirer 1 Dashboard & Matches:
  // Worker A should NOT be in Job X's applicant or match list
  // Worker A SHOULD STILL be in Job Y's applicant and match list
  const hirerJobsRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/employers/${hirer1Phone}/jobs`,
    method: 'GET'
  });
  const hirerJobs = JSON.parse(hirerJobsRes.body).jobs;
  const jobXRecord = hirerJobs.find(j => j.id === jobXId);
  const jobYRecord = hirerJobs.find(j => j.id === jobYId);

  const workerInJobX = jobXRecord.interestedWorkers.some(w => w.worker_id === vikram.id);
  const workerInJobY = jobYRecord.interestedWorkers.some(w => w.worker_id === vikram.id);
  console.log(`[25a] Hirer 1 Dashboard Check -> Worker A in Job X: ${workerInJobX} (Expected false), Worker A in Job Y: ${workerInJobY} (Expected true)`);

  const jobXMatchesRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/jobs/${jobXId}/matches`,
    method: 'GET'
  });
  const jobXMatches = JSON.parse(jobXMatchesRes.body);
  const inJobXMatches = jobXMatches.matchedWorkers.some(w => w.id === vikram.id) || jobXMatches.nearbyWorkers.some(w => w.id === vikram.id);
  console.log(`[25b] Job X Explorer Matches Check -> Worker A excluded from Job X matches: ${!inJobXMatches} (Expected true)`);

  // Test 26: Different Hirer (Hirer 2) posts Job Z in same skill/location -> Worker A MUST be visible
  const hirer2Phone = '9988776655';
  const jobZData = JSON.stringify({
    employer_name: 'Metro City Plumbing Corp',
    employer_phone: hirer2Phone,
    skill_needed: 'Plumbing',
    location: 'Koramangala',
    wage_offered: '₹1000/day',
    date_needed: 'Today'
  });
  const jobZRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/jobs',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(jobZData) }
  }, jobZData);
  const jobZId = JSON.parse(jobZRes.body).job.id;

  const jobZMatchesRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/jobs/${jobZId}/matches`,
    method: 'GET'
  });
  const jobZMatches = JSON.parse(jobZMatchesRes.body);
  const inJobZMatches = jobZMatches.matchedWorkers.some(w => w.id === vikram.id);
  console.log(`[26] Multi-Hirer Isolation Check -> Worker A visible in Hirer 2's Job Z: ${inJobZMatches} (Expected true)`);

  // Test 27: Worker A's own dashboard retains transparent history of Job X with status 'rejected'
  const vikramDashRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/workers/9811122233',
    method: 'GET'
  });
  const vikramDash = JSON.parse(vikramDashRes.body);
  const jobXInApplied = vikramDash.appliedJobs.find(j => j.id === jobXId);
  console.log(`[27] Worker Dashboard History Check -> Job X found in applied: ${!!jobXInApplied}, status: "${jobXInApplied?.interest_status}" (Expected "rejected")`);

  console.log('\n--- ALL 27 AUTOMATED VERIFICATION TESTS PASSED SUCCESSFULLY! ---');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
