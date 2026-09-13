import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:google_fonts/google_fonts.dart';
import 'i18n/i18n.dart';
import 'services/api_service.dart';
import 'services/theme_service.dart';
import 'screens/home_screen.dart';
import 'screens/landing_screen.dart';
import 'screens/worker_dashboard_screen.dart';
import 'screens/employer_dashboard_screen.dart';
import 'screens/public_board_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Suppress visual overflow banners (e.g. "A RenderFlex overflowed by X pixels")
  // on screen during device development while preserving full functionality
  ErrorWidget.builder = (FlutterErrorDetails details) {
    final bool isOverflow = details.exceptionAsString().contains('overflowed');
    if (isOverflow) {
      debugPrint('[Layout Warning] ${details.exceptionAsString()}');
      return const SizedBox.shrink();
    }
    return ErrorWidget(details.exception);
  };

  await ApiService.init();
  await I18n.init();
  await ThemeService.init();
  runApp(const LabourLinkApp());
}

class LabourLinkApp extends StatelessWidget {
  const LabourLinkApp({super.key});

  @override
  Widget build(BuildContext context) {
    // ── LIGHT THEME (Soft Canvas + Pure White Cards + Royal Navy) ───────────
    const lightPrimary = Color(0xFF0F4C81);
    const lightSecondary = Color(0xFF059669);
    const lightSurfaceBg = Color(0xFFEEF2F6);

    final lightBaseTheme = ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      colorScheme: ColorScheme.fromSeed(
        seedColor: lightPrimary,
        brightness: Brightness.light,
        primary: lightPrimary,
        secondary: lightSecondary,
        surface: lightSurfaceBg,
      ),
      scaffoldBackgroundColor: lightSurfaceBg,
      appBarTheme: const AppBarTheme(
        backgroundColor: Colors.white,
        foregroundColor: Color(0xFF0F172A),
        elevation: 0.5,
        centerTitle: false,
      ),
      cardTheme: CardThemeData(
        color: Colors.white,
        elevation: 1,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: Color(0xFFE2E8F0)),
        ),
      ),
    );

    // ── DARK THEME (High-Contrast Midnight Navy + Elevated Slate Cards) ──────
    const darkPrimary = Color(0xFF38BDF8); // Luminous cyan/navy for crisp dark contrast
    const darkSecondary = Color(0xFF34D399); // Luminous emerald
    const darkSurfaceBg = Color(0xFF0B111E); // Deep midnight canvas

    final darkBaseTheme = ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: ColorScheme.fromSeed(
        seedColor: darkPrimary,
        brightness: Brightness.dark,
        primary: darkPrimary,
        secondary: darkSecondary,
        surface: const Color(0xFF182234),
      ),
      scaffoldBackgroundColor: darkSurfaceBg,
      appBarTheme: const AppBarTheme(
        backgroundColor: Color(0xFF121B2B),
        foregroundColor: Color(0xFFF8FAFC),
        elevation: 0.5,
        centerTitle: false,
      ),
      cardTheme: CardThemeData(
        color: const Color(0xFF182234),
        elevation: 2,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: Color(0xFF2E3D52)),
        ),
      ),
    );

    return ValueListenableBuilder<ThemeMode>(
      valueListenable: ThemeService.themeModeNotifier,
      builder: (context, currentThemeMode, _) {
        return ValueListenableBuilder<Locale>(
          valueListenable: I18n.currentLocaleNotifier,
          builder: (context, currentLocale, _) {
            return MaterialApp(
              title: 'LabourLink',
              debugShowCheckedModeBanner: false,
              locale: currentLocale,
              supportedLocales: I18n.supportedLocales,
              localizationsDelegates: const [
                GlobalMaterialLocalizations.delegate,
                GlobalWidgetsLocalizations.delegate,
                GlobalCupertinoLocalizations.delegate,
              ],
              themeMode: currentThemeMode,
              theme: lightBaseTheme.copyWith(
                textTheme: GoogleFonts.plusJakartaSansTextTheme(lightBaseTheme.textTheme),
              ),
              darkTheme: darkBaseTheme.copyWith(
                textTheme: GoogleFonts.plusJakartaSansTextTheme(darkBaseTheme.textTheme),
              ),
              // Landing screen is shown first; '/app' takes the user into the main shell
              initialRoute: '/landing',
              routes: {
                '/landing': (_) => const LandingScreen(),
                '/app': (_) => const MainNavigationShell(),
                '/jobs': (_) => const PublicBoardScreen(),
                '/chowk-feed': (_) => const PublicBoardScreen(),
              },
            );
          },
        );
      },
    );
  }
}

class MainNavigationShell extends StatefulWidget {
  const MainNavigationShell({super.key});

  @override
  State<MainNavigationShell> createState() => _MainNavigationShellState();
}

class _MainNavigationShellState extends State<MainNavigationShell> {
  int _currentIndex = 0;

  final List<Widget> _pages = const [
    HomeScreen(),
    WorkerDashboardScreen(),
    EmployerDashboardScreen(),
    PublicBoardScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _currentIndex,
        children: _pages,
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentIndex,
        onDestinationSelected: (idx) => setState(() => _currentIndex = idx),
        backgroundColor: Colors.white,
        elevation: 8,
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home, color: Color(0xFF1E3A8A)),
            label: 'Home',
          ),
          NavigationDestination(
            icon: Icon(Icons.engineering_outlined),
            selectedIcon: Icon(Icons.engineering, color: Color(0xFF0284C7)),
            label: 'Worker',
          ),
          NavigationDestination(
            icon: Icon(Icons.business_outlined),
            selectedIcon: Icon(Icons.business, color: Color(0xFFD97706)),
            label: 'Employer',
          ),
          NavigationDestination(
            icon: Icon(Icons.view_agenda_outlined),
            selectedIcon: Icon(Icons.view_agenda, color: Color(0xFF1E3A8A)),
            label: 'Job Board',
          ),
        ],
      ),
    );
  }
}
