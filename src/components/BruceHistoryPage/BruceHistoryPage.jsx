import { useEffect, useRef } from 'react';
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

function BruceHistoryPage() {
  const { messages, clearHistory } = useBruceHistory();
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Group messages by date
  let lastDate = '';

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Bruce History</h1>
        {messages.length > 0 && (
          <button className={styles.clearBtn} onClick={clearHistory}>
            Clear History
          </button>
        )}
      </div>

      <div className={styles.timeline}>
        {messages.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="48" height="48">
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
  );
}

export default BruceHistoryPage;
