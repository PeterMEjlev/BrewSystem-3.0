import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'bruceHistory';
const MAX_MESSAGES = 500;

const BruceHistoryContext = createContext({ messages: [], clearHistory: () => {} });

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(messages) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_MESSAGES)));
  } catch {}
}

export function BruceHistoryProvider({ children }) {
  const [messages, setMessages] = useState(loadHistory);

  // Listen for Bruce messages from Electron IPC
  useEffect(() => {
    if (!window.bruceAPI?.onMessage) return;
    return window.bruceAPI.onMessage((msg) => {
      setMessages((prev) => {
        const next = [...prev, msg].slice(-MAX_MESSAGES);
        saveHistory(next);
        return next;
      });
    });
  }, []);

  const clearHistory = useCallback(() => {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <BruceHistoryContext.Provider value={{ messages, clearHistory }}>
      {children}
    </BruceHistoryContext.Provider>
  );
}

export function useBruceHistory() {
  return useContext(BruceHistoryContext);
}
