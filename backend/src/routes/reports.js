import { Router } from "express";
import { query } from "../db.js";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();

router.post("/", authMiddleware, async (req, res) => {
  const { entity_type, entity_id, reason } = req.body;
  if (!entity_type || !entity_id || !reason) {
    return res.status(400).json({ error: "Missing fields" });
  }
  try {
    const { rows } = await query(
      `INSERT INTO reports (reporter_id, entity_type, entity_id, reason) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.user.id, entity_type, entity_id, reason]
    );
    res.status(201).json({ report: rows[0] });
  } catch (e) {
    console.error("[reports] DB error:", e.message);
    if (e.message?.includes("relation \"reports\" does not exist")) {
      return res.status(500).json({ error: "Reports table not found. Run the schema SQL on the database." });
    }
    res.status(500).json({ error: e.message || "Report failed" });
  }
});

export default router;
