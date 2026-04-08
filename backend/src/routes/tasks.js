import { Router } from "express";
import { query, pool } from "../db.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { notify } from "../services/notify.js";
import { getBalance, ledger, adjustPendingEarnings } from "../services/wallet.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const {
      q = "",
      category = "",
      minBudget,
      maxBudget,
      featured,
      page = "1",
      limit = "24",
    } = req.query;
    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 24));
    const offset = (p - 1) * l;
    const conds = [`t.status = 'open'`];
    const params = [];
    let i = 1;
    if (q) {
      conds.push(
        `(t.title ILIKE $${i} OR t.description ILIKE $${i} OR EXISTS (SELECT 1 FROM unnest(t.tags) tag WHERE tag ILIKE $${i}))`
      );
      params.push(`%${q}%`);
      i++;
    }
    if (category) {
      conds.push(`t.category = $${i}`);
      params.push(category);
      i++;
    }
    if (minBudget !== undefined && minBudget !== "") {
      conds.push(`t.budget_inr >= $${i}`);
      params.push(Number(minBudget));
      i++;
    }
    if (maxBudget !== undefined && maxBudget !== "") {
      conds.push(`t.budget_inr <= $${i}`);
      params.push(Number(maxBudget));
      i++;
    }
    if (featured === "true") {
      conds.push(`t.featured = TRUE`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const countQ = `SELECT COUNT(*)::int AS c FROM tasks t ${where}`;
    const { rows: cr } = await query(countQ, params);
    const listQ = `
      SELECT t.*, u.name AS client_name, u.avatar_url AS client_avatar
      FROM tasks t
      JOIN users u ON u.id = t.client_id
      ${where}
      ORDER BY t.featured DESC, t.created_at DESC
      LIMIT $${i} OFFSET $${i + 1}
    `;
    params.push(l, offset);
    const { rows } = await query(listQ, params);
    res.json({ tasks: rows, total: cr[0].c, page: p, limit: l });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to list tasks" });
  }
});

router.get("/categories", async (_req, res) => {
  const { rows } = await query(
    `SELECT DISTINCT category FROM tasks WHERE status = 'open' ORDER BY category`
  );
  res.json({ categories: rows.map((r) => r.category) });
});

router.get("/mine/posted", authMiddleware, async (req, res) => {
  const { rows } = await query(`SELECT * FROM tasks WHERE client_id = $1 ORDER BY created_at DESC`, [
    req.user.id,
  ]);
  res.json({ tasks: rows });
});

router.get("/mine/assigned", authMiddleware, async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM tasks WHERE assigned_student_id = $1 ORDER BY updated_at DESC`,
    [req.user.id]
  );
  res.json({ tasks: rows });
});

router.get("/mine/completed", authMiddleware, async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM tasks WHERE status = 'completed' AND (client_id = $1 OR assigned_student_id = $1) ORDER BY updated_at DESC`,
    [req.user.id]
  );
  res.json({ tasks: rows });
});

