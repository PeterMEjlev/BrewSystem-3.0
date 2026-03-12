import { useState, useRef, useCallback } from 'react';
import styles from './ToolsPage.module.css';

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
  const panelRef = useRef(null);
  const dragState = useRef({ isDragging: false, startY: 0, startScroll: 0, moved: false });

  const onPointerDown = useCallback((e) => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'TEXTAREA') return;
    dragState.current = {
      isDragging: true,
      startY: e.clientY,
      startScroll: panelRef.current.scrollTop,
      moved: false,
    };
  }, []);

  const onPointerMove = useCallback((e) => {
    if (!dragState.current.isDragging) return;
    const dy = e.clientY - dragState.current.startY;
    if (Math.abs(dy) > 3) dragState.current.moved = true;
    panelRef.current.scrollTop = dragState.current.startScroll - dy;
  }, []);

  const onPointerUp = useCallback(() => {
    dragState.current.isDragging = false;
  }, []);

  const onClickCapture = useCallback((e) => {
    if (dragState.current.moved) {
      e.stopPropagation();
      dragState.current.moved = false;
    }
  }, []);

  return (
    <div
      className={styles.toolsPage}
      ref={panelRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onClickCapture={onClickCapture}
    >
      <h1 className={styles.pageTitle}>Tools</h1>
      <DilutionCalculator />
    </div>
  );
}

export default ToolsPage;
