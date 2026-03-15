import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const HISTORY_KEY = 'bruceHistory';
const REMINDERS_KEY = 'bruceReminders';
const MAX_MESSAGES = 500;

const BruceHistoryContext = createContext({
  messages: [],
  clearHistory: () => {},
  reminders: [],
});

function loadJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveJSON(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}

// History messages: user, assistant, function_call
const HISTORY_TYPES = new Set(['user', 'assistant', 'function_call']);

export function BruceHistoryProvider({ children }) {
  const [messages, setMessages] = useState(() => loadJSON(HISTORY_KEY));
  const [reminders, setReminders] = useState(() => loadJSON(REMINDERS_KEY));

  useEffect(() => {
    if (!window.bruceAPI?.onMessage) return;
    return window.bruceAPI.onMessage((msg) => {
      if (HISTORY_TYPES.has(msg.type)) {
        setMessages((prev) => {
          const next = [...prev, msg].slice(-MAX_MESSAGES);
          saveJSON(HISTORY_KEY, next);
          return next;
        });
      } else if (msg.type === 'reminder_set') {
        setReminders((prev) => {
          const next = [...prev, {
            id: msg.id,
            message: msg.message,
            createdAt: msg.createdAt,
            firesAt: msg.firesAt,
            status: 'active',
          }];
          saveJSON(REMINDERS_KEY, next);
          return next;
        });
      } else if (msg.type === 'reminder_fired') {
        setReminders((prev) => {
          const next = prev.map((r) =>
            r.id === msg.id ? { ...r, status: 'fired', firedAt: msg.timestamp } : r
          );
          saveJSON(REMINDERS_KEY, next);
          return next;
        });
      }
    });
  }, []);

  const clearHistory = useCallback(() => {
    setMessages([]);
    localStorage.removeItem(HISTORY_KEY);
  }, []);

  return (
    <BruceHistoryContext.Provider value={{ messages, clearHistory, reminders }}>
      {children}
    </BruceHistoryContext.Provider>
  );
}

export function useBruceHistory() {
  return useContext(BruceHistoryContext);
}
