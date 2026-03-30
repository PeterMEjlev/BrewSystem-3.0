import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Legend, ResponsiveContainer } from 'recharts';
import { brewSystem } from '../../utils/mockHardware';
import { hardwareApi } from '../../utils/hardwareApi';
import { useTheme } from '../../contexts/ThemeContext';
import styles from './TemperatureChart.module.css';
import { lttbDownsample } from '../../utils/downsample';

const WINDOW_MAX = 120; // slider max = "Full session"
const MIN_ZOOM_MS = 30000; // minimum zoom range: 30 seconds
const MAX_PERSISTED_POINTS = 8640; // 24h at 10s intervals

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

  const isProduction = localStorage.getItem('brewSystemEnvironment') !== 'development';

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
      if (persistedData.length > MAX_PERSISTED_POINTS) {
        persistedData = persistedData.slice(persistedData.length - MAX_PERSISTED_POINTS);
      }
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
    if (persistedData.length > MAX_PERSISTED_POINTS) {
      persistedData = persistedData.slice(persistedData.length - MAX_PERSISTED_POINTS);
    }
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

// Start polling immediately on module load (not lazily on first mount)
startGlobalPolling();

function getTouchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
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
  const [maxChartPoints, setMaxChartPoints] = useState(150); // kept low for RPi SVG performance
  const [tooltipState, setTooltipState] = useState(null); // { payload, label, x, y }
  const chartContainerRef = useRef(null);
  const panRef = useRef(null); // { startX, domainStart, domainEnd, chartWidth }
  const touchRef = useRef(null); // { distance, centerX, domainStart, domainEnd }
  const dragHappenedRef = useRef(false);
  // RAF throttle refs — prevent re-rendering on every pixel during pan/zoom
  const panRafRef = useRef(null);
  const latestPanRef = useRef(null);
  const touchRafRef = useRef(null);
  const latestTouchRef = useRef(null);

  // Subscribe to data updates (polling already started at module level)
  useEffect(() => {
    const handler = (snapshot) => setData(snapshot);
    subscribers.add(handler);
    // Sync with any data collected while unmounted
    setData([...persistedData]);
    return () => { subscribers.delete(handler); };
  }, []);

  // Fetch max chart points from settings on every mount so changes take effect immediately
  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((s) => setMaxChartPoints(s?.app?.max_chart_points ?? 150))
      .catch(() => {});
  }, []);

  // Reset zoom and tooltip when slider changes
  useEffect(() => { setZoomDomain(null); setTooltipState(null); }, [windowMinutes]);

  const toggleVisibility = (pot) => {
    setVisibility((prev) => ({
      ...prev,
      [pot]: !prev[pot],
    }));
  };

  // Memoized window slice — only recomputes when data or windowMinutes changes, not on every render
  const windowData = useMemo(() => {
    if (data.length === 0) return data;
    const now = data[data.length - 1].ts;
    const cutoff = now - windowMinutes * 60 * 1000;
    return windowMinutes >= WINDOW_MAX ? data : data.filter((p) => p.ts >= cutoff);
  }, [data, windowMinutes]);

  // Memoized display data — only recomputes when zoom domain, window, or point limit changes
  const displayData = useMemo(() => {
    const raw = zoomDomain
      ? windowData.filter((p) => p.ts >= zoomDomain.start && p.ts <= zoomDomain.end)
      : windowData;
    return lttbDownsample(raw, maxChartPoints);
  }, [windowData, zoomDomain, maxChartPoints]);

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

  // --- Mouse wheel zoom with RAF throttle ---
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;
    let latestWheel = null;
    let wheelRaf = null;
    const handler = (e) => {
      e.preventDefault();
      latestWheel = { factor: e.deltaY > 0 ? 1.25 : 0.8, ratio: xToRatio(e.clientX) };
      if (wheelRaf) return;
      wheelRaf = requestAnimationFrame(() => {
        if (latestWheel) applyZoom(latestWheel.factor, latestWheel.ratio);
        wheelRaf = null;
        latestWheel = null;
      });
    };
    container.addEventListener('wheel', handler, { passive: false });
    return () => {
      container.removeEventListener('wheel', handler);
      if (wheelRaf) cancelAnimationFrame(wheelRaf);
    };
  }, [xToRatio, applyZoom]);

  // --- Mouse drag pan ---
  const handleMouseDown = useCallback((e) => {
    dragHappenedRef.current = false;
    if (!zoomDomain || e.button !== 0) return;
    e.preventDefault();
    setIsPanning(true);
    // Cache chartWidth here to avoid getBoundingClientRect on every mousemove
    const rect = chartContainerRef.current?.getBoundingClientRect();
    panRef.current = {
      startX: e.clientX,
      domainStart: zoomDomain.start,
      domainEnd: zoomDomain.end,
      chartWidth: rect ? rect.width - 110 : 800,
    };
  }, [zoomDomain]);

  const handleMouseMove = useCallback((e) => {
    if (!panRef.current || !isPanning) return;
    dragHappenedRef.current = true;
    const deltaRatio = (e.clientX - panRef.current.startX) / panRef.current.chartWidth;
    // Store latest pan params; RAF callback picks up the most recent values
    latestPanRef.current = { deltaRatio, refDomain: { start: panRef.current.domainStart, end: panRef.current.domainEnd } };
    if (panRafRef.current) return; // RAF already scheduled for this frame
    panRafRef.current = requestAnimationFrame(() => {
      const p = latestPanRef.current;
      if (p) applyPan(p.deltaRatio, p.refDomain);
      panRafRef.current = null;
      latestPanRef.current = null;
    });
  }, [isPanning, applyPan]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    panRef.current = null;
  }, []);

  // --- Touch: pinch zoom + single-finger pan ---
  const handleTouchStart = useCallback((e) => {
    dragHappenedRef.current = false;
    if (e.touches.length === 2) {
      // Pinch start
      const dist = getTouchDistance(e.touches);
      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const bounds = getVisibleBounds();
      touchRef.current = { distance: dist, centerX, domainStart: bounds?.start, domainEnd: bounds?.end };
    } else if (e.touches.length === 1 && zoomDomain) {
      // Pan start — cache chartWidth to avoid reflow on every touchmove
      setIsPanning(true);
      const rect = chartContainerRef.current?.getBoundingClientRect();
      panRef.current = {
        startX: e.touches[0].clientX,
        domainStart: zoomDomain.start,
        domainEnd: zoomDomain.end,
        chartWidth: rect ? rect.width - 110 : 800,
      };
    }
  }, [zoomDomain, getVisibleBounds]);

  const handleTouchMove = useCallback((e) => {
    if (e.touches.length === 2 && touchRef.current) {
      e.preventDefault();
      const newDist = getTouchDistance(e.touches);
      latestTouchRef.current = { type: 'pinch', newDist };
    } else if (e.touches.length === 1 && panRef.current && isPanning) {
      e.preventDefault();
      dragHappenedRef.current = true;
      const deltaRatio = (e.touches[0].clientX - panRef.current.startX) / panRef.current.chartWidth;
      latestTouchRef.current = { type: 'pan', deltaRatio, refDomain: { start: panRef.current.domainStart, end: panRef.current.domainEnd } };
    } else {
      return;
    }

    if (touchRafRef.current) return; // RAF already scheduled for this frame
    touchRafRef.current = requestAnimationFrame(() => {
      const t = latestTouchRef.current;
      latestTouchRef.current = null;
      touchRafRef.current = null;
      if (!t) return;

      if (t.type === 'pinch' && touchRef.current) {
        const scale = touchRef.current.distance / t.newDist;
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
        setZoomDomain({ start: Math.max(newStart, windowBounds.start), end: Math.min(newEnd, windowBounds.end) });
      } else if (t.type === 'pan') {
        applyPan(t.deltaRatio, t.refDomain);
      }
    });
  }, [isPanning, xToRatio, getWindowBounds, applyPan]);

  const handleTouchEnd = useCallback(() => {
    touchRef.current = null;
    setIsPanning(false);
    panRef.current = null;
  }, []);

  // Click-to-show tooltip — use activeIndex to look up the data point directly
  const handleChartClick = useCallback((chartData) => {
    if (dragHappenedRef.current) return;
    const index = chartData?.activeIndex;
    if (index == null || !chartData.activeCoordinate) {
      setTooltipState(null);
      return;
    }
    const point = displayData[index];
    if (!point) {
      setTooltipState(null);
      return;
    }
    // activeCoordinate is in SVG space; the SVG starts after container padding (24px)
    setTooltipState({
      point,
      x: chartData.activeCoordinate.x + 24,
      y: chartData.activeCoordinate.y + 24,
    });
  }, [displayData]);

  // Memoized tick/range calculations — avoids getBoundingClientRect on every render
  const { isSubMinuteZoom, xTicks } = useMemo(() => {
    if (displayData.length < 2) return { isSubMinuteZoom: false, xTicks: undefined };
    const first = displayData[0].ts;
    const last = displayData[displayData.length - 1].ts;
    const rangeMs = last - first;
    if (rangeMs < 60000) return { isSubMinuteZoom: true, xTicks: undefined };

    const totalMinutes = rangeMs / 60000;
    const containerWidth = chartContainerRef.current?.getBoundingClientRect().width ?? 800;
    const chartWidth = containerWidth - 110;
    const maxTicks = Math.max(2, Math.floor(chartWidth / 80));
    const niceSteps = [1, 2, 5, 10, 15, 30, 60];
    const stepMinutes = niceSteps.find((s) => totalMinutes / s <= maxTicks) ?? 60;
    const stepMs = stepMinutes * 60000;
    const firstTick = Math.ceil(first / stepMs) * stepMs;
    const ticks = [];
    for (let t = firstTick; t <= last; t += stepMs) ticks.push(t);
    return { isSubMinuteZoom: false, xTicks: ticks.length > 0 ? ticks : undefined };
  }, [displayData]);

  const windowLabel = windowMinutes >= WINDOW_MAX
    ? 'Full session'
    : windowMinutes === 60
    ? 'Last 1 hr'
    : `Last ${windowMinutes} min`;

  return (
    <div className={styles.chartPanel}>
      <div className={styles.header}>
        <h2 className={styles.title}>Temperature Chart</h2>

        <div className={styles.controlsRow}>
          <div className={styles.sliderRow}>
            <div className={styles.sliderWrapper}>
              <input
                type="range"
                min={5}
                max={WINDOW_MAX}
                step={1}
                value={windowMinutes}
                onChange={(e) => setWindowMinutes(Number(e.target.value))}
                className={styles.slider}
                style={{
                  background: `linear-gradient(to right,
                    var(--color-text-muted) 0%,
                    var(--color-text-muted) ${((windowMinutes - 5) / (WINDOW_MAX - 5)) * 100}%,
                    var(--color-border-light) ${((windowMinutes - 5) / (WINDOW_MAX - 5)) * 100}%,
                    var(--color-border-light) 100%)`,
                }}
              />
              <span className={styles.windowLabel}>{windowLabel}</span>
            </div>
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
          <LineChart data={displayData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }} onClick={handleChartClick}>
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
            <Legend wrapperStyle={{ color: '#cbd5e1' }} itemSorter={null} />
            {visibility.BK && <Line type="linear" dataKey="BK" stroke={theme.vesselBK} strokeWidth={2} dot={false} activeDot={false} isAnimationActive={false} />}
            {visibility.MLT && <Line type="linear" dataKey="MLT" stroke={theme.vesselMLT} strokeWidth={2} dot={false} activeDot={false} isAnimationActive={false} />}
            {visibility.HLT && <Line type="linear" dataKey="HLT" stroke={theme.vesselHLT} strokeWidth={2} dot={false} activeDot={false} isAnimationActive={false} />}
          </LineChart>
        </ResponsiveContainer>
        {tooltipState && (
          <div
            className={styles.clickTooltip}
            style={{ left: tooltipState.x, top: tooltipState.y }}
          >
            <div className={styles.tooltipLabel}>{formatTime(new Date(tooltipState.point.ts))}</div>
            {visibility.BK && <div style={{ color: theme.vesselBK }}>BK: {Number(tooltipState.point.BK).toFixed(1)} °C</div>}
            {visibility.MLT && <div style={{ color: theme.vesselMLT }}>MLT: {Number(tooltipState.point.MLT).toFixed(1)} °C</div>}
            {visibility.HLT && <div style={{ color: theme.vesselHLT }}>HLT: {Number(tooltipState.point.HLT).toFixed(1)} °C</div>}
          </div>
        )}
      </div>
    </div>
  );
}

export default TemperatureChart;
