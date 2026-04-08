import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../api.js";

export default function Admin() {
  const { user } = useAuth();
  const [tab, setTab] = useState("analytics");
  const [analytics, setAnalytics] = useState(null);
  const [users, setUsers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [bids, setBids] = useState([]);
  const [reports, setReports] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [disputes, setDisputes] = useState([]);
  const [msg, setMsg] = useState("");

  const refresh = async () => {
    if (user?.role !== "admin") return;
    try {
      const [a, u, t, b, r, l, w, d] = await Promise.all([
        api("/api/admin/analytics"),
        api("/api/admin/users"),
        api("/api/admin/tasks"),
        api("/api/admin/bids"),
        api("/api/admin/reports"),
        api("/api/admin/transactions"),
        api("/api/admin/withdrawals"),
        api("/api/admin/disputes"),
      ]);
      setAnalytics(a);
      setUsers(u.users || []);
      setTasks(t.tasks || []);
      setBids(b.bids || []);
      setReports(r.reports || []);
      setLedger(l.entries || []);
      setWithdrawals(w.withdrawals || []);
      setDisputes(d.disputes || []);
    } catch (e) {
      setMsg(e.data?.error || e.message);
    }
  };

  useEffect(() => {
    refresh();
  }, [user]);

  if (!user) return <Navigate to="/auth" replace />;
  if (user.role !== "admin") {
    return (
      <div className="px-4 py-20 text-center text-slate-600">
        Admin dashboard is restricted. Use an admin account with an institutional email.
      </div>
    );
  }

  const tabs = [
    "analytics",
    "users",
    "tasks",
    "bids",
    "reports",
    "transactions",
    "withdrawals",
    "disputes",
  ];

  const toggleBlock = async (id, blocked) => {
    await api(`/api/admin/users/${id}`, { method: "PATCH", body: { blocked: !blocked } });
    refresh();
  };

  const deleteUser = async (id) => {
    if (!confirm("Delete user?")) return;
    await api(`/api/admin/users/${id}`, { method: "DELETE" });
    refresh();
  };

  const toggleFeatured = async (taskId, featured) => {
    await api(`/api/admin/tasks/${taskId}`, { method: "PATCH", body: { featured: !featured } });
    refresh();
  };

  const deleteTask = async (id) => {
    if (!confirm("Delete task?")) return;
    await api(`/api/admin/tasks/${id}`, { method: "DELETE" });
    refresh();
  };

  const deleteBid = async (id) => {
    if (!confirm("Delete bid?")) return;
    await api(`/api/admin/bids/${id}`, { method: "DELETE" });
    refresh();
  };

  const resolveReport = async (id, status) => {
    await api(`/api/admin/reports/${id}/resolve`, { method: "POST", body: { status } });
    refresh();
  };

  const resolveDispute = async (id) => {
    const resolution_notes = prompt("Resolution notes?");
    await api(`/api/admin/disputes/${id}/resolve`, {
      method: "POST",
      body: { status: "resolved_client", resolution_notes },
    });
    refresh();
  };

  const updateWithdrawal = async (id, status) => {
    await api(`/api/admin/withdrawals/${id}`, { method: "PATCH", body: { status } });
    refresh();
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="font-display text-3xl font-bold text-ck-blue">Admin</h1>
      <p className="text-slate-600">Users, tasks, bids, compliance, and money movement.</p>
      {msg && <p className="mt-2 text-sm text-red-600">{msg}</p>}

      <div className="mt-6 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize ${
              tab === t ? "bg-ck-purple text-white" : "bg-slate-100 text-slate-700"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "analytics" && analytics && (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(analytics).map(([k, v]) => (
            <div key={k} className="ck-card p-4">
              <p className="text-xs uppercase text-slate-500">{k}</p>
              <p className="font-display text-2xl font-bold text-ck-ink">{String(v)}</p>
            </div>
          ))}
        </div>
      )}

      {tab === "users" && (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b text-xs uppercase text-slate-500">
                <th className="py-2">Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Blocked</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-100">
                  <td className="py-2 font-medium">{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>{u.blocked ? "yes" : "no"}</td>
                  <td className="space-x-2 text-right">
                    <button type="button" className="text-ck-orange" onClick={() => toggleBlock(u.id, u.blocked)}>
                      Block/unblock
                    </button>
                    <button type="button" className="text-red-600" onClick={() => deleteUser(u.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "tasks" && (
        <div className="mt-6 space-y-3">
          {tasks.map((t) => (
            <div key={t.id} className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Link className="font-semibold text-ck-blue hover:underline" to={`/tasks/${t.id}`}>
                    {t.title}
                  </Link>
                  <p className="text-xs text-slate-500">
                    Status: <span className="font-semibold">{t.status}</span>
                    {t.budget_inr != null && <> · Budget: ₹{Number(t.budget_inr).toFixed(0)}</>}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="ck-btn-secondary !py-1 !text-xs" onClick={() => toggleFeatured(t.id, t.featured)}>
                    {t.featured ? "Unfeature" : "Feature"}
                  </button>
                  <button type="button" className="text-xs text-red-600" onClick={() => deleteTask(t.id)}>
                    Delete
                  </button>
                </div>
              </div>

              {/* Release payment controls — only for in_progress tasks */}
              {t.status === "in_progress" && (
                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Release Payment:</span>
                  <button
                    type="button"
                    className="rounded-lg px-3 py-1.5 text-xs font-bold text-white"
                    style={{ background: "linear-gradient(135deg,#059669,#10b981)" }}
                    onClick={async () => {
                      if (!confirm(`Pay student for "${t.title}"? This releases escrowed funds to the student and marks the task as completed.`)) return;
                      try {
                        await api(`/api/admin/tasks/${t.id}/release-payment`, { method: "POST", body: { release_to: "student" } });
                        setMsg("✅ Payment released to student");
                        refresh();
                      } catch (e) { setMsg("❌ " + (e.data?.error || e.message)); }
                    }}
                  >
                    💸 Pay Student
                  </button>
                  <button
                    type="button"
                    className="rounded-lg px-3 py-1.5 text-xs font-bold text-white"
                    style={{ background: "linear-gradient(135deg,#d97706,#f59e0b)" }}
                    onClick={async () => {
                      if (!confirm(`Refund client for "${t.title}"? This returns escrowed funds to the client and cancels the task.`)) return;
                      try {
                        await api(`/api/admin/tasks/${t.id}/release-payment`, { method: "POST", body: { release_to: "client" } });
                        setMsg("✅ Escrow refunded to client");
                        refresh();
                      } catch (e) { setMsg("❌ " + (e.data?.error || e.message)); }
                    }}
                  >
                    🔄 Refund Client
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "bids" && (
        <div className="mt-6 space-y-2 text-sm">
          {bids.map((b) => (
            <div key={b.id} className="flex justify-between rounded-lg border border-slate-100 px-3 py-2">
              <span>
                Task {b.task_id.slice(0, 8)}… · ₹{Number(b.amount_inr).toFixed(0)} · {b.status}
              </span>
              <button type="button" className="text-red-600" onClick={() => deleteBid(b.id)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "reports" && (
        <div className="mt-6 space-y-3">
          {reports.map((r) => (
            <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <p className="font-semibold">{r.entity_type}</p>
              <p className="text-slate-600">{r.reason}</p>
              <p className="text-xs text-slate-400">{r.status}</p>
              <div className="mt-2 flex gap-2">
                <button type="button" className="ck-btn-secondary !py-1 !text-xs" onClick={() => resolveReport(r.id, "approved")}>
                  Approve action
                </button>
                <button type="button" className="ck-btn-secondary !py-1 !text-xs" onClick={() => resolveReport(r.id, "rejected")}>
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "transactions" && (
        <div className="mt-6 max-h-[480px] space-y-2 overflow-y-auto text-xs">
          {ledger.map((e) => (
            <div key={e.id} className="rounded border border-slate-100 px-2 py-2">
              {e.type} · user {e.user_id?.slice(0, 8)}… · ₹{Number(e.amount_inr).toFixed(2)} · CC {Number(e.amount_cc).toFixed(0)}
            </div>
          ))}
        </div>
      )}

      {tab === "withdrawals" && (
        <div className="mt-6 space-y-2 text-sm">
          {withdrawals.map((w) => (
            <div key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2">
              <span>
                ₹{Number(w.amount_inr).toFixed(2)} · {w.method} · {w.status}
              </span>
              <div className="flex gap-2">
                <button type="button" className="text-xs text-ck-blue" onClick={() => updateWithdrawal(w.id, "completed")}>
                  Mark paid
                </button>
                <button type="button" className="text-xs text-red-600" onClick={() => updateWithdrawal(w.id, "failed")}>
                  Fail
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "disputes" && (
        <div className="mt-6 space-y-3">
          {disputes.map((d) => (
            <div key={d.id} className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <p className="font-semibold">Task {d.task_id}</p>
              <p className="text-xs text-slate-500">{d.status}</p>
              <button type="button" className="mt-2 ck-btn-primary !py-1 !text-xs" onClick={() => resolveDispute(d.id)}>
                Resolve
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
