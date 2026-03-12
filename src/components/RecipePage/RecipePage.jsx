import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './RecipePage.module.css';

function RecipePage() {
  const panelRef = useRef(null);
  const dragState = useRef({ isDragging: false, startY: 0, startScroll: 0, moved: false });

  const [recipes, setRecipes] = useState([]);
  const [selectedRecipe, setSelectedRecipe] = useState(() => {
    try {
      const saved = sessionStorage.getItem('selectedRecipe');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(null);

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
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.detail || `Failed to fetch recipes (${response.status})`);
      }
      const data = await response.json();
      setRecipes(data.recipes || []);
    } catch (err) {
      console.error('Error fetching recipes:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const selectRecipe = async (id) => {
    setDetailLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/recipes/${id}`);
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.detail || `Failed to fetch recipe (${response.status})`);
      }
      const data = await response.json();
      setSelectedRecipe(data);
      try { sessionStorage.setItem('selectedRecipe', JSON.stringify(data)); } catch {}
    } catch (err) {
      console.error('Error fetching recipe:', err);
      setError(err.message);
    } finally {
      setDetailLoading(false);
    }
  };

  const goBack = () => {
    setSelectedRecipe(null);
    sessionStorage.removeItem('selectedRecipe');
    setError(null);
  };

  useEffect(() => {
    fetchRecipes();
  }, []);

  // Scroll to top when switching views
  useEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [selectedRecipe]);

  const fmt = (val, decimals) => {
    const n = parseFloat(val);
    return isNaN(n) ? val : n.toFixed(decimals);
  };

  const fmtAbv = (val) => {
    const n = parseFloat(val);
    return isNaN(n) ? val : n.toFixed(1);
  };

  // Map EBC to beer color via standard SRM reference (SRM = EBC / 1.97)
  const ebcToColor = (ebc) => {
    const n = parseFloat(ebc);
    if (isNaN(n)) return null;
    const srm = n / 1.97;
    // Standard SRM color chart (index = SRM value 1–40+)
    const srmColors = [
      '#FFE699', // 1
      '#FFD878', // 2
      '#FFCA5A', // 3
      '#FFBF42', // 4
      '#FBB123', // 5
      '#F8A600', // 6
      '#F39C00', // 7
      '#EA8F00', // 8
      '#E58500', // 9
      '#DE7C00', // 10
      '#D77200', // 11
      '#CF6900', // 12
      '#CB6200', // 13
      '#C35900', // 14
      '#BB5100', // 15
      '#B54C00', // 16
      '#A63E00', // 17
      '#8D3200', // 18
      '#7C2A00', // 19
      '#6B2400', // 20
      '#5E1E00', // 21
      '#531A00', // 22
      '#4A1700', // 23
      '#421500', // 24
      '#3B1200', // 25
      '#341000', // 26
      '#2E0E00', // 27
      '#290C00', // 28
      '#250B00', // 29
      '#200A00', // 30
      '#1C0900', // 31
      '#180800', // 32
      '#150700', // 33
      '#120600', // 34
      '#100500', // 35
      '#0E0500', // 36
      '#0C0400', // 37
      '#0A0300', // 38
      '#080300', // 39
      '#060200', // 40
    ];
    const idx = Math.min(Math.max(Math.round(srm) - 1, 0), srmColors.length - 1);
    return srmColors[idx];
  };

  // ─── Detail view ───────────────────────────────────────────────────────────
  if (selectedRecipe) {
    const recipe = selectedRecipe;

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
    const hopsGperL = recipe.batchSize ? totalHopsG / recipe.batchSize : null;

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

        <div className={styles.nameCard}>
          <h3 className={styles.recipeName}>{recipe.name}</h3>
          <span className={styles.recipeStyle}>{recipe.style}</span>
        </div>

        <div className={styles.statsGrid}>
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
          <div className={styles.statCard}>
            <span className={styles.statLabel}>EBC</span>
            <span className={styles.statValue}>
              {fmt(recipe.ebc, 1)}
              <span
                className={styles.ebcSwatch}
                style={{ background: ebcToColor(recipe.ebc) }}
              />
            </span>
          </div>
          {recipe.batchSize != null && (
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Batch</span>
              <span className={styles.statValue}>{recipe.batchSize} L</span>
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
        </div>

        {recipe.fermentables.length > 0 && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>🌾 Fermentables <span className={styles.sectionSubtitle}>{totalFermentablesKg.toFixed(2)} kg</span></h3>
            <div className={styles.ingredientList}>
              {recipe.fermentables.map((f, i) => (
                <div key={i} className={styles.ingredientRow}>
                  <span className={styles.ingredientName}>{f.name}</span>
                  <span className={styles.ingredientDetail}>
                    {f.amount} {f.unit}
                    {f.percent ? ` (${f.percent}%)` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {recipe.hops.length > 0 && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>
              🌿 Hops <span className={styles.sectionSubtitle}>{totalHopsG.toFixed(1)} g{hopsGperL != null ? ` · ${hopsGperL.toFixed(1)} g/L` : ''}</span>
            </h3>
            <div className={styles.ingredientList}>
              {recipe.hops.map((h, i) => (
                <div key={i} className={styles.ingredientRow}>
                  <span className={styles.ingredientName}>
                    {h.name}
                    {h.aa ? <span className={styles.hopAa}>{h.aa}% AA</span> : ''}
                  </span>
                  <span className={styles.ingredientDetail}>
                    {h.amount} {h.unit} @ {h.time} min ({h.use})
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {recipe.yeast.length > 0 && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>🧫 Yeast</h3>
            <div className={styles.ingredientList}>
              {recipe.yeast.map((y, i) => (
                <div key={i} className={styles.ingredientRow}>
                  <span className={styles.ingredientName}>{y.name}</span>
                  <span className={styles.ingredientDetail}>
                    {y.amount && y.amountUnit ? `${y.amount} ${y.amountUnit} | ` : ''}{y.lab}
                    {y.attenuation ? ` | ${y.attenuation}% atten.` : ''}
                  </span>
                </div>
              ))}
            </div>
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
        <button className={styles.refreshBtn} onClick={fetchRecipes} disabled={loading}>
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
          <button className={styles.retryBtn} onClick={fetchRecipes}>Retry</button>
        </div>
      )}

      {detailLoading && <p className={styles.loading}>Loading recipe details...</p>}

      {!loading && !error && recipes.length === 0 && (
        <p className={styles.loading}>No recipes found.</p>
      )}

      {!loading && !error && recipes.length > 0 && (
        <div className={styles.recipeList}>
          {recipes.map((r) => (
            <button
              key={r.id}
              className={styles.recipeListItem}
              onClick={() => selectRecipe(r.id)}
              disabled={detailLoading}
            >
              <div className={styles.recipeListInfo}>
                <div className={styles.recipeListNameRow}>
                  <span className={styles.recipeListName}>{r.name}</span>
                  <span
                    className={styles.ebcSwatch}
                    style={{ background: ebcToColor(r.ebc) }}
                  />
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
          ))}
        </div>
      )}
    </div>
  );
}

export default RecipePage;
