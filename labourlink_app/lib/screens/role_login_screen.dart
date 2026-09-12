import 'package:flutter/material.dart';
import '../i18n/i18n.dart';
import '../widgets/language_selector.dart';
import 'worker_dashboard_screen.dart';
import 'employer_dashboard_screen.dart';

/// Login screen that accepts a [role] of either 'worker' or 'hirer'.
/// Supports multi-language internationalization (English, Hindi, Bengali).
/// Navigates to the appropriate dashboard on successful login.
class RoleLoginScreen extends StatefulWidget {
  final String role; // 'worker' | 'hirer'
  const RoleLoginScreen({super.key, required this.role});

  @override
  State<RoleLoginScreen> createState() => _RoleLoginScreenState();
}

class _RoleLoginScreenState extends State<RoleLoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _phoneCtrl = TextEditingController();
  bool _isLoading = false;

  bool get _isWorker => widget.role == 'worker';

  Color get _accentColor =>
      _isWorker ? const Color(0xFFF97316) : const Color(0xFF06B6D4);

  Color get _darkAccent =>
      _isWorker ? const Color(0xFFEA580C) : const Color(0xFF0891B2);

  IconData get _roleIcon =>
      _isWorker ? Icons.engineering_rounded : Icons.business_center_rounded;

  @override
  void dispose() {
    _phoneCtrl.dispose();
    super.dispose();
  }

  Future<void> _handleLogin() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _isLoading = true);

    // Small UX delay to show loading state
    await Future.delayed(const Duration(milliseconds: 600));

    if (!mounted) return;
    setState(() => _isLoading = false);

    // Navigate to the correct dashboard based on role
    if (_isWorker) {
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(builder: (_) => const WorkerDashboardScreen()),
      );
    } else {
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(builder: (_) => const EmployerDashboardScreen()),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        width: double.infinity,
        height: double.infinity,
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            colors: [Color(0xFF0F172A), Color(0xFF1E293B)],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              // ── Header Row: Back Button & Language Selector ───────────
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    IconButton(
                      icon: const Icon(Icons.arrow_back_ios_new_rounded,
                          color: Colors.white70, size: 20),
                      onPressed: () => Navigator.pop(context),
                      tooltip: context.tr('action.back'),
                    ),
                    const LanguageSelector(compact: true),
                  ],
                ),
              ),

              Expanded(
                child: Center(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 28, vertical: 16),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        // ── Role icon ─────────────────────────────────────
                        Container(
                          width: 80,
                          height: 80,
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              colors: [_accentColor, _darkAccent],
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                            ),
                            shape: BoxShape.circle,
                            boxShadow: [
                              BoxShadow(
                                color: _accentColor.withValues(alpha: 0.4),
                                blurRadius: 24,
                                offset: const Offset(0, 8),
                              ),
                            ],
                          ),
                          child: Icon(_roleIcon,
                              color: Colors.white, size: 40),
                        ),
                        const SizedBox(height: 20),

                        // ── Title ─────────────────────────────────────────
                        Text(
                          _isWorker
                              ? context.tr('login.workerTitle')
                              : context.tr('login.hirerTitle'),
                          textAlign: TextAlign.center,
                          style: context.font(
                            color: Colors.white,
                            fontSize: 26,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          _isWorker
                              ? context.tr('login.workerSubtitle')
                              : context.tr('login.hirerSubtitle'),
                          textAlign: TextAlign.center,
                          style: context.font(
                            color: const Color(0xFF94A3B8),
                            fontSize: 14,
                            height: 1.5,
                          ),
                        ),

                        const SizedBox(height: 32),

                        // ── Login Form ────────────────────────────────────
                        Container(
                          padding: const EdgeInsets.all(24),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.05),
                            borderRadius: BorderRadius.circular(24),
                            border: Border.all(
                              color: Colors.white.withValues(alpha: 0.1),
                            ),
                          ),
                          child: Form(
                            key: _formKey,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                // Phone field
                                TextFormField(
                                  controller: _phoneCtrl,
                                  keyboardType: TextInputType.phone,
                                  style: context.font(
                                    color: Colors.white,
                                    fontSize: 15,
                                  ),
                                  decoration: InputDecoration(
                                    labelText: context.tr('login.phoneLabel'),
                                    hintText: context.tr('login.phonePlaceholder'),
                                    labelStyle: context.font(
                                      color: const Color(0xFF94A3B8),
                                    ),
                                    hintStyle: context.font(
                                      color: const Color(0xFF64748B),
                                      fontSize: 13,
                                    ),
                                    prefixIcon: Icon(
                                      Icons.phone_rounded,
                                      color: _accentColor,
                                      size: 20,
                                    ),
                                    enabledBorder: OutlineInputBorder(
                                      borderRadius: BorderRadius.circular(14),
                                      borderSide: BorderSide(
                                        color: Colors.white.withValues(alpha: 0.15),
                                      ),
                                    ),
                                    focusedBorder: OutlineInputBorder(
                                      borderRadius: BorderRadius.circular(14),
                                      borderSide: BorderSide(
                                          color: _accentColor, width: 2),
                                    ),
                                    errorBorder: OutlineInputBorder(
                                      borderRadius: BorderRadius.circular(14),
                                      borderSide: const BorderSide(
                                          color: Colors.redAccent),
                                    ),
                                    focusedErrorBorder: OutlineInputBorder(
                                      borderRadius: BorderRadius.circular(14),
                                      borderSide: const BorderSide(
                                          color: Colors.redAccent, width: 2),
                                    ),
                                    errorStyle: context.font(
                                      color: Colors.redAccent,
                                      fontSize: 12,
                                    ),
                                    filled: true,
                                    fillColor:
                                        Colors.white.withValues(alpha: 0.06),
                                  ),
                                  validator: (v) {
                                    if (v == null || v.trim().isEmpty) {
                                      return context.tr('validation.phoneRequired');
                                    }
                                    if (v.trim().length < 10) {
                                      return context.tr('validation.phoneInvalid');
                                    }
                                    return null;
                                  },
                                ),

                                const SizedBox(height: 20),

                                // Login button
                                SizedBox(
                                  height: 52,
                                  child: ElevatedButton(
                                    onPressed:
                                        _isLoading ? null : _handleLogin,
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: _accentColor,
                                      foregroundColor: Colors.white,
                                      disabledBackgroundColor:
                                          _accentColor.withValues(alpha: 0.5),
                                      elevation: 0,
                                      shape: RoundedRectangleBorder(
                                        borderRadius:
                                            BorderRadius.circular(14),
                                      ),
                                    ),
                                    child: _isLoading
                                        ? const SizedBox(
                                            width: 22,
                                            height: 22,
                                            child: CircularProgressIndicator(
                                              color: Colors.white,
                                              strokeWidth: 2.5,
                                            ),
                                          )
                                        : Text(
                                            _isWorker
                                                ? context.tr('login.submitWorker')
                                                : context.tr('login.submitHirer'),
                                            textAlign: TextAlign.center,
                                            style: context.font(
                                              fontWeight: FontWeight.w700,
                                              fontSize: 15,
                                            ),
                                          ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),

                        const SizedBox(height: 20),

                        // ── Divider ───────────────────────────────────────
                        Row(
                          children: [
                            Expanded(
                              child: Divider(
                                color: Colors.white.withValues(alpha: 0.12),
                              ),
                            ),
                            Padding(
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 12),
                              child: Text(
                                context.tr('login.noAccount'),
                                style: context.font(
                                  color: const Color(0xFF64748B),
                                  fontSize: 12,
                                ),
                              ),
                            ),
                            Expanded(
                              child: Divider(
                                color: Colors.white.withValues(alpha: 0.12),
                              ),
                            ),
                          ],
                        ),

                        const SizedBox(height: 16),

                        // ── Register link ─────────────────────────────────
                        GestureDetector(
                          onTap: () => Navigator.pop(context),
                          child: Text(
                            context.tr('login.goBackRegister'),
                            textAlign: TextAlign.center,
                            style: context.font(
                              color: _accentColor,
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ),
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
