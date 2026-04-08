import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

import { query } from "./db.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import taskRoutes from "./routes/tasks.js";
import walletRoutes from "./routes/wallet.js";
import notifRoutes from "./routes/notifications.js";
import reviewRoutes from "./routes/reviews.js";
import chatRoutes from "./routes/chat.js";
import adminRoutes from "./routes/admin.js";
import reportRoutes from "./routes/reports.js";
import dashboardRoutes from "./routes/dashboard.js";
import disputeRoutes from "./routes/disputes.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

async function ensureDbEnums() {
  // Keep runtime compatible with existing DBs when enum values evolve.
  // Safe to run on every boot; IF NOT EXISTS prevents errors.
  try {
    await query(`ALTER TYPE ledger_type ADD VALUE IF NOT EXISTS 'escrow_refund'`);
  } catch (e) {
    // If DB isn't ready or enum doesn't exist yet, don't block startup here.
    // The API will still surface DB errors on first use.
    console.warn("DB enum check skipped:", e?.message || e);
  }
}

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(uploadDir));

const limiter = rateLimit({ windowMs: 60_000, max: 200 });
app.use("/api/", limiter);

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "CampusKart API" }));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/notifications", notifRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/disputes", disputeRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT || 4000);
ensureDbEnums().finally(() => {
  app.listen(port, () => {
    console.log(`CampusKart API listening on :${port}`);
  });
});
