/**
 * voice-tools.js
 * Backend Tools exposed to the ElevenLabs Conversational AI Agent for LabourLink.
 *
 * Each tool provides safe, controlled operations:
 * - Sanitizes all user inputs
 * - Queries data safely through database.js (with automatic retry)
 * - Returns natural, conversational responses for the voice model
 * - Hides sensitive internals, passwords, and raw database errors
 */

require('dotenv').config();
const db = require('./database');

// Helper to clean phone numbers to standard 10 digits
function cleanPhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/[^0-9]/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// Helper to mask phone numbers (e.g. ••••••89)
function maskPhone(phone) {
  if (!phone) return '••••••00';
  const digits = String(phone).replace(/[^0-9]/g, '');
  if (digits.length < 4) return '••••••';
  return '•'.repeat(Math.max(0, digits.length - 2)) + digits.slice(-2);
}

/**
 * Tool 1: lookup_caller
 * Identifies caller identity, role (worker/employer/guest), and current status.
 */
async function lookupCaller({ phone_number }) {
  const phone = cleanPhone(phone_number);
  if (!phone) {
    return {
      found: false,
      role: 'guest',
      message: 'No phone number provided. Please ask the caller for their phone number.'
    };
  }

  try {
    // 1. Check if registered worker
    const worker = await db.getAsync(
      'SELECT id, name, phone_number, skill_type, location, available, status, current_location_zone FROM workers WHERE phone_number = ?',
      [phone]
    );

    if (worker) {
      // Fetch any ratings or active jobs
      const ratings = await db.getAsync(
        'SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM worker_ratings WHERE worker_id = ?',
        [worker.id]
      );

      return {
        found: true,
        role: 'worker',
        name: worker.name,
        skill: worker.skill_type,
        location: worker.location,
        is_available: worker.available === 1 || worker.available === true,
        status: worker.status || 'AVAILABLE',
        rating: ratings && ratings.avg_rating ? parseFloat(ratings.avg_rating).toFixed(1) : 'New worker',
        message: `Found worker profile for ${worker.name}, skilled in ${worker.skill_type}, located in ${worker.location}.`
      };
    }

    // 2. Check if registered employer (has posted jobs)
    const employerJobs = await db.allAsync(
      "SELECT id, employer_name, skill_needed, location, wage_offered, status FROM jobs WHERE employer_phone = ? ORDER BY id DESC LIMIT 5",
      [phone]
    );

    if (employerJobs && employerJobs.length > 0) {
      const employerName = employerJobs[0].employer_name;
      const openCount = employerJobs.filter(j => j.status === 'open').length;

      return {
        found: true,
        role: 'employer',
        name: employerName,
        total_posted_jobs: employerJobs.length,
        open_jobs_count: openCount,
        recent_jobs: employerJobs.map(j => ({
          job_id: j.id,
          skill_needed: j.skill_needed,
          location: j.location,
          status: j.status
        })),
        message: `Found employer profile for ${employerName} with ${openCount} open job(s).`
      };
    }

    // 3. Unregistered / Guest Caller
    return {
      found: false,
      role: 'guest',
      phone_number: phone,
      message: `Phone number ${phone} is not yet registered. You can guide them to register as a skilled daily-wage worker or post a job as an employer.`
    };
  } catch (err) {
    console.error('Error in lookupCaller tool:', err.message);
    return {
      found: false,
      role: 'guest',
      error: 'Lookup failed due to temporary service error.',
      message: 'Could not access profile records right now.'
    };
  }
}

/**
 * Tool 2: get_open_jobs
 * Finds currently open daily-wage jobs matching a skill and/or location.
 */
