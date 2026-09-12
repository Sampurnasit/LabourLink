const sqlite3 = require('sqlite3').verbose();
const path = require('path');

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
        registered_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, (err) => {
        if (err) return reject(err);
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
        console.log('Database tables initialized: workers, jobs, job_interests.');
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

module.exports = db;
