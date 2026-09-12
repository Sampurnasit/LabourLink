require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
let Pool;
try {
  Pool = require('pg').Pool;
} catch (_) {
  Pool = null;
}

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
        reason TEXT,
        rejected_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
        FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE,
        UNIQUE (job_id, worker_id)
      )`, (err) => {
        if (err) return reject(err);
        // Safely add columns if upgrading existing table
        db.run(`ALTER TABLE job_interests ADD COLUMN reason TEXT`, () => {});
        db.run(`ALTER TABLE job_interests ADD COLUMN rejected_at DATETIME`, () => {});
      });

      // 3b. job_rejections table (Job-scoped rejection tracking)
      db.run(`CREATE TABLE IF NOT EXISTS job_rejections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hirer_phone TEXT,
        job_id INTEGER NOT NULL,
        worker_id INTEGER NOT NULL,
        reason TEXT,
        rejected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
        FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE,
        UNIQUE (job_id, worker_id)
      )`, (err) => {
        if (err) return reject(err);
        db.run(`CREATE INDEX IF NOT EXISTS idx_job_rejections_job_worker ON job_rejections (job_id, worker_id)`, () => {});
        db.run(`CREATE INDEX IF NOT EXISTS idx_job_rejections_hirer_job ON job_rejections (hirer_phone, job_id)`, () => {});
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
        console.log('Database tables initialized: workers, jobs, job_interests, job_rejections, worker_cv, worker_ratings.');
        resolve();
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

module.exports = db;
module.exports.supabase = supabase;
module.exports.pgPool = pgPool;
module.exports.withRetry = withRetry;
module.exports.isSupabaseConfigured = isSupabaseConfigured;
module.exports.isConfigured = isSupabaseConfigured;
