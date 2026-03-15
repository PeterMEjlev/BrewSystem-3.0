import { useState, useEffect, useRef, useCallback } from 'react';
import { playClick } from '../../utils/sounds';
import styles from '../ToolsPage/ToolsPage.module.css';

const SHEETS_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1c5CWo_-7lS9C0HSklylLVgFAT4OwADm2Svqfr9x28Do/export?format=csv&gid=0';

// Replace with your deployed Apps Script web app URL
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxKTibop5YCnFjuewJLn-cf0MJ-o2SFVVqMzHm3BK-bp7fWmT9bECyZF5NF5uw4A-ywtA/exec';

// Colours chosen to evoke the actual appearance of each beer / keg state
const CONTENT_COLORS = {
  'IPA':       '#C8782A', // amber copper
  'NEIPA':     '#3ee849', // hazy orange-gold
  'Wiessbeer': '#E8C84A', // cloudy banana-gold
  'Sour':      '#D64878', // tart raspberry pink
  'Brown Ale': '#7A3B1A', // rich mahogany
  'Starsan':   '#b8faff', // pink (like the sanitiser itself)
  'SIPA':      '#2a9826', // lighter golden session IPA
  'Pilsner':   '#DEC05C', // pale straw gold
  'Stout':     '#3A2A1A', // near-black dark roast (card uses overrides)
  'Dirty':     '#ff0000', // warning red-brown
  'Clean':     '#ffffff', // fresh aqua
  '???':       '#707070', // neutral grey
};

const CONTENT_OPTIONS = [
  'IPA', 'NEIPA', 'Wiessbeer', 'Sour', 'Brown Ale',
  'Starsan', 'SIPA', 'Pilsner', 'Stout',
  'Dirty', 'Clean', '???',
];

