require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { Pool } = require('pg');

// ==========================================================================
// 1. CONNECTION STRING INSPECTION & POOLER CONFIGURATION (Ports 5432 vs 6543)
// ==========================================================================
let rawDatabaseUrl = (process.env.DATABASE_URL || '').trim();
let databaseUrl = rawDatabaseUrl;
let connectionType = 'none'; // 'pooler', 'direct', 'supabase_rest', or 'sqlite'
let poolerPort = null;

if (rawDatabaseUrl) {
  try {
    const parsed = new URL(rawDatabaseUrl.replace(/^postgresql:\/\//, 'http://'));
    poolerPort = parsed.port;

    if (poolerPort === '5432') {
      connectionType = 'direct';
      console.warn('⚠️ [Supabase DB] WARNING: DATABASE_URL is using Port 5432 (Direct PostgreSQL connection).');
      console.warn('   Direct connections have a strict connection limit and drop under concurrent queries.');
      console.warn('   👉 Recommendation: Switch to the Supabase Connection Pooler on Port 6543 (Transaction Mode).');
      
      // Auto-upgrade to pooler port if pointing to pooler.supabase.com
      if (rawDatabaseUrl.includes('pooler.supabase.com')) {
        console.log('🔄 [Supabase DB] Auto-optimizing connection to Supavisor Pooler on Port 6543...');
        databaseUrl = rawDatabaseUrl.replace(':5432', ':6543');
        if (!databaseUrl.includes('pgbouncer=true')) {
          databaseUrl += (databaseUrl.includes('?') ? '&' : '?') + 'pgbouncer=true';
        }
        connectionType = 'pooler';
      }
    } else if (poolerPort === '6543') {
      connectionType = 'pooler';
      console.log('✅ [Supabase DB] Connection pooler detected on Port 6543 (Supavisor Transaction Mode).');
    } else {
      connectionType = `custom_port_${poolerPort}`;
    }
  } catch (err) {
    console.warn('⚠️ [Supabase DB] Could not parse DATABASE_URL port:', err.message);
  }
}

// ==========================================================================
// 2. RETRY WRAPPER FOR TRANSIENT NETWORK BLIPS
// ==========================================================================
/**
 * Automatically retries an async database operation when a transient
 * network error (ECONNRESET, ETIMEDOUT, socket hang up, etc.) occurs.
 */
async function withRetry(operation, maxRetries = 3, initialDelayMs = 500) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      const errMsg = (err.message || '').toLowerCase();
      const isTransient =
        errMsg.includes('connection') ||
        errMsg.includes('timeout') ||
        errMsg.includes('econnreset') ||
        errMsg.includes('etimedout') ||
        errMsg.includes('econnrefused') ||
        errMsg.includes('socket hang up') ||
        errMsg.includes('terminated') ||
        errMsg.includes('closed') ||
        errMsg.includes('503') ||
        errMsg.includes('502') ||
        errMsg.includes('504') ||
        errMsg.includes('remaining connection slots') ||
        errMsg.includes('tenant') ||
        errMsg.includes('pool');

      if (attempt < maxRetries && isTransient) {
        const delay = initialDelayMs * Math.pow(2, attempt - 1);
        console.warn(`⚠️ [DB Retry] Query attempt ${attempt} failed with: "${err.message}". Retrying in ${delay}ms...`);
        await new Promise((res) => setTimeout(res, delay));
      } else {
        break;
      }
    }
  }
  throw lastError;
}

// ==========================================================================
// 3. POSTGRESQL CONNECTION POOL (pg.Pool) WITH ERROR HANDLING
// ==========================================================================
let pgPool = null;

