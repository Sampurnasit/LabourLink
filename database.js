require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Initialize Supabase client
const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || '').trim();

let supabase = null;
let isSupabaseConfigured = false;

if (supabaseUrl && supabaseAnonKey && supabaseUrl.startsWith('http')) {
  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
    isSupabaseConfigured = true;
    console.log(`Connected to Supabase PostgreSQL at: ${supabaseUrl}`);
  } catch (err) {
    console.error('Error initializing Supabase client:', err.message);
  }
} else {
  console.log('Running in local SQLite mode (Supabase not configured in .env)');
}

const dbPath = path.resolve(__dirname, 'labourlink.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to the SQLite database:', dbPath);
  }
});

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON');

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

      // 4. worker_cv table (Structured CV data, not file uploads)
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

      // 5. worker_ratings table (1-5 stars with comments, preventing duplicate job ratings)
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
        console.log('Database tables initialized: workers, jobs, job_interests, worker_cv, worker_ratings.');
        resolve();
      });
    });
  });
}

// Immediately ensure schema is created
initSchema().catch((err) => {
  console.error('Failed to initialize schema:', err);
});

// Promisified query helper functions
db.runAsync = function (sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

db.getAsync = function (sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

db.allAsync = function (sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

db.initSchema = initSchema;
db.supabase = supabase;
db.isSupabaseConfigured = isSupabaseConfigured;

// Helper to sync local records to Supabase cloud
db.syncToSupabase = async function() {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, message: 'Supabase is not configured' };
  }
  try {
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
  } catch (err) {
    return { success: false, error: err.message };
  }
};

module.exports = db;
module.exports.supabase = supabase;
module.exports.isSupabaseConfigured = isSupabaseConfigured;
