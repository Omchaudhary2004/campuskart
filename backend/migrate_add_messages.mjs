// Adds `messages` JSONB column to tasks table for built-in chat
import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query(`
    ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS messages JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
  console.log("✅ Added messages column to tasks table");
} catch (e) {
  console.error("❌ Migration failed:", e.message);
} finally {
  await pool.end();
}