if (databaseUrl) {
  try {
    pgPool = new Pool({
      connectionString: databaseUrl,
      max: 10,                      // Maximum active connections in pool
      idleTimeoutMillis: 30000,     // Close idle clients after 30 seconds
      connectionTimeoutMillis: 10000,// Timeout when acquiring a connection
      ssl: { rejectUnauthorized: false }
    });

    // ⭐️ CRITICAL REQUIREMENT: Error handling on pool's 'error' event
    // Prevents unhandled idle client errors from crashing the Node.js server.
    pgPool.on('error', (err, client) => {
      console.error('⚠️ [Postgres Pool Error] Unexpected idle client error:', err.message || err);
      // The pg.Pool automatically evicts the dropped client and creates a fresh one on the next query.
    });

    pgPool.on('connect', () => {
      // Client connected to pool
    });

    console.log(`✅ [Postgres Pool] Initialized connection pool for: ${databaseUrl.replace(/:[^:@]+@/, ':****@')}`);
  } catch (err) {
    console.error('❌ [Postgres Pool] Failed to initialize pg.Pool:', err.message);
  }
}

// ==========================================================================
// 4. SUPABASE REST CLIENT (Singleton Instance)
// ==========================================================================
const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || '').trim();

let supabase = null;
let isSupabaseConfigured = false;

if (supabaseUrl && supabaseAnonKey && supabaseUrl.startsWith('http')) {
  try {
    // Single shared singleton client for entire application lifecycle
    supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      db: { schema: 'public' }
    });
    isSupabaseConfigured = true;
    if (!databaseUrl) connectionType = 'supabase_rest';
    console.log(`✅ [Supabase Client] Connected to Supabase REST API at: ${supabaseUrl}`);
  } catch (err) {
    console.error('❌ [Supabase Client] Error initializing client:', err.message);
  }
} else if (!databaseUrl) {
  connectionType = 'sqlite';
  console.log('ℹ️ Running in local SQLite mode (Supabase not configured in .env)');
}

// ==========================================================================
// 5. LOCAL SQLITE DATABASE (Fallback & Storage)
// ==========================================================================
const dbPath = path.resolve(__dirname, 'labourlink.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to the SQLite database:', dbPath);
  }
});

// Initialize database schema according to LabourLink specifications
function initSchema() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // 1. workers table
      db.run(`CREATE TABLE IF NOT EXISTS workers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone_number TEXT UNIQUE NOT NULL,
        skill_type TEXT NOT NULL,
        location TEXT NOT NULL,
        available BOOLEAN DEFAULT 1,
        status TEXT DEFAULT 'AVAILABLE',
        current_active_job_id INTEGER DEFAULT NULL,
        current_location_zone TEXT DEFAULT NULL,
        registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (current_active_job_id) REFERENCES jobs(id) ON DELETE SET NULL
      )`, (err) => {
        if (err) return reject(err);
      });

      // Safe column migrations for existing databases
      const workerCols = [
        "ALTER TABLE workers ADD COLUMN status TEXT DEFAULT 'AVAILABLE'",
        "ALTER TABLE workers ADD COLUMN current_active_job_id INTEGER DEFAULT NULL",
        "ALTER TABLE workers ADD COLUMN current_location_zone TEXT DEFAULT NULL"
      ];
      workerCols.forEach(cmd => {
        db.run(cmd, () => {}); // Ignore error if column already exists
      });

      // 2. jobs table
      db.run(`CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employer_name TEXT NOT NULL,
        employer_phone TEXT NOT NULL,
        skill_needed TEXT NOT NULL,
        location TEXT NOT NULL,
        wage_offered TEXT NOT NULL,
        date_needed TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, (err) => {
        if (err) return reject(err);
      });

      // 3. job_interests table
      db.run(`CREATE TABLE IF NOT EXISTS job_interests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL,
        worker_id INTEGER NOT NULL,
        status TEXT DEFAULT 'interested',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
        FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE,
        UNIQUE (job_id, worker_id)
      )`, (err) => {
        if (err) return reject(err);
      });

      // 4. worker_cv table
      db.run(`CREATE TABLE IF NOT EXISTS worker_cv (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        worker_id INTEGER UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        dob_or_age TEXT,
        phone_number TEXT,
        skills TEXT,
        years_of_experience INTEGER DEFAULT 0,
        previous_work TEXT,
        work_location TEXT,
        daily_wage_expectation TEXT,
        availability_type TEXT,
        languages TEXT,
        about_me TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE
      )`, (err) => {
        if (err) return reject(err);
      });

      // 5. worker_ratings table
      db.run(`CREATE TABLE IF NOT EXISTS worker_ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        worker_id INTEGER NOT NULL,
        employer_phone TEXT,
        job_id INTEGER NOT NULL,
        rating REAL NOT NULL CHECK (rating >= 1.0 AND rating <= 5.0),
        comment TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE,
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
        UNIQUE (job_id, worker_id)
      )`, (err) => {
        if (err) return reject(err);

        // 6. voice_calls table (AI Call Logs & Analytics)
        db.run(`CREATE TABLE IF NOT EXISTS voice_calls (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          call_sid TEXT UNIQUE NOT NULL,
          caller_phone TEXT NOT NULL,
          caller_role TEXT DEFAULT 'guest',
          caller_name TEXT,
          duration_seconds INTEGER DEFAULT 0,
          status TEXT DEFAULT 'in-progress',
          escalated_to_human BOOLEAN DEFAULT 0,
          conversation_id TEXT,
          summary TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (voiceErr) => {
          if (voiceErr) return reject(voiceErr);
          console.log('Database tables initialized: workers, jobs, job_interests, worker_cv, worker_ratings, voice_calls.');
          resolve();
        });
      });
    });
  });
}

