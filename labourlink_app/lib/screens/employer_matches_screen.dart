import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../models/job.dart';
import '../models/worker.dart';
import 'employer_dashboard_screen.dart';

class EmployerMatchesScreen extends StatefulWidget {
  final int jobId;
  const EmployerMatchesScreen({super.key, required this.jobId});

  @override
  State<EmployerMatchesScreen> createState() => _EmployerMatchesScreenState();
}

class _EmployerMatchesScreenState extends State<EmployerMatchesScreen> {
  Job? _job;
  List<Worker> _matchedWorkers = [];
  List<Worker> _nearbyWorkers = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadMatches();
  }

  Future<void> _loadMatches() async {
    setState(() => _isLoading = true);
    final data = await ApiService.getJobMatches(widget.jobId);
    if (mounted) {
      if (data != null) {
        setState(() {
          _job = data['job'] as Job;
          _matchedWorkers = (data['matchedWorkers'] as List<Worker>?) ?? [];
          _nearbyWorkers = (data['nearbyWorkers'] as List<Worker>?) ?? [];
          _isLoading = false;
        });
      } else {
        setState(() => _isLoading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Matched Workers'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadMatches,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _job == null
              ? const Center(child: Text('Job not found.'))
              : SingleChildScrollView(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // Job Created Banner
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF0FDF4),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: const Color(0xFF86EFAC)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Row(
                              children: [
                                Icon(
                                  Icons.check_circle,
                                  color: Color(0xFF15803D),
                                  size: 22,
                                ),
                                SizedBox(width: 8),
                                Text(
                                  'Job Successfully Posted!',
                                  style: TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w800,
                                    color: Color(0xFF15803D),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Text(
                              'Requirement: ${_job!.skillNeeded} in ${_job!.location}',
                              style: const TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            Text(
                              'Wage: ${_job!.wageOffered}  •  Date: ${_job!.dateNeeded}',
                              style: TextStyle(
                                fontSize: 13,
                                color: Colors.grey.shade700,
                              ),
                            ),
                            const SizedBox(height: 12),
                            OutlinedButton(
                              style: OutlinedButton.styleFrom(
                                foregroundColor: const Color(0xFF15803D),
                                side: const BorderSide(
                                  color: Color(0xFF15803D),
                                ),
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 12,
                                  vertical: 8,
                                ),
                              ),
                              onPressed: () {
                                Navigator.pushReplacement(
                                  context,
                                  MaterialPageRoute(
                                    builder: (_) =>
                                        EmployerDashboardScreen(
                                      initialPhone: _job!.employerPhone,
                                    ),
                                  ),
                                );
                              },
                              child: const Text('Go to Employer Dashboard →'),
                            ),
                          ],
                        ),
                      ),

                      const SizedBox(height: 20),

                      // Matching Local Workers Header
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Row(
                            children: [
                              const Text(
                                '🎯 Local Workers Available',
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
                                  color: const Color(0xFFDCFCE7),
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: Text(
                                  '${_matchedWorkers.length}',
                                  style: const TextStyle(
                                    color: Color(0xFF15803D),
                                    fontWeight: FontWeight.w800,
                                    fontSize: 12,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),

                      if (_matchedWorkers.isEmpty)
                        Container(
                          padding: const EdgeInsets.all(20),
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: Colors.grey.shade100,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(
                            'No available ${_job!.skillNeeded} workers currently listed in ${_job!.location}.\nCheck back on your Employer Dashboard as workers apply!',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 13,
                              color: Colors.grey.shade700,
                              height: 1.4,
                            ),
                          ),
                        )
                      else
                        ..._matchedWorkers.map((w) => _buildWorkerCard(w)),

                      const SizedBox(height: 20),

                      // Nearby Workers
                      if (_nearbyWorkers.isNotEmpty) ...[
                        Text(
                          '📍 Other ${_job!.skillNeeded} Workers in Nearby Areas',
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 8),
                        ..._nearbyWorkers.map(
                          (w) => _buildWorkerCard(w, isNearby: true),
                        ),
                      ],
                    ],
                  ),
                ),
    );
  }

  Widget _buildWorkerCard(Worker worker, {bool isNearby = false}) {
    final isBusy = worker.isHiredByOther || worker.status == 'HIRED' || !worker.available;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(
                    worker.name,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: isBusy ? const Color(0xFFFEF3C7) : const Color(0xFFDCFCE7),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(
                      color: isBusy ? const Color(0xFFFCD34D) : const Color(0xFF86EFAC),
                    ),
                  ),
                  child: Text(
                    isBusy ? '● Hired by other' : '● Available',
                    style: TextStyle(
                      color: isBusy ? const Color(0xFF92400E) : const Color(0xFF15803D),
                      fontWeight: FontWeight.w800,
                      fontSize: 11,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              '🛠 ${worker.skillType}  •  📍 ${worker.location}',
              style: TextStyle(fontSize: 13, color: Colors.grey.shade700),
            ),
            if (isBusy && worker.currentLocationZone != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  '🏢 Active on job in: ${worker.currentLocationZone}',
                  style: const TextStyle(fontSize: 11, color: Color(0xFFB45309), fontWeight: FontWeight.w600),
                ),
              ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: Colors.grey.shade50,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: Colors.grey.shade300),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    '📞 ${worker.phoneNumber}',
                    style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 14,
                    ),
                  ),
                  if (isBusy)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 5,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.grey.shade200,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.lock_outline, color: Colors.grey, size: 14),
                          SizedBox(width: 4),
                          Text(
                            'Busy on Job',
                            style: TextStyle(
                              color: Colors.black54,
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    )
                  else
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFF10B981),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.call, color: Colors.white, size: 14),
                          SizedBox(width: 4),
                          Text(
                            'Call Worker',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
