/**
 * LabourLink Client-side i18n Manager
 * Supports: English ('en'), Hindi ('hi'), and Bengali ('bn')
 * Persists selected language to localStorage and reacts instantly.
 */
(function () {
  const STORAGE_KEY = 'labourlink_lang';
  const SUPPORTED_LANGS = ['en', 'hi', 'bn'];
  const translations = {};

  async function loadTranslations(lang) {
    if (translations[lang]) return translations[lang];
    try {
      const res = await fetch(`/locales/${lang}.json`);
      if (res.ok) {
        translations[lang] = await res.json();
        return translations[lang];
      }
    } catch (e) {
      console.warn(`Could not load translations for ${lang}:`, e);
    }
    return null;
  }

  function getNestedValue(obj, path) {
    return path.split('.').reduce((prev, curr) => (prev && prev[curr] !== undefined ? prev[curr] : null), obj);
  }

  function detectLanguage() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED_LANGS.includes(saved)) return saved;

    const navLang = (navigator.language || navigator.userLanguage || '').toLowerCase();
    if (navLang.startsWith('hi')) return 'hi';
    if (navLang.startsWith('bn')) return 'bn';
    return 'en';
  }

  async function setLanguage(lang) {
    if (!SUPPORTED_LANGS.includes(lang)) lang = 'en';
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;

    const data = await loadTranslations(lang);
    if (!data) return;

    // Apply translations to all DOM elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const val = getNestedValue(data, key);
      if (val) el.textContent = val;
    });

    // Apply translations to placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      const val = getNestedValue(data, key);
      if (val) el.setAttribute('placeholder', val);
    });

    // Update active state in selector dropdowns if present
    document.querySelectorAll('.lang-select-dropdown').forEach((sel) => {
      sel.value = lang;
    });

    // Apply font fallbacks for Devanagari and Bengali
    if (lang === 'hi' || lang === 'bn') {
      document.body.classList.add('indic-script');
    } else {
      document.body.classList.remove('indic-script');
    }

    // Trigger custom event for other components if needed
    window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang } }));
  }

  window.LabourLinkI18n = {
    setLanguage,
    getLanguage: detectLanguage,
    init: function () {
      const initialLang = detectLanguage();
      setLanguage(initialLang);

      // Bind language selector elements
      document.addEventListener('DOMContentLoaded', () => {
        const selects = document.querySelectorAll('.lang-select-dropdown');
        selects.forEach((sel) => {
          sel.value = initialLang;
          sel.addEventListener('change', (e) => {
            setLanguage(e.target.value);
          });
        });
      });
    }
  };

  // Run initial setup immediately
  window.LabourLinkI18n.init();
})();
