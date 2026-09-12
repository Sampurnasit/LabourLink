import 'dart:convert';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// App Internationalization Service (i18n)
/// Supports English ('en'), Hindi ('hi'), and Bengali ('bn').
class I18n {
  static const String prefKey = 'selected_language_code';

  static const List<Locale> supportedLocales = [
    Locale('en'),
    Locale('hi'),
    Locale('bn'),
  ];

  static final ValueNotifier<Locale> currentLocaleNotifier =
      ValueNotifier<Locale>(const Locale('en'));

  static Locale get currentLocale => currentLocaleNotifier.value;
  static String get currentLanguageCode => currentLocaleNotifier.value.languageCode;

  static final Map<String, Map<String, dynamic>> _translations = {};

  /// Preloaded in-memory fallbacks to guarantee immediate synchronous translation
  static const Map<String, Map<String, dynamic>> _inMemoryTranslations = {
    'en': {
      'app': {
        'name': 'LabourLink',
        'taglineBadge': '⚡ CHOWK — Direct Labour Matching',
        'tagline': 'Instant short-term gig matching.\nNo middlemen. Just work.',
        'browseWithoutLogin': 'Browse open jobs without signing in'
      },
      'landing': {
        'whoAreYou': 'Who are you?'
      },
      'role': {
        'worker': 'Worker',
        'hirer': 'Hirer',
        'workerCardTitle': "I'm a Worker",
        'workerCardDesc': 'Find daily gigs, register skills & get hired today.',
        'hirerCardTitle': "I'm a Hirer",
        'hirerCardDesc': 'Post jobs, browse workers & confirm hires instantly.'
      },
      'login': {
        'workerTitle': 'Worker Login',
        'hirerTitle': 'Hirer Login',
        'workerSubtitle': 'Enter your registered phone number\nto access your Worker dashboard.',
        'hirerSubtitle': 'Enter your registered phone number\nto access your Hirer dashboard.',
        'phoneLabel': 'Phone Number',
        'phonePlaceholder': 'Enter 10-digit phone number',
        'submitWorker': 'Log In as Worker',
        'submitHirer': 'Log In as Hirer',
        'loggingIn': 'Logging in...',
        'noAccount': "Don't have an account?",
        'goBackRegister': '← Go back and Register',
        'forgotNumber': 'Forgot registered number?',
        'helpText': 'We will verify your profile using your phone number.'
      },
      'validation': {
        'phoneRequired': 'Phone number is required',
        'phoneInvalid': 'Enter a valid 10-digit phone number',
        'fillAllFields': 'Please fill in all required fields'
      },
      'action': {
        'logIn': 'Log In',
        'orRegister': 'or Register',
        'register': 'Register',
        'back': 'Back'
      },
      'language': {
        'select': 'Language',
        'en': 'English',
        'hi': 'हिन्दी',
        'bn': 'বাংলা'
      }
    },
    'hi': {
      'app': {
        'name': 'LabourLink',
        'taglineBadge': '⚡ चौक — सीधा मज़दूर मिलान',
        'tagline': 'दैनिक काम और मज़दूरों का सीधा संपर्क।\nकोई बिचौलिया नहीं। सिर्फ़ काम।',
        'browseWithoutLogin': 'बिना लॉगिन किए उपलब्ध काम देखें'
      },
      'landing': {
        'whoAreYou': 'आप कौन हैं?'
      },
      'role': {
        'worker': 'मज़दूर / कारीगर',
        'hirer': 'मालिक / ठेकेदार',
        'workerCardTitle': 'मैं मज़दूर / कारीगर हूँ',
        'workerCardDesc': 'दैनिक काम खोजें, अपना हुनर जोड़ें और आज ही काम पाएँ।',
        'hirerCardTitle': 'मुझे मज़दूर चाहिए (मालिक)',
        'hirerCardDesc': 'काम पोस्ट करें, कारीगर देखें और तुरंत काम पर रखें।'
      },
      'login': {
        'workerTitle': 'कारीगर लॉगिन',
        'hirerTitle': 'मालिक / ठेकेदार लॉगिन',
        'workerSubtitle': 'अपने मज़दूर डैशबोर्ड में जाने के लिए\nअपना पंजीकृत फ़ोन नंबर दर्ज करें।',
        'hirerSubtitle': 'अपने मालिक डैशबोर्ड में जाने के लिए\nअपना पंजीकृत फ़ोन नंबर दर्ज करें।',
        'phoneLabel': 'फ़ोन नंबर',
        'phonePlaceholder': '10 अंकों का मोबाइल नंबर दर्ज करें',
        'submitWorker': 'कारीगर के रूप में लॉगिन करें',
        'submitHirer': 'मालिक के रूप में लॉगिन करें',
        'loggingIn': 'लॉगिन हो रहा है...',
        'noAccount': 'क्या आपका खाता नहीं है?',
        'goBackRegister': '← वापस जाएँ और नया पंजीकरण करें',
        'forgotNumber': 'पंजीकृत नंबर भूल गए?',
        'helpText': 'हम आपके फ़ोन नंबर से आपकी प्रोफ़ाइल की पुष्टि करेंगे।'
      },
      'validation': {
        'phoneRequired': 'फ़ोन नंबर दर्ज करना अनिवार्य है',
        'phoneInvalid': 'कृपया वैध 10 अंकों का फ़ोन नंबर दर्ज करें',
        'fillAllFields': 'कृपया सभी आवश्यक जानकारी भरें'
      },
      'action': {
        'logIn': 'लॉग इन करें',
        'orRegister': 'या पंजीकरण करें',
        'register': 'पंजीकरण करें',
        'back': 'वापस'
      },
      'language': {
        'select': 'भाषा',
        'en': 'English',
        'hi': 'हिन्दी',
        'bn': 'বাংলা'
      }
    },
    'bn': {
      'app': {
        'name': 'LabourLink',
        'taglineBadge': '⚡ চক — সরাসরি শ্রমিক যোগাযোগ',
        'tagline': 'দৈনিক কাজ ও শ্রমিকের সরাসরি যোগাযোগ।\nকোনো দালাল নেই। শুধু কাজ।',
        'browseWithoutLogin': 'লগইন ছাড়াই উপলব্ধ কাজগুলি দেখুন'
      },
      'landing': {
        'whoAreYou': 'আপনি কে?'
      },
      'role': {
        'worker': 'শ্রমিক / কারিগর',
        'hirer': 'মালিক / নিয়োগকর্তা',
        'workerCardTitle': 'আমি শ্রমিক / কারিগর',
        'workerCardDesc': 'প্রতিদিনের কাজের সুযোগ খুঁজুন, দক্ষতা যুক্ত করুন ও কাজ পান।',
        'hirerCardTitle': 'আমার শ্রমিক প্রয়োজন (মালিক)',
        'hirerCardDesc': 'কাজের তথ্য দিন, দক্ষ কারিগর খুঁজুন এবং সাথে সাথে নিয়োগ করুন।'
      },
      'login': {
        'workerTitle': 'শ্রমিক লগইন',
        'hirerTitle': 'নিয়োগকর্তা লগইন',
        'workerSubtitle': 'আপনার শ্রমিক ড্যাশবোর্ড খোলার জন্য\nনিবন্ধিত মোবাইল নম্বর লিখুন।',
        'hirerSubtitle': 'আপনার মালিক ড্যাশবোর্ড খোলার জন্য\nনিবন্ধিত মোবাইল নম্বর লিখুন।',
        'phoneLabel': 'ফোন নম্বর',
        'phonePlaceholder': '১০ অঙ্কের মোবাইল নম্বর লিখুন',
        'submitWorker': 'শ্রমিক হিসেবে লগইন করুন',
        'submitHirer': 'মালিক হিসেবে লগইন করুন',
        'loggingIn': 'লগইন হচ্ছে...',
        'noAccount': 'অ্যাকাউন্ট তৈরি করা নেই?',
        'goBackRegister': '← ফিরে যান এবং নতুন নিবন্ধন করুন',
        'forgotNumber': 'নিবন্ধিত নম্বর ভুলে গেছেন?',
        'helpText': 'আমরা আপনার মোবাইল নম্বর দিয়ে প্রোফাইল যাচাই করব।'
      },
      'validation': {
        'phoneRequired': 'ফোন নম্বর দেওয়া আবশ্যক',
        'phoneInvalid': 'সঠিক ১০ অঙ্কের মোবাইল নম্বর লিখুন',
        'fillAllFields': 'অনুগ্রহ করে সব তথ্য সঠিকভাবে পূরণ করুন'
      },
      'action': {
        'logIn': 'লগইন করুন',
        'orRegister': 'অথবা নিবন্ধন করুন',
        'register': 'নিবন্ধন করুন',
        'back': 'ফিরে যান'
      },
      'language': {
        'select': 'ভাষা',
        'en': 'English',
        'hi': 'हिन्दी',
        'bn': 'বাংলা'
      }
    }
  };

