import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { api, assetUrl } from "../api.js";

export default function TaskDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [bidAmount, setBidAmount] = useState("");
  const [proposal, setProposal] = useState("");
  const [review, setReview] = useState({ rating: 5, comment: "" });
  const [msg, setMsg] = useState("");
  const [reportReason, setReportReason] = useState("");
  const [reportStatus, setReportStatus] = useState(""); // "" | "ok" | "err"
  const [reportErr, setReportErr] = useState("");

  const load = () => api(`/api/tasks/${id}`).then(setData).catch(() => setData(null));

  useEffect(() => {
    load();
  }, [id]);

  if (!data?.task) {
    return (
      <div className="px-4 py-20 text-center text-slate-500">
        {data === null ? "Loading…" : "Task not found."}
      </div>
    );
  }

  const { task, attachments, bids } = data;
  const isClient = user && task.client_user_id === user.id;
  const isStudent = user && user.role === "student";
  const assigned = task.assigned_student_id;

  const placeBid = async (e) => {
    e.preventDefault();
    setMsg("");
    try {
      await api(`/api/tasks/${id}/bids`, {
        method: "POST",
        body: { amount_inr: Number(bidAmount), proposal },
      });
      setMsg("Bid placed.");
      setBidAmount("");
      setProposal("");
      load();
    } catch (err) {
      setMsg(err.data?.error || err.message);
    }
  };

  const accept = async (bidId) => {
    setMsg("");
    try {
      await api(`/api/tasks/${id}/bids/${bidId}/accept`, { method: "POST", body: {} });
      setMsg("Bid accepted. Task is now in progress.");
      load();
    } catch (err) {
      setMsg(err.data?.error || err.message);
    }
  };

  const complete = async () => {
    setMsg("");
    try {
      await api(`/api/tasks/${id}/complete`, { method: "POST", body: {} });
      setMsg("Task completed — payment released to student.");
      load();
    } catch (err) {
      setMsg(err.data?.error || err.message);
    }
  };

  const submitReview = async (toUserId) => {
    setMsg("");
    try {
      await api("/api/reviews", {
        method: "POST",
        body: {
          task_id: id,
          to_user_id: toUserId,
          rating: Number(review.rating),
          comment: review.comment,
        },
      });
      setMsg("Review submitted.");
    } catch (err) {
      setMsg(err.data?.error || err.message);
    }
  };

  const del = async () => {
    if (!confirm("Delete this open task?")) return;
    try {
      await api(`/api/tasks/${id}`, { method: "DELETE" });
      nav("/");
    } catch (err) {
      setMsg(err.data?.error || err.message);
    }
  };

  const report = async () => {
    if (!reportReason.trim()) return;
    if (!user) { setReportErr("You must be signed in to report."); setReportStatus("err"); return; }
    setReportStatus("");
    setReportErr("");
    try {
      await api("/api/reports", {
        method: "POST",
        body: { entity_type: "task", entity_id: id, reason: reportReason },
      });
      setReportStatus("ok");
      setReportReason("");
    } catch (err) {
      const errMsg =
        typeof err?.data?.error === "string" ? err.data.error :
        typeof err?.message === "string" ? err.message :
        "Report failed — please try again.";
      setReportErr(errMsg);
      setReportStatus("err");
      console.error("[report]", err);
    }
  };

  const openDispute = async () => {
    try {
      await api("/api/disputes", { method: "POST", body: { task_id: id, notes: "User opened dispute" } });
      setMsg("Dispute opened — admins will review.");
    } catch (err) {
      setMsg(err.data?.error || err.message);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <img src={task.image_url} alt="" className="h-64 w-full object-cover md:h-80" />
        <div className="p-6 md:p-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase text-ck-purple">{task.category}</p>
              <h1 className="mt-2 font-display text-3xl font-bold text-ck-blue">{task.title}</h1>
              <p className="mt-2 text-2xl font-bold text-ck-orange">₹{Number(task.budget_inr).toLocaleString("en-IN")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {isClient && task.status === "open" && (
                <button type="button" onClick={del} className="ck-btn-secondary text-red-600">
                  Delete task
                </button>
              )}
              {user && task.status === "in_progress" && (isClient || user.id === assigned) && (
                <button type="button" onClick={complete} className="ck-btn-primary">
                  Complete task & release pay
                </button>
              )}
              {user && task.status === "in_progress" &&
                (user.id === task.client_user_id || user.id === assigned) && (
                <Link
                  to={`/chat?task=${id}`}
                  className="ck-btn-secondary"
                >
                  💬 Chat
                </Link>
              )}
            </div>
          </div>
          <p className="mt-6 text-slate-700 whitespace-pre-wrap">{task.description}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {(task.tags || []).map((t) => (
              <span key={t} className="rounded-full bg-ck-cream px-3 py-1 text-xs font-medium text-ck-blue">
                {t}
              </span>
            ))}
          </div>

          <section className="mt-10 rounded-2xl border border-slate-100 bg-slate-50/80 p-6">
            <h2 className="font-display text-lg font-bold text-ck-ink">Client</h2>
            <div className="mt-3 flex items-center gap-3">
              <img
                src={assetUrl(task.client_avatar) || `https://i.pravatar.cc/80?u=${task.client_user_id}`}
                alt=""
                className="h-12 w-12 rounded-full object-cover"
              />
              <div>
                <p className="font-semibold">{task.client_name}</p>
                <Link to={`/users/${task.client_user_id}`} className="text-sm text-ck-orange hover:underline">
                  View profile
                </Link>
              </div>
            </div>
          </section>

          {!!attachments?.length && (
            <section className="mt-8">
              <h2 className="font-display text-lg font-bold text-ck-blue">Attachments</h2>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {attachments.map((a) => (
                  <li key={a.id} className="overflow-hidden rounded-xl border bg-white">
                    <img src={a.url} alt={a.label || ""} className="h-40 w-full object-cover" />
                    {a.label && <p className="p-2 text-xs text-slate-600">{a.label}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-10">
            <h2 className="font-display text-xl font-bold text-ck-purple">Live bids</h2>
            <ul className="mt-4 space-y-3">
              {(bids || []).map((b) => (
                <li key={b.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex gap-3">
                    <img
                      src={b.student_avatar?.startsWith?.("http") ? b.student_avatar : assetUrl(b.student_avatar) || `https://i.pravatar.cc/64?u=${b.student_id}`}
                      alt=""
                      className="h-14 w-14 rounded-xl object-cover"
                    />
                    <div>
                      <p className="font-semibold text-ck-ink">{b.student_name}</p>
                      <p className="text-sm text-ck-blue">₹{Number(b.amount_inr).toLocaleString("en-IN")}</p>
                      <p className="text-sm text-slate-600 line-clamp-3">{b.proposal}</p>
                      <p className="text-xs uppercase text-slate-400">{b.status}</p>
                    </div>
                  </div>
                  {isClient && task.status === "open" && b.status === "pending" && (
                    <button type="button" className="ck-btn-primary shrink-0" onClick={() => accept(b.id)}>
                      Accept bid
                    </button>
                  )}
                </li>
              ))}
              {!bids?.length && <li className="text-slate-500">No bids yet.</li>}
            </ul>
          </section>

          {isStudent && task.status === "open" && (
            <form onSubmit={placeBid} className="mt-10 space-y-4 rounded-2xl border border-ck-orange/30 bg-orange-50/50 p-6">
              <h3 className="font-display font-bold text-ck-orange">Place your bid</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-slate-500">Price (INR)</label>
                  <input type="number" className="ck-input mt-1" required value={bidAmount} onChange={(e) => setBidAmount(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500">Proposal</label>
                <textarea className="ck-input mt-1 min-h-[100px]" required value={proposal} onChange={(e) => setProposal(e.target.value)} />
              </div>
              <button type="submit" className="ck-btn-primary">
                Submit bid
              </button>
            </form>
          )}

          {task.status === "completed" && user && (user.id === task.client_user_id || user.id === assigned) && (
            <div className="mt-10 rounded-2xl border border-ck-purple/30 bg-ck-cream p-6">
              <h3 className="font-display font-bold text-ck-purple">Rate the other party</h3>
              <div className="mt-3 flex flex-wrap gap-3">
                <select className="ck-input w-24" value={review.rating} onChange={(e) => setReview({ ...review, rating: e.target.value })}>
                  {[5, 4, 3, 2, 1].map((r) => (
                    <option key={r} value={r}>
                      {r}★
                    </option>
                  ))}
                </select>
                <input
                  className="ck-input flex-1 min-w-[200px]"
                  placeholder="Comment"
                  value={review.comment}
                  onChange={(e) => setReview({ ...review, comment: e.target.value })}
                />
                {user.id === task.client_user_id && assigned && (
                  <button type="button" className="ck-btn-secondary" onClick={() => submitReview(assigned)}>
                    Review student
                  </button>
                )}
                {user.id === assigned && (
                  <button type="button" className="ck-btn-secondary" onClick={() => submitReview(task.client_user_id)}>
                    Review client
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="mt-10 border-t border-slate-100 pt-6">
            <div className="flex flex-wrap gap-3">
              <input
                className="ck-input max-w-md flex-1"
                placeholder="Report reason"
                value={reportReason}
                onChange={(e) => { setReportReason(e.target.value); setReportStatus(""); setReportErr(""); }}
              />
              <button type="button" className="ck-btn-secondary" onClick={report}>
                Report task
              </button>
              {user && task.status === "in_progress" && (user.id === task.client_user_id || user.id === assigned) && (
                <button type="button" className="ck-btn-secondary" onClick={openDispute}>
                  Open dispute
                </button>
              )}
            </div>
            {reportStatus === "ok" && (
              <p className="mt-3 text-sm font-semibold text-green-600">✅ Report filed successfully. Our team will review it.</p>
            )}
            {reportStatus === "err" && (
              <p className="mt-3 text-sm font-semibold text-red-600">❌ {reportErr}</p>
            )}
          </div>

          {msg && <p className="mt-6 text-sm font-semibold text-ck-purple">{msg}</p>}
        </div>
      </div>
    </div>
  );
}
