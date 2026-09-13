// Theme switcher for LabourLink Web Portal
(function () {
  const STORAGE_KEY = 'labourlink_web_theme';

  function applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    updateToggleButtons(theme);
  }

  function updateToggleButtons(theme) {
    const isDark = theme === 'dark';
    document.querySelectorAll('.theme-toggle-btn').forEach((btn) => {
      const icon = btn.querySelector('.theme-icon');
      const label = btn.querySelector('.theme-label');
      if (icon) icon.textContent = isDark ? '☀️' : '🌙';
      if (label) label.textContent = isDark ? 'Light' : 'Dark';
    });
  }

  // Read saved theme
  const savedTheme = localStorage.getItem(STORAGE_KEY) || 'light';
  applyTheme(savedTheme);

  document.addEventListener('DOMContentLoaded', () => {
    updateToggleButtons(localStorage.getItem(STORAGE_KEY) || 'light');

    document.querySelectorAll('.theme-toggle-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const current = localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        localStorage.setItem(STORAGE_KEY, next);
        applyTheme(next);
      });
    });
  });
})();
