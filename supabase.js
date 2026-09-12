require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('⚠️ Warning: SUPABASE_URL or SUPABASE_ANON_KEY not set in .env');
}

const supabase = createClient(supabaseUrl || '', supabaseKey || '');

// Test connection on load
async function testConnection() {
  try {
    const { data, error } = await supabase.from('workers').select('id').limit(1);
    if (error) {
      console.error('❌ Supabase connection error:', error.message);
    } else {
      console.log('✅ Connected to Supabase successfully at:', supabaseUrl);
    }
  } catch (err) {
    console.error('❌ Failed to reach Supabase:', err.message);
  }
}

testConnection();

module.exports = supabase;
