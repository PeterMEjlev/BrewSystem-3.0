import { createContext, useContext, useState, useEffect } from 'react';

export const DEFAULT_THEME = {
  bgPrimary: '#0f172a',
  bgSecondary: '#1e293b',
  accentBlue: '#3b82f6',
  accentGreen: '#10b981',
  accentOrange: '#f97316',
  vesselBK: '#ef4444',
  vesselMLT: '#10b981',
  vesselHLT: '#3b82f6',
};

// Maps theme keys to CSS custom property names
const CSS_VAR_MAP = {
  bgPrimary: '--color-bg-primary',
  bgSecondary: '--color-bg-secondary',
  accentBlue: '--color-accent-blue',
  accentGreen: '--color-accent-green',
  accentOrange: '--color-accent-orange',
  vesselBK: '--color-vessel-bk',
  vesselMLT: '--color-vessel-mlt',
  vesselHLT: '--color-vessel-hlt',
};

const ThemeContext = createContext({
  theme: DEFAULT_THEME,
  updateTheme: () => {},
  resetTheme: () => {},
});

export function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applyCssVars(theme) {
  const root = document.documentElement;
  for (const [key, varName] of Object.entries(CSS_VAR_MAP)) {
    root.style.setProperty(varName, theme[key]);
  }
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(DEFAULT_THEME);

  // Fetch theme from API on mount
  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((s) => {
        if (s.theme && Object.keys(s.theme).length > 0) {
          setTheme((prev) => ({ ...prev, ...s.theme }));
        }
      })
      .catch(() => {});
  }, []);

  // Apply CSS variables whenever theme changes
  useEffect(() => {
    applyCssVars(theme);
  }, [theme]);

  const updateTheme = (key, value) => {
    setTheme((prev) => ({ ...prev, [key]: value }));
  };

  const resetTheme = () => {
    setTheme(DEFAULT_THEME);
  };

  return (
    <ThemeContext.Provider value={{ theme, updateTheme, resetTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
