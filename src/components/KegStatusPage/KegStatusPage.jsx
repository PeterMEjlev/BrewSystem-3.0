import { useState, useEffect } from 'react';
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
        // Push empty dates to the end regardless of direction
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

function KegEditModal({ keg, onClose, onSave }) {
  const [form, setForm] = useState({
    contents: keg.contents,
    date: keg.date,
    note: keg.note,
    abv: keg.abv,
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSave = () => {
    if (!APPS_SCRIPT_URL) {
      setSaveError('Apps Script URL not configured. See google-apps-script/keg-updater.gs for setup instructions.');
      return;
    }
    setSaving(true);
    setSaveError('');

    fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ number: keg.number, ...form }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        onSave({ ...keg, ...form });
      })
      .catch((err) => setSaveError(err.message))
      .finally(() => setSaving(false));
  };

  const color = getContentColor(form.contents);

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>
            Edit Keg <span style={color ? { color } : undefined}>#{keg.number}</span>
          </h3>
          <button className={styles.modalClose} onClick={onClose}>×</button>
        </div>

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
            <label className={styles.label}>Date</label>
            <input
              className={styles.input}
              type="text"
              value={form.date}
              onChange={(e) => update('date', e.target.value)}
              placeholder="DD/MM/YYYY"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Note</label>
            <input
              className={styles.input}
              type="text"
              value={form.note}
              onChange={(e) => update('note', e.target.value)}
              placeholder="e.g. Dry-hopped"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>ABV</label>
            <input
              className={styles.input}
              type="text"
              value={form.abv}
              onChange={(e) => update('abv', e.target.value)}
              placeholder="e.g. 5.2%"
            />
          </div>
        </div>

        {saveError && <p className={styles.error}>{saveError}</p>}

        <div className={styles.modalActions}>
          <button className={styles.modalCancelBtn} onClick={() => { playClick(); onClose(); }}>Cancel</button>
          <button className={styles.calcButton} onClick={() => { playClick(); handleSave(); }} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
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
  const [editingKeg, setEditingKeg] = useState(null);

  useEffect(() => {
    fetch(SHEETS_CSV_URL)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch keg data');
        return res.text();
      })
      .then((text) => {
        const rows = parseCSV(text);
        // Row 0 is blank, row 1 is header — data starts at row 2
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

  const handleKegSave = (updatedKeg) => {
    setKegs((prev) =>
      prev.map((k) => (k.number === updatedKeg.number ? updatedKeg : k)),
    );
    setEditingKeg(null);
  };

  const handleSort = (key) => {
    if (key === sortKey) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

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

  return (
    <div className={styles.calculator}>
      <h2 className={styles.calcTitle}>Keg Status</h2>
      <p className={styles.calcSubtitle}>
        Current inventory — {kegs.filter((k) => !isUnknown(k.contents)).length} of{' '}
        {kegs.length} kegs filled
      </p>

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
              className={`${styles.kegCard} ${unknown ? styles.kegUnknown : ''}`}
              style={cardStyle}
              onClick={() => { playClick(); setEditingKeg(keg); }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setEditingKeg(keg)}
            >
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

      {editingKeg && (
        <KegEditModal
          keg={editingKeg}
          onClose={() => setEditingKeg(null)}
          onSave={handleKegSave}
        />
      )}
    </div>
  );
}

export default KegStatusPage;
