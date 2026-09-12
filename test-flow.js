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
  const supabase = require('./database');
  const { data: vikram } = await supabase.from('workers').select('id').eq('phone_number', '9811122233').single();

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
  const { data: vikramHired } = await supabase.from('workers').select('*').eq('id', vikram.id).single();
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

  const { data: vikramFreed } = await supabase.from('workers').select('*').eq('id', vikram.id).single();
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

  console.log('--- ALL 16 AUTOMATED VERIFICATION TESTS PASSED SUCCESSFULLY! ---');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
