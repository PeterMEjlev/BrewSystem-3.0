import { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { brewSystem } from '../../utils/mockHardware';
import { hardwareApi } from '../../utils/hardwareApi';
import { useTheme } from '../../contexts/ThemeContext';
import { useSettings } from '../../contexts/SettingsContext';
import styles from './TemperatureChart.module.css';

const WINDOW_MAX = 120; // slider max = "Full session"
const MIN_ZOOM_MS = 30000; // minimum zoom range: 30 seconds
const MAX_PERSISTED_POINTS = 8640; // 24h at 10s intervals

const formatTime = (date) =>
  date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const formatTimeShort = (date) =>
  date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

// --- Module-level data store (survives component unmount/remount) ---
// Rows are { ts (epoch ms, server-authoritative in production), bk, mlt, hlt }.
// Consumed via useSyncExternalStore — appendRows replaces the array reference.
let persistedData = [];
const subscribers = new Set(); // functions to call when data changes

function subscribeStore(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

function getStoreSnapshot() {
  return persistedData;
}

function appendRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  // Dedupe by timestamp — overlapping top-ups (StrictMode double effects,
  // slow responses) may return rows we already have.
  const lastTs = persistedData.length > 0 ? persistedData[persistedData.length - 1].ts : -Infinity;
  const fresh = rows.filter((r) => r.ts > lastTs);
  if (fresh.length === 0) return;
  persistedData = [...persistedData, ...fresh];
  if (persistedData.length > MAX_PERSISTED_POINTS) {
    persistedData = persistedData.slice(persistedData.length - MAX_PERSISTED_POINTS);
  }
  subscribers.forEach((fn) => fn());
}

// Incremental history fetch: first call pulls the whole session, subsequent
// calls only rows newer than what we already hold (?since=<epoch_ms>).
let topUpInFlight = false;
async function topUpFromServer() {
  if (topUpInFlight) return;
  topUpInFlight = true;
  try {
    const lastTs = persistedData.length > 0 ? persistedData[persistedData.length - 1].ts : undefined;
    const rows = await hardwareApi.getTemperatureHistory(lastTs);
    if (!Array.isArray(rows)) return;
    appendRows(rows.map((r) => ({
      ts: r.ts ?? new Date(r.timestamp).getTime(),
      bk: r.bk,
      mlt: r.mlt,
      hlt: r.hlt,
    })));
  } finally {
    topUpInFlight = false;
  }
}

function getTouchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function TemperatureChart() {
  const { theme } = useTheme();
  const { settings } = useSettings();
  const data = useSyncExternalStore(subscribeStore, getStoreSnapshot);
  const [visibility, setVisibility] = useState({
    BK: true,
    MLT: true,
    HLT: true,
  });
  const [windowMinutes, setWindowMinutes] = useState(WINDOW_MAX);
  const [zoomDomain, setZoomDomain] = useState(null); // { start, end } ms timestamps or null
  const [isPanning, setIsPanning] = useState(false);
  const [tooltipState, setTooltipState] = useState(null); // { point, x, y }
  const chartContainerRef = useRef(null);
  const plotElRef = useRef(null); // div uPlot renders into
  const plotRef = useRef(null); // uPlot instance
  const panRef = useRef(null); // { startX, domainStart, domainEnd, chartWidth }
  const touchRef = useRef(null); // { distance, centerX, domainStart, domainEnd }
  const dragHappenedRef = useRef(false);
  // RAF throttle refs — prevent scale churn on every pixel during pan/zoom
  const panRafRef = useRef(null);
  const latestPanRef = useRef(null);
  const touchRafRef = useRef(null);
  const latestTouchRef = useRef(null);

  // Read environment once on mount — avoids re-renders when localStorage changes
  const [isProduction] = useState(
    () => localStorage.getItem('brewSystemEnvironment') !== 'development'
  );

  // Poll cadence follows the backend log interval — settings come from
  // SettingsProvider, so changes apply without an app restart.
  const logIntervalSeconds = settings?.app?.log_interval_seconds ?? 10;

  // Data collection: in production, top up from the server history (the
  // backend log loop is the single sampler); in dev, sample the mock locally.
  useEffect(() => {
    const tick = () => {
      if (isProduction) {
        topUpFromServer();
      } else {
        const states = brewSystem.getAllStates();
        appendRows([{
          ts: Date.now(),
          bk: states.pots.BK.pv,
          mlt: states.pots.MLT.pv,
          hlt: states.pots.HLT.pv,
        }]);
      }
    };
    tick();
    const id = setInterval(tick, Math.max(1, logIntervalSeconds) * 1000);
    return () => clearInterval(id);
  }, [isProduction, logIntervalSeconds]);

  // Slider changes also reset zoom + tooltip (handled in its onChange)
  const handleWindowChange = (e) => {
    setWindowMinutes(Number(e.target.value));
    setZoomDomain(null);
    setTooltipState(null);
  };

  const toggleVisibility = (pot) => {
    setVisibility((prev) => ({
      ...prev,
      [pot]: !prev[pot],
    }));
  };

  // Memoized window slice — only recomputes when data or windowMinutes changes
  const windowData = useMemo(() => {
    if (data.length === 0) return data;
    const now = data[data.length - 1].ts;
    const cutoff = now - windowMinutes * 60 * 1000;
    return windowMinutes >= WINDOW_MAX ? data : data.filter((p) => p.ts >= cutoff);
  }, [data, windowMinutes]);

  // Columnar arrays for uPlot: [xs (seconds), bk, mlt, hlt]. Canvas rendering
  // handles the full point count — no downsampling needed.
  const chartData = useMemo(() => {
    const n = windowData.length;
    const xs = new Array(n);
    const bk = new Array(n);
    const mlt = new Array(n);
    const hlt = new Array(n);
    for (let i = 0; i < n; i++) {
      const row = windowData[i];
      xs[i] = row.ts / 1000;
      bk[i] = row.bk ?? null;
      mlt[i] = row.mlt ?? null;
      hlt[i] = row.hlt ?? null;
    }
    return [xs, bk, mlt, hlt];
  }, [windowData]);

  // Helper: get full time bounds of the slider window (ms)
  const getWindowBounds = useCallback(() => {
    if (windowData.length < 2) return null;
    return { start: windowData[0].ts, end: windowData[windowData.length - 1].ts };
  }, [windowData]);

  // Helper: get current visible bounds (zoom or full window)
  const getVisibleBounds = useCallback(() => {
    if (zoomDomain) return zoomDomain;
    return getWindowBounds();
  }, [zoomDomain, getWindowBounds]);

  // Helper: map a clientX pixel position to a 0–1 ratio across the plot area
  const xToRatio = useCallback((clientX) => {
    const u = plotRef.current;
    if (!u) return 0.5;
    const rect = u.over.getBoundingClientRect();
    if (rect.width === 0) return 0.5;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  // ── uPlot instance ─────────────────────────────────────────────────────────
  // Created once on mount. Series strokes are resolved from the theme's CSS
  // variables at draw time, so theme changes only need a repaint — the
  // instance is never recreated.
  useEffect(() => {
    const el = plotElRef.current;
    if (!el) return;
    const cssColor = (varName, fallback) => () => {
      const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
      return v || fallback;
    };
    const opts = {
      width: Math.max(el.clientWidth, 50),
      height: Math.max(el.clientHeight, 50),
      legend: { show: false },
      cursor: { show: false },
      scales: {
        x: { time: true },
        y: { range: [0, 100] },
      },
      series: [
        {},
        { label: 'BK', stroke: cssColor('--color-vessel-bk', '#ef4444'), width: 2 },
        { label: 'MLT', stroke: cssColor('--color-vessel-mlt', '#10b981'), width: 2 },
        { label: 'HLT', stroke: cssColor('--color-vessel-hlt', '#3b82f6'), width: 2 },
      ],
      axes: [
        {
          stroke: '#94a3b8',
          ticks: { stroke: '#94a3b8' },
          grid: { stroke: '#334155', dash: [3, 3] },
          values: (u, splits) => {
            const min = u.scales.x.min ?? 0;
            const max = u.scales.x.max ?? 0;
            const fmt = (max - min) < 60 ? formatTime : formatTimeShort;
            return splits.map((s) => fmt(new Date(s * 1000)));
          },
        },
        {
          label: '°C',
          labelGap: 4,
          stroke: '#94a3b8',
          ticks: { stroke: '#94a3b8' },
          grid: { stroke: '#334155', dash: [3, 3] },
        },
      ],
    };
    const u = new uPlot(opts, [[], [], [], []], el);
    plotRef.current = u;

    // Keep the canvas sized to its container (also fires when the chart tab
    // becomes visible again after display:none).
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) u.setSize({ width, height });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      u.destroy();
      plotRef.current = null;
    };
  }, []);

  // Repaint when the vessel colors change — strokes re-resolve their CSS vars
  useEffect(() => {
    plotRef.current?.redraw(false);
  }, [theme.vesselBK, theme.vesselMLT, theme.vesselHLT]);

  // Push data + x-scale into the plot
  useEffect(() => {
    const u = plotRef.current;
    if (!u) return;
    u.setData(chartData, false);
    const xs = chartData[0];
    if (xs.length === 0) return;
    let min, max;
    if (zoomDomain) {
      min = zoomDomain.start / 1000;
      max = zoomDomain.end / 1000;
    } else {
      min = xs[0];
      max = xs[xs.length - 1];
      if (min === max) { min -= 30; max += 30; } // single point — give it room
    }
    u.setScale('x', { min, max });
  }, [chartData, zoomDomain]);

  // Push series visibility
  useEffect(() => {
    const u = plotRef.current;
    if (!u) return;
    u.setSeries(1, { show: visibility.BK });
    u.setSeries(2, { show: visibility.MLT });
    u.setSeries(3, { show: visibility.HLT });
  }, [visibility]);

  // ── Zoom / pan interactions (same gestures as before) ─────────────────────

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

    const visibleRange = refDomain.end - refDomain.start;
    const deltaMs = deltaRatio * visibleRange;

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
    // Cache the plot width here to avoid getBoundingClientRect on every mousemove
    const rect = plotRef.current?.over.getBoundingClientRect();
    panRef.current = {
      startX: e.clientX,
      domainStart: zoomDomain.start,
      domainEnd: zoomDomain.end,
      chartWidth: rect && rect.width > 0 ? rect.width : 800,
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
      // Pan start — cache the plot width to avoid reflow on every touchmove
      setIsPanning(true);
      const rect = plotRef.current?.over.getBoundingClientRect();
      panRef.current = {
        startX: e.touches[0].clientX,
        domainStart: zoomDomain.start,
        domainEnd: zoomDomain.end,
        chartWidth: rect && rect.width > 0 ? rect.width : 800,
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

  // Click-to-show tooltip — find the nearest point to the click position
  const handleChartClick = useCallback((e) => {
    if (dragHappenedRef.current) { dragHappenedRef.current = false; return; }
    const u = plotRef.current;
    const container = chartContainerRef.current;
    if (!u || !container || windowData.length === 0) return;

    const overRect = u.over.getBoundingClientRect();
    if (overRect.width === 0) return;
    const left = e.clientX - overRect.left;
    if (left < 0 || left > overRect.width) { setTooltipState(null); return; }

    const xVal = u.posToVal(left, 'x') * 1000; // → epoch ms
    // Binary search the nearest row by timestamp
    let lo = 0, hi = windowData.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (windowData[mid].ts < xVal) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(windowData[lo - 1].ts - xVal) < Math.abs(windowData[lo].ts - xVal)) lo -= 1;
    const point = windowData[lo];
    if (!point) { setTooltipState(null); return; }

    const containerRect = container.getBoundingClientRect();
    setTooltipState({
      point,
      x: u.valToPos(point.ts / 1000, 'x') + (overRect.left - containerRect.left),
      y: e.clientY - containerRect.top,
    });
  }, [windowData]);

  const windowLabel = windowMinutes >= WINDOW_MAX
    ? 'Full session'
    : windowMinutes === 60
    ? 'Last 1 hr'
    : `Last ${windowMinutes} min`;

  const latest = data.length > 0 ? data[data.length - 1] : null;
  const formatTemp = (v) => (v == null || Number.isNaN(Number(v)) ? '--' : Number(v).toFixed(1));

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
                onChange={handleWindowChange}
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

      <div className={styles.currentTempStrip}>
        {visibility.BK && (
          <div className={styles.currentTempItem} style={{ color: theme.vesselBK }}>
            <span className={styles.currentTempLabel}>BK</span>
            <span className={styles.currentTempValue}>{formatTemp(latest?.bk)}<span className={styles.currentTempUnit}>°C</span></span>
          </div>
        )}
        {visibility.MLT && (
          <div className={styles.currentTempItem} style={{ color: theme.vesselMLT }}>
            <span className={styles.currentTempLabel}>MLT</span>
            <span className={styles.currentTempValue}>{formatTemp(latest?.mlt)}<span className={styles.currentTempUnit}>°C</span></span>
          </div>
        )}
        {visibility.HLT && (
          <div className={styles.currentTempItem} style={{ color: theme.vesselHLT }}>
            <span className={styles.currentTempLabel}>HLT</span>
            <span className={styles.currentTempValue}>{formatTemp(latest?.hlt)}<span className={styles.currentTempUnit}>°C</span></span>
          </div>
        )}
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
        onClick={handleChartClick}
      >
        {zoomDomain && (
          <button
            className={styles.resetZoom}
            onClick={(e) => { e.stopPropagation(); setZoomDomain(null); }}
          >
            Reset Zoom
          </button>
        )}
        <div ref={plotElRef} className={styles.plotWrap} />
        {tooltipState && (
          <div
            className={styles.clickTooltip}
            style={{ left: tooltipState.x, top: tooltipState.y }}
          >
            <div className={styles.tooltipLabel}>{formatTime(new Date(tooltipState.point.ts))}</div>
            {visibility.BK && <div style={{ color: theme.vesselBK }}>BK: {formatTemp(tooltipState.point.bk)} °C</div>}
            {visibility.MLT && <div style={{ color: theme.vesselMLT }}>MLT: {formatTemp(tooltipState.point.mlt)} °C</div>}
            {visibility.HLT && <div style={{ color: theme.vesselHLT }}>HLT: {formatTemp(tooltipState.point.hlt)} °C</div>}
          </div>
        )}
      </div>
    </div>
  );
}

export default TemperatureChart;
