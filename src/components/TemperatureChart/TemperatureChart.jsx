import { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { brewSystem } from '../../utils/mockHardware';
import styles from './TemperatureChart.module.css';

function TemperatureChart() {
  const [data, setData] = useState([]);
  const [visibility, setVisibility] = useState({
    BK: true,
    MLT: true,
    HLT: true,
  });
  const dataRef = useRef([]);
  const maxDataPoints = 120; // 2 minutes at 1 second intervals

  useEffect(() => {
    const interval = setInterval(() => {
      const states = brewSystem.getAllStates();
      const timestamp = new Date().toLocaleTimeString();

      const newPoint = {
        time: timestamp,
        BK: states.pots.BK.pv,
        MLT: states.pots.MLT.pv,
        HLT: states.pots.HLT.pv,
      };

      dataRef.current = [...dataRef.current, newPoint].slice(-maxDataPoints);
      setData([...dataRef.current]);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const toggleVisibility = (pot) => {
    setVisibility((prev) => ({
      ...prev,
      [pot]: !prev[pot],
    }));
  };

  return (
    <div className={styles.chartPanel}>
      <div className={styles.header}>
        <h2 className={styles.title}>Temperature Chart</h2>
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
          <LineChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
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
                backgroundColor: '#1e293b',
                border: '1px solid #475569',
                borderRadius: '8px',
              }}
              labelStyle={{ color: '#cbd5e1' }}
              itemStyle={{ color: '#f1f5f9' }}
            />
            <Legend wrapperStyle={{ color: '#cbd5e1' }} />
            {visibility.BK && <Line type="monotone" dataKey="BK" stroke="#ef4444" strokeWidth={2} dot={false} />}
            {visibility.MLT && <Line type="monotone" dataKey="MLT" stroke="#10b981" strokeWidth={2} dot={false} />}
            {visibility.HLT && <Line type="monotone" dataKey="HLT" stroke="#3b82f6" strokeWidth={2} dot={false} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default TemperatureChart;