// Immediately ensure schema is created
initSchema().catch((err) => {
  console.error('Failed to initialize schema:', err);
});

// ==========================================================================
// 6. PROMISIFIED QUERY HELPERS WITH AUTOMATIC RETRY
// ==========================================================================
db.runAsync = function (sql, params = []) {
  return withRetry(() => {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  });
};

db.getAsync = function (sql, params = []) {
  return withRetry(() => {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  });
};

db.allAsync = function (sql, params = []) {
  return withRetry(() => {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  });
};

// Generic query wrapper with retry (works with pgPool or SQLite)
db.queryWithRetry = async function (sql, params = []) {
  return withRetry(async () => {
    if (pgPool) {
      const res = await pgPool.query(sql, params);
      return res.rows;
    }
    return db.allAsync(sql, params);
  });
};

// ==========================================================================
// 7. DIAGNOSTICS & STATUS REPORTING
// ==========================================================================
db.getDiagnostics = function () {
  return {
    connectionType,
    poolerPort: poolerPort || (connectionType === 'supabase_rest' ? '443 (HTTPS REST)' : 'N/A'),
    isPooler: poolerPort === '6543' || connectionType === 'pooler',
    isDirect5432: poolerPort === '5432',
    isSupabaseConfigured,
    supabaseUrl: supabaseUrl || null,
    hasPgPool: !!pgPool,
    pgPoolStats: pgPool ? {
      totalCount: pgPool.totalCount,
      idleCount: pgPool.idleCount,
      waitingCount: pgPool.waitingCount
    } : null,
    retryMechanismActive: true
  };
};

db.withRetry = withRetry;
db.initSchema = initSchema;
db.supabase = supabase;
db.pgPool = pgPool;
db.isSupabaseConfigured = isSupabaseConfigured;
db.isConfigured = isSupabaseConfigured;

// Helper to sync local records to Supabase cloud
db.syncToSupabase = async function() {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, message: 'Supabase is not configured' };
  }
  return withRetry(async () => {
    const workers = await db.allAsync('SELECT name, phone_number, skill_type, location, available FROM workers');
    const formattedWorkers = workers.map(w => ({
      name: w.name,
      phone_number: w.phone_number,
      skill_type: w.skill_type,
      location: w.location,
      available: w.available === 1
    }));
    await supabase.from('workers').upsert(formattedWorkers, { onConflict: 'phone_number' });

    const jobs = await db.allAsync('SELECT employer_name, employer_phone, skill_needed, location, wage_offered, date_needed, status FROM jobs');
    await supabase.from('jobs').insert(jobs);

    return { success: true, workersSynced: workers.length, jobsSynced: jobs.length };
  });
};

