import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en';
import zhCN from './locales/zh-CN';

const LANGUAGE_STORAGE_KEY = 'web_language';

const getInitialLanguage = () => {
    if (typeof window === 'undefined') {
        return 'en';
    }
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored) {
        return stored;
    }
    const browser = window.navigator.language || window.navigator.languages?.[0];
    if (browser && browser.toLowerCase().startsWith('zh')) {
        return 'zh-CN';
    }
    return 'en';
};

const initialLanguage = getInitialLanguage();

void i18n.use(initReactI18next).init({
    resources: {
        en: { translation: en },
        'zh-CN': { translation: zhCN },
    },
    lng: initialLanguage,
    fallbackLng: 'en',
    keySeparator: false,
    nsSeparator: false,
    interpolation: {
        escapeValue: false,
    },
});

if (typeof document !== 'undefined') {
    document.documentElement.lang = initialLanguage;
}

i18n.on('languageChanged', (lng) => {
    if (typeof document !== 'undefined') {
        document.documentElement.lang = lng;
    }
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
    }
});

export default i18n;
