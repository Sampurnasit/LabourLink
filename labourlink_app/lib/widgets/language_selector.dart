import 'package:flutter/material.dart';
import '../i18n/i18n.dart';

class LanguageOption {
  final String code;
  final String nativeName;
  final String englishName;
  final String flag;

  const LanguageOption({
    required this.code,
    required this.nativeName,
    required this.englishName,
    required this.flag,
  });
}

class LanguageSelector extends StatelessWidget {
  final bool compact;
  final Color? backgroundColor;
  final Color? textColor;

  const LanguageSelector({
    super.key,
    this.compact = false,
    this.backgroundColor,
    this.textColor,
  });

  static const List<LanguageOption> options = [
    LanguageOption(
      code: 'en',
      nativeName: 'English',
      englishName: 'English',
      flag: '🇬🇧',
    ),
    LanguageOption(
      code: 'hi',
      nativeName: 'हिन्दी',
      englishName: 'Hindi',
      flag: '🇮🇳',
    ),
    LanguageOption(
      code: 'bn',
      nativeName: 'বাংলা',
      englishName: 'Bengali',
      flag: '🇮🇳',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<Locale>(
      valueListenable: I18n.currentLocaleNotifier,
      builder: (context, currentLocale, _) {
        final currentOption = options.firstWhere(
          (o) => o.code == currentLocale.languageCode,
          orElse: () => options[0],
        );

        return PopupMenuButton<String>(
          tooltip: context.tr('language.select'),
          onSelected: (String code) {
            I18n.setLocale(code);
          },
          offset: const Offset(0, 42),
          elevation: 8,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: BorderSide(
              color: Colors.white.withValues(alpha: 0.15),
            ),
          ),
          color: const Color(0xFF1E293B),
          itemBuilder: (BuildContext context) {
            return options.map((LanguageOption opt) {
              final isSelected = opt.code == currentLocale.languageCode;
              return PopupMenuItem<String>(
                value: opt.code,
                height: 48,
                child: Row(
                  children: [
                    Text(
                      opt.flag,
                      style: const TextStyle(fontSize: 18),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            opt.nativeName,
                            style: context.font(
                              color: isSelected
                                  ? const Color(0xFF38BDF8)
                                  : Colors.white,
                              fontSize: 14,
                              fontWeight: isSelected
                                  ? FontWeight.w700
                                  : FontWeight.w500,
                            ),
                          ),
                          if (opt.nativeName != opt.englishName)
                            Text(
                              opt.englishName,
                              style: TextStyle(
                                color: Colors.white.withValues(alpha: 0.5),
                                fontSize: 11,
                              ),
                            ),
                        ],
                      ),
                    ),
                    if (isSelected)
                      const Icon(
                        Icons.check_circle_rounded,
                        color: Color(0xFF38BDF8),
                        size: 18,
                      ),
                  ],
                ),
              );
            }).toList();
          },
          child: Container(
            padding: EdgeInsets.symmetric(
              horizontal: compact ? 10 : 14,
              vertical: compact ? 6 : 8,
            ),
            decoration: BoxDecoration(
              color: backgroundColor ?? Colors.white.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: Colors.white.withValues(alpha: 0.18),
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.15),
                  blurRadius: 8,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.language_rounded,
                  color: Color(0xFF38BDF8),
                  size: 16,
                ),
                const SizedBox(width: 6),
                Text(
                  currentOption.nativeName,
                  style: context.font(
                    color: textColor ?? Colors.white,
                    fontSize: compact ? 12 : 13,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(width: 4),
                Icon(
                  Icons.keyboard_arrow_down_rounded,
                  color: (textColor ?? Colors.white).withValues(alpha: 0.7),
                  size: 16,
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