// ==========================================================================
// 8. VOICE CALL LOGGING & ANALYTICS HELPERS
// ==========================================================================
db.logVoiceCall = async function({ callSid, callerPhone, callerRole = 'guest', callerName = null, status = 'in-progress', conversationId = null }) {
  try {
    const sql = `INSERT INTO voice_calls (call_sid, caller_phone, caller_role, caller_name, status, conversation_id)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(call_sid) DO UPDATE SET
                   caller_phone = excluded.caller_phone,
                   caller_role = excluded.caller_role,
                   caller_name = excluded.caller_name,
                   status = excluded.status,
                   conversation_id = COALESCE(excluded.conversation_id, voice_calls.conversation_id)`;
    return await db.runAsync(sql, [callSid, callerPhone, callerRole, callerName, status, conversationId]);
  } catch (err) {
    console.error('Error logging voice call:', err.message);
  }
};

db.updateVoiceCall = async function({ callSid, durationSeconds = null, status = 'completed', escalatedToHuman = null, conversationId = null, summary = null }) {
  try {
    const sets = [];
    const params = [];
    if (durationSeconds !== null) { sets.push('duration_seconds = ?'); params.push(parseInt(durationSeconds, 10) || 0); }
    if (status !== null) { sets.push('status = ?'); params.push(status); }
    if (escalatedToHuman !== null) { sets.push('escalated_to_human = ?'); params.push(escalatedToHuman ? 1 : 0); }
    if (conversationId !== null) { sets.push('conversation_id = ?'); params.push(conversationId); }
    if (summary !== null) { sets.push('summary = ?'); params.push(summary); }

    if (sets.length === 0) return;
    params.push(callSid);

    const sql = `UPDATE voice_calls SET ${sets.join(', ')} WHERE call_sid = ?`;
    return await db.runAsync(sql, params);
  } catch (err) {
    console.error('Error updating voice call:', err.message);
  }
};

db.getVoiceCalls = async function({ limit = 50, offset = 0 } = {}) {
  try {
    const sql = `SELECT * FROM voice_calls ORDER BY id DESC LIMIT ? OFFSET ?`;
    return await db.allAsync(sql, [limit, offset]);
  } catch (err) {
    console.error('Error fetching voice calls:', err.message);
    return [];
  }
};

db.getVoiceCallStats = async function() {
  try {
    const total = (await db.getAsync('SELECT COUNT(*) as count FROM voice_calls')).count || 0;
    const completed = (await db.getAsync("SELECT COUNT(*) as count FROM voice_calls WHERE status = 'completed'")).count || 0;
    const escalated = (await db.getAsync('SELECT COUNT(*) as count FROM voice_calls WHERE escalated_to_human = 1')).count || 0;
    const avgDuration = (await db.getAsync("SELECT AVG(duration_seconds) as avg FROM voice_calls WHERE duration_seconds > 0")).avg || 0;
    return {
      totalCalls: total,
      completedCalls: completed,
      escalatedCalls: escalated,
      averageDurationSeconds: Math.round(avgDuration)
    };
  } catch (err) {
    console.error('Error fetching voice call stats:', err.message);
    return { totalCalls: 0, completedCalls: 0, escalatedCalls: 0, averageDurationSeconds: 0 };
  }
};

module.exports = db;
module.exports.supabase = supabase;
module.exports.pgPool = pgPool;
module.exports.withRetry = withRetry;
module.exports.isSupabaseConfigured = isSupabaseConfigured;
module.exports.isConfigured = isSupabaseConfigured;

