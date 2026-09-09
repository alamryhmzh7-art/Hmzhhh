import React, { createContext, useContext, useState, useEffect } from 'react';

type ThemeMode = 'dark' | 'daylight';

interface ThemeContextType {
  theme: ThemeMode;
  toggleTheme: () => void;
  setTheme: (theme: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('hamza_obd_theme');
    return (saved === 'daylight' || saved === 'dark') ? saved : 'dark';
  });

  useEffect(() => {
    localStorage.setItem('hamza_obd_theme', theme);
    const root = document.documentElement;
    if (theme === 'daylight') {
      root.classList.remove('dark');
      root.classList.add('daylight');
    } else {
      root.classList.remove('daylight');
      root.classList.add('dark');
    }
  }, [theme]);

  const toggleTheme = () => {
    setThemeState(prev => (prev === 'dark' ? 'daylight' : 'dark'));
  };

  const setTheme = (newTheme: ThemeMode) => {
    setThemeState(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