  /// Initialize i18n: Load preference or detect device locale, load json assets
  static Future<void> init() async {
    // Populate in-memory map first
    _translations.addAll(_inMemoryTranslations);

    // Try loading full JSON assets if available
    for (final loc in supportedLocales) {
      try {
        final jsonString =
            await rootBundle.loadString('assets/i18n/${loc.languageCode}.json');
        final Map<String, dynamic> jsonMap = jsonDecode(jsonString);
        _translations[loc.languageCode] = jsonMap;
      } catch (_) {
        // Fallback already present in _inMemoryTranslations
      }
    }

    try {
      final prefs = await SharedPreferences.getInstance();
      final savedLang = prefs.getString(prefKey);
      if (savedLang != null && isSupported(savedLang)) {
        currentLocaleNotifier.value = Locale(savedLang);
        return;
      }

      // Auto-detect device/browser language
      final deviceLocale = ui.PlatformDispatcher.instance.locale.languageCode.toLowerCase();
      if (isSupported(deviceLocale)) {
        currentLocaleNotifier.value = Locale(deviceLocale);
      } else {
        currentLocaleNotifier.value = const Locale('en');
      }
    } catch (_) {
      currentLocaleNotifier.value = const Locale('en');
    }
  }

  static bool isSupported(String code) {
    return supportedLocales.any((l) => l.languageCode == code.toLowerCase());
  }

