import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/api_service.dart';
import '../models/job.dart';
import 'employer_post_job_screen.dart';

class EmployerDashboardScreen extends StatefulWidget {
  final String? initialPhone;
  const EmployerDashboardScreen({super.key, this.initialPhone});

  @override
  State<EmployerDashboardScreen> createState() =>
      _EmployerDashboardScreenState();
}

class _EmployerDashboardScreenState extends State<EmployerDashboardScreen> {
  final _phoneController = TextEditingController();
  List<Job> _jobs = [];
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
      _loadJobs();
      return;
    }

    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString('employer_phone');
    if (saved != null && saved.isNotEmpty) {
      _phoneController.text = saved;
      _loadJobs();
    }
  }

  Future<void> _loadJobs() async {
    final phone = _phoneController.text.trim();
    if (phone.length != 10) {
      setState(() => _errorMessage = 'Please enter a valid 10-digit phone');
      return;
    }

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    final jobs = await ApiService.getEmployerJobs(phone);

    if (mounted) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('employer_phone', phone);

      setState(() {
        _jobs = jobs;
        _isLoading = false;
        if (jobs.isEmpty) {
          _errorMessage = 'No jobs found for $phone. Post your first job!';
        }
      });
    }
  }

  Future<void> _confirmWorker(Job job, InterestedWorker worker) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Confirm Worker'),
        content: Text(
          'Confirm ${worker.name} (${worker.phoneNumber}) for ${job.skillNeeded} job at ${job.wageOffered}?\n\nThis will mark the job as FILLED.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFF10B981),
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Confirm Hire'),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      final success =
          await ApiService.confirmWorker(job.id, worker.workerId);
      if (success && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              '✓ ${worker.name} confirmed! Job is now marked filled.',
            ),
            backgroundColor: const Color(0xFF10B981),
          ),
        );
        _loadJobs();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Employer Portal'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadJobs,
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: const Color(0xFFD97706),
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add),
        label: const Text('Post New Job'),
        onPressed: () {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => const EmployerPostJobScreen(),
            ),
          ).then((_) => _loadJobs());
        },
      ),
      body: RefreshIndicator(
        onRefresh: _loadJobs,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Phone lookup bar
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
                          hintText: 'Enter employer 10-digit phone',
                          prefixIcon: Icon(Icons.phone),
                          border: InputBorder.none,
                          counterText: '',
                        ),
                        onSubmitted: (_) => _loadJobs(),
                      ),
                    ),
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFFD97706),
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                      ),
                      onPressed: _loadJobs,
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
              else if (_jobs.isEmpty) ...[
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
                          Icons.business_center,
                          size: 54,
                          color: Color(0xFFD97706),
                        ),
                        const SizedBox(height: 12),
                        Text(
                          _errorMessage ?? 'Welcome to Employer Portal',
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
                            backgroundColor: const Color(0xFFD97706),
                            foregroundColor: Colors.white,
                          ),
                          onPressed: () {
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (_) => const EmployerPostJobScreen(),
                              ),
                            );
                          },
                          child: const Text('+ Post a 1-Day Job'),
                        ),
                        const SizedBox(height: 10),
                        TextButton(
                          onPressed: () {
                            _phoneController.text = '9900112233';
                            _loadJobs();
                          },
                          child: const Text(
                            'Demo Employer: Anand Buildcon (9900112233)',
                            style: TextStyle(fontSize: 12),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ] else ...[
                const SizedBox(height: 16),
                Text(
                  'Your Posted Jobs (${_jobs.length})',
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 10),

                ..._jobs.map((job) => _buildJobSection(job)),
                const SizedBox(height: 60), // Room for FAB
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildJobSection(Job job) {
    final isOpen = job.status == 'open';
    final applicants = job.interestedWorkers ?? [];

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      elevation: 2,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  '${job.skillNeeded} Worker',
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: isOpen
                        ? const Color(0xFFDCFCE7)
                        : const Color(0xFFE2E8F0),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    isOpen ? '● OPEN' : '✓ FILLED',
                    style: TextStyle(
                      color: isOpen
                          ? const Color(0xFF15803D)
                          : const Color(0xFF475569),
                      fontWeight: FontWeight.w800,
                      fontSize: 11,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              '📍 ${job.location}  •  💰 ${job.wageOffered}  •  📅 ${job.dateNeeded}',
              style: TextStyle(fontSize: 13, color: Colors.grey.shade700),
            ),
            const Divider(height: 20),

            // Interested Workers
            Row(
              children: [
                const Text(
                  '👷‍♂️ Interested Workers',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5),
                ),
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 1,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFEF3C7),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    '${applicants.length}',
                    style: const TextStyle(
                      color: Color(0xFF92400E),
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),

            if (applicants.isEmpty)
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.grey.shade50,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Text(
                  'No worker has marked interest yet.',
                  style: TextStyle(fontSize: 12, color: Colors.grey),
                ),
              )
            else
              ...applicants.map((worker) {
                final isConfirmed = worker.status == 'confirmed';
                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: isConfirmed
                        ? const Color(0xFFF0FDF4)
                        : Colors.grey.shade50,
                    border: Border.all(
                      color: isConfirmed
                          ? const Color(0xFF86EFAC)
                          : Colors.grey.shade300,
                    ),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            worker.name,
                            style: const TextStyle(
                              fontWeight: FontWeight.w700,
                              fontSize: 14,
                            ),
                          ),
                          Text(
                            isConfirmed ? '🎉 CONFIRMED' : 'Applied',
                            style: TextStyle(
                              color: isConfirmed
                                  ? const Color(0xFF15803D)
                                  : const Color(0xFFD97706),
                              fontWeight: FontWeight.w800,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '📞 ${worker.phoneNumber}  •  📍 ${worker.location}',
                        style: TextStyle(
                          fontSize: 12,
                          color: Colors.grey.shade700,
                        ),
                      ),
                      if (isOpen && !isConfirmed) ...[
                        const SizedBox(height: 8),
                        ElevatedButton.icon(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFF10B981),
                            foregroundColor: Colors.white,
                            minimumSize: const Size(double.infinity, 34),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(8),
                            ),
                          ),
                          icon: const Icon(Icons.check_circle, size: 16),
                          label: const Text(
                            '✓ Confirm This Worker',
                            style: TextStyle(fontWeight: FontWeight.w700),
                          ),
                          onPressed: () => _confirmWorker(job, worker),
                        ),
                      ],
                    ],
                  ),
                );
              }),
          ],
        ),
      ),
    );
  }
}
