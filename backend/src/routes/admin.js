import { Router } from "express";
import { query, pool } from "../db.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { isEduEmail } from "../utils/email.js";
import { ledger, adjustPendingEarnings } from "../services/wallet.js";

const router = Router();
router.use(authMiddleware, requireRole("admin"));

router.get("/analytics", async (_req, res) => {
  const { rows: u } = await query(`SELECT COUNT(*)::int AS c FROM users`);
  const { rows: t } = await query(`SELECT COUNT(*)::int AS c FROM tasks`);
  const { rows: tr } = await query(`SELECT COUNT(*)::int AS c FROM wallet_ledger`);
  const { rows: open } = await query(`SELECT COUNT(*)::int AS c FROM tasks WHERE status = 'open'`);
  const { rows: prog } = await query(`SELECT COUNT(*)::int AS c FROM tasks WHERE status = 'in_progress'`);
  const { rows: done } = await query(`SELECT COUNT(*)::int AS c FROM tasks WHERE status = 'completed'`);
  const { rows: vol } = await query(
    `SELECT COALESCE(SUM(amount_inr),0)::numeric AS s FROM wallet_ledger WHERE type IN ('deposit','escrow_release')`
  );
  res.json({
    totalUsers: u[0].c,
    totalTasks: t[0].c,
    totalLedgerEvents: tr[0].c,
    tasksOpen: open[0].c,
    tasksInProgress: prog[0].c,
    tasksCompleted: done[0].c,
    approximateVolumeInr: Number(vol[0].s),
  });
});

router.get("/users", async (_req, res) => {
  const { rows } = await query(
    `SELECT id, email, role, name, blocked, created_at FROM users ORDER BY created_at DESC LIMIT 500`
  );
  res.json({ users: rows });
});

router.patch("/users/:id", async (req, res) => {
  const { blocked, role, name } = req.body;
  const fields = [];
  const vals = [];
  let i = 1;
  if (blocked !== undefined) {
    fields.push(`blocked = $${i++}`);
    vals.push(!!blocked);
  }
  if (role !== undefined) {
    if (!["client", "student", "admin"].includes(role)) return res.status(400).json({ error: "Bad role" });
    fields.push(`role = $${i++}`);
    vals.push(role);
  }
  if (name !== undefined) {
    fields.push(`name = $${i++}`);
    vals.push(name);
  }
  if (!fields.length) return res.status(400).json({ error: "Nothing to update" });
  vals.push(req.params.id);
  await query(`UPDATE users SET ${fields.join(", ")}, updated_at = NOW() WHERE id = $${i}`, vals);
  res.json({ ok: true });
});

