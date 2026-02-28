import { useState, useEffect, useRef, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { brewSystem } from '../../utils/mockHardware';
import { hardwareApi } from '../../utils/hardwareApi';
import { useTheme } from '../../contexts/ThemeContext';
import styles from './TemperatureChart.module.css';

const WINDOW_MAX = 120; // slider max = "Full session"
const MIN_ZOOM_MS = 30000; // minimum zoom range: 30 seconds

const formatTime = (date) =>
  date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

// --- Module-level data store & polling (survives component unmount/remount) ---
let persistedData = [];
let pollingStarted = false;
const subscribers = new Set(); // functions to call when data changes

function notifySubscribers() {
  const snapshot = [...persistedData];
  subscribers.forEach((fn) => fn(snapshot));
}

function startGlobalPolling() {
  if (pollingStarted) return;
  pollingStarted = true;

  const isProduction = localStorage.getItem('brewSystemEnvironment') === 'production';

  // Seed with history in production
  if (isProduction) {
    hardwareApi.getTemperatureHistory().then((history) => {
      if (!Array.isArray(history) || history.length === 0) return;
      if (persistedData.length > 0) return; // already have data from polling
      persistedData = history.map((row) => ({
        ts: new Date(row.timestamp).getTime(),
        time: formatTime(new Date(row.timestamp)),
        BK: row.bk,
        MLT: row.mlt,
        HLT: row.hlt,
      }));
      notifySubscribers();
    });
  }

  const poll = async () => {
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

    persistedData = [...persistedData, {
      ts: Date.now(),
      time: formatTime(new Date()),
      BK: bk,
      MLT: mlt,
      HLT: hlt,
    }];
    notifySubscribers();
  };

  const beginPolling = (ms) => {
    const delay = ms - (Date.now() % ms);
    setTimeout(() => {
      poll();
      setInterval(poll, ms);
    }, delay);
  };

  fetch('/api/settings')
    .then((r) => r.json())
    .then((s) => beginPolling((s?.app?.log_interval_seconds ?? 10) * 1000))
    .catch(() => beginPolling(10000));
}

function TemperatureChart() {
  const { theme } = useTheme();
  const [data, setData] = useState(persistedData);
  const [visibility, setVisibility] = useState({
    BK: true,
    MLT: true,
    HLT: true,
  });
  const [windowMinutes, setWindowMinutes] = useState(WINDOW_MAX);
  const [zoomDomain, setZoomDomain] = useState(null); // { start, end } timestamps or null
  const [isPanning, setIsPanning] = useState(false);
  const chartContainerRef = useRef(null);
  const panRef = useRef(null); // { startX, domainStart, domainEnd }
  const touchRef = useRef(null); // { distance, centerX, domainStart, domainEnd }

  // Start global polling once and subscribe to data updates
  useEffect(() => {
    startGlobalPolling();
    const handler = (snapshot) => setData(snapshot);
    subscribers.add(handler);
    // Sync with any data collected while unmounted
    setData([...persistedData]);
    return () => { subscribers.delete(handler); };
  }, []);

  // Reset zoom when slider changes
  useEffect(() => { setZoomDomain(null); }, [windowMinutes]);

  const toggleVisibility = (pot) => {
    setVisibility((prev) => ({
      ...prev,
      [pot]: !prev[pot],
    }));
  };

  // Derive the visible slice from the full data based on selected window
  const now = data.length > 0 ? data[data.length - 1].ts : 0;
  const cutoff = now - windowMinutes * 60 * 1000;
  const windowData = windowMinutes >= WINDOW_MAX
    ? data
    : data.filter((p) => p.ts >= cutoff);

  // Apply zoom filter on top of slider window
  const displayData = zoomDomain
    ? windowData.filter((p) => p.ts >= zoomDomain.start && p.ts <= zoomDomain.end)
    : windowData;

  // Helper: get full time bounds of the slider window
  const getWindowBounds = useCallback(() => {
    if (windowData.length < 2) return null;
    return { start: windowData[0].ts, end: windowData[windowData.length - 1].ts };
  }, [windowData]);

  // Helper: get current visible bounds (zoom or full window)
  const getVisibleBounds = useCallback(() => {
    if (zoomDomain) return zoomDomain;
    return getWindowBounds();
  }, [zoomDomain, getWindowBounds]);

  // Helper: map a clientX pixel position to a 0–1 ratio across the chart area
  const xToRatio = useCallback((clientX) => {
    const container = chartContainerRef.current;
    if (!container) return 0.5;
    const rect = container.getBoundingClientRect();
    // Approximate recharts drawing area (accounting for Y-axis label + margins)
    const chartLeft = 80;
    const chartRight = rect.width - 30;
    return Math.max(0, Math.min(1, (clientX - rect.left - chartLeft) / (chartRight - chartLeft)));
  }, []);

  // Helper: apply a zoom centered on a pivot ratio
  const applyZoom = useCallback((zoomFactor, pivotRatio) => {
    const bounds = getVisibleBounds();
    const windowBounds = getWindowBounds();
    if (!bounds || !windowBounds) return;

    const range = bounds.end - bounds.start;
    const newRange = range * zoomFactor;

    // Zoom out past full window → reset
    const fullRange = windowBounds.end - windowBounds.start;
    if (newRange >= fullRange) { setZoomDomain(null); return; }
    // Don't zoom in past minimum
    if (newRange < MIN_ZOOM_MS) return;

    const pivot = bounds.start + range * pivotRatio;
    let newStart = pivot - newRange * pivotRatio;
    let newEnd = pivot + newRange * (1 - pivotRatio);

    // Clamp to window bounds
    if (newStart < windowBounds.start) { newEnd += windowBounds.start - newStart; newStart = windowBounds.start; }
    if (newEnd > windowBounds.end) { newStart -= newEnd - windowBounds.end; newEnd = windowBounds.end; }
    newStart = Math.max(newStart, windowBounds.start);
    newEnd = Math.min(newEnd, windowBounds.end);

    setZoomDomain({ start: newStart, end: newEnd });
  }, [getVisibleBounds, getWindowBounds]);

  // Helper: pan by a pixel delta
  const applyPan = useCallback((deltaRatio, refDomain) => {
    const windowBounds = getWindowBounds();
    if (!windowBounds || !refDomain) return;

    const fullRange = windowBounds.end - windowBounds.start;
    const deltaMs = deltaRatio * fullRange;

    let newStart = refDomain.start - deltaMs;
    let newEnd = refDomain.end - deltaMs;

    // Clamp
    if (newStart < windowBounds.start) { newEnd += windowBounds.start - newStart; newStart = windowBounds.start; }
    if (newEnd > windowBounds.end) { newStart -= newEnd - windowBounds.end; newEnd = windowBounds.end; }
    newStart = Math.max(newStart, windowBounds.start);
    newEnd = Math.min(newEnd, windowBounds.end);

    setZoomDomain({ start: newStart, end: newEnd });
  }, [getWindowBounds]);

  // --- Mouse wheel zoom ---
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;
    const handler = (e) => {
      e.preventDefault();
      const ratio = xToRatio(e.clientX);
      const factor = e.deltaY > 0 ? 1.25 : 0.8;
      applyZoom(factor, ratio);
    };
    container.addEventListener('wheel', handler, { passive: false });
    return () => container.removeEventListener('wheel', handler);
  }, [xToRatio, applyZoom]);

  // --- Mouse drag pan ---
  const handleMouseDown = useCallback((e) => {
    if (!zoomDomain || e.button !== 0) return;
    e.preventDefault();
    setIsPanning(true);
    panRef.current = { startX: e.clientX, domainStart: zoomDomain.start, domainEnd: zoomDomain.end };
  }, [zoomDomain]);

  const handleMouseMove = useCallback((e) => {
    if (!panRef.current || !isPanning) return;
    const container = chartContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const chartWidth = rect.width - 110; // approximate chart drawing width
    const deltaRatio = (e.clientX - panRef.current.startX) / chartWidth;
    applyPan(deltaRatio, { start: panRef.current.domainStart, end: panRef.current.domainEnd });
  }, [isPanning, applyPan]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    panRef.current = null;
  }, []);

  // --- Touch: pinch zoom + single-finger pan ---
  const getTouchDistance = (touches) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = useCallback((e) => {
    if (e.touches.length === 2) {
      // Pinch start
      const dist = getTouchDistance(e.touches);
      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const bounds = getVisibleBounds();
      touchRef.current = { distance: dist, centerX, domainStart: bounds?.start, domainEnd: bounds?.end };
    } else if (e.touches.length === 1 && zoomDomain) {
      // Pan start
      setIsPanning(true);
      panRef.current = { startX: e.touches[0].clientX, domainStart: zoomDomain.start, domainEnd: zoomDomain.end };
    }
  }, [zoomDomain, getVisibleBounds]);

  const handleTouchMove = useCallback((e) => {
    if (e.touches.length === 2 && touchRef.current) {
      e.preventDefault();
      const newDist = getTouchDistance(e.touches);
      const scale = touchRef.current.distance / newDist; // pinch in = scale > 1 = zoom in
      const pivotRatio = xToRatio(touchRef.current.centerX);
      const refDomain = { start: touchRef.current.domainStart, end: touchRef.current.domainEnd };
      const refRange = refDomain.end - refDomain.start;
      const newRange = refRange * scale;

      const windowBounds = getWindowBounds();
      if (!windowBounds) return;
      const fullRange = windowBounds.end - windowBounds.start;
      if (newRange >= fullRange) { setZoomDomain(null); return; }
      if (newRange < MIN_ZOOM_MS) return;

      const pivot = refDomain.start + refRange * pivotRatio;
      let newStart = pivot - newRange * pivotRatio;
      let newEnd = pivot + newRange * (1 - pivotRatio);
      if (newStart < windowBounds.start) { newEnd += windowBounds.start - newStart; newStart = windowBounds.start; }
      if (newEnd > windowBounds.end) { newStart -= newEnd - windowBounds.end; newEnd = windowBounds.end; }
      newStart = Math.max(newStart, windowBounds.start);
      newEnd = Math.min(newEnd, windowBounds.end);
      setZoomDomain({ start: newStart, end: newEnd });
    } else if (e.touches.length === 1 && panRef.current && isPanning) {
      e.preventDefault();
      const container = chartContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const chartWidth = rect.width - 110;
      const deltaRatio = (e.touches[0].clientX - panRef.current.startX) / chartWidth;
      applyPan(deltaRatio, { start: panRef.current.domainStart, end: panRef.current.domainEnd });
    }
  }, [isPanning, xToRatio, getWindowBounds, applyPan]);

  const handleTouchEnd = useCallback(() => {
    touchRef.current = null;
    setIsPanning(false);
    panRef.current = null;
  }, []);

  // Determine if the visible range is less than 1 minute (show seconds in that case)
  const visibleRangeMs = displayData.length >= 2
    ? displayData[displayData.length - 1].ts - displayData[0].ts
    : Infinity;
  const isSubMinuteZoom = visibleRangeMs < 60000;

  // Generate tick values at exact minute boundaries for the XAxis
  const xTicks = (() => {
    if (displayData.length < 2) return undefined;
    const first = displayData[0].ts;
    const last = displayData[displayData.length - 1].ts;
    if (isSubMinuteZoom) return undefined; // let recharts auto-generate ticks

    const totalMinutes = (last - first) / 60000;
    // Estimate how many labels fit (~80px per label, chart ≈ container - 110px margins)
    const containerWidth = chartContainerRef.current?.getBoundingClientRect().width ?? 800;
    const chartWidth = containerWidth - 110;
    const maxTicks = Math.max(2, Math.floor(chartWidth / 80));

    // Pick a step in whole minutes that keeps tick count under maxTicks
    // Use nice steps: 1, 2, 5, 10, 15, 30, 60
    const niceSteps = [1, 2, 5, 10, 15, 30, 60];
    let stepMinutes = niceSteps.find((s) => totalMinutes / s <= maxTicks) ?? 60;

    const stepMs = stepMinutes * 60000;
    const firstTick = Math.ceil(first / stepMs) * stepMs;
    const ticks = [];
    for (let t = firstTick; t <= last; t += stepMs) {
      ticks.push(t);
    }
    return ticks.length > 0 ? ticks : undefined;
  })();

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

      <div
        ref={chartContainerRef}
        className={`${styles.chartContainer} ${zoomDomain ? styles.zoomed : ''} ${isPanning ? styles.panning : ''}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {zoomDomain && (
          <button
            className={styles.resetZoom}
            onClick={(e) => { e.stopPropagation(); setZoomDomain(null); }}
          >
            Reset Zoom
          </button>
        )}
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={displayData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis
              dataKey="ts"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              ticks={xTicks}
              stroke="#94a3b8"
              tick={{ fill: '#94a3b8' }}
              tickLine={{ stroke: '#94a3b8' }}
              tickFormatter={(ts) => {
                const d = new Date(ts);
                if (isSubMinuteZoom) return formatTime(d);
                return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
              }}
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
              labelFormatter={(ts) => formatTime(new Date(ts))}
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
