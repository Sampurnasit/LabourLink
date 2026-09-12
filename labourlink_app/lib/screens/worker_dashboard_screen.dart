import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/api_service.dart';
import '../models/worker.dart';
import '../models/job.dart';
import 'worker_register_screen.dart';
import 'worker_cv_screen.dart';

class WorkerDashboardScreen extends StatefulWidget {
  final String? initialPhone;
  const WorkerDashboardScreen({super.key, this.initialPhone});

  @override
  State<WorkerDashboardScreen> createState() => _WorkerDashboardScreenState();
}

class _WorkerDashboardScreenState extends State<WorkerDashboardScreen> {
  final _phoneController = TextEditingController();
  Worker? _worker;
  List<Job> _matchedJobs = [];
  List<Job> _otherSkillJobs = [];
  List<Job> _appliedJobs = [];
  bool _isLoading = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _initPhone();
  }

  Future<void> _initPhone() async {
    if (widget.initialPhone != null && widget.initialPhone!.isNotEmpty) {
      _phoneController.text = widget.initialPhone!;
      _loadDashboard();
      return;
    }

    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString('worker_phone');
    if (saved != null && saved.isNotEmpty) {
      _phoneController.text = saved;
      _loadDashboard();
    }
  }

  Future<void> _loadDashboard() async {
    final phone = _phoneController.text.trim();
    if (phone.length != 10) {
      setState(() => _errorMessage = 'Please enter a valid 10-digit phone');
      return;
    }

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    final data = await ApiService.getWorkerProfile(phone);

    if (mounted) {
      if (data != null && data['worker'] != null) {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('worker_phone', phone);

        setState(() {
          _worker = data['worker'] as Worker;
          _matchedJobs = (data['matchedJobs'] as List<Job>?) ?? [];
          _otherSkillJobs = (data['otherSkillJobs'] as List<Job>?) ?? [];
          _appliedJobs = (data['appliedJobs'] as List<Job>?) ?? [];
          _isLoading = false;
        });
      } else {
        setState(() {
          _worker = null;
          _isLoading = false;
          _errorMessage =
              'No worker profile found for $phone. Please register first.';
        });
      }
    }
  }

  Future<void> _toggleAvailability(bool val) async {
    if (_worker == null) return;
    final updated =
        await ApiService.toggleAvailability(_worker!.phoneNumber, val);
    if (updated != null && mounted) {
      setState(() => _worker = updated);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            val
                ? '✓ Marked available today for job matches!'
                : 'Marked unavailable for today',
          ),
          backgroundColor:
              val ? const Color(0xFF10B981) : Colors.grey.shade800,
        ),
      );
    }
  }

  Future<void> _expressInterest(Job job) async {
    if (_worker == null) return;
    final success = await ApiService.expressInterest(_worker!.id, job.id);
    if (success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('✓ Interested! The employer has been notified.'),
          backgroundColor: Color(0xFF10B981),
        ),
      );
      _loadDashboard();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Worker Portal'),
        actions: [
          if (_worker != null)
            IconButton(
              icon: const Icon(Icons.refresh),
              onPressed: _loadDashboard,
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadDashboard,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Phone input search bar
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.04),
                      blurRadius: 8,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _phoneController,
                        keyboardType: TextInputType.phone,
                        maxLength: 10,
                        decoration: const InputDecoration(
                          hintText: 'Enter worker 10-digit phone',
                          prefixIcon: Icon(Icons.phone),
                          border: InputBorder.none,
                          counterText: '',
                        ),
                        onSubmitted: (_) => _loadDashboard(),
                      ),
                    ),
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF0284C7),
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                      ),
                      onPressed: _loadDashboard,
                      child: const Text('Search'),
                    ),
                  ],
                ),
              ),

              if (_isLoading)
                const Padding(
                  padding: EdgeInsets.all(40.0),
                  child: Center(child: CircularProgressIndicator()),
                )
              else if (_worker == null) ...[
                const SizedBox(height: 24),
                Card(
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(24.0),
                    child: Column(
                      children: [
                        const Icon(
                          Icons.engineering,
                          size: 54,
                          color: Color(0xFF0284C7),
                        ),
                        const SizedBox(height: 12),
                        Text(
                          _errorMessage ?? 'Welcome to Worker Portal',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: _errorMessage != null
                                ? Colors.red
                                : Colors.black87,
                          ),
                        ),
                        const SizedBox(height: 14),
                        ElevatedButton(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFF0284C7),
                            foregroundColor: Colors.white,
                          ),
                          onPressed: () {
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (_) => const WorkerRegisterScreen(),
                              ),
                            );
                          },
                          child: const Text('Register as New Worker'),
                        ),
                        const SizedBox(height: 10),
                        TextButton(
                          onPressed: () {
                            _phoneController.text = '9876500001';
                            _loadDashboard();
                          },
                          child: const Text(
                            'Demo Worker: Ramesh Kumar (9876500001)',
                            style: TextStyle(fontSize: 12),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ] else ...[
                const SizedBox(height: 16),

                // Worker Profile Card
                Card(
                  elevation: 2,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              _worker!.name,
                              style: const TextStyle(
                                fontSize: 19,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 4,
                              ),
                              decoration: BoxDecoration(
                                color: _worker!.available
                                    ? const Color(0xFFDCFCE7)
                                    : const Color(0xFFFEE2E2),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Text(
                                _worker!.available
                                    ? '● Available Today'
                                    : '○ Unavailable Today',
                                style: TextStyle(
                                  color: _worker!.available
                                      ? const Color(0xFF15803D)
                                      : const Color(0xFFB91C1C),
                                  fontWeight: FontWeight.w700,
                                  fontSize: 11,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 8,
                          runSpacing: 6,
                          children: [
                            _buildBadge(
                              '🛠 ${_worker!.skillType}',
                              const Color(0xFFEEF2FF),
                              const Color(0xFF3730A3),
                            ),
                            _buildBadge(
                              '📍 ${_worker!.location}',
                              const Color(0xFFF1F5F9),
                              const Color(0xFF334155),
                            ),
                            _buildBadge(
                              '📞 ${_worker!.phoneNumber}',
                              const Color(0xFFFEF3C7),
                              const Color(0xFF92400E),
                            ),
                            _buildBadge(
                              _worker!.avgRating > 0
                                  ? '⭐ ${_worker!.avgRating.toStringAsFixed(1)} (${_worker!.ratingCount} ${_worker!.ratingCount == 1 ? 'review' : 'reviews'})'
                                  : '⭐ New (No reviews)',
                              const Color(0xFFFEF3C7),
                              const Color(0xFFB45309),
                            ),
                          ],
                        ),
                        const Divider(height: 24),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text(
                              'Available for Work Today?',
                              style: TextStyle(fontWeight: FontWeight.w600),
                            ),
                            Switch(
                              value: _worker!.available,
                              activeThumbColor: const Color(0xFF10B981),
                              onChanged: _toggleAvailability,
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),

                const SizedBox(height: 12),

                // My CV / Resume Card
                Card(
                  elevation: 1,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  color: _worker!.hasCv ? const Color(0xFFF0FDF4) : const Color(0xFFFFFBEB),
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Row(
                      children: [
                        Icon(
                          _worker!.hasCv ? Icons.verified_user_outlined : Icons.assignment_late_outlined,
                          color: _worker!.hasCv ? const Color(0xFF15803D) : const Color(0xFFD97706),
                          size: 30,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                _worker!.hasCv ? 'Worker CV: Completed' : 'Profile / CV Incomplete',
                                style: TextStyle(
                                  fontWeight: FontWeight.w800,
                                  fontSize: 13.5,
                                  color: _worker!.hasCv ? const Color(0xFF15803D) : const Color(0xFFB45309),
                                ),
                              ),
                              Text(
                                _worker!.hasCv
                                    ? 'Employers can view your verified work history & trades'
                                    : 'Add past employers & skills to get hired faster',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: Colors.grey.shade700,
                                ),
                              ),
                            ],
                          ),
                        ),
                        ElevatedButton(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: _worker!.hasCv ? const Color(0xFF0284C7) : const Color(0xFFD97706),
                            foregroundColor: Colors.white,
                            visualDensity: VisualDensity.compact,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                          ),
                          onPressed: () {
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (_) => WorkerCvScreen(worker: _worker!),
                              ),
                            ).then((_) => _loadDashboard());
                          },
                          child: Text(_worker!.hasCv ? 'Edit CV' : 'Complete CV'),
                        ),
                      ],
                    ),
                  ),
                ),

                const SizedBox(height: 16),

                // Confirmed Jobs Celebration
                ..._appliedJobs
                    .where((j) => j.interestStatus == 'confirmed')
                    .map(
                      (job) => Container(
                        margin: const EdgeInsets.only(bottom: 12),
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF0FDF4),
                          border: Border.all(color: const Color(0xFF86EFAC)),
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Row(
                              children: [
                                Text(
                                  '🎉 YOU ARE CONFIRMED FOR THIS JOB!',
                                  style: TextStyle(
                                    color: Color(0xFF065F46),
                                    fontWeight: FontWeight.w800,
                                    fontSize: 13,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Text(
                              '${job.employerName}  •  ${job.wageOffered}',
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 15,
                              ),
                            ),
                            Text('📍 ${job.location} • 📅 ${job.dateNeeded}'),
                            const SizedBox(height: 8),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 12,
                                vertical: 6,
                              ),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(8),
                                border: Border.all(
                                  color: const Color(0xFF10B981),
                                ),
                              ),
                              child: Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    'Employer: ${job.employerPhone}',
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                  const Icon(
                                    Icons.phone,
                                    color: Color(0xFF059669),
                                    size: 18,
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),

                // Matched Jobs
                Row(
                  children: [
                    const Text(
                      '🎯 Matched Jobs in Area',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFFEEF2FF),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text(
                        '${_matchedJobs.length}',
                        style: const TextStyle(
                          color: Color(0xFF3730A3),
                          fontWeight: FontWeight.w800,
                          fontSize: 12,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),

                if (_matchedJobs.isEmpty)
                  Container(
                    padding: const EdgeInsets.all(18),
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: Colors.grey.shade100,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      'No open ${_worker!.skillType} jobs in ${_worker!.location} right now.',
                      style: const TextStyle(fontSize: 13, color: Colors.grey),
                    ),
                  )
                else
                  ..._matchedJobs.map((job) {
                    final isApplied =
                        _appliedJobs.any((app) => app.id == job.id);
                    return _buildJobCard(job, isApplied: isApplied);
                  }),

                const SizedBox(height: 16),

                // Citywide jobs in skill
                if (_otherSkillJobs.isNotEmpty) ...[
                  Text(
                    '🌐 Other Open ${_worker!.skillType} Jobs Citywide',
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 8),
                  ..._otherSkillJobs.map((job) {
                    final isApplied =
                        _appliedJobs.any((app) => app.id == job.id);
                    return _buildJobCard(job, isApplied: isApplied);
                  }),
                ],
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBadge(String text, Color bg, Color textCol) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: textCol,
          fontWeight: FontWeight.w700,
          fontSize: 11.5,
        ),
      ),
    );
  }

  Widget _buildJobCard(Job job, {required bool isApplied}) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _buildBadge(
                  job.skillNeeded,
                  const Color(0xFFEEF2FF),
                  const Color(0xFF3730A3),
                ),
                _buildBadge(
                  job.wageOffered,
                  const Color(0xFFFEF3C7),
                  const Color(0xFF92400E),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              job.employerName,
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 2),
            Text(
              '📍 ${job.location}  •  📅 ${job.dateNeeded}',
              style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
            ),
            const SizedBox(height: 12),
            if (isApplied)
              OutlinedButton(
                onPressed: null,
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(double.infinity, 38),
                ),
                child: const Text('✓ Interested (Waiting for Employer)'),
              )
            else
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF0284C7),
                  foregroundColor: Colors.white,
                  minimumSize: const Size(double.infinity, 38),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
                icon: const Icon(Icons.touch_app, size: 18),
                label: const Text(
                  "✋ I'm Interested",
                  style: TextStyle(fontWeight: FontWeight.w700),
                ),
                onPressed: () => _expressInterest(job),
              ),
          ],
        ),
      ),
    );
  }
}