router.delete("/users/:id", async (req, res) => {
  await query(`DELETE FROM users WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

router.get("/tasks", async (_req, res) => {
  const { rows } = await query(`SELECT * FROM tasks ORDER BY created_at DESC LIMIT 500`);
  res.json({ tasks: rows });
});

router.patch("/tasks/:id", async (req, res) => {
  const { title, description, category, budget_inr, status, featured } = req.body;
  const fields = [];
  const vals = [];
  let i = 1;
  for (const [k, v] of Object.entries({
    title,
    description,
    category,
    budget_inr,
    status,
    featured,
  })) {
    if (v !== undefined) {
      fields.push(`${k} = $${i++}`);
      vals.push(v);
    }
  }
  if (!fields.length) return res.status(400).json({ error: "Nothing to update" });
  vals.push(req.params.id);
  await query(`UPDATE tasks SET ${fields.join(", ")}, updated_at = NOW() WHERE id = $${i}`, vals);
  res.json({ ok: true });
});

router.delete("/tasks/:id", async (req, res) => {
  await query(`DELETE FROM tasks WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

router.get("/bids", async (_req, res) => {
  const { rows } = await query(`SELECT * FROM bids ORDER BY created_at DESC LIMIT 500`);
  res.json({ bids: rows });
});

router.delete("/bids/:id", async (req, res) => {
  await query(`DELETE FROM bids WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

router.get("/reports", async (_req, res) => {
  const { rows } = await query(`SELECT * FROM reports ORDER BY created_at DESC`);
  res.json({ reports: rows });
});

router.post("/reports/:id/resolve", async (req, res) => {
  const { status } = req.body;
  if (!["approved", "rejected"].includes(status)) return res.status(400).json({ error: "Bad status" });
  await query(`UPDATE reports SET status = $1 WHERE id = $2`, [status, req.params.id]);
  res.json({ ok: true });
});

router.get("/transactions", async (_req, res) => {
  const { rows } = await query(`SELECT * FROM wallet_ledger ORDER BY created_at DESC LIMIT 500`);
  res.json({ entries: rows });
});

router.get("/withdrawals", async (_req, res) => {
  const { rows } = await query(`SELECT * FROM withdrawals ORDER BY created_at DESC`);
  res.json({ withdrawals: rows });
});

router.patch("/withdrawals/:id", async (req, res) => {
  const { status } = req.body;
  if (!["pending", "processing", "completed", "failed"].includes(status)) {
    return res.status(400).json({ error: "Bad status" });
  }
  await query(`UPDATE withdrawals SET status = $1 WHERE id = $2`, [status, req.params.id]);
  res.json({ ok: true });
});

router.get("/disputes", async (_req, res) => {
  const { rows } = await query(`SELECT * FROM disputes ORDER BY created_at DESC`);
  res.json({ disputes: rows });
});

router.post("/disputes/:id/resolve", async (req, res) => {
  const { status, resolution_notes } = req.body;
  if (!status) return res.status(400).json({ error: "Missing status" });
  await query(`UPDATE disputes SET status = $1, resolution_notes = $2 WHERE id = $3`, [
    status,
    resolution_notes || null,
    req.params.id,
  ]);
  res.json({ ok: true });
});

router.post("/promote-admin", async (req, res) => {
  const { email } = req.body;
  if (!email || !isEduEmail(email)) {
    return res.status(400).json({ error: "Admin promotions require .edu / .ac.in email" });
  }
  await query(`UPDATE users SET role = 'admin' WHERE email = $1`, [email.toLowerCase().trim()]);
  res.json({ ok: true });
});

/* ── Release payment to either client or student ── */
router.post("/tasks/:id/release-payment", async (req, res) => {
  const { release_to } = req.body; // "client" or "student"
  if (!["client", "student"].includes(release_to)) {
    return res.status(400).json({ error: 'release_to must be "client" or "student"' });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Lock the task
    const { rows: tr } = await client.query(
      `SELECT * FROM tasks WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (!tr.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Task not found" });
    }
    const task = tr[0];
    if (task.status !== "in_progress") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Task is not in_progress" });
    }

    // 2. Find held escrow
    const { rows: esc } = await client.query(
      `SELECT * FROM escrow_holds WHERE task_id = $1 AND status = 'held' FOR UPDATE`,
      [task.id]
    );
    if (!esc.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No held escrow for this task" });
    }
    const hold = esc[0];
    const amount = Number(hold.amount_inr);

    if (release_to === "student") {
      // Pay the student
      const studentId = task.assigned_student_id;
      await ledger(client, studentId, {
        amount_inr: amount,
        amount_cc: amount * 10,
        type: "escrow_release",
        reference_type: "task",
        reference_id: task.id,
        note: `Admin released payment for "${task.title}"`,
      });
      await adjustPendingEarnings(client, studentId, -amount);
      await client.query(
        `UPDATE tasks SET status = 'completed', updated_at = NOW() WHERE id = $1`,
        [task.id]
      );
    } else {
      // Refund the client
      await ledger(client, task.client_id, {
        amount_inr: amount,
        type: "escrow_refund",
        reference_type: "task",
        reference_id: task.id,
        note: `Admin refunded escrow for "${task.title}"`,
      });
      // Remove student's pending earnings
      if (task.assigned_student_id) {
        await adjustPendingEarnings(client, task.assigned_student_id, -amount);
      }
      await client.query(
        `UPDATE tasks SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
        [task.id]
      );
    }

    // Mark escrow as released
    await client.query(
      `UPDATE escrow_holds SET status = 'released', released_at = NOW() WHERE id = $1`,
      [hold.id]
    );
    await client.query("COMMIT");

    res.json({ ok: true, released_to: release_to, amount_inr: amount });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ error: "Release payment failed" });
  } finally {
    client.release();
  }
});

export default router;
