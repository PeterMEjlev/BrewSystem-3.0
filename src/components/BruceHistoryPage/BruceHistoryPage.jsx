import { useEffect, useRef, useState } from 'react';
import { useBruceHistory } from '../../contexts/BruceHistoryContext';
import styles from './BruceHistoryPage.module.css';

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatArgs(args) {
  if (!args) return '';
  try {
    const str = typeof args === 'string' ? args : JSON.stringify(args, null, 2);
    return str.length > 300 ? str.slice(0, 300) + '\u2026' : str;
  } catch {
    return String(args);
  }
}

function formatCountdown(firesAt) {
  const diff = firesAt - Date.now();
  if (diff <= 0) return 'any moment';
  const s = Math.floor(diff / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (sec > 0 || parts.length === 0) parts.push(`${sec}s`);
  return parts.join(' ');
}

// ── Message item (history timeline) ──────────────────────────────────────

function MessageItem({ msg }) {
  if (msg.type === 'user') {
    return (
      <div className={styles.message}>
        <div className={styles.userBubble}>
          <span className={styles.senderLabel}>[You]</span>
          <span className={styles.timestamp}>{formatTime(msg.timestamp)}</span>
        </div>
        <div className={styles.userContent}>{msg.content}</div>
      </div>
    );
  }

  if (msg.type === 'assistant') {
    return (
      <div className={styles.message}>
        <div className={styles.bruceBubble}>
          <span className={styles.senderLabel}>[Bruce]</span>
          <span className={styles.timestamp}>{formatTime(msg.timestamp)}</span>
        </div>
        <div className={styles.bruceContent}>{msg.content}</div>
      </div>
    );
  }

  if (msg.type === 'function_call') {
    return (
      <div className={`${styles.message} ${styles.fnMessage}`}>
        <div className={styles.fnBubble}>
          <span className={styles.senderLabel}>[Function Call]</span>
          <span className={styles.timestamp}>{formatTime(msg.timestamp)}</span>
        </div>
        <div className={styles.fnContent}>
          <code className={styles.fnName}>
            {msg.functionName}({msg.functionArgs ? '' : ')'})
          </code>
          {msg.functionArgs && (
            <pre className={styles.fnArgs}>{formatArgs(msg.functionArgs)}</pre>
          )}
          {msg.functionArgs && <code className={styles.fnName}>)</code>}
          {msg.functionResult && (
            <div className={styles.fnResult}>
              <span className={styles.fnResultLabel}>Returned:</span> {String(msg.functionResult)}
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}

// ── Reminder item ────────────────────────────────────────────────────────

function ReminderItem({ reminder, now }) {
  const isActive = reminder.status === 'active' && reminder.firesAt > now;
  const isFired = reminder.status === 'fired';

  return (
    <div className={`${styles.reminderItem} ${isFired ? styles.reminderFired : ''}`}>
      <div className={styles.reminderHeader}>
        <span className={`${styles.reminderBadge} ${isActive ? styles.badgeActive : styles.badgeFired}`}>
          {isActive ? '[Reminder]' : '[Fired]'}
        </span>
        <span className={styles.timestamp}>
          {isActive ? `in ${formatCountdown(reminder.firesAt)}` : formatTime(reminder.firedAt || reminder.firesAt)}
        </span>
      </div>
      <div className={styles.reminderMessage}>{reminder.message}</div>
      <div className={styles.reminderMeta}>
        Set {formatTime(reminder.createdAt)} &middot; Due {formatTime(reminder.firesAt)}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────

function BruceHistoryPage() {
  const { messages, clearHistory, reminders } = useBruceHistory();
  const bottomRef = useRef(null);

  // Tick every second to update countdowns
  const [now, setNow] = useState(Date.now());
  const hasActiveReminders = reminders.some((r) => r.status === 'active' && r.firesAt > now);
  useEffect(() => {
    if (!hasActiveReminders) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasActiveReminders]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Sort reminders: active first, then fired (most recent first)
  const sortedReminders = [...reminders].sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (a.status !== 'active' && b.status === 'active') return 1;
    return (b.firesAt || 0) - (a.firesAt || 0);
  });

  // Group history messages by date
  let lastDate = '';

  return (
    <div className={styles.page}>
      <div className={styles.columns}>
        {/* ── History card ── */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Bruce History</h2>
            {messages.length > 0 && (
              <button className={styles.clearBtn} onClick={clearHistory}>
                Clear
              </button>
            )}
          </div>
          <div className={styles.timeline}>
            {messages.length === 0 ? (
              <div className={styles.empty}>
                <div className={styles.emptyIcon}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="40" height="40">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                    />
                  </svg>
                </div>
                <p className={styles.emptyText}>No Bruce interactions yet.</p>
                <p className={styles.emptyHint}>Say the wake word to start a conversation with Bruce.</p>
              </div>
            ) : (
              messages.map((msg, i) => {
                const dateStr = formatDate(msg.timestamp);
                const showDate = dateStr && dateStr !== lastDate;
                if (showDate) lastDate = dateStr;
                return (
                  <div key={i}>
                    {showDate && <div className={styles.dateDivider}>{dateStr}</div>}
                    <MessageItem msg={msg} />
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* ── Reminders / Queue card ── */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Reminders / Queue</h2>
          </div>
          <div className={styles.reminderList}>
            {sortedReminders.length === 0 ? (
              <div className={styles.empty}>
                <div className={styles.emptyIcon}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="40" height="40">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <p className={styles.emptyText}>No active reminders.</p>
                <p className={styles.emptyHint}>Ask Bruce to set a reminder during a conversation.</p>
              </div>
            ) : (
              sortedReminders.map((r) => (
                <ReminderItem key={r.id} reminder={r} now={now} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default BruceHistoryPage;
