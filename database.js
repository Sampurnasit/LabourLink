require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || '').trim();

let supabase = null;
let isConfigured = false;

if (supabaseUrl && supabaseAnonKey && supabaseUrl.startsWith('http')) {
  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
    isConfigured = true;
    console.log(`Connected to Supabase project at: ${supabaseUrl}`);
  } catch (err) {
    console.error('Error initializing Supabase client:', err.message);
  }
} else {
  console.warn(
    '\n============================================================\n' +
    ' [NOTICE] Supabase credentials not found in .env!\n' +
    ' 1. Create a project at https://supabase.com\n' +
    ' 2. Run the SQL in supabase-schema.sql in the SQL Editor\n' +
    ' 3. Add to your .env:\n' +
    '    SUPABASE_URL=https://<your-project-id>.supabase.co\n' +
    '    SUPABASE_ANON_KEY=<your-anon-public-key>\n' +
    '============================================================\n'
  );

  // Safe fallback mock so server can start and display clear error in responses
  const mockQuery = () => {
    const error = new Error('Supabase not configured. Please add SUPABASE_URL and SUPABASE_ANON_KEY to .env');
    const chainable = {
      select: () => chainable,
      eq: () => chainable,
      neq: () => chainable,
      order: () => chainable,
      limit: () => chainable,
      single: () => Promise.resolve({ data: null, error }),
      maybeSingle: () => Promise.resolve({ data: null, error }),
      insert: () => chainable,
      upsert: () => chainable,
      update: () => chainable,
      delete: () => chainable,
      then: (resolve) => Promise.resolve({ data: [], error, count: 0 }).then(resolve)
    };
    return chainable;
  };

  supabase = {
    from: () => mockQuery()
  };
}

module.exports = supabase;
module.exports.supabase = supabase;
module.exports.isConfigured = isConfigured;
