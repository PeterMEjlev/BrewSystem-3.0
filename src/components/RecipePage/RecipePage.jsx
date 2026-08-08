import { useState, useEffect, useRef, useCallback } from 'react';
import { playClick, playNavigate } from '../../utils/sounds';
import { ebcToColor } from '../../utils/beerColor';
import { predictBeerColor } from '../../utils/beerColorPrediction';
import { estimateFermentationDays } from '../../utils/fermentationEstimate';
import { DEFAULT_CONTENT_COLORS, fetchContentColors, matchContentOption } from '../../utils/kegContent';
import { HOP_STAGE_ORDER, formatContactTime, kr, sumCost } from '../../utils/recipeDisplay';
import styles from './RecipePage.module.css';

/**
 * The brewery's recipes, read from BrewPlanner.
 *
 * BrewPlanner owns the library and has already done the work this rig can't:
 * costing each line against its price catalogue, calculating a colour for a
 * grain bill that reports none, sorting hops into brew-session stages, and
 * recording which contact times are in days rather than minutes. The sheet
 * arrives with all of that on it, so this page renders rather than derives.
 *
 * What is worked out here is only what needs the whole sheet at once and needs
 * nothing else: the pour colour once fruit is accounted for, and roughly how
 * long the pitch will take. Both are ported from BrewPlanner so a recipe reads
 * the same in either place.
 */

// fetch() itself throws (vs. returning a non-ok response) only when the request
// never completes — almost always because the backend isn't reachable.
function describeNetworkError(err, fallback) {
  if (err instanceof TypeError) {
    return 'Could not reach the brew server. Make sure the backend is running, then retry.';
  }
  return err?.message || fallback;
}

// Module-level cache — RecipePage unmounts when leaving the tab, and without
// this every visit re-reads the whole library across the LAN. The list only
// refetches on the explicit refresh button.
let recipesCache = null;

const ALL_COLLAPSED = {
  fermentables: true,
  hops: true,
  otherIngredients: true,
  yeast: true,
  mashGuidelines: true,
  water: true,
  brewHistory: true,
};

const fmt = (val, decimals) => {
  const n = parseFloat(val);
  return isNaN(n) ? val : n.toFixed(decimals);
};

const fmtAbv = (val) => {
  const n = parseFloat(val);
  return isNaN(n) ? val : n.toFixed(1);
};

/** The calendar day a brew happened: "14 Jul 2026". */
const brewDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
};

