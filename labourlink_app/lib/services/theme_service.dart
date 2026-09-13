import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Theme management service supporting Light, Dark, and System modes
/// with persistent storage and reactive ValueNotifier updates.
class ThemeService {
  static final ValueNotifier<ThemeMode> themeModeNotifier =
      ValueNotifier<ThemeMode>(ThemeMode.light);

  static const String _prefKey = 'app_theme_mode';

  static bool get isDark => themeModeNotifier.value == ThemeMode.dark;

  static Future<void> init() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final savedMode = prefs.getString(_prefKey);
      if (savedMode == 'dark') {
        themeModeNotifier.value = ThemeMode.dark;
      } else if (savedMode == 'light') {
        themeModeNotifier.value = ThemeMode.light;
      } else {
        themeModeNotifier.value = ThemeMode.light;
      }
    } catch (_) {
      themeModeNotifier.value = ThemeMode.light;
    }
  }

  static Future<void> toggleTheme() async {
    final nextMode = isDark ? ThemeMode.light : ThemeMode.dark;
    await setThemeMode(nextMode);
  }

  static Future<void> setThemeMode(ThemeMode mode) async {
    themeModeNotifier.value = mode;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_prefKey, mode == ThemeMode.dark ? 'dark' : 'light');
    } catch (_) {}
  }
}
