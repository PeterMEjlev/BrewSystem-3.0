import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './RecipePage.module.css';

function RecipePage() {
  const panelRef = useRef(null);
  const dragState = useRef({ isDragging: false, startY: 0, startScroll: 0, moved: false });

  const [recipe, setRecipe] = useState(null);
  const [loading, setLoading] = useState(true);
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

  const fetchRecipe = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/recipe/latest');
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.detail || `Failed to fetch recipe (${response.status})`);
      }
      const data = await response.json();
      setRecipe(data);
    } catch (err) {
      console.error('Error fetching recipe:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecipe();
  }, []);

  if (loading) {
    return (
      <div className={styles.recipePanel}>
        <h2 className={styles.title}>Recipe</h2>
        <p className={styles.loading}>Loading recipe...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.recipePanel}>
        <h2 className={styles.title}>Recipe</h2>
        <div className={styles.errorCard}>
          <p className={styles.error}>{error}</p>
          <button className={styles.retryBtn} onClick={fetchRecipe}>Retry</button>
        </div>
      </div>
    );
  }

  if (!recipe) return null;

  const fmt = (val, decimals) => {
    const n = parseFloat(val);
    return isNaN(n) ? val : n.toFixed(decimals);
  };

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
        <h2 className={styles.title}>Recipe</h2>
        <button className={styles.refreshBtn} onClick={fetchRecipe}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 4v6h-6" />
            <path d="M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
        </button>
      </div>

      {/* Recipe Name & Style */}
      <div className={styles.nameCard}>
        <h3 className={styles.recipeName}>{recipe.name}</h3>
        <span className={styles.recipeStyle}>{recipe.style}</span>
      </div>

      {/* Stats Grid */}
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
          <span className={styles.statValue}>{fmt(recipe.abv, 1)}%</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>IBU</span>
          <span className={styles.statValue}>{fmt(recipe.ibu, 1)}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>EBC</span>
          <span className={styles.statValue}>{fmt(recipe.ebc, 1)}</span>
        </div>
        {recipe.mashTemp && (
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Mash</span>
            <span className={styles.statValue}>{recipe.mashTemp}</span>
          </div>
        )}
      </div>

      {/* Fermentables */}
      {recipe.fermentables.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Fermentables</h3>
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

      {/* Hops */}
      {recipe.hops.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Hops</h3>
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

      {/* Yeast */}
      {recipe.yeast.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Yeast</h3>
          <div className={styles.ingredientList}>
            {recipe.yeast.map((y, i) => (
              <div key={i} className={styles.ingredientRow}>
                <span className={styles.ingredientName}>{y.name}</span>
                <span className={styles.ingredientDetail}>
                  {y.lab}
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

export default RecipePage;
