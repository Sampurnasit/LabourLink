import 'package:flutter/material.dart';
import '../i18n/i18n.dart';
import '../widgets/language_selector.dart';
import '../widgets/theme_toggle.dart';
import 'worker_register_screen.dart';
import 'employer_post_job_screen.dart';
import 'role_login_screen.dart';
import '../widgets/mock_phone_call_widget.dart';

/// The initial landing screen with reactive Light and High-Contrast Dark modes.
/// Adapts surfaces, cards, and accent contrast dynamically.
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
      duration: const Duration(milliseconds: 650),
    );
    _fadeAnim = CurvedAnimation(parent: _animCtrl, curve: Curves.easeOut);
    _slideAnim = Tween<Offset>(
      begin: const Offset(0, 0.08),
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
    final isWide = size.width > 680;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF0B111E) : const Color(0xFFEEF2F6),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: const Color(0xFF10B981),
        foregroundColor: Colors.white,
        elevation: 6,
        icon: const Icon(Icons.phone_in_talk_rounded),
        label: Text(
          'AI Voice Call',
          style: context.font(
            fontSize: 13,
            fontWeight: FontWeight.w800,
            letterSpacing: 0.2,
          ),
        ),
        onPressed: () {
          _showVoiceCallBottomSheet(context, isDark);
        },
      ),
      body: AnimatedContainer(
        duration: const Duration(milliseconds: 300),
        width: double.infinity,
        height: double.infinity,
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: isDark
                ? const [Color(0xFF0F172A), Color(0xFF0B111E), Color(0xFF070C15)]
                : const [Color(0xFFF4F7FB), Color(0xFFEEF2F6), Color(0xFFE5ECF4)],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: SafeArea(
          child: FadeTransition(
            opacity: _fadeAnim,
            child: SlideTransition(
              position: _slideAnim,
              child: SingleChildScrollView(
                padding: EdgeInsets.symmetric(
                  horizontal: isWide ? 48 : 20,
                  vertical: 16,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    // ── Top Bar with Theme Toggle & Language Selector ────
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        // Mini brand tag
                        Row(
                          children: [
                            Container(
                              width: 34,
                              height: 34,
                              decoration: BoxDecoration(
                                gradient: LinearGradient(
                                  colors: isDark
                                      ? const [Color(0xFF38BDF8), Color(0xFF10B981)]
                                      : const [Color(0xFF0F4C81), Color(0xFF065F46)],
                                ),
                                borderRadius: BorderRadius.circular(10),
                                boxShadow: [
                                  BoxShadow(
                                    color: (isDark ? const Color(0xFF38BDF8) : const Color(0xFF0F4C81))
                                        .withValues(alpha: 0.3),
                                    blurRadius: 8,
                                    offset: const Offset(0, 2),
                                  ),
                                ],
                              ),
                              child: const Icon(Icons.bolt_rounded, color: Colors.white, size: 20),
                            ),
                            const SizedBox(width: 10),
                            Text(
                              'LabourLink',
                              style: context.font(
                                color: isDark ? const Color(0xFFF8FAFC) : const Color(0xFF1A2332),
                                fontSize: 17,
                                fontWeight: FontWeight.w800,
                                letterSpacing: -0.3,
                              ),
                            ),
                          ],
                        ),

                        // Action Controls: Theme Switch + Language Selector
                        Row(
                          children: const [
                            ThemeToggleButton(showLabel: true),
                            SizedBox(width: 8),
                            LanguageSelector(),
                          ],
                        ),
                      ],
                    ),
                    const SizedBox(height: 24),

                    // ── Hero Header ───────────────────────────────────────
                    _buildHeader(context, isDark),

                    const SizedBox(height: 18),

                    // Signature 4 Circular Category Badges
                    _buildCategoryBadgeCluster(isDark),

                    const SizedBox(height: 28),

                    // ── AI Voice Agent Live Call Dispatch (Web Parity) ────
                    _buildVoiceCallSection(context, isDark, isWide),

                    const SizedBox(height: 32),

                    // ── Section Title ─────────────────────────────────────
                    Text(
                      context.tr('landing.whoAreYou'),
                      style: context.font(
                        color: isDark ? const Color(0xFF94A3B8) : const Color(0xFF64748B),
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 1.2,
                      ),
                    ),
                    const SizedBox(height: 14),

                    // ── Dual Role Cards ───────────────────────────────────
                    isWide
                        ? Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(child: _WorkerCard(onNavigate: _navigate, isDark: isDark)),
                              const SizedBox(width: 20),
                              Expanded(child: _HirerCard(onNavigate: _navigate, isDark: isDark)),
                            ],
                          )
                        : Column(
                            children: [
                              _WorkerCard(onNavigate: _navigate, isDark: isDark),
                              const SizedBox(height: 18),
                              _HirerCard(onNavigate: _navigate, isDark: isDark),
                            ],
                          ),

                    const SizedBox(height: 32),

                    // ── Browse Jobs row ───────────────────────────────────
                    _buildBrowseChip(context, isDark),

                    const SizedBox(height: 20),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildHeader(BuildContext context, bool isDark) {
    return Column(
      children: [
        // App Title
        Text(
          context.tr('app.name'),
          style: context.font(
            color: isDark ? const Color(0xFFF8FAFC) : const Color(0xFF1A2332),
            fontSize: 34,
            fontWeight: FontWeight.w900,
            letterSpacing: -0.8,
          ),
        ),
        const SizedBox(height: 8),

        // Tagline badge
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
          decoration: BoxDecoration(
            color: isDark ? const Color(0xFF064E3B) : const Color(0xFFD1FAE5),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: isDark ? const Color(0xFF059669) : const Color(0xFFA7F3D0),
            ),
          ),
          child: Text(
            context.tr('app.taglineBadge'),
            style: context.font(
              color: isDark ? const Color(0xFF34D399) : const Color(0xFF047857),
              fontSize: 12,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.3,
            ),
          ),
        ),
        const SizedBox(height: 12),

        // Subtitle
        ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Text(
            context.tr('app.tagline'),
            textAlign: TextAlign.center,
            style: context.font(
              color: isDark ? const Color(0xFF94A3B8) : const Color(0xFF64748B),
              fontSize: 14,
              height: 1.55,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildCategoryBadgeCluster(bool isDark) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF182234) : Colors.white,
        borderRadius: BorderRadius.circular(30),
        border: Border.all(
          color: isDark ? const Color(0xFF2E3D52) : const Color(0xFFE2E8F0),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: isDark ? 0.3 : 0.05),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _CircleBadge(color: isDark ? const Color(0xFF1D4ED8) : const Color(0xFF0F4C81), icon: Icons.handyman_rounded, tooltip: 'Technical Trades'),
          const SizedBox(width: 10),
          _CircleBadge(color: isDark ? const Color(0xFFEA580C) : const Color(0xFFC2410C), icon: Icons.construction_rounded, tooltip: 'Construction & Labor'),
          const SizedBox(width: 10),
          _CircleBadge(color: isDark ? const Color(0xFF059669) : const Color(0xFF047857), icon: Icons.verified_user_rounded, tooltip: 'Verified Workers'),
          const SizedBox(width: 10),
          _CircleBadge(color: isDark ? const Color(0xFFDC2626) : const Color(0xFFB91C1C), icon: Icons.electric_bolt_rounded, tooltip: 'Instant Dispatch'),
        ],
      ),
    );
  }

  Widget _buildBrowseChip(BuildContext context, bool isDark) {
    final highlight = isDark ? const Color(0xFF38BDF8) : const Color(0xFF0F4C81);

    return GestureDetector(
      onTap: () {
        Navigator.of(context).pushNamed('/jobs');
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
        decoration: BoxDecoration(
          color: isDark ? const Color(0xFF182234) : Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isDark ? const Color(0xFF2E3D52) : const Color(0xFFCBD5E1),
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: isDark ? 0.25 : 0.04),
              blurRadius: 6,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.search_rounded, color: highlight, size: 16),
            const SizedBox(width: 8),
            Text(
              context.tr('app.browseWithoutLogin'),
              style: context.font(
                color: highlight,
                fontSize: 13,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildVoiceCallSection(BuildContext context, bool isDark, bool isWide) {
    return Container(
      constraints: const BoxConstraints(maxWidth: 480),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          // Badge Pill
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
            decoration: BoxDecoration(
              color: isDark
                  ? const Color(0xFF1E3A8A).withValues(alpha: 0.3)
                  : const Color(0xFFEFF6FF),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: isDark ? const Color(0xFF3B82F6) : const Color(0xFFBFDBFE),
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('🎙️ ', style: TextStyle(fontSize: 14)),
                Text(
                  'AI Voice Agent Direct Line',
                  style: context.font(
                    color: isDark ? const Color(0xFF60A5FA) : const Color(0xFF1D4ED8),
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.3,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),

          // Section Title
          Text(
            'Try Live AI Voice Dispatch',
            textAlign: TextAlign.center,
            style: context.font(
              color: isDark ? const Color(0xFFF8FAFC) : const Color(0xFF0F172A),
              fontSize: 22,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.3,
            ),
          ),
          const SizedBox(height: 6),

          // Subtitle
          Text(
            'Talk to LabourLink like you\'re making a call — no typing needed.',
            textAlign: TextAlign.center,
            style: context.font(
              color: isDark ? const Color(0xFF94A3B8) : const Color(0xFF64748B),
              fontSize: 13,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 16),

          // Mock Phone Call Widget
          const MockPhoneCallWidget(),
        ],
      ),
    );
  }

  void _showVoiceCallBottomSheet(BuildContext context, bool isDark) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return Container(
          decoration: BoxDecoration(
            color: isDark ? const Color(0xFF0F172A) : Colors.white,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
            border: Border.all(
              color: isDark ? const Color(0xFF1E293B) : const Color(0xFFE2E8F0),
            ),
          ),
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 16,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 24,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 44,
                height: 4,
                decoration: BoxDecoration(
                  color: isDark ? const Color(0xFF334155) : const Color(0xFFCBD5E1),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 16),
              const MockPhoneCallWidget(),
            ],
          ),
        );
      },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Signature Circular Status Badge Widget
// ─────────────────────────────────────────────────────────────────────────────
class _CircleBadge extends StatelessWidget {
  final Color color;
  final IconData icon;
  final String tooltip;

  const _CircleBadge({
    required this.color,
    required this.icon,
    required this.tooltip,
  });

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Container(
        width: 34,
        height: 34,
        decoration: BoxDecoration(
          color: color,
          shape: BoxShape.circle,
          boxShadow: [
            BoxShadow(
              color: color.withValues(alpha: 0.35),
              blurRadius: 6,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Icon(icon, color: Colors.white, size: 18),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker Card (Emerald Green Theme from Spec with Contrast Adaptation)
// ─────────────────────────────────────────────────────────────────────────────
class _WorkerCard extends StatefulWidget {
  final void Function(Widget) onNavigate;
  final bool isDark;

  const _WorkerCard({
    required this.onNavigate,
    required this.isDark,
  });

  @override
  State<_WorkerCard> createState() => _WorkerCardState();
}

class _WorkerCardState extends State<_WorkerCard> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final isDark = widget.isDark;
    final cardBg = isDark ? const Color(0xFF182234) : Colors.white;
    final borderColor = _hovered
        ? (isDark ? const Color(0xFF34D399) : const Color(0xFF059669))
        : (isDark ? const Color(0xFF2E3D52) : const Color(0xFFE2E8F0));
    final textColor = isDark ? const Color(0xFFF8FAFC) : const Color(0xFF1A2332);
    final descColor = isDark ? const Color(0xFF94A3B8) : const Color(0xFF64748B);

    return MouseRegion(
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: cardBg,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(
            color: borderColor,
            width: _hovered ? 1.5 : 1,
          ),
          boxShadow: [
            BoxShadow(
              color: (isDark ? Colors.black : const Color(0xFF059669))
                  .withValues(alpha: _hovered ? 0.35 : 0.08),
              blurRadius: _hovered ? 24 : 14,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Top Row: Square green badge + pill tag
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: isDark ? const Color(0xFF064E3B) : const Color(0xFF065F46),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(
                      color: isDark ? const Color(0xFF059669) : Colors.transparent,
                    ),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x33065F46),
                        blurRadius: 10,
                        offset: Offset(0, 4),
                      ),
                    ],
                  ),
                  child: const Icon(Icons.engineering_rounded, color: Color(0xFF34D399), size: 26),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: isDark ? const Color(0xFF064E3B) : const Color(0xFFECFDF5),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(
                      color: isDark ? const Color(0xFF059669) : const Color(0xFFA7F3D0),
                    ),
                  ),
                  child: Text(
                    'Worker Portal',
                    style: context.font(
                      color: isDark ? const Color(0xFF34D399) : const Color(0xFF047857),
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),

            // Title
            Text(
              context.tr('role.workerCardTitle'),
              style: context.font(
                color: textColor,
                fontSize: 21,
                fontWeight: FontWeight.w800,
                letterSpacing: -0.3,
              ),
            ),
            const SizedBox(height: 8),

            // Description
            Text(
              context.tr('role.workerCardDesc'),
              style: context.font(
                color: descColor,
                fontSize: 13,
                height: 1.5,
              ),
            ),

            const SizedBox(height: 24),

            // Primary Emerald Action Button
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: () => widget.onNavigate(
                  const RoleLoginScreen(role: 'worker'),
                ),
                icon: const Icon(Icons.login_rounded, size: 18),
                label: Text(
                  context.tr('action.logIn'),
                  style: context.font(
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                  ),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: isDark ? const Color(0xFF059669) : const Color(0xFF047857),
                  foregroundColor: Colors.white,
                  elevation: isDark ? 2 : 0,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
              ),
            ),

            const SizedBox(height: 10),

            // Secondary Outlined Register Button
            SizedBox(
              width: double.infinity,
              child: OutlinedButton(
                onPressed: () => widget.onNavigate(const WorkerRegisterScreen()),
                style: OutlinedButton.styleFrom(
                  foregroundColor: isDark ? const Color(0xFF34D399) : const Color(0xFF047857),
                  side: BorderSide(
                    color: isDark ? const Color(0xFF334155) : const Color(0xFFCBD5E1),
                  ),
                  padding: const EdgeInsets.symmetric(vertical: 13),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                child: Text(
                  context.tr('action.orRegister'),
                  style: context.font(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hirer Card (Royal Navy Theme with Contrast Adaptation)
// ─────────────────────────────────────────────────────────────────────────────
class _HirerCard extends StatefulWidget {
  final void Function(Widget) onNavigate;
  final bool isDark;

  const _HirerCard({
    required this.onNavigate,
    required this.isDark,
  });

  @override
  State<_HirerCard> createState() => _HirerCardState();
}

class _HirerCardState extends State<_HirerCard> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final isDark = widget.isDark;
    final cardBg = isDark ? const Color(0xFF182234) : Colors.white;
    final borderColor = _hovered
        ? (isDark ? const Color(0xFF60A5FA) : const Color(0xFF0F4C81))
        : (isDark ? const Color(0xFF2E3D52) : const Color(0xFFE2E8F0));
    final textColor = isDark ? const Color(0xFFF8FAFC) : const Color(0xFF1A2332);
    final descColor = isDark ? const Color(0xFF94A3B8) : const Color(0xFF64748B);

    return MouseRegion(
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: cardBg,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(
            color: borderColor,
            width: _hovered ? 1.5 : 1,
          ),
          boxShadow: [
            BoxShadow(
              color: (isDark ? Colors.black : const Color(0xFF0F4C81))
                  .withValues(alpha: _hovered ? 0.35 : 0.08),
              blurRadius: _hovered ? 24 : 14,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Top Row: Navy Badge + Pill Tag
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: isDark ? const Color(0xFF1E293B) : const Color(0xFFEBF2F9),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(
                      color: isDark ? const Color(0xFF334155) : const Color(0xFFD7E5F5),
                    ),
                  ),
                  child: Icon(
                    Icons.business_center_rounded,
                    color: isDark ? const Color(0xFF38BDF8) : const Color(0xFF0F4C81),
                    size: 26,
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: isDark ? const Color(0xFF1E293B) : const Color(0xFFEBF2F9),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(
                      color: isDark ? const Color(0xFF334155) : const Color(0xFFD7E5F5),
                    ),
                  ),
                  child: Text(
                    'Employer Desk',
                    style: context.font(
                      color: isDark ? const Color(0xFF38BDF8) : const Color(0xFF0F4C81),
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),

            // Title
            Text(
              context.tr('role.hirerCardTitle'),
              style: context.font(
                color: textColor,
                fontSize: 21,
                fontWeight: FontWeight.w800,
                letterSpacing: -0.3,
              ),
            ),
            const SizedBox(height: 8),

            // Description
            Text(
              context.tr('role.hirerCardDesc'),
              style: context.font(
                color: descColor,
                fontSize: 13,
                height: 1.5,
              ),
            ),

            const SizedBox(height: 24),

            // Primary Royal Navy Pill Action Button
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: () => widget.onNavigate(
                  const RoleLoginScreen(role: 'hirer'),
                ),
                icon: const Icon(Icons.login_rounded, size: 18),
                label: Text(
                  context.tr('action.logIn'),
                  style: context.font(
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                  ),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: isDark ? const Color(0xFF0F4C81) : const Color(0xFF0F4C81),
                  foregroundColor: Colors.white,
                  elevation: isDark ? 2 : 0,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                  shadowColor: const Color(0x400F4C81),
                ),
              ),
            ),

            const SizedBox(height: 10),

            // Secondary Outlined Post Job Button
            SizedBox(
              width: double.infinity,
              child: OutlinedButton(
                onPressed: () => widget.onNavigate(const EmployerPostJobScreen()),
                style: OutlinedButton.styleFrom(
                  foregroundColor: isDark ? const Color(0xFF38BDF8) : const Color(0xFF0F4C81),
                  side: BorderSide(
                    color: isDark ? const Color(0xFF334155) : const Color(0xFFCBD5E1),
                  ),
                  padding: const EdgeInsets.symmetric(vertical: 13),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                child: Text(
                  context.tr('action.orRegister'),
                  style: context.font(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