function RecipePage() {
  const panelRef = useRef(null);
  const dragState = useRef({ isDragging: false, startY: 0, startScroll: 0, moved: false });

  const [recipes, setRecipes] = useState(recipesCache ?? []);
  const [selectedRecipe, setSelectedRecipe] = useState(() => {
    try {
      const saved = sessionStorage.getItem('selectedRecipe');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const restoredRecipeId = useRef(selectedRecipe?.id);
  const [brewHistory, setBrewHistory] = useState([]);
  const [brewCounts, setBrewCounts] = useState({});
  // The keg palette, which is also what colours a recipe by its style — the
  // same beer wears one colour on the keg board and in this list.
  const [contentColors, setContentColors] = useState(DEFAULT_CONTENT_COLORS);
  const [loading, setLoading] = useState(recipesCache == null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = sessionStorage.getItem('recipeSectionsCollapsed');
      return saved ? { ...ALL_COLLAPSED, ...JSON.parse(saved) } : ALL_COLLAPSED;
    } catch { return ALL_COLLAPSED; }
  });

  const toggleSection = (key) => setCollapsed(prev => {
    const next = { ...prev, [key]: !prev[key] };
    try { sessionStorage.setItem('recipeSectionsCollapsed', JSON.stringify(next)); } catch { /* the sections still toggle, they just won't be remembered */ }
    return next;
  });

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

  const fetchRecipes = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/recipes');
      const data = await response.json();
      if (!data.available) {
        // The library lives on the other Pi, so "no recipes" and "no web
        // server" are different answers and the page says which.
        recipesCache = [];
        setRecipes([]);
        setError(data.error || 'BrewPlanner is unreachable.');
        return;
      }
      recipesCache = data.recipes || [];
      setRecipes(recipesCache);
    } catch (err) {
      console.error('Error fetching recipes:', err);
      setError(describeNetworkError(err, 'Failed to fetch recipes.'));
    } finally {
      setLoading(false);
    }
  };

  const selectRecipe = async (id) => {
    setDetailLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/recipes/${encodeURIComponent(id)}`);
      const data = await response.json();
      if (!data.available || !data.recipe) {
        throw new Error(data.error || 'Failed to fetch recipe.');
      }
      setSelectedRecipe(data.recipe);
      try { sessionStorage.setItem('selectedRecipe', JSON.stringify(data.recipe)); } catch { /* the sheet still opens, it just won't survive a reload */ }
      // The history is a separate read, and a missing one is not a reason to
      // fail opening the sheet — it just shows no brews.
      try {
        const historyRes = await fetch(`/api/recipes/${encodeURIComponent(id)}/brew-sessions`);
        const history = await historyRes.json();
        setBrewHistory(history.brewSessions || []);
      } catch { setBrewHistory([]); }
    } catch (err) {
      console.error('Error fetching recipe:', err);
      setError(describeNetworkError(err, 'Failed to fetch recipe.'));
    } finally {
      setDetailLoading(false);
    }
  };

  const goBack = () => {
    playNavigate();
    setSelectedRecipe(null);
    setBrewHistory([]);
    sessionStorage.removeItem('selectedRecipe');
    setError(null);
  };

  // Only hit the network when the module cache is empty (first visit this
  // app session) — browsing between tabs reuses the cached list.
  useEffect(() => {
    if (recipesCache == null) fetchRecipes();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchContentColors().then((c) => { if (!cancelled) setContentColors(c); });
    (async () => {
      try {
        const response = await fetch('/api/recipes/brew-counts');
        const data = await response.json();
        if (!cancelled) setBrewCounts(data.counts || {});
      } catch { /* no badges, no harm */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // A brew session in progress on BrewPlanner means the brewer is standing at
  // the rig working through that recipe, so open straight into it. This runs on
  // every mount — i.e. every time the tab is opened — so backing out to the
  // list lasts for that visit only, and reopening returns to the active brew.
  useEffect(() => {
    const alreadyOpen = String(restoredRecipeId.current ?? '');
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/brew-planner/active-brew');
        if (!response.ok) return;
        const data = await response.json();
        if (cancelled || !data.recipeId || data.recipeId === alreadyOpen) return;
        selectRecipe(data.recipeId);
      } catch { /* no web server — leave the list as it is */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Scroll to top when switching views
  useEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [selectedRecipe]);

  // ─── Detail view ───────────────────────────────────────────────────────────
  if (selectedRecipe) {
    const recipe = selectedRecipe;
    const batchSizeL = recipe.batchSizeL;

    const toKg = (amt, unit) => {
      const n = parseFloat(amt);
      if (isNaN(n)) return 0;
      const u = (unit || '').toLowerCase();
      if (u === 'g') return n / 1000;
      if (u === 'lb' || u === 'lbs') return n * 0.453592;
      if (u === 'oz') return n * 0.0283495;
      return n;
    };
    const toG = (amt, unit) => {
      const n = parseFloat(amt);
      if (isNaN(n)) return 0;
      const u = (unit || '').toLowerCase();
      if (u === 'oz') return n * 28.3495;
      return n;
    };
    const totalFermentablesKg = recipe.fermentables.reduce((s, f) => s + toKg(f.amount, f.unit), 0);
    const totalHopsG = recipe.hops.reduce((s, h) => s + toG(h.amount, h.unit), 0);
    const isBitteringHop = (h) => parseFloat(h.time) === 60 && h.stage === 'Boil';
    const nonBitteringHopsG = recipe.hops
      .filter((h) => !isBitteringHop(h))
      .reduce((s, h) => s + toG(h.amount, h.unit), 0);
    const hopsGperL = batchSizeL ? nonBitteringHopsG / batchSizeL : null;

    // What the beer actually pours: the malt colour, restained by any fruit in
    // the other-ingredients list. A fruited sour shows red here rather than the
    // straw its grain bill implies.
    const predicted = predictBeerColor({
      ebc: recipe.ebc,
      batchSizeL,
      additions: recipe.otherIngredients,
    });
    const pourColor = predicted?.hex ?? ebcToColor(recipe.ebc);

    const fermentation = estimateFermentationDays({
      og: recipe.og,
      temperatureC: recipe.fermentationTemp,
      yeast: recipe.yeast,
    });

    const cost = recipe.cost;
    const pricing = recipe.pricing;
    const showCost = pricing?.available && cost && cost.priced + cost.unpriced > 0;
    const perLitre = showCost && batchSizeL ? cost.usedDkk / batchSizeL : null;
    const byGroup = showCost
      ? {
          Malt: sumCost(recipe.fermentables),
          Hops: sumCost(recipe.hops),
          Yeast: sumCost(recipe.yeast),
          Other: sumCost(recipe.otherIngredients),
        }
      : null;

    // The recipe's own price for one line, where the catalogue covered it.
    const linePrice = (line) => (line.price ? kr(line.price.usedDkk, 0) : null);

    const hopsByStage = HOP_STAGE_ORDER
      .map((stage) => ({ stage, hops: recipe.hops.filter((h) => (h.stage || 'Other') === stage) }))
      .filter((group) => group.hops.length > 0);

    return (
      <div
        className={styles.recipePanel}
        ref={panelRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClickCapture={onClickCapture}
      >
        <div className={styles.header}>
          <button className={styles.backBtn} onClick={goBack}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
            Recipes
          </button>
        </div>

        {/* The style banner: the colour this beer wears everywhere in the
            brewery — keg board, recipe list, here. */}
        <div
          className={styles.nameCard}
          style={(() => {
            const styleColor = matchContentOption(recipe.name, recipe.style);
            const hex = styleColor ? contentColors[styleColor] : null;
            return hex ? { borderLeft: `4px solid ${hex}` } : undefined;
          })()}
        >
          <h3 className={styles.recipeName}>{recipe.name}</h3>
          <span className={styles.recipeStyle}>{recipe.style}</span>
        </div>

        <div className={styles.statsGrid}>
          {recipe.preBoilGravity && (
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Pre-Boil</span>
              <span className={styles.statValue}>{fmt(recipe.preBoilGravity, 3)}</span>
            </div>
          )}
          {recipe.postBoilGravity && (
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Post-Boil</span>
              <span className={styles.statValue}>{fmt(recipe.postBoilGravity, 3)}</span>
            </div>
          )}
          <div className={styles.statCard}>
            <span className={styles.statLabel}>OG</span>
            <span className={styles.statValue}>{fmt(recipe.og, 3)}</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>FG</span>
            <span className={styles.statValue}>{fmt(recipe.fg, 3)}</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>ABV</span>
            <span className={styles.statValue}>{fmtAbv(recipe.abv)}%</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>IBU</span>
            <span className={styles.statValue}>{fmt(recipe.ibu, 1)}</span>
          </div>
          {/* Brewer's Friend reports 0 for this account's recipes, so BrewPlanner
              calculates from the grain bill — flagged rather than passed off as
              the recipe's own figure. The swatch is the pour, fruit included. */}
          <div className={styles.statCard} title={predicted?.fruit?.note}>
            <span className={styles.statLabel}>{recipe.ebcEstimated ? 'EBC (est.)' : 'EBC'}</span>
            <span className={styles.statValue}>
              {fmt(recipe.ebc, 1)}
              <span className={styles.ebcSwatch} style={{ background: pourColor }} />
            </span>
          </div>
          {batchSizeL != null && (
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Batch</span>
              <span className={styles.statValue}>{batchSizeL} L</span>
            </div>
          )}
          {recipe.mashTemp && (
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Mash</span>
              <span className={styles.statValue}>{recipe.mashTemp}</span>
            </div>
          )}
          {recipe.fermentationTemp && (
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Ferm.</span>
              <span className={styles.statValue}>{recipe.fermentationTemp}</span>
            </div>
          )}
          {/* When the fermenter comes free, near enough to plan around. An
              estimate from the strain, the temperature and the gravity — never
              a substitute for a hydrometer, which is what the tooltip says. */}
          {fermentation && (
            <div className={styles.statCard} title={fermentation.note}>
              <span className={styles.statLabel}>Ferments</span>
              <span className={styles.statValue}>≈{fermentation.days}d</span>
            </div>
          )}
        </div>

        {showCost && (
          <div className={styles.costCard}>
            <div className={styles.costFigures}>
              <div className={styles.costMain}>
                <span className={styles.statLabel}>Ingredient cost</span>
                <span className={styles.costTotal}>{cost.priced > 0 ? kr(cost.usedDkk, 0) : '—'}</span>
              </div>
              {perLitre != null && cost.priced > 0 && (
                <div className={styles.costMain}>
                  <span className={styles.statLabel}>Per litre</span>
                  <span className={styles.costPerLitre}>{kr(perLitre, 2)}</span>
                </div>
              )}
            </div>
            <div className={styles.costBreakdown}>
              {Object.entries(byGroup)
                .filter(([, total]) => total.priced > 0)
                .map(([label, total]) => (
                  <span key={label}>{label} {kr(total.usedDkk, 0)}</span>
                ))}
              {cost.unpriced > 0 && (
                <span
                  className={styles.costUnpriced}
                  title="These lines have an amount but no catalogue price, so the total is short of them"
                >
                  {cost.unpriced} unpriced
                </span>
              )}
            </div>
          </div>
        )}

        {recipe.fermentables.length > 0 && (
          <div className={styles.section}>
            <button className={styles.sectionTitle} onClick={() => { playClick(); toggleSection('fermentables'); }}>
              <span>🌾 Fermentables <span className={styles.sectionSubtitle}>{totalFermentablesKg.toFixed(2)} kg</span></span>
              <svg className={`${styles.collapseChevron} ${collapsed.fermentables ? styles.collapseChevronCollapsed : ''}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {!collapsed.fermentables && (
              <div className={styles.ingredientList}>
                {[...recipe.fermentables]
                  .sort((a, b) => toKg(b.amount, b.unit) - toKg(a.amount, a.unit))
                  .map((f, i) => (
                  <div key={i} className={styles.ingredientRow}>
                    <span className={styles.ingredientName}>
                      {f.name}
                      {f.ebc != null && (
                        <span className={styles.ebcSwatch} style={{ background: ebcToColor(f.ebc) }} title={`EBC ${f.ebc}`} />
                      )}
                      {f.lateAddition && (
                        <span className={styles.flag} title="Kept out of the boil gravity the hops are utilized against">late</span>
                      )}
                      {f.fermentable === false && (
                        <span className={styles.flag} title="Raises the gravity but never attenuates — it lands in the FG">unfermentable</span>
                      )}
                    </span>
                    <span className={styles.ingredientDetail}>
                      {f.amount} {f.unit}
                      {f.percent ? ` (${f.percent}%)` : ''}
                      {f.ebc != null ? ` · ${f.ebc} EBC` : ''}
                      {linePrice(f) ? <span className={styles.linePrice}> · {linePrice(f)}</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {recipe.hops.length > 0 && (
          <div className={styles.section}>
            <button className={styles.sectionTitle} onClick={() => { playClick(); toggleSection('hops'); }}>
              <span>🌿 Hops <span className={styles.sectionSubtitle}>{totalHopsG.toFixed(1)} g{hopsGperL != null ? ` · ${hopsGperL.toFixed(1)} g/L` : ''}</span></span>
              <svg className={`${styles.collapseChevron} ${collapsed.hops ? styles.collapseChevronCollapsed : ''}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {!collapsed.hops && (
              <div className={styles.ingredientList}>
                {/* Grouped by the stage each addition happens at, in brew-day
                    order — the schedule a brewer actually works through. */}
                {hopsByStage.map(({ stage, hops }) => (
                  <div key={stage} className={styles.hopStage}>
                    <div className={styles.hopStageLabel}>{stage}</div>
                    {hops.map((h, i) => {
                      const useLabel = h.temp ? `${h.use} @ ${h.temp}°C` : (h.use || null);
                      const time = formatContactTime(h.time, h.timeUnit);
                      return (
                        <div key={i} className={styles.hopRow}>
                          <div className={styles.hopMain}>
                            <span className={styles.ingredientName}>
                              {h.name}
                              {h.aa ? <span className={styles.hopAa}>{h.aa}% AA</span> : ''}
                            </span>
                            <span className={styles.hopMeta}>
                              {h.amount}{h.unit ? ` ${h.unit}` : ''}
                              {useLabel ? ` · ${useLabel}` : ''}
                              {time ? ` · ${time}` : ''}
                              {linePrice(h) ? ` · ${linePrice(h)}` : ''}
                            </span>
                          </div>
                          {h.ibu ? <span className={styles.hopIbu}>{fmt(h.ibu, 1)} IBU</span> : null}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {recipe.otherIngredients && recipe.otherIngredients.length > 0 && (
          <div className={styles.section}>
            <button className={styles.sectionTitle} onClick={() => { playClick(); toggleSection('otherIngredients'); }}>
              <span>🧪 Other Ingredients</span>
              <svg className={`${styles.collapseChevron} ${collapsed.otherIngredients ? styles.collapseChevronCollapsed : ''}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {!collapsed.otherIngredients && (
              <div className={styles.ingredientList}>
                {recipe.otherIngredients.map((m, i) => (
                  <div key={i} className={styles.ingredientRow}>
                    <span className={styles.ingredientName}>{m.name}</span>
                    <span className={styles.ingredientDetail}>
                      {m.amount}{m.unit ? ` ${m.unit}` : ''}
                      {m.type ? ` · ${m.type}` : ''}
                      {m.use ? ` · ${m.use}` : ''}
                      {formatContactTime(m.time, m.timeUnit) ? ` · ${formatContactTime(m.time, m.timeUnit)}` : ''}
                      {linePrice(m) ? <span className={styles.linePrice}> · {linePrice(m)}</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {recipe.yeast.length > 0 && (
          <div className={styles.section}>
            <button className={styles.sectionTitle} onClick={() => { playClick(); toggleSection('yeast'); }}>
              <span>🧫 Yeast</span>
              <svg className={`${styles.collapseChevron} ${collapsed.yeast ? styles.collapseChevronCollapsed : ''}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {!collapsed.yeast && (
              <div className={styles.ingredientList}>
                {recipe.yeast.map((y, i) => {
                  const range = y.minTempC != null && y.maxTempC != null
                    ? `${y.minTempC}–${y.maxTempC}°C`
                    : null;
                  return (
                    <div key={i} className={styles.ingredientRow}>
                      <span className={styles.ingredientName}>
                        {y.name}
                        {y.starter && <span className={styles.flag} title="This recipe calls for a starter">starter</span>}
                      </span>
                      <span className={styles.ingredientDetail}>
                        {y.amount && y.amountUnit ? `${y.amount} ${y.amountUnit} | ` : ''}{y.lab}
                        {y.form ? ` | ${y.form}` : ''}
                        {y.attenuation ? ` | ${y.attenuation}% atten.` : ''}
                        {y.flocculation ? ` | ${y.flocculation} floc.` : ''}
                        {range ? ` | ${range}` : ''}
                        {linePrice(y) ? <span className={styles.linePrice}> · {linePrice(y)}</span> : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {recipe.mashGuidelines && (
          <div className={styles.section}>
            <button className={styles.sectionTitle} onClick={() => { playClick(); toggleSection('mashGuidelines'); }}>
              <span>🌡️ Mash Guidelines</span>
              <svg className={`${styles.collapseChevron} ${collapsed.mashGuidelines ? styles.collapseChevronCollapsed : ''}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {!collapsed.mashGuidelines && (
              <div className={styles.mashContent}>
                {recipe.mashGuidelines.steps.length > 0 && (
                  <div className={styles.mashStepsList}>
                    {recipe.mashGuidelines.steps.map((s, i) => (
                      <div key={i} className={styles.mashStepRow}>
                        <span className={styles.mashStepNumber}>{i + 1}</span>
                        <div className={styles.mashStepInfo}>
                          <span className={styles.mashStepName}>{s.name || s.type || `Step ${i + 1}`}</span>
                          <span className={styles.mashStepDetail}>
                            {s.temp || ''}
                            {s.temp && s.time ? ' · ' : ''}
                            {s.time ? `${s.time} min` : ''}
                            {s.amount ? ` · ${s.amount}${s.amountUnit ? ` ${s.amountUnit}` : ''}` : ''}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {recipe.mashGuidelines.notes && (
                  <div className={styles.waterMeta}>
                    <span className={styles.waterMetaLabel}>Notes</span>
                    <span className={styles.waterMetaValue}>{recipe.mashGuidelines.notes}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {recipe.waterProfile && (
          <div className={styles.section}>
            <button className={styles.sectionTitle} onClick={() => { playClick(); toggleSection('water'); }}>
              <span>💧 Water Profile {recipe.waterProfile.name && <span className={styles.sectionSubtitle}>{recipe.waterProfile.name}</span>}</span>
              <svg className={`${styles.collapseChevron} ${collapsed.water ? styles.collapseChevronCollapsed : ''}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {!collapsed.water && (() => {
              const wp = recipe.waterProfile;
              const hasBatch = batchSizeL != null && batchSizeL > 0;
              const calcGrams = (mgPerL) => (mgPerL * batchSizeL) / 1000;
              const minerals = [
                { label: 'Calcium',      key: 'calcium',    source: 'Gypsum' },
                { label: 'Magnesium',    key: 'magnesium',  source: 'Epsom salt' },
                { label: 'Sodium',       key: 'sodium' },
                { label: 'Chloride',     key: 'chloride' },
                { label: 'Sulfate',      key: 'sulfate' },
                { label: 'Bicarbonate',  key: 'bicarbonate' },
              ];
              const hasMinerals = minerals.some(m => wp[m.key] != null && wp[m.key] !== '');
              return (
                <div className={styles.waterContent}>
                  {hasMinerals && (
                    <div className={styles.mineralGrid}>
                      {minerals.map(({ label, key, source }) => {
                        const raw = wp[key];
                        if (raw == null || raw === '') return null;
                        const mgPerL = parseFloat(raw);
                        const isNum = !isNaN(mgPerL);
                        return (
                          <div key={key} className={styles.mineralCard}>
                            <span className={styles.mineralLabel}>{label}</span>
                            {source && <span className={styles.mineralSource}>{source}</span>}
                            <span className={styles.mineralValue}>{raw}</span>
                            <span className={styles.mineralUnit}>ppm / mg/L</span>
                            {isNum && hasBatch && (
                              <span className={styles.mineralGrams}>{calcGrams(mgPerL).toFixed(2)} g</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {wp.ph && (
                    <div className={styles.waterMeta}>
                      <span className={styles.waterMetaLabel}>pH</span>
                      <span className={styles.waterMetaValue}>{wp.ph}</span>
                    </div>
                  )}
                  {wp.notes && (
                    <div className={styles.waterMeta}>
                      <span className={styles.waterMetaLabel}>Notes</span>
                      <span className={styles.waterMetaValue}>{wp.notes}</span>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* Every batch brewed from this sheet, newest first — what it came out
            at last time, standing at the rig about to do it again. */}
        {brewHistory.length > 0 && (
          <div className={styles.section}>
            <button className={styles.sectionTitle} onClick={() => { playClick(); toggleSection('brewHistory'); }}>
              <span>📖 Brew History <span className={styles.sectionSubtitle}>{brewHistory.length} brew{brewHistory.length === 1 ? '' : 's'}</span></span>
              <svg className={`${styles.collapseChevron} ${collapsed.brewHistory ? styles.collapseChevronCollapsed : ''}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {!collapsed.brewHistory && (
              <div className={styles.ingredientList}>
                {brewHistory.map((brew) => {
                  const og = brew.measured?.og;
                  const fg = brew.measured?.fg;
                  const facts = [
                    og ? (fg ? `${og} → ${fg}` : `OG ${og}`) : null,
                    brew.measured?.volumeL != null ? `${brew.measured.volumeL} L` : null,
                  ].filter(Boolean);
                  return (
                    <div key={brew.id} className={styles.ingredientRow}>
                      <span className={styles.ingredientName}>
                        {brewDate(brew.brewedAt)}
                        {brew.brewNumber > 1 && <span className={styles.flag}>#{brew.brewNumber}</span>}
                        {brew.rating != null && (
                          <span className={styles.rating} title={`Rated ${brew.rating} of 5`}>
                            {'★'.repeat(brew.rating)}
                          </span>
                        )}
                      </span>
                      <span className={styles.ingredientDetail}>
                        {brew.status}
                        {facts.length > 0 ? ` · ${facts.join(' · ')}` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ─── List view ─────────────────────────────────────────────────────────────
  return (
    <div
      className={styles.recipePanel}
      ref={panelRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClickCapture={onClickCapture}
    >
      <div className={styles.header}>
        <h2 className={styles.title}>Recipes</h2>
        <button className={styles.refreshBtn} onClick={() => { playClick(); fetchRecipes(); }} disabled={loading}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 4v6h-6" />
            <path d="M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
        </button>
      </div>

      {loading && <p className={styles.loading}>Loading recipes...</p>}

      {error && (
        <div className={styles.errorCard}>
          <p className={styles.error}>{error}</p>
          <button className={styles.retryBtn} onClick={() => { playClick(); fetchRecipes(); }}>Retry</button>
        </div>
      )}

      {detailLoading && <p className={styles.loading}>Loading recipe details...</p>}

      {!loading && !error && recipes.length === 0 && (
        <p className={styles.loading}>No recipes found.</p>
      )}

      {!loading && !error && recipes.length > 0 && (
        <div className={styles.recipeList}>
          {recipes.map((r) => {
            const styleMatch = matchContentOption(r.name, r.style);
            const styleColor = styleMatch ? contentColors[styleMatch] : null;
            const count = brewCounts[String(r.id)];
            return (
              <button
                key={r.id}
                className={styles.recipeListItem}
                style={styleColor ? { borderLeft: `3px solid ${styleColor}` } : undefined}
                onClick={() => { playNavigate(); selectRecipe(r.id); }}
                disabled={detailLoading}
              >
                <div className={styles.recipeListInfo}>
                  <div className={styles.recipeListNameRow}>
                    <span className={styles.recipeListName}>{r.name}</span>
                    <span
                      className={styles.ebcSwatch}
                      style={{ background: ebcToColor(r.ebc) }}
                    />
                    {count && (
                      <span
                        className={styles.brewCount}
                        title={`Brewed ${count.count} time${count.count === 1 ? '' : 's'} · last on ${brewDate(count.lastBrewedAt)}`}
                      >
                        ×{count.count}
                      </span>
                    )}
                  </div>
                  <span className={styles.recipeListStyle}>{r.style}</span>
                </div>
                <div className={styles.recipeListStats}>
                  <span>{fmtAbv(r.abv)}%</span>
                  <span>{fmt(r.ibu, 0)} IBU</span>
                </div>
                <svg className={styles.chevron} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default RecipePage;
