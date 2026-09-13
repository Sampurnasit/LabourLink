import 'package:flutter/material.dart';
import '../services/theme_service.dart';

/// A stylish, animated theme switch toggle button for Light and Dark modes.
class ThemeToggleButton extends StatelessWidget {
  final bool showLabel;
  final Color? backgroundColor;

  const ThemeToggleButton({
    super.key,
    this.showLabel = false,
    this.backgroundColor,
  });

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<ThemeMode>(
      valueListenable: ThemeService.themeModeNotifier,
      builder: (context, themeMode, _) {
        final isDark = themeMode == ThemeMode.dark;

        return Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: () => ThemeService.toggleTheme(),
            borderRadius: BorderRadius.circular(20),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 250),
              padding: EdgeInsets.symmetric(
                horizontal: showLabel ? 12 : 8,
                vertical: 6,
              ),
              decoration: BoxDecoration(
                color: backgroundColor ??
                    (isDark
                        ? const Color(0xFF1E293B)
                        : Colors.white),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: isDark
                      ? const Color(0xFF334155)
                      : const Color(0xFFCBD5E1),
                ),
                boxShadow: [
                  BoxShadow(
                    color: (isDark ? Colors.black : const Color(0xFF0F172A))
                        .withValues(alpha: isDark ? 0.3 : 0.06),
                    blurRadius: 8,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  AnimatedRotation(
                    turns: isDark ? 0.5 : 0.0,
                    duration: const Duration(milliseconds: 300),
                    child: Icon(
                      isDark ? Icons.light_mode_rounded : Icons.dark_mode_rounded,
                      size: 18,
                      color: isDark ? const Color(0xFFFBBF24) : const Color(0xFF0F4C81),
                    ),
                  ),
                  if (showLabel) ...[
                    const SizedBox(width: 6),
                    Text(
                      isDark ? 'Light' : 'Dark',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: isDark ? const Color(0xFFF8FAFC) : const Color(0xFF1A2332),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