async function getOpenJobs({ skill, location, limit = 4 }) {
  try {
    let sql = "SELECT id, employer_name, skill_needed, location, wage_offered, date_needed FROM jobs WHERE status = 'open'";
    const params = [];

    if (skill && skill.trim().toLowerCase() !== 'all') {
      sql += " AND LOWER(skill_needed) LIKE LOWER(?)";
      params.push(`%${skill.trim()}%`);
    }

    if (location && location.trim().toLowerCase() !== 'all') {
      sql += " AND LOWER(location) LIKE LOWER(?)";
      params.push(`%${location.trim()}%`);
    }

    sql += " ORDER BY id DESC LIMIT ?";
    params.push(Math.min(parseInt(limit, 10) || 4, 10));

    const jobs = await db.allAsync(sql, params);

    if (!jobs || jobs.length === 0) {
      return {
        count: 0,
        jobs: [],
        message: `Currently there are no open jobs matching ${skill || 'any trade'} in ${location || 'your area'}. Let the caller know more jobs are added daily.`
      };
    }

    return {
      count: jobs.length,
      jobs: jobs.map(j => ({
        id: j.id,
        skill: j.skill_needed,
        location: j.location,
        wage: j.wage_offered,
        date_needed: j.date_needed
      })),
      message: `Found ${jobs.length} open position(s).`
    };
  } catch (err) {
    console.error('Error in getOpenJobs tool:', err.message);
    return {
      count: 0,
      jobs: [],
      error: 'Failed to retrieve open jobs.'
    };
  }
}

/**
 * Tool 3: toggle_worker_availability
 * Toggles a worker's daily availability status (available / busy).
 */
async function toggleWorkerAvailability({ phone_number, set_available }) {
  const phone = cleanPhone(phone_number);
  if (!phone) {
    return { success: false, message: 'Please provide the worker phone number.' };
  }

  try {
    const worker = await db.getAsync('SELECT id, name, available, status FROM workers WHERE phone_number = ?', [phone]);
    if (!worker) {
      return {
        success: false,
        message: 'No worker account found for this phone number. Please register first.'
      };
    }

    const newAvail = (set_available !== undefined)
      ? (Boolean(set_available) ? 1 : 0)
      : (worker.available === 1 ? 0 : 1);

    const newStatus = newAvail === 1 ? 'AVAILABLE' : 'BUSY';

    await db.runAsync('UPDATE workers SET available = ?, status = ? WHERE id = ?', [newAvail, newStatus, worker.id]);

    return {
      success: true,
      worker_name: worker.name,
      available: newAvail === 1,
      status: newStatus,
      message: `Updated availability for ${worker.name} to ${newStatus === 'AVAILABLE' ? 'Available for work' : 'Busy / Unavailable'}.`
    };
  } catch (err) {
    console.error('Error in toggleWorkerAvailability tool:', err.message);
    return { success: false, error: 'Database update failed.' };
  }
}

/**
 * Tool 4: check_job_application_status
 * Checks job interest/applications for a worker.
 */
async function checkJobApplicationStatus({ phone_number }) {
  const phone = cleanPhone(phone_number);
  if (!phone) {
    return { found: false, message: 'Phone number is required.' };
  }

  try {
    const worker = await db.getAsync('SELECT id, name FROM workers WHERE phone_number = ?', [phone]);
    if (!worker) {
      return { found: false, message: 'No worker found with this phone number.' };
    }

    const interests = await db.allAsync(
      `SELECT ji.id, ji.status, j.skill_needed, j.location, j.wage_offered, j.employer_name
       FROM job_interests ji
       JOIN jobs j ON ji.job_id = j.id
       WHERE ji.worker_id = ?
       ORDER BY ji.id DESC LIMIT 5`,
      [worker.id]
    );

    if (!interests || interests.length === 0) {
      return {
        found: true,
        applications_count: 0,
        applications: [],
        message: `${worker.name} has not applied for or expressed interest in any jobs yet.`
      };
    }

    return {
      found: true,
      applications_count: interests.length,
      applications: interests.map(i => ({
        skill: i.skill_needed,
        location: i.location,
        wage: i.wage_offered,
        status: i.status
      })),
      message: `Found ${interests.length} recent job interest(s) for ${worker.name}.`
    };
  } catch (err) {
    console.error('Error in checkJobApplicationStatus tool:', err.message);
    return { found: false, error: 'Failed to look up application history.' };
  }
}

