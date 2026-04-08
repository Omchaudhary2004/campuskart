import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../api.js";

const POLL_MS = 3000; // refresh every 3 s

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  return isToday
    ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) +
        " " +
        d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function Avatar({ name, size = 36, isSelf = false }) {
  const initials = (name || "?")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const hue = isSelf ? 217 : [...(name || "X")].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: isSelf
          ? "linear-gradient(135deg,#1e3a5f,#2d5fa6)"
          : `hsl(${hue},50%,45%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontWeight: 800,
        fontSize: size * 0.38,
        flexShrink: 0,
        userSelect: "none",
        border: isSelf ? "2px solid #93c5fd" : "2px solid #e2e8f0",
        boxShadow: "0 2px 6px rgba(0,0,0,.12)",
      }}
    >
      {initials}
    </div>
  );
}

export default function Chat() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const taskId = params.get("task") || "";

  const [messages, setMessages] = useState([]);
  const [taskInfo, setTaskInfo] = useState(null); // { title, peerName }
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [sendErr, setSendErr] = useState("");
  const [status, setStatus] = useState("loading"); // loading | ready | error

  const bottomRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const inputRef = useRef(null);
  const pollerRef = useRef(null);
  const prevMsgCountRef = useRef(0);

  // Check if user is scrolled near bottom
  const isNearBottom = () => {
    const el = scrollContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  };

  // Fetch messages
  const fetchMessages = useCallback(async () => {
    if (!taskId || !user) return;
    try {
      const data = await api(`/api/tasks/${taskId}/messages`);
      const newMsgs = data.messages || [];
      setMessages((prev) => {
        // Only update state if messages actually changed
        if (newMsgs.length === prev.length && JSON.stringify(newMsgs) === JSON.stringify(prev)) {
          return prev; // Return same reference — no re-render
        }
        return newMsgs;
      });
      setStatus("ready");
      setLoadErr("");
    } catch (err) {
      const msg =
        typeof err?.data?.error === "string"
          ? err.data.error
          : err?.message || "Failed to load chat";
      setLoadErr(msg);
      setStatus("error");
    }
  }, [taskId, user]);

  // Fetch task info (title + peer name + clientId) once
  useEffect(() => {
    if (!taskId || !user) return;
    api(`/api/tasks/${taskId}`)
      .then((data) => {
        const task = data.task;
        if (!task) return;
        const cId = task.client_id || task.client_user_id;
        const isClient = user.id === cId;
        const peerName = isClient
          ? data.bids?.find((b) => b.status === "accepted")?.student_name || "Student"
          : task.client_name || "Client";
        setTaskInfo({ title: task.title, peerName, clientId: cId });
      })
      .catch(() => {});
  }, [taskId, user]);

  // Initial fetch + start polling
  useEffect(() => {
    if (!taskId || !user) return;
    fetchMessages();
    pollerRef.current = setInterval(fetchMessages, POLL_MS);
    return () => clearInterval(pollerRef.current);
  }, [taskId, user, fetchMessages]);

  // Smart auto-scroll: only when NEW messages arrive AND user is near bottom
  useEffect(() => {
    if (messages.length > prevMsgCountRef.current && isNearBottom()) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevMsgCountRef.current = messages.length;
  }, [messages]);

  const send = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setSendErr("");
    // Optimistic UI
    const optimistic = {
      uid: user.id,
      name: user.name || "You",
      message: text,
      timestamp: new Date().toISOString(),
      _optimistic: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    // Scroll to bottom on send
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    try {
      const data = await api(`/api/tasks/${taskId}/messages`, {
        method: "POST",
        body: { message: text },
      });
      // Replace with server version
      setMessages(data.messages || []);
    } catch (err) {
      // Rollback optimistic
      setMessages((prev) => prev.filter((m) => !m._optimistic));
      setInput(text);
      const msg =
        typeof err?.data?.error === "string" ? err.data.error : err?.message || "Send failed";
      setSendErr(msg);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  /* ── Not signed in ── */
  if (!user) {
    return (
      <div style={styles.centerWrap}>
        <div style={{ fontSize: "3rem" }}>💬</div>
        <h1 style={styles.centerTitle}>Sign in to chat</h1>
        <p style={styles.centerSub}>Chat is only available to signed-in users.</p>
        <Link to="/auth" style={styles.pill}>Sign in</Link>
      </div>
    );
  }

  /* ── No task ID ── */
  if (!taskId) {
    return (
      <div style={styles.centerWrap}>
        <div style={{ fontSize: "3rem" }}>💬</div>
        <h1 style={styles.centerTitle}>No conversation selected</h1>
        <p style={styles.centerSub}>Open a chat from an accepted task to start messaging.</p>
        <Link to="/activity" style={styles.pill}>Go to My Tasks</Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem 1rem" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.25rem" }}>
        <Link
          to="/activity"
          style={{
            display: "inline-flex", alignItems: "center", gap: ".4rem",
            fontSize: ".85rem", color: "#64748b", textDecoration: "none",
            background: "#f1f5f9", padding: ".35rem .9rem",
            borderRadius: "9999px", fontWeight: 600,
          }}
        >
          ← Back
        </Link>
        <div>
          <h1 style={{ fontWeight: 800, fontSize: "1.2rem", color: "#1e3a5f", margin: 0 }}>
            💬 {taskInfo?.title || "Task Chat"}
          </h1>
          {taskInfo?.peerName && (
            <p style={{ margin: 0, fontSize: ".8rem", color: "#64748b" }}>
              with {taskInfo.peerName}
            </p>
          )}
        </div>
      </div>

      {/* Chat box */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: "1.5rem",
          overflow: "hidden",
          boxShadow: "0 4px 24px rgba(0,0,0,.07)",
          display: "flex",
          flexDirection: "column",
          height: "65vh",
          minHeight: 400,
        }}
      >
        {/* Messages area */}
        <div
          ref={scrollContainerRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "1.25rem",
            display: "flex",
            flexDirection: "column",
            gap: ".85rem",
            background: "linear-gradient(180deg,#f8fafc 0%,#fff 100%)",
          }}
        >
          {status === "loading" && (
            <div style={styles.centeredFlex}>
              <Spinner />
              <p style={{ color: "#64748b", marginTop: ".75rem" }}>Loading messages…</p>
            </div>
          )}

          {status === "error" && (
            <div style={styles.centeredFlex}>
              <div style={{
                background: "#fff7ed", border: "1px solid #fed7aa",
                borderRadius: "1rem", padding: "1.25rem", textAlign: "center",
              }}>
                <p style={{ color: "#9a3412", fontWeight: 700, marginBottom: ".5rem" }}>⚠️ {loadErr}</p>
                <button
                  onClick={fetchMessages}
                  style={{
                    marginTop: ".5rem", padding: ".4rem 1.1rem",
                    background: "#1e3a5f", color: "#fff",
                    border: "none", borderRadius: "8px", cursor: "pointer",
                    fontWeight: 600, fontSize: ".85rem",
                  }}
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {status === "ready" && messages.length === 0 && (
            <div style={styles.centeredFlex}>
              <div style={{ fontSize: "2.5rem" }}>👋</div>
              <p style={{ color: "#94a3b8", marginTop: ".5rem", fontWeight: 500 }}>
                No messages yet — say hello!
              </p>
            </div>
          )}

          {status === "ready" &&
            messages.map((msg, i) => {
              const isMe = msg.uid === user.id;
              const isClient = taskInfo?.clientId && msg.uid === taskInfo.clientId;
              const roleBadge = isClient ? "Client" : "Student";
              const showAvatar = i === 0 || messages[i - 1]?.uid !== msg.uid;
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    flexDirection: isMe ? "row-reverse" : "row",
                    alignItems: "flex-start",
                    gap: ".6rem",
                    marginTop: showAvatar ? ".5rem" : 0,
                  }}
                >
                  {/* Avatar */}
                  {showAvatar ? (
                    <Avatar name={isMe ? (user.name || "Me") : msg.name} size={36} isSelf={isMe} />
                  ) : (
                    <div style={{ width: 36, flexShrink: 0 }} />
                  )}

                  {/* Bubble */}
                  <div style={{ maxWidth: "72%" }}>
                    {/* Sender label with role badge — shown on every message */}
                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: ".4rem",
                        marginBottom: ".25rem",
                        justifyContent: isMe ? "flex-end" : "flex-start",
                        paddingLeft: isMe ? 0 : ".6rem",
                        paddingRight: isMe ? ".6rem" : 0,
                      }}>
                        <span style={{
                          fontSize: ".72rem",
                          fontWeight: 800,
                          color: isMe ? "#1e3a5f" : "#7c3aed",
                          letterSpacing: ".02em",
                        }}>
                          {isMe ? "You" : msg.name}
                        </span>
                        <span style={{
                          fontSize: ".62rem",
                          fontWeight: 700,
                          color: "#fff",
                          background: isClient ? "#f59e0b" : "#8b5cf6",
                          padding: ".1rem .45rem",
                          borderRadius: "9999px",
                          letterSpacing: ".03em",
                          textTransform: "uppercase",
                          lineHeight: 1.4,
                        }}>
                          {roleBadge}
                        </span>
                      </div>

                    {/* Message bubble */}
                    <div
                      style={{
                        background: isMe
                          ? "linear-gradient(135deg,#1e3a5f,#2d5fa6)"
                          : "#f3f0ff",
                        color: isMe ? "#fff" : "#1e293b",
                        borderRadius: isMe
                          ? "1.2rem 1.2rem .25rem 1.2rem"
                          : "1.2rem 1.2rem 1.2rem .25rem",
                        padding: ".65rem 1.1rem",
                        fontSize: ".93rem",
                        lineHeight: 1.5,
                        wordBreak: "break-word",
                        boxShadow: isMe
                          ? "0 3px 12px rgba(30,58,95,.3)"
                          : "0 2px 8px rgba(124,58,237,.1)",
                        border: isMe
                          ? "none"
                          : "1.5px solid #ddd6fe",
                        opacity: msg._optimistic ? 0.6 : 1,
                        transition: "opacity .2s",
                      }}
                    >
                      {msg.message}
                    </div>

                    {/* Timestamp */}
                    <p style={{
                      fontSize: ".68rem",
                      color: "#94a3b8",
                      marginTop: ".2rem",
                      textAlign: isMe ? "right" : "left",
                      paddingLeft: isMe ? 0 : ".6rem",
                      paddingRight: isMe ? ".6rem" : 0,
                    }}>
                      {formatTime(msg.timestamp)}
                      {msg._optimistic && " · sending…"}
                    </p>
                  </div>
                </div>
              );
            })}

          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <form
          onSubmit={send}
          style={{
            display: "flex",
            gap: ".75rem",
            padding: "1rem 1.25rem",
            borderTop: "1px solid #e2e8f0",
            background: "#fff",
            alignItems: "center",
          }}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); setSendErr(""); }}
            placeholder="Type a message…"
            disabled={status !== "ready"}
            maxLength={2000}
            style={{
              flex: 1,
              border: "1.5px solid #e2e8f0",
              borderRadius: "9999px",
              padding: ".6rem 1.2rem",
              fontSize: ".95rem",
              outline: "none",
              transition: "border-color .2s",
              fontFamily: "inherit",
              background: status !== "ready" ? "#f8fafc" : "#fff",
            }}
            onFocus={(e) => (e.target.style.borderColor = "#1e3a5f")}
            onBlur={(e) => (e.target.style.borderColor = "#e2e8f0")}
          />
          <button
            type="submit"
            disabled={!input.trim() || sending || status !== "ready"}
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background:
                !input.trim() || sending || status !== "ready"
                  ? "#cbd5e1"
                  : "linear-gradient(135deg,#1e3a5f,#2d5fa6)",
              border: "none",
              cursor:
                !input.trim() || sending || status !== "ready"
                  ? "not-allowed"
                  : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background .2s, transform .1s",
              flexShrink: 0,
              boxShadow:
                !input.trim() || sending || status !== "ready"
                  ? "none"
                  : "0 2px 8px rgba(30,58,95,.3)",
            }}
            onMouseDown={(e) => { if (input.trim()) e.currentTarget.style.transform = "scale(.93)"; }}
            onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
          >
            {sending ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="60">
                  <animate attributeName="stroke-dashoffset" from="60" to="0" dur=".6s" repeatCount="indefinite" />
                </circle>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </form>

        {sendErr && (
          <p style={{
            padding: ".4rem 1.25rem .6rem",
            color: "#dc2626", fontSize: ".8rem", fontWeight: 600,
            background: "#fff",
          }}>
            ❌ {sendErr}
          </p>
        )}
      </div>

      {/* Live indicator */}
      {status === "ready" && (
        <p style={{
          textAlign: "center", fontSize: ".72rem",
          color: "#94a3b8", marginTop: ".5rem",
        }}>
          <span style={{
            display: "inline-block", width: 6, height: 6,
            borderRadius: "50%", background: "#22c55e",
            marginRight: ".3rem", verticalAlign: "middle",
            animation: "ckPulse 2s ease-in-out infinite",
          }} />
          Live · refreshes every 3 s
          <style>{`@keyframes ckPulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
        </p>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <div style={{
      width: 36, height: 36,
      border: "3.5px solid #e2e8f0",
      borderTop: "3.5px solid #1e3a5f",
      borderRadius: "50%",
      animation: "spin .8s linear infinite",
    }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

const styles = {
  centerWrap: {
    maxWidth: 420,
    margin: "0 auto",
    padding: "6rem 1rem",
    textAlign: "center",
  },
  centerTitle: {
    fontSize: "1.5rem", fontWeight: 700,
    marginTop: "1rem", color: "#1e3a5f",
  },
  centerSub: { color: "#64748b", marginTop: ".5rem" },
  pill: {
    display: "inline-block", marginTop: "1.5rem",
    padding: ".6rem 2rem", background: "#1e3a5f",
    color: "#fff", borderRadius: "9999px",
    fontWeight: 600, textDecoration: "none",
  },
  centeredFlex: {
    flex: 1, display: "flex",
    flexDirection: "column",
    alignItems: "center", justifyContent: "center",
  },
};
