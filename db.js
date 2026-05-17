const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.connect()
    .then(() => console.log('[DB] Conectado a Supabase PostgreSQL'))
    .catch(err => console.error('[DB] Error:', err.message));

module.exports = pool;