router.get("/:id", async (req, res) => {
  const { rows } = await query(
    `SELECT t.*, u.name AS client_name, u.avatar_url AS client_avatar, u.id AS client_user_id
     FROM tasks t JOIN users u ON u.id = t.client_id WHERE t.id = $1`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Task not found" });
  const task = rows[0];
  const { rows: atts } = await query(`SELECT * FROM task_attachments WHERE task_id = $1`, [
    req.params.id,
  ]);
  const { rows: bids } = await query(
    `SELECT b.*, u.name AS student_name, u.avatar_url AS student_avatar
     FROM bids b JOIN users u ON u.id = b.student_id WHERE b.task_id = $1 ORDER BY b.created_at DESC`,
    [req.params.id]
  );
  res.json({ task, attachments: atts, bids });
});

router.post("/", authMiddleware, requireRole("client", "admin"), async (req, res) => {
  try {
    const { title, description, category, budget_inr, tags = [], image_url, attachments = [] } =
      req.body;
    if (!title || !description || !category || budget_inr == null || !image_url) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const clientId = req.user.role === "admin" ? req.body.client_id || req.user.id : req.user.id;
    const { rows } = await query(
      `INSERT INTO tasks (client_id, title, description, category, budget_inr, tags, image_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [clientId, title, description, category, Number(budget_inr), tags, image_url]
    );
    const task = rows[0];
    for (const a of attachments) {
      if (a?.url) {
        await query(`INSERT INTO task_attachments (task_id, url, label) VALUES ($1,$2,$3)`, [
          task.id,
          a.url,
          a.label || null,
        ]);
      }
    }
    res.status(201).json({ task });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create task" });
  }
});

router.delete("/:id", authMiddleware, async (req, res) => {
  const { rows } = await query(`SELECT * FROM tasks WHERE id = $1`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  const t = rows[0];
  if (t.client_id !== req.user.id && req.user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (t.status !== "open") {
    return res.status(400).json({ error: "Only open tasks can be deleted" });
  }
  await query(`DELETE FROM tasks WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

router.post("/:id/bids", authMiddleware, requireRole("student", "admin"), async (req, res) => {
  try {
    const { amount_inr, proposal } = req.body;
    if (amount_inr == null || !proposal) return res.status(400).json({ error: "Missing bid data" });
    const { rows: tr } = await query(`SELECT * FROM tasks WHERE id = $1`, [req.params.id]);
    if (!tr.length) return res.status(404).json({ error: "Task not found" });
    const task = tr[0];
    if (task.status !== "open") return res.status(400).json({ error: "Task not open for bids" });
    const studentId = req.user.id;
    const { rows } = await query(
      `INSERT INTO bids (task_id, student_id, amount_inr, proposal) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, studentId, Number(amount_inr), proposal]
    );
    await notify(task.client_id, "bid_placed", "New bid on your task", `${req.user.name} bid ₹${amount_inr}`, {
      taskId: task.id,
      bidId: rows[0].id,
    });
    res.status(201).json({ bid: rows[0] });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "You already bid on this task" });
    console.error(e);
    res.status(500).json({ error: "Bid failed" });
  }
});

router.post("/:id/bids/:bidId/accept", authMiddleware, requireRole("client", "admin"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: tr } = await client.query(`SELECT * FROM tasks WHERE id = $1 FOR UPDATE`, [
      req.params.id,
    ]);
    if (!tr.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Task not found" });
    }
    const task = tr[0];
    if (req.user.role !== "admin" && task.client_id !== req.user.id) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Forbidden" });
    }
    if (task.status !== "open") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Task not open" });
    }
    const { rows: br } = await client.query(`SELECT * FROM bids WHERE id = $1 AND task_id = $2`, [
      req.params.bidId,
      req.params.id,
    ]);
    if (!br.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Bid not found" });
    }
    const bid = br[0];
    const amount = Number(bid.amount_inr);
    const bal = await getBalance(client, task.client_id);
    if (Number(bal.balance_inr) < amount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Insufficient wallet balance. Add funds via Paytm first." });
    }
    await ledger(client, task.client_id, {
      amount_inr: -amount,
      type: "escrow_lock",
      reference_type: "task",
      reference_id: task.id,
      note: `Escrow for task ${task.title}`,
    });
    await client.query(
      `INSERT INTO escrow_holds (task_id, client_id, amount_inr, status) VALUES ($1,$2,$3,'held')`,
      [task.id, task.client_id, amount]
    );
    await client.query(
      `UPDATE bids SET status = 'rejected' WHERE task_id = $1 AND id <> $2 AND status = 'pending'`,
      [task.id, bid.id]
    );
    await client.query(`UPDATE bids SET status = 'accepted' WHERE id = $1`, [bid.id]);
    await client.query(
      `UPDATE tasks SET status = 'in_progress', assigned_student_id = $2, accepted_bid_id = $3 WHERE id = $1`,
      [task.id, bid.student_id, bid.id]
    );
    await adjustPendingEarnings(client, bid.student_id, amount);
    await client.query("COMMIT");
    await notify(bid.student_id, "bid_accepted", "Your bid was accepted", `Task: ${task.title}`, {
      taskId: task.id,
    });
    await notify(task.client_id, "bid_accepted", "Bid accepted", `Assigned ${bid.student_id}`, {
      taskId: task.id,
    });
    res.json({ ok: true, taskId: task.id, assignedStudentId: bid.student_id });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ error: "Accept failed" });
  } finally {
    client.release();
  }
});

router.post("/:id/complete", authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: tr } = await client.query(`SELECT * FROM tasks WHERE id = $1 FOR UPDATE`, [
      req.params.id,
    ]);
    if (!tr.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Not found" });
    }
    const task = tr[0];
    if (task.status !== "in_progress") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Task not in progress" });
    }
    const uid = req.user.id;
    const okUser =
      task.client_id === uid ||
      task.assigned_student_id === uid ||
      req.user.role === "admin";
    if (!okUser) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Forbidden" });
    }
    const { rows: esc } = await client.query(
      `SELECT * FROM escrow_holds WHERE task_id = $1 AND status = 'held' FOR UPDATE`,
      [task.id]
    );
    if (!esc.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No escrow record" });
    }
    const hold = esc[0];
    const amount = Number(hold.amount_inr);
    const studentId = task.assigned_student_id;
    await ledger(client, studentId, {
      amount_inr: amount,
      amount_cc: amount * 10,
      type: "escrow_release",
      reference_type: "task",
      reference_id: task.id,
      note: `Payment for ${task.title}`,
    });
    await adjustPendingEarnings(client, studentId, -amount);
    await client.query(`UPDATE escrow_holds SET status = 'released', released_at = NOW() WHERE id = $1`, [
      hold.id,
    ]);
    await client.query(`UPDATE tasks SET status = 'completed', updated_at = NOW() WHERE id = $1`, [
      task.id,
    ]);
    const { rows: bidRows } = await client.query(`SELECT proposal FROM bids WHERE id = $1`, [
      task.accepted_bid_id,
    ]);
    const proposal = bidRows[0]?.proposal || "";
    await client.query(
      `INSERT INTO resume_items (user_id, item_type, title, description, proficiency, link, from_task_id)
       VALUES ($1,'skill',$2,$3,$4,$5,$6)`,
      [
        studentId,
        `Delivered: ${task.title}`,
        proposal.slice(0, 2000),
        "Project",
        null,
        task.id,
      ]
    );
    await client.query("COMMIT");
    await notify(studentId, "task_completed", "Task completed", `Payment released for ${task.title}`, {
      taskId: task.id,
    });
    await notify(task.client_id, "payment_released", "Payment released", `Task "${task.title}" marked complete`, {
      taskId: task.id,
    });
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ error: "Complete failed" });
  } finally {
    client.release();
  }
});

/* ── Built-in chat ─────────────────────────────────────── */
router.get("/:id/messages", authMiddleware, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT messages, client_id, assigned_student_id, status FROM tasks WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Task not found" });
    const task = rows[0];
    const uid = req.user.id;
    const allowed =
      task.client_id === uid ||
      task.assigned_student_id === uid ||
      req.user.role === "admin";
    if (!allowed) return res.status(403).json({ error: "Not a participant of this task" });
    if (task.status !== "in_progress" && task.status !== "completed") {
      return res.status(400).json({ error: "Chat only available for in-progress or completed tasks" });
    }
    res.json({ messages: task.messages || [] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

router.post("/:id/messages", authMiddleware, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: "Message is required" });
    }
    const { rows } = await query(
      `SELECT client_id, assigned_student_id, status FROM tasks WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Task not found" });
    const task = rows[0];
    const uid = req.user.id;
    const allowed =
      task.client_id === uid ||
      task.assigned_student_id === uid ||
      req.user.role === "admin";
    if (!allowed) return res.status(403).json({ error: "Not a participant of this task" });
    if (task.status !== "in_progress") {
      return res.status(400).json({ error: "Chat only available for in-progress tasks" });
    }
    const newMsg = {
      uid: req.user.id,
      name: req.user.name,
      message: String(message).trim().slice(0, 2000),
      timestamp: new Date().toISOString(),
    };
    const { rows: updated } = await query(
      `UPDATE tasks SET messages = messages || $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING messages`,
      [JSON.stringify([newMsg]), req.params.id]
    );
    res.status(201).json({ message: newMsg, messages: updated[0].messages });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to send message" });
  }
});

export default router;