  /// Switch language dynamically across entire app & persist
  static Future<void> setLocale(String languageCode) async {
    final code = languageCode.toLowerCase();
    if (!isSupported(code)) return;

    currentLocaleNotifier.value = Locale(code);

    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(prefKey, code);
    } catch (e) {
      debugPrint('Error saving language preference: $e');
    }
  }

  /// Translate a key with optional interpolation args
  /// e.g. I18n.t('login.phoneLabel') or I18n.t('login.title', args: {'role': 'Worker'})
  static String t(String key, {Map<String, String>? args, String? lang}) {
    final targetLang = lang ?? currentLanguageCode;
    final map = _translations[targetLang] ?? _translations['en'] ?? {};

    dynamic value = _resolveNestedKey(map, key);

    // If missing in current language, try English
    if (value == null && targetLang != 'en') {
      final fallbackMap = _translations['en'] ?? {};
      value = _resolveNestedKey(fallbackMap, key);
    }

    String result = (value is String) ? value : key;

    // Interpolate placeholders: {name} -> args['name']
    if (args != null && args.isNotEmpty) {
      args.forEach((k, v) {
        result = result.replaceAll('{$k}', v);
      });
    }

    return result;
  }

  static dynamic _resolveNestedKey(Map<String, dynamic> map, String key) {
    final parts = key.split('.');
    dynamic current = map;
    for (final part in parts) {
      if (current is Map<String, dynamic> && current.containsKey(part)) {
        current = current[part];
      } else {
        return null;
      }
    }
    return current;
  }

  /// Get typography with proper script fallbacks for English, Devanagari (Hindi) and Bengali
  static TextStyle font({
    double? fontSize,
    FontWeight? fontWeight,
    Color? color,
    double? height,
    double? letterSpacing,
    TextDecoration? decoration,
    Color? decorationColor,
  }) {
    final lang = currentLanguageCode;

    // For Hindi and Bengali, increase line height slightly to avoid clipping ascenders/descenders
    final safeHeight = height ?? (lang == 'en' ? 1.4 : 1.55);

    if (lang == 'hi') {
      return GoogleFonts.notoSansDevanagari(
        fontSize: fontSize,
        fontWeight: fontWeight,
        color: color,
        height: safeHeight,
        letterSpacing: letterSpacing,
        decoration: decoration,
        decorationColor: decorationColor,
      );
    } else if (lang == 'bn') {
      return GoogleFonts.notoSansBengali(
        fontSize: fontSize,
        fontWeight: fontWeight,
        color: color,
        height: safeHeight,
        letterSpacing: letterSpacing,
        decoration: decoration,
        decorationColor: decorationColor,
      );
    } else {
      return GoogleFonts.plusJakartaSans(
        fontSize: fontSize,
        fontWeight: fontWeight,
        color: color,
        height: safeHeight,
        letterSpacing: letterSpacing,
        decoration: decoration,
        decorationColor: decorationColor,
      );
    }
  }
}

/// Extension for convenient access on BuildContext: context.tr('key') and context.font(...)
extension I18nExtension on BuildContext {
  String tr(String key, {Map<String, String>? args}) =>
      I18n.t(key, args: args);

  TextStyle font({
    double? fontSize,
    FontWeight? fontWeight,
    Color? color,
    double? height,
    double? letterSpacing,
    TextDecoration? decoration,
    Color? decorationColor,
  }) =>
      I18n.font(
        fontSize: fontSize,
        fontWeight: fontWeight,
        color: color,
        height: height,
        letterSpacing: letterSpacing,
        decoration: decoration,
        decorationColor: decorationColor,
      );

  Locale get locale => I18n.currentLocale;
  String get languageCode => I18n.currentLanguageCode;
}
