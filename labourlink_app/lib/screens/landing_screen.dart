import 'package:flutter/material.dart';
import '../i18n/i18n.dart';
import '../widgets/language_selector.dart';
import 'worker_register_screen.dart';
import 'employer_post_job_screen.dart';
import 'role_login_screen.dart';
import '../widgets/mock_phone_call_widget.dart';

/// The initial landing screen presenting dual role-selection cards
/// for Worker and Hirer. Supports multi-language internationalization (en/hi/bn).
class LandingScreen extends StatefulWidget {
  const LandingScreen({super.key});

  @override
  State<LandingScreen> createState() => _LandingScreenState();
}

class _LandingScreenState extends State<LandingScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _animCtrl;
  late Animation<double> _fadeAnim;
  late Animation<Offset> _slideAnim;

  @override
  void initState() {
    super.initState();
    _animCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 700),
    );
    _fadeAnim = CurvedAnimation(parent: _animCtrl, curve: Curves.easeOut);
    _slideAnim = Tween<Offset>(
      begin: const Offset(0, 0.12),
      end: Offset.zero,
    ).animate(CurvedAnimation(parent: _animCtrl, curve: Curves.easeOut));
    _animCtrl.forward();
  }

  @override
  void dispose() {
    _animCtrl.dispose();
    super.dispose();
  }

  void _navigate(Widget screen) {
    Navigator.push(context, MaterialPageRoute(builder: (_) => screen));
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;
    final isWide = size.width > 600;

    return Scaffold(
      body: Container(
        width: double.infinity,
        height: double.infinity,
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            colors: [Color(0xFF0F172A), Color(0xFF1E293B), Color(0xFF0F172A)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        child: SafeArea(
          child: FadeTransition(
            opacity: _fadeAnim,
            child: SlideTransition(
              position: _slideAnim,
              child: SingleChildScrollView(
                padding: EdgeInsets.symmetric(
                  horizontal: isWide ? 40 : 20,
                  vertical: 16,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    // ── Top Bar with Language Selector ────────────────────
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: const [
                        LanguageSelector(),
                      ],
                    ),
                    const SizedBox(height: 12),

                    // ── Logo + Title ──────────────────────────────────────
                    _buildHeader(context),

                    const SizedBox(height: 12),

                    // Tagline
                    Text(
                      context.tr('app.tagline'),
                      textAlign: TextAlign.center,
                      style: context.font(
                        color: const Color(0xFF94A3B8),
                        fontSize: 14,
                        height: 1.6,
                      ),
                    ),

                    const SizedBox(height: 36),

                    // ── Dual Role Cards ───────────────────────────────────
                    Text(
                      context.tr('landing.whoAreYou'),
                      style: context.font(
                        color: Colors.white.withValues(alpha: 0.6),
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 1.2,
                      ),
                    ),
                    const SizedBox(height: 16),

                    isWide
                        ? Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(child: _WorkerCard(onNavigate: _navigate)),
                              const SizedBox(width: 16),
                              Expanded(child: _HirerCard(onNavigate: _navigate)),
                            ],
                          )
                        : Column(
                            children: [
                              _WorkerCard(onNavigate: _navigate),
                              const SizedBox(height: 16),
                              _HirerCard(onNavigate: _navigate),
                            ],
                          ),

                    const SizedBox(height: 28),

                    // Mock Phone Call Interface
                    const MockPhoneCallWidget(),

                    const SizedBox(height: 28),

                    // ── Browse Jobs row ───────────────────────────────────
                    _buildBrowseChip(context),

                    const SizedBox(height: 24),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildHeader(BuildContext context) {
    return Column(
      children: [
        Container(
          width: 68,
          height: 68,
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [Color(0xFF3B82F6), Color(0xFF1D4ED8)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(20),
            boxShadow: [
              BoxShadow(
                color: const Color(0xFF3B82F6).withValues(alpha: 0.4),
                blurRadius: 20,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: const Icon(Icons.bolt_rounded, color: Colors.white, size: 36),
        ),
        const SizedBox(height: 16),
        Text(
          context.tr('app.name'),
          style: context.font(
            color: Colors.white,
            fontSize: 32,
            fontWeight: FontWeight.w900,
            letterSpacing: -0.5,
          ),
        ),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
          decoration: BoxDecoration(
            color: const Color(0xFFFEF3C7).withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: const Color(0xFFFDE68A).withValues(alpha: 0.3),
            ),
          ),
          child: Text(
            context.tr('app.taglineBadge'),
            style: context.font(
              color: const Color(0xFFFDE68A),
              fontSize: 12,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.4,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildBrowseChip(BuildContext context) {
    return GestureDetector(
      onTap: () {
        Navigator.of(context).pushNamed('/jobs');
      },
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.search, color: Color(0xFF64748B), size: 16),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              context.tr('app.browseWithoutLogin'),
              textAlign: TextAlign.center,
              style: context.font(
                color: const Color(0xFF64748B),
                fontSize: 13,
                decoration: TextDecoration.underline,
                decorationColor: const Color(0xFF64748B),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker Card
// ─────────────────────────────────────────────────────────────────────────────
class _WorkerCard extends StatefulWidget {
  final void Function(Widget) onNavigate;
  const _WorkerCard({required this.onNavigate});

  @override
  State<_WorkerCard> createState() => _WorkerCardState();
}

class _WorkerCardState extends State<_WorkerCard> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: AnimatedScale(
        scale: _hovered ? 1.02 : 1.0,
        duration: const Duration(milliseconds: 200),
        child: Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: _hovered
                  ? [const Color(0xFFF97316), const Color(0xFFEA580C)]
                  : [const Color(0xFFFA8231), const Color(0xFFD97706)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(24),
            boxShadow: [
              BoxShadow(
                color: const Color(0xFFF97316).withValues(alpha: _hovered ? 0.5 : 0.3),
                blurRadius: _hovered ? 28 : 18,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              // Icon
              Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.2),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.engineering_rounded,
                  color: Colors.white,
                  size: 38,
                ),
              ),
              const SizedBox(height: 16),

              // Title
              Text(
                context.tr('role.workerCardTitle'),
                textAlign: TextAlign.center,
                style: context.font(
                  color: Colors.white,
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                context.tr('role.workerCardDesc'),
                textAlign: TextAlign.center,
                style: context.font(
                  color: Colors.white.withValues(alpha: 0.85),
                  fontSize: 13,
                  height: 1.4,
                ),
              ),

              const SizedBox(height: 24),

              // Log In button
              _CardButton(
                label: context.tr('action.logIn'),
                icon: Icons.login_rounded,
                onTap: () => widget.onNavigate(
                  const RoleLoginScreen(role: 'worker'),
                ),
              ),

              const SizedBox(height: 12),

              // Register link
              GestureDetector(
                onTap: () => widget.onNavigate(const WorkerRegisterScreen()),
                child: Text(
                  context.tr('action.orRegister'),
                  style: context.font(
                    color: Colors.white.withValues(alpha: 0.9),
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    decoration: TextDecoration.underline,
                    decorationColor: Colors.white.withValues(alpha: 0.6),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hirer Card
// ─────────────────────────────────────────────────────────────────────────────
class _HirerCard extends StatefulWidget {
  final void Function(Widget) onNavigate;
  const _HirerCard({required this.onNavigate});

  @override
  State<_HirerCard> createState() => _HirerCardState();
}

class _HirerCardState extends State<_HirerCard> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: AnimatedScale(
        scale: _hovered ? 1.02 : 1.0,
        duration: const Duration(milliseconds: 200),
        child: Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: _hovered
                  ? [const Color(0xFF0891B2), const Color(0xFF0E7490)]
                  : [const Color(0xFF06B6D4), const Color(0xFF0284C7)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(24),
            boxShadow: [
              BoxShadow(
                color: const Color(0xFF06B6D4).withValues(alpha: _hovered ? 0.5 : 0.3),
                blurRadius: _hovered ? 28 : 18,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              // Icon
              Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.2),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.business_center_rounded,
                  color: Colors.white,
                  size: 38,
                ),
              ),
              const SizedBox(height: 16),

              // Title
              Text(
                context.tr('role.hirerCardTitle'),
                textAlign: TextAlign.center,
                style: context.font(
                  color: Colors.white,
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                context.tr('role.hirerCardDesc'),
                textAlign: TextAlign.center,
                style: context.font(
                  color: Colors.white.withValues(alpha: 0.85),
                  fontSize: 13,
                  height: 1.4,
                ),
              ),

              const SizedBox(height: 24),

              // Log In button
              _CardButton(
                label: context.tr('action.logIn'),
                icon: Icons.login_rounded,
                onTap: () => widget.onNavigate(
                  const RoleLoginScreen(role: 'hirer'),
                ),
              ),

              const SizedBox(height: 12),

              // Register link
              GestureDetector(
                onTap: () => widget.onNavigate(const EmployerPostJobScreen()),
                child: Text(
                  context.tr('action.orRegister'),
                  style: context.font(
                    color: Colors.white.withValues(alpha: 0.9),
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    decoration: TextDecoration.underline,
                    decorationColor: Colors.white.withValues(alpha: 0.6),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared styled button inside cards
// ─────────────────────────────────────────────────────────────────────────────
class _CardButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final VoidCallback onTap;

  const _CardButton({
    required this.label,
    required this.icon,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton.icon(
        onPressed: onTap,
        icon: Icon(icon, size: 18),
        label: Text(
          label,
          style: context.font(
            fontWeight: FontWeight.w700,
            fontSize: 15,
          ),
        ),
        style: ElevatedButton.styleFrom(
          backgroundColor: Colors.white,
          foregroundColor: const Color(0xFF0F172A),
          elevation: 0,
          padding: const EdgeInsets.symmetric(vertical: 14),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
        ),
      ),
    );
  }
}
