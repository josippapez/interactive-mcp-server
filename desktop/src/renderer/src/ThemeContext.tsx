import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';

export type Theme = 'dark' | 'light';
export type LightTint = 'none' | 'sage' | 'sand' | 'teal' | 'sky' | 'peach';

type ThemeContextValue = {
  theme: Theme;
  toggle: () => void;
  lightTint: LightTint;
  setLightTint: (tint: LightTint) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggle: () => {},
  lightTint: 'none',
  setLightTint: () => {},
});

export function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('imcp-theme');
    return saved === 'light' ? 'light' : 'dark';
  });

  const [lightTint, setLightTintState] = useState<LightTint>(() => {
    const saved = localStorage.getItem('imcp-light-tint');
    const valid: LightTint[] = ['none', 'sage', 'sand', 'teal', 'sky', 'peach'];
    return valid.includes(saved as LightTint) ? (saved as LightTint) : 'none';
  });

  useEffect(() => {
    localStorage.setItem('imcp-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    // Clear tint when switching to dark mode
    if (theme === 'dark') {
      document.documentElement.removeAttribute('data-tint');
    } else if (lightTint !== 'none') {
      document.documentElement.setAttribute('data-tint', lightTint);
    }
  }, [theme, lightTint]);

  const toggle = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const setLightTint = useCallback((tint: LightTint) => {
    setLightTintState(tint);
    localStorage.setItem('imcp-light-tint', tint);
    if (tint === 'none') {
      document.documentElement.removeAttribute('data-tint');
    } else {
      document.documentElement.setAttribute('data-tint', tint);
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggle, lightTint, setLightTint }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
