import React, { createContext, useContext, useState, useEffect } from 'react';
import { translations, TranslationKey } from './translations';
import { Language } from '../types';

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  isRtl: boolean;
  t: (key: TranslationKey | string) => string;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem('hamza_obd_lang');
    return (saved === 'en' || saved === 'ar') ? saved : 'ar';
  });

  const isRtl = language === 'ar';

  useEffect(() => {
    localStorage.setItem('hamza_obd_lang', language);
    document.documentElement.lang = language;
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
  }, [language, isRtl]);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
  };

  const t = (key: TranslationKey | string): string => {
    const langDict = translations[language] || translations.ar;
    if (key in langDict) {
      return (langDict as Record<string, string>)[key];
    }
    // Fallback to English then to key
    if (key in translations.en) {
      return (translations.en as Record<string, string>)[key];
    }
    return key;
  };

  return (
    <I18nContext.Provider value={{ language, setLanguage, isRtl, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = () => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
};
