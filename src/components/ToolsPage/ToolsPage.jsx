import { useState } from 'react';
import SidebarLayout from '../SidebarLayout/SidebarLayout';
import styles from './ToolsPage.module.css';

const TOOL_ITEMS = [
  {
    id: 'dilution',
    label: 'Dilution',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
        />
      </svg>
    ),
  },
];

function DilutionCalculator() {
  const [wortVolume, setWortVolume] = useState('');
  const [currentGravity, setCurrentGravity] = useState('');
  const [desiredGravity, setDesiredGravity] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  // Strip commas and normalise gravity to decimal SG (e.g. 1,050 / 1050 → 1.050)
  const parseGravity = (str) => {
    const num = parseFloat(String(str).replace(/,/g, ''));
    return num >= 2 ? num / 1000 : num;
  };

  const formatGravityBlur = (value, setter) => {
    const raw = String(value).replace(/,/g, '');
    const num = parseFloat(raw);
    if (!isNaN(num) && num >= 1000) {
      setter(num.toLocaleString('en-US'));
    }
  };

  const calculate = () => {
    const vol = parseFloat(wortVolume);
    const og = parseGravity(currentGravity);
    const dg = parseGravity(desiredGravity);

    if (isNaN(vol) || isNaN(og) || isNaN(dg)) {
      setError('Please fill in all fields.');
      setResult(null);
      return;
    }
    if (vol <= 0 || og <= 1 || dg <= 1) {
      setError('Gravity values must be greater than 1 (e.g. 1.050 or 1050).');
      setResult(null);
      return;
    }
    if (dg >= og) {
      setError('Desired gravity must be lower than current gravity.');
      setResult(null);
      return;
    }

    // Uses gravity points: NewVol = Vol × (OG - 1) / (DG - 1)
    const newVolume = (vol * (og - 1)) / (dg - 1);
    const difference = newVolume - vol;
    setResult({ newVolume, difference });
    setError('');
  };

  return (
    <div className={styles.calculator}>
      <h2 className={styles.calcTitle}>Dilution Calculator</h2>
      <p className={styles.calcSubtitle}>Target gravity is known — finds new volume</p>

      <div className={styles.fields}>
        <div className={styles.field}>
          <label className={styles.label}>Wort Volume</label>
          <div className={styles.inputRow}>
            <input
              className={styles.input}
              type="number"
              min="0"
              step="0.1"
              value={wortVolume}
              onChange={e => setWortVolume(e.target.value)}
              placeholder="e.g. 20"
            />
            <span className={styles.unit}>L</span>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Current Gravity</label>
          <input
            className={styles.input}
            type="text"
            inputMode="decimal"
            value={currentGravity}
            onChange={e => setCurrentGravity(e.target.value.replace(/,/g, ''))}
            onBlur={() => formatGravityBlur(currentGravity, setCurrentGravity)}
            placeholder="e.g. 1.075 or 1075"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Desired Gravity</label>
          <input
            className={styles.input}
            type="text"
            inputMode="decimal"
            value={desiredGravity}
            onChange={e => setDesiredGravity(e.target.value.replace(/,/g, ''))}
            onBlur={() => formatGravityBlur(desiredGravity, setDesiredGravity)}
            placeholder="e.g. 1.050 or 1050"
          />
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <button className={styles.calcButton} onClick={calculate}>
        Calculate
      </button>

      {result && (
        <div className={styles.results}>
          <div className={styles.resultRow}>
            <span className={styles.resultLabel}>New Volume</span>
            <span className={styles.resultValue}>{result.newVolume.toFixed(2)} L</span>
          </div>
          <div className={styles.resultRow}>
            <span className={styles.resultLabel}>Water to Add</span>
            <span className={`${styles.resultValue} ${styles.resultHighlight}`}>
              {result.difference.toFixed(2)} L
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolsPage() {
  const [activeTool, setActiveTool] = useState('dilution');

  return (
    <SidebarLayout
      title="Tools"
      items={TOOL_ITEMS}
      activeItem={activeTool}
      onItemChange={setActiveTool}
    >
      {activeTool === 'dilution' && <DilutionCalculator />}
    </SidebarLayout>
  );
}

export default ToolsPage;
