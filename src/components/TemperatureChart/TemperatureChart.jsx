import { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { brewSystem } from '../../utils/mockHardware';
import { hardwareApi } from '../../utils/hardwareApi';
import { useTheme } from '../../contexts/ThemeContext';
import styles from './TemperatureChart.module.css';

const WINDOW_MAX = 120; // slider max = "Full session"

const formatTime = (date) =>
  date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

function TemperatureChart() {
  const { theme } = useTheme();
  const [data, setData] = useState([]);
  const [visibility, setVisibility] = useState({
    BK: true,
    MLT: true,
    HLT: true,
  });
  const [windowMinutes, setWindowMinutes] = useState(WINDOW_MAX);
  const dataRef = useRef([]);
  const isProduction = useRef(
    localStorage.getItem('brewSystemEnvironment') === 'production'
  ).current;

  // Seed chart with full session history on mount (production only)
  useEffect(() => {
    if (!isProduction) return;
    hardwareApi.getTemperatureHistory().then((history) => {
      if (!Array.isArray(history) || history.length === 0) return;
      const seeded = history.map((row) => ({
        ts: new Date(row.timestamp).getTime(),
        time: formatTime(new Date(row.timestamp)),
        BK: row.bk,
        MLT: row.mlt,
        HLT: row.hlt,
      }));
      dataRef.current = seeded;
      setData([...seeded]);
    });
  }, [isProduction]);

  // Polling — interval is read from settings API on mount, defaults to 10s
  useEffect(() => {
    let interval;

    const startPolling = (ms) => {
      interval = setInterval(async () => {
        let bk, mlt, hlt;

        if (isProduction) {
          const temps = await hardwareApi.getTemperatures();
          if (!temps) return;
          ({ bk, mlt, hlt } = temps);
        } else {
          const states = brewSystem.getAllStates();
          bk = states.pots.BK.pv;
          mlt = states.pots.MLT.pv;
          hlt = states.pots.HLT.pv;
        }

        const newPoint = {
          ts: Date.now(),
          time: formatTime(new Date()),
          BK: bk,
          MLT: mlt,
          HLT: hlt,
        };

        dataRef.current = [...dataRef.current, newPoint];
        setData([...dataRef.current]);
      }, ms);
    };

    fetch('/api/settings')
      .then((r) => r.json())
      .then((s) => startPolling((s?.app?.log_interval_seconds ?? 10) * 1000))
      .catch(() => startPolling(10000));

    return () => { if (interval) clearInterval(interval); };
  }, [isProduction]);

  const toggleVisibility = (pot) => {
    setVisibility((prev) => ({
      ...prev,
      [pot]: !prev[pot],
    }));
  };

  // Derive the visible slice from the full data based on selected window
  const cutoff = Date.now() - windowMinutes * 60 * 1000;
  const displayData = windowMinutes >= WINDOW_MAX
    ? data
    : data.filter((p) => p.ts >= cutoff);

  const windowLabel = windowMinutes >= WINDOW_MAX
    ? 'Full session'
    : windowMinutes === 60
    ? 'Last 1 hr'
    : `Last ${windowMinutes} min`;

  return (
    <div className={styles.chartPanel}>
      <div className={styles.header}>
        <h2 className={styles.title}>Temperature Chart</h2>

        <div className={styles.sliderRow}>
          <input
            type="range"
            min={5}
            max={WINDOW_MAX}
            step={1}
            value={windowMinutes}
            onChange={(e) => setWindowMinutes(Number(e.target.value))}
            className={styles.slider}
          />
          <span className={styles.windowLabel}>{windowLabel}</span>
        </div>

        <div className={styles.toggles}>
          <button
            className={`${styles.toggleBtn} ${visibility.BK ? styles.bk : styles.off}`}
            onClick={() => toggleVisibility('BK')}
          >
            BK
          </button>
          <button
            className={`${styles.toggleBtn} ${visibility.MLT ? styles.mlt : styles.off}`}
            onClick={() => toggleVisibility('MLT')}
          >
            MLT
          </button>
          <button
            className={`${styles.toggleBtn} ${visibility.HLT ? styles.hlt : styles.off}`}
            onClick={() => toggleVisibility('HLT')}
          >
            HLT
          </button>
        </div>
      </div>

      <div className={styles.chartContainer}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={displayData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis
              dataKey="time"
              stroke="#94a3b8"
              tick={{ fill: '#94a3b8' }}
              tickLine={{ stroke: '#94a3b8' }}
            />
            <YAxis
              domain={[0, 100]}
              stroke="#94a3b8"
              tick={{ fill: '#94a3b8' }}
              tickLine={{ stroke: '#94a3b8' }}
              label={{ value: '°C', angle: -90, position: 'insideLeft', fill: '#94a3b8' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: theme.bgSecondary,
                border: '1px solid #475569',
                borderRadius: '8px',
              }}
              labelStyle={{ color: '#cbd5e1' }}
              itemStyle={{ color: '#f1f5f9' }}
              formatter={(value, name) => [`${Number(value).toFixed(1)} °C`, name]}
            />
            <Legend wrapperStyle={{ color: '#cbd5e1' }} />
            {visibility.BK && <Line type="monotone" dataKey="BK" stroke={theme.vesselBK} strokeWidth={2} dot={false} />}
            {visibility.MLT && <Line type="monotone" dataKey="MLT" stroke={theme.vesselMLT} strokeWidth={2} dot={false} />}
            {visibility.HLT && <Line type="monotone" dataKey="HLT" stroke={theme.vesselHLT} strokeWidth={2} dot={false} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default TemperatureChart;
