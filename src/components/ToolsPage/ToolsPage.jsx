import { useState, useEffect } from 'react';
import SidebarLayout from '../SidebarLayout/SidebarLayout';
import { playClick } from '../../utils/sounds';
import styles from './ToolsPage.module.css';

const TOOL_ITEMS = [
  {
    id: 'dilution',
    label: 'Dilution',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 2c0 0-7 8-7 13a7 7 0 0014 0c0-5-7-13-7-13z"
        />
      </svg>
    ),
  },
  {
    id: 'hydrometer',
    label: 'Hydrometer',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
        {/* Rim */}
        <path strokeLinecap="round" strokeWidth={2} d="M8 3h8"/>
        {/* Vial body with rounded bottom */}
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 3v14a3 3 0 006 0V3"
        />
        {/* Liquid level line */}
        <path strokeLinecap="round" strokeWidth={1.5} d="M9 14h6"/>
      </svg>
    ),
  },
  {
    id: 'carbonation',
    label: 'Carbonation',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M8 12c0-1.5.5-3 2-4m4 8c0 1.5-.5 3-2 4M12 8v1m0 6v1"
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

      <button className={styles.calcButton} onClick={() => { playClick(); calculate(); }}>
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

const CARBONATION_GUIDELINES = [
  { style: 'British Style Ales',       range: '1.5 – 2.0' },
  { style: 'Belgian Ales',             range: '1.9 – 2.4' },
  { style: 'American Ales and Lager',  range: '2.2 – 2.7' },
  { style: 'Porter, Stout',            range: '1.7 – 2.3' },
  { style: 'European Lagers',          range: '2.2 – 2.7' },
  { style: 'Fruit Lambic',             range: '3.0 – 4.5' },
  { style: 'Lambic',                   range: '2.4 – 2.8' },
  { style: 'German Wheat Beer',        range: '3.3 – 4.5' },
];

function CarbonationCalculator() {
  const [volumes, setVolumes] = useState('');
  const [tempC, setTempC] = useState('');
  const [pressureUnit, setPressureUnit] = useState('bar');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const calculate = () => {
    const v = parseFloat(volumes);
    const t = parseFloat(tempC);

    if (isNaN(v) || isNaN(t)) {
      setError('Please fill in all fields.');
      setResult(null);
      return;
    }
    if (v <= 0) {
      setError('Volumes of CO2 must be greater than zero.');
      setResult(null);
      return;
    }

    // Formula uses °F internally; convert from °C
    const T = t * 9 / 5 + 32;
    const V = v;
    const psi =
      -16.6999
      - 0.0101059 * T
      + 0.00116512 * T * T
      + 0.173354 * T * V
      + 4.24267 * V
      - 0.0684226 * V * V;

    const pressure = pressureUnit === 'bar' ? psi * 0.0689476 : psi;
    setResult(pressure);
    setError('');
  };

  const displayResult = result !== null
    ? `${result.toFixed(2)} ${pressureUnit}`
    : null;

  return (
    <div className={styles.calculator}>
      <h2 className={styles.calcTitle}>Carbonation Calculator</h2>
      <p className={styles.calcSubtitle}>Finds the regulator pressure needed to force-carbonate at a given temperature</p>

      <div className={styles.fields}>
        <div className={styles.field}>
          <label className={styles.label}>Pressure Unit</label>
          <div className={styles.segmented}>
            <button
              className={`${styles.segBtn} ${pressureUnit === 'bar' ? styles.segActive : ''}`}
              onClick={() => { playClick(); setPressureUnit('bar'); setResult(null); }}
            >bar</button>
            <button
              className={`${styles.segBtn} ${pressureUnit === 'psi' ? styles.segActive : ''}`}
              onClick={() => { playClick(); setPressureUnit('psi'); setResult(null); }}
            >PSI</button>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Volumes of CO₂</label>
          <input
            className={styles.input}
            type="number"
            min="0"
            step="0.1"
            value={volumes}
            onChange={e => setVolumes(e.target.value)}
            placeholder="e.g. 2.4"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Keg Temperature</label>
          <div className={styles.inputRow}>
            <input
              className={styles.input}
              type="number"
              step="0.5"
              value={tempC}
              onChange={e => setTempC(e.target.value)}
              placeholder="e.g. 2"
            />
            <span className={styles.unit}>°C</span>
          </div>
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <button className={styles.calcButton} onClick={() => { playClick(); calculate(); }}>
        Calculate
      </button>

      {displayResult && (
        <div className={styles.results}>
          <div className={styles.resultRow}>
            <span className={styles.resultLabel}>Regulator Setting</span>
            <span className={`${styles.resultValue} ${styles.resultHighlight}`}>
              {displayResult}
            </span>
          </div>
        </div>
      )}

      <div className={styles.guidelines}>
        <h3 className={styles.guidelinesTitle}>Carbonation Guidelines by Style</h3>
        <div className={styles.guidelinesTable}>
          {CARBONATION_GUIDELINES.map(({ style, range }) => (
            <div key={style} className={styles.guidelineRow}>
              <span className={styles.guidelineStyle}>{style}</span>
              <span className={styles.guidelineRange}>{range} vol</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HydrometerCalculator() {
  const [reading, setReading] = useState('');
  const [sampleTemp, setSampleTemp] = useState('');
  const [calibTemp, setCalibTemp] = useState('20');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const calculate = () => {
    // Normalise: accept both 1.027 and 1027
    const rawSg = parseFloat(reading);
    const sg = rawSg >= 2 ? rawSg / 1000 : rawSg;
    const T = parseFloat(sampleTemp);
    const C = parseFloat(calibTemp);

    if (isNaN(sg) || isNaN(T) || isNaN(C)) {
      setError('Please fill in all fields.');
      setResult(null);
      return;
    }
    if (sg <= 0) {
      setError('Hydrometer reading must be greater than zero.');
      setResult(null);
      return;
    }

    // Formula requires °F internally (BrewersFriend standard)
    const toF = (c) => c * 9 / 5 + 32;
    const adj = (tF) =>
      (1.313454 - 0.132674 * tF + 0.002057793 * tF * tF - 0.000002627634 * tF * tF * tF) * 0.001;

    const corrected = sg + adj(toF(T)) - adj(toF(C));
    setResult(corrected);
    setError('');
  };

  return (
    <div className={styles.calculator}>
      <h2 className={styles.calcTitle}>Hydrometer Temperature Adjustment</h2>
      <p className={styles.calcSubtitle}>Corrects a hydrometer reading for the difference between sample temperature and calibration temperature</p>

      <div className={styles.fields}>
        <div className={styles.field}>
          <label className={styles.label}>Hydrometer Reading</label>
          <div className={styles.inputRow}>
            <input
              className={styles.input}
              type="number"
              step="0.001"
              value={reading}
              onChange={e => setReading(e.target.value)}
              placeholder="e.g. 1.020"
            />
            <span className={styles.unit}>SG</span>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Sample Temperature</label>
          <div className={styles.inputRow}>
            <input
              className={styles.input}
              type="number"
              step="0.5"
              value={sampleTemp}
              onChange={e => setSampleTemp(e.target.value)}
              placeholder="e.g. 27"
            />
            <span className={styles.unit}>°C</span>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Calibration Temperature</label>
          <div className={styles.inputRow}>
            <input
              className={styles.input}
              type="number"
              step="0.5"
              value={calibTemp}
              onChange={e => setCalibTemp(e.target.value)}
              placeholder="e.g. 20"
            />
            <span className={styles.unit}>°C</span>
          </div>
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <button className={styles.calcButton} onClick={() => { playClick(); calculate(); }}>
        Calculate
      </button>

      {result !== null && (
        <div className={styles.results}>
          <div className={styles.resultRow}>
            <span className={styles.resultLabel}>Adjusted Value</span>
            <span className={`${styles.resultValue} ${styles.resultHighlight}`}>
              {result.toFixed(3)}
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
      {activeTool === 'hydrometer' && <HydrometerCalculator />}
      {activeTool === 'carbonation' && <CarbonationCalculator />}
    </SidebarLayout>
  );
}

export default ToolsPage;