function getContentColor(contents) {
  const key = Object.keys(CONTENT_COLORS).find(
    (k) => k.toLowerCase() === contents.trim().toLowerCase(),
  );
  return key ? CONTENT_COLORS[key] : null;
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function parseCSV(text) {
  const lines = text.split('\n').filter(Boolean);
  return lines.map((line) => {
    const cols = [];
    let cur = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { cols.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    cols.push(cur.trim());
    return cols;
  });
}

const SORT_OPTIONS = [
  { key: 'number',   label: 'Keg #' },
  { key: 'volume',   label: 'Size' },
  { key: 'contents', label: 'Contents' },
  { key: 'date',     label: 'Date' },
  { key: 'note',     label: 'Note' },
  { key: 'abv',      label: 'ABV' },
];

function parseVolume(v) {
  return parseFloat(v) || 0;
}

function parseDate(d) {
  if (!d) return 0;
  // Handle DD/MM/YYYY format
  const parts = d.split('/');
  if (parts.length === 3) {
    return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).getTime() || 0;
  }
  return new Date(d).getTime() || 0;
}

function sortKegs(kegs, sortKey, sortAsc) {
  const dir = sortAsc ? 1 : -1;
  return [...kegs].sort((a, b) => {
    switch (sortKey) {
      case 'number':
        return (parseInt(a.number) - parseInt(b.number)) * dir;
      case 'volume':
        return (parseVolume(a.volume) - parseVolume(b.volume)) * dir;
      case 'contents':
        return a.contents.localeCompare(b.contents) * dir;
      case 'date': {
        const da = parseDate(a.date);
        const db = parseDate(b.date);
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return (da - db) * dir;
      }
      case 'note':
        return a.note.localeCompare(b.note) * dir;
      case 'abv': {
        const aa = parseFloat(a.abv) || 0;
        const ab = parseFloat(b.abv) || 0;
        if (!aa && !ab) return 0;
        if (!aa) return 1;
        if (!ab) return -1;
        return (aa - ab) * dir;
      }
      default:
        return 0;
    }
  });
}

const LONG_PRESS_MS = 500;

function todayDDMMYYYY() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function KegEditModal({ kegs, onClose, onSave }) {
  const isBulk = kegs.length > 1;
  const first = kegs[0];

  const [form, setForm] = useState({
    contents: isBulk ? first.contents : first.contents,
    date: isBulk ? '' : first.date,
    note: isBulk ? '' : first.note,
    abv: isBulk ? '' : first.abv,
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveProgress, setSaveProgress] = useState('');

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    if (!APPS_SCRIPT_URL) {
      setSaveError('Apps Script URL not configured. See google-apps-script/keg-updater.gs for setup instructions.');
      return;
    }
    setSaving(true);
    setSaveError('');

    const updates = [];
    for (let i = 0; i < kegs.length; i++) {
      const keg = kegs[i];
      if (isBulk) {
        setSaveProgress(`Saving keg ${i + 1} of ${kegs.length}…`);
      }
      const resolvedDate = isBulk
        ? (form.date || keg.date || todayDDMMYYYY())
        : (form.date || todayDDMMYYYY());
      const payload = isBulk
        ? {
            number: keg.number,
            contents: form.contents,
            date: resolvedDate,
            note: form.note || keg.note,
            abv: form.abv || keg.abv,
          }
        : { number: keg.number, ...form, date: resolvedDate };

      try {
        const res = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        updates.push({ ...keg, ...payload });
      } catch (err) {
        setSaveError(`Failed on keg #${keg.number}: ${err.message}`);
        setSaving(false);
        setSaveProgress('');
        // Still apply successful updates so far
        if (updates.length > 0) onSave(updates);
        return;
      }
    }

    setSaving(false);
    setSaveProgress('');
    onSave(updates);
  };

  const color = getContentColor(form.contents);

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>
            {isBulk ? (
              <>Edit {kegs.length} Kegs</>
            ) : (
              <>Edit Keg <span style={color ? { color } : undefined}>#{first.number}</span></>
            )}
          </h3>
          <button className={styles.modalClose} onClick={onClose}>×</button>
        </div>

        {isBulk && (
          <p className={styles.bulkKegList}>
            Kegs: {kegs.map((k) => `#${k.number}`).join(', ')}
          </p>
        )}

        <div className={styles.fields}>
          <div className={styles.field}>
            <label className={styles.label}>Contents</label>
            <select
              className={styles.input}
              value={form.contents}
              onChange={(e) => update('contents', e.target.value)}
            >
              {CONTENT_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Date{isBulk && <span className={styles.bulkHint}> (blank = keep existing)</span>}</label>
            <div className={styles.inputRow}>
              <input
                className={styles.input}
                type="text"
                value={form.date}
                onChange={(e) => update('date', e.target.value)}
                placeholder={isBulk ? 'Leave blank to keep existing' : 'DD/MM/YYYY'}
              />
              <button
                type="button"
                className={styles.todayBtn}
                onClick={() => { playClick(); update('date', todayDDMMYYYY()); }}
                title="Set to today"
              >
                Today
              </button>
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Note{isBulk && <span className={styles.bulkHint}> (blank = keep existing)</span>}</label>
            <input
              className={styles.input}
              type="text"
              value={form.note}
              onChange={(e) => update('note', e.target.value)}
              placeholder={isBulk ? 'Leave blank to keep existing' : 'e.g. Dry-hopped'}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>ABV{isBulk && <span className={styles.bulkHint}> (blank = keep existing)</span>}</label>
            <input
              className={styles.input}
              type="text"
              value={form.abv}
              onChange={(e) => update('abv', e.target.value)}
              placeholder={isBulk ? 'Leave blank to keep existing' : 'e.g. 5.2%'}
            />
          </div>
        </div>

        {saveError && <p className={styles.error}>{saveError}</p>}
        {saveProgress && <p className={styles.calcSubtitle}>{saveProgress}</p>}

        <div className={styles.modalActions}>
          <button className={styles.modalCancelBtn} onClick={() => { playClick(); onClose(); }}>Cancel</button>
          <button className={styles.calcButton} onClick={() => { playClick(); handleSave(); }} disabled={saving}>
            {saving ? 'Saving…' : isBulk ? `Save ${kegs.length} Kegs` : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function KegStatusPage() {
  const [kegs, setKegs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState('number');
  const [sortAsc, setSortAsc] = useState(true);

  // Single edit
  const [editingKeg, setEditingKeg] = useState(null);

  // Multi-select
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [editingBulk, setEditingBulk] = useState(false);

  // Long-press tracking
  const pressTimer = useRef(null);
  const pressedKeg = useRef(null);
  const didLongPress = useRef(false);

  useEffect(() => {
    fetch(SHEETS_CSV_URL)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch keg data');
        return res.text();
      })
      .then((text) => {
        const rows = parseCSV(text);
        const dataRows = rows.slice(2);
        const parsed = dataRows
          .map((cols) => ({
            number: cols[1] || '',
            contents: cols[2] || '',
            date: cols[3] || '',
            note: cols[4] || '',
            volume: cols[5] || '',
            abv: cols[6] || '',
          }))
          .filter((k) => k.number);
        setKegs(parsed);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const isUnknown = (contents) => contents.trim() === '???';

  const handleSaveResult = useCallback((updatedKegs) => {
    setKegs((prev) => {
      const map = new Map(updatedKegs.map((k) => [k.number, k]));
      return prev.map((k) => map.get(k.number) || k);
    });
    setEditingKeg(null);
    setEditingBulk(false);
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleSort = (key) => {
    if (key === sortKey) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  // --- Long-press + tap handling ---

  const startPress = useCallback((kegNumber) => {
    pressedKeg.current = kegNumber;
    didLongPress.current = false;
    pressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      playClick();
      // Enter select mode and select this keg
      setSelectMode(true);
      setSelectedIds((prev) => new Set(prev).add(kegNumber));
    }, LONG_PRESS_MS);
  }, []);

  const cancelPress = useCallback(() => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);

  const endPress = useCallback((keg) => {
    cancelPress();
    // If long-press already fired, don't also do a tap action
    if (didLongPress.current) {
      didLongPress.current = false;
      return;
    }

    playClick();

    if (selectMode) {
      // Toggle selection
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(keg.number)) {
          next.delete(keg.number);
        } else {
          next.add(keg.number);
        }
        // Exit select mode if nothing selected
        if (next.size === 0) {
          setSelectMode(false);
        }
        return next;
      });
    } else {
      // Normal single-keg edit
      setEditingKeg(keg);
    }
  }, [selectMode, cancelPress]);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const openBulkEdit = useCallback(() => {
    playClick();
    setEditingBulk(true);
  }, []);

  if (loading) {
    return (
      <div className={styles.calculator}>
        <h2 className={styles.calcTitle}>Keg Status</h2>
        <p className={styles.calcSubtitle}>Loading keg data…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.calculator}>
        <h2 className={styles.calcTitle}>Keg Status</h2>
        <p className={styles.error}>{error}</p>
      </div>
    );
  }

  const sorted = sortKegs(kegs, sortKey, sortAsc);
  const selectedKegs = kegs.filter((k) => selectedIds.has(k.number));

  return (
    <div className={styles.calculator}>
      <div className={styles.kegTitleRow}>
        <div>
          <h2 className={styles.calcTitle}>Keg Status</h2>
          <p className={styles.calcSubtitle}>
            {selectMode
              ? `${selectedIds.size} keg${selectedIds.size !== 1 ? 's' : ''} selected — tap to toggle`
              : <>Current inventory — {kegs.filter((k) => !isUnknown(k.contents)).length} of {kegs.length} kegs filled</>
            }
          </p>
        </div>
        {selectMode && (
          <button className={styles.exitSelectBtn} onClick={() => { playClick(); exitSelectMode(); }}>
            Cancel
          </button>
        )}
      </div>

      <div className={styles.sortBar}>
        {SORT_OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            className={`${styles.sortBtn} ${sortKey === key ? styles.sortActive : ''}`}
            onClick={() => { playClick(); handleSort(key); }}
          >
            {label}
            {sortKey === key && (
              <span className={styles.sortArrow}>{sortAsc ? '▲' : '▼'}</span>
            )}
          </button>
        ))}
      </div>

      <div className={styles.kegGrid}>
        {sorted.map((keg) => {
          const color = getContentColor(keg.contents);
          const unknown = isUnknown(keg.contents);
          const rgb = color ? hexToRgb(color) : null;
          const isStout = keg.contents.trim().toLowerCase() === 'stout';
          const selected = selectedIds.has(keg.number);
          const cardStyle = rgb
            ? {
                borderLeft: `3px solid ${color}`,
                background: isStout
                  ? `linear-gradient(135deg, rgba(${rgb}, 0.55), var(--color-bg-tertiary, #1e293b))`
                  : `linear-gradient(135deg, rgba(${rgb}, 0.15), var(--color-bg-tertiary, #1e293b))`,
              }
            : {};
          const labelColor = isStout ? '#A68B6B' : color;
          return (
            <div
              key={keg.number}
              className={`${styles.kegCard} ${unknown ? styles.kegUnknown : ''} ${selected ? styles.kegSelected : ''}`}
              style={cardStyle}
              onPointerDown={(e) => {
                // Only handle primary button (left click / touch)
                if (e.button !== 0) return;
                e.preventDefault();
                startPress(keg.number);
              }}
              onPointerUp={() => endPress(keg)}
              onPointerLeave={cancelPress}
              onContextMenu={(e) => e.preventDefault()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (selectMode) {
                    endPress(keg);
                  } else {
                    setEditingKeg(keg);
                  }
                }
              }}
            >
              {selectMode && (
                <div className={styles.kegCheckbox}>
                  {selected && (
                    <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
              )}
              <div className={styles.kegHeader}>
                <span className={styles.kegNumber}>#{keg.number}</span>
                <span className={styles.kegVolume}>{keg.volume}</span>
              </div>
              <span className={styles.kegContents} style={labelColor ? { color: labelColor } : undefined}>
                {keg.contents}
              </span>
              {keg.date && <span className={styles.kegDate}>{keg.date}</span>}
              {keg.note && <span className={styles.kegNote}>{keg.note}</span>}
              {keg.abv && <span className={styles.kegAbv}>{keg.abv} ABV</span>}
            </div>
          );
        })}
      </div>

      {/* Floating bulk action bar */}
      {selectMode && selectedIds.size > 0 && (
        <div className={styles.bulkBar}>
          <span className={styles.bulkBarLabel}>
            {selectedIds.size} keg{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <button className={styles.calcButton} onClick={openBulkEdit}>
            Assign Content to {selectedIds.size} Keg{selectedIds.size !== 1 ? 's' : ''}
          </button>
        </div>
      )}

      {/* Single-keg edit modal */}
      {editingKeg && (
        <KegEditModal
          kegs={[editingKeg]}
          onClose={() => setEditingKeg(null)}
          onSave={handleSaveResult}
        />
      )}

      {/* Bulk edit modal */}
      {editingBulk && selectedKegs.length > 0 && (
        <KegEditModal
          kegs={selectedKegs}
          onClose={() => setEditingBulk(false)}
          onSave={handleSaveResult}
        />
      )}
    </div>
  );
}

export default KegStatusPage;