/**
 * Tool 5: post_urgent_job
 * Allows an employer to post an urgent gig via phone call.
 */
async function postUrgentJob({ employer_name, employer_phone, skill_needed, location, wage_offered, date_needed }) {
  const phone = cleanPhone(employer_phone);
  if (!employer_name || !phone || !skill_needed || !location) {
    return {
      success: false,
      message: 'Missing required details. Need employer name, phone number, trade/skill needed, and location.'
    };
  }

  try {
    const wage = wage_offered || 'Negotiable';
    const date = date_needed || 'Today';

    const result = await db.runAsync(
      `INSERT INTO jobs (employer_name, employer_phone, skill_needed, location, wage_offered, date_needed, status)
       VALUES (?, ?, ?, ?, ?, ?, 'open')`,
      [employer_name.trim(), phone, skill_needed.trim(), location.trim(), wage, date]
    );

    // Count matching available workers
    const matches = await db.allAsync(
      `SELECT COUNT(*) as count FROM workers
       WHERE LOWER(skill_type) = LOWER(?) AND LOWER(location) = LOWER(?) AND available = 1`,
      [skill_needed.trim(), location.trim()]
    );

    const matchCount = (matches && matches[0]) ? matches[0].count : 0;

    return {
      success: true,
      job_id: result.lastID,
      employer_name,
      skill_needed,
      location,
      wage_offered: wage,
      date_needed: date,
      available_workers_in_area: matchCount,
      message: `Job posted successfully with ID ${result.lastID}. We found ${matchCount} available ${skill_needed} worker(s) in ${location}.`
    };
  } catch (err) {
    console.error('Error in postUrgentJob tool:', err.message);
    return { success: false, error: 'Database error posting job.' };
  }
}

/**
 * Tool 6: request_human_escalation
 * Called when user explicitly asks for human support or has an unresolvable issue.
 */
async function requestHumanEscalation({ call_sid, reason, caller_phone }) {
  const humanNumber = process.env.HUMAN_TRANSFER_NUMBER || '+919900112233';
  console.log(`📞 [Voice Escalation] Transfer requested for call ${call_sid || 'unknown'}: "${reason || 'Caller requested support'}"`);

  if (call_sid) {
    await db.updateVoiceCall({
      callSid: call_sid,
      status: 'escalated',
      escalatedToHuman: true,
      summary: reason || 'Caller requested human agent'
    });
  }

  return {
    escalate: true,
    transfer_number: humanNumber,
    message: 'I am transferring you to a human support coordinator now. Please stay on the line.'
  };
}

// Tool Registry Mapping
const tools = {
  lookup_caller: lookupCaller,
  get_open_jobs: getOpenJobs,
  toggle_worker_availability: toggleWorkerAvailability,
  check_job_application_status: checkJobApplicationStatus,
  post_urgent_job: postUrgentJob,
  request_human_escalation: requestHumanEscalation
};

/**
 * Central dispatcher for ElevenLabs tool calls
 */
async function executeTool(toolName, parameters = {}) {
  const handler = tools[toolName];
  if (!handler) {
    console.warn(`[Voice Tools] Unknown tool requested: ${toolName}`);
    return { error: `Tool ${toolName} is not recognized.` };
  }

  try {
    console.log(`⚙️ [Voice Tools] Executing tool "${toolName}" with args:`, JSON.stringify(parameters));
    const result = await handler(parameters);
    console.log(`✓ [Voice Tools] Result for "${toolName}":`, JSON.stringify(result));
    return result;
  } catch (err) {
    console.error(`❌ [Voice Tools] Error executing "${toolName}":`, err.message);
    return { error: `Execution error in ${toolName}: ${err.message}` };
  }
}

module.exports = {
  tools,
  executeTool,
  lookupCaller,
  getOpenJobs,
  toggleWorkerAvailability,
  checkJobApplicationStatus,
  postUrgentJob,
  requestHumanEscalation
};
