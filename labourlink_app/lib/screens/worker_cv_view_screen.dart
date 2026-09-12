import 'package:flutter/material.dart';
import '../models/worker.dart';
import '../models/worker_cv.dart';
import '../models/job.dart';
import '../services/api_service.dart';

class WorkerCvViewScreen extends StatefulWidget {
  final Worker worker;
  final Job? forJob;
  final VoidCallback? onHire;

  const WorkerCvViewScreen({
    super.key,
    required this.worker,
    this.forJob,
    this.onHire,
  });

  @override
  State<WorkerCvViewScreen> createState() => _WorkerCvViewScreenState();
}

class _WorkerCvViewScreenState extends State<WorkerCvViewScreen> {
  WorkerCv? _cv;
  List<Map<String, dynamic>> _reviews = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    final cv = await ApiService.getWorkerCv(widget.worker.id);
    final ratingsData = await ApiService.getWorkerRatings(widget.worker.id);

    if (mounted) {
      setState(() {
        _cv = cv;
        if (ratingsData != null && ratingsData['reviews'] is List) {
          _reviews = (ratingsData['reviews'] as List)
              .map((r) => r as Map<String, dynamic>)
              .toList();
        }
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final worker = widget.worker;
    final isBusy = worker.isHiredByOther || worker.status == 'HIRED';

    return Scaffold(
      appBar: AppBar(
        title: Text("${worker.name}'s CV"),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              setState(() => _isLoading = true);
              _loadData();
            },
          ),
        ],
      ),
      bottomNavigationBar: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.06),
              blurRadius: 10,
              offset: const Offset(0, -3),
            ),
          ],
        ),
        child: Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFF0F172A),
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
                icon: const Icon(Icons.call, color: Color(0xFF10B981)),
                label: const Text('Call Worker', style: TextStyle(fontWeight: FontWeight.w700)),
                onPressed: () {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('Dialing ${worker.phoneNumber}...'),
                      backgroundColor: const Color(0xFF10B981),
                    ),
                  );
                },
              ),
            ),
            if (widget.forJob != null && widget.onHire != null) ...[
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: isBusy ? Colors.grey : const Color(0xFF10B981),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  icon: Icon(isBusy ? Icons.lock : Icons.check_circle),
                  label: Text(
                    isBusy ? 'Busy on Job' : 'Hire Worker',
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  onPressed: isBusy
                      ? null
                      : () {
                          Navigator.pop(context);
                          widget.onHire!();
                        },
                ),
              ),
            ],
          ],
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Profile Header Card
                  Card(
                    elevation: 1,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              CircleAvatar(
                                radius: 30,
                                backgroundColor: const Color(0xFF0284C7).withValues(alpha: 0.15),
                                child: Text(
                                  worker.name.isNotEmpty ? worker.name[0].toUpperCase() : 'W',
                                  style: const TextStyle(
                                    fontSize: 26,
                                    fontWeight: FontWeight.w900,
                                    color: Color(0xFF0284C7),
                                  ),
                                ),
                              ),
                              const SizedBox(width: 14),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      _cv?.fullName.isNotEmpty == true ? _cv!.fullName : worker.name,
                                      style: const TextStyle(
                                        fontSize: 18,
                                        fontWeight: FontWeight.w800,
                                        color: Color(0xFF0F172A),
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      '🛠 ${worker.skillType}  •  📍 ${worker.location}',
                                      style: TextStyle(fontSize: 13, color: Colors.grey.shade700),
                                    ),
                                    const SizedBox(height: 6),
                                    // Star Rating Badge
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                      decoration: BoxDecoration(
                                        color: const Color(0xFFFEF3C7),
                                        borderRadius: BorderRadius.circular(6),
                                        border: Border.all(color: const Color(0xFFFCD34D)),
                                      ),
                                      child: Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          const Icon(Icons.star, size: 15, color: Color(0xFFD97706)),
                                          const SizedBox(width: 4),
                                          Text(
                                            worker.avgRating > 0
                                                ? '${worker.avgRating.toStringAsFixed(1)} ⭐ (${worker.ratingCount} ${worker.ratingCount == 1 ? 'review' : 'reviews'})'
                                                : 'New Worker (No reviews yet)',
                                            style: const TextStyle(
                                              fontSize: 12,
                                              fontWeight: FontWeight.w800,
                                              color: Color(0xFF92400E),
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
                          const Divider(height: 24),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceAround,
                            children: [
                              _buildMetric(
                                'Experience',
                                '${_cv?.yearsOfExperience ?? 3}+ Years',
                                Icons.work_history_outlined,
                              ),
                              _buildMetric(
                                'Daily Wage',
                                _cv?.dailyWageExpectation.isNotEmpty == true
                                    ? _cv!.dailyWageExpectation
                                    : '₹800 - ₹950',
                                Icons.currency_rupee,
                              ),
                              _buildMetric(
                                'Availability',
                                _cv?.availabilityType.isNotEmpty == true
                                    ? _cv!.availabilityType
                                    : (isBusy ? 'Busy' : 'Immediate'),
                                Icons.event_available_outlined,
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),

                  const SizedBox(height: 16),

                  // Skills & Trades
                  _buildSectionCard(
                    title: '🛠 Verified Skills & Trade Tags',
                    child: (_cv != null && _cv!.skills.isNotEmpty)
                        ? Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: _cv!.skills
                                .map((s) => Chip(
                                      label: Text(s),
                                      backgroundColor: const Color(0xFFF0FDF4),
                                      side: const BorderSide(color: Color(0xFF86EFAC)),
                                      labelStyle: const TextStyle(
                                        color: Color(0xFF15803D),
                                        fontWeight: FontWeight.w700,
                                        fontSize: 12.5,
                                      ),
                                    ))
                                .toList(),
                          )
                        : Text(
                            worker.skillType,
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                  ),

                  const SizedBox(height: 14),

                  // Previous Work & Employers History
                  _buildSectionCard(
                    title: '🏢 Previous Work & Experience History',
                    child: (_cv != null && _cv!.previousWork.isNotEmpty)
                        ? Column(
                            children: _cv!.previousWork.map((work) {
                              return Container(
                                margin: const EdgeInsets.only(bottom: 10),
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: Colors.grey.shade50,
                                  borderRadius: BorderRadius.circular(10),
                                  border: Border.all(color: Colors.grey.shade200),
                                ),
                                child: Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.all(8),
                                      decoration: BoxDecoration(
                                        color: const Color(0xFF0284C7).withValues(alpha: 0.1),
                                        borderRadius: BorderRadius.circular(8),
                                      ),
                                      child: const Icon(Icons.business, color: Color(0xFF0284C7), size: 20),
                                    ),
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            work.company.isNotEmpty ? work.company : 'Direct Contractor Work',
                                            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14),
                                          ),
                                          const SizedBox(height: 2),
                                          Text(
                                            'Role: ${work.role.isNotEmpty ? work.role : worker.skillType}',
                                            style: TextStyle(fontSize: 12.5, color: Colors.grey.shade700),
                                          ),
                                          if (work.duration.isNotEmpty)
                                            Text(
                                              'Duration: ${work.duration}',
                                              style: TextStyle(fontSize: 11.5, color: Colors.grey.shade500),
                                            ),
                                        ],
                                      ),
                                    ),
                                  ],
                                ),
                              );
                            }).toList(),
                          )
                        : const Text(
                            'No previous company details provided yet.',
                            style: TextStyle(color: Colors.grey, fontSize: 13),
                          ),
                  ),

                  const SizedBox(height: 14),

                  // Languages & About Me
                  _buildSectionCard(
                    title: '🗣 Languages & Bio',
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const Text('Languages: ', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                            Text(
                              _cv?.languages.isNotEmpty == true ? _cv!.languages : 'Hindi, Regional Languages',
                              style: TextStyle(fontSize: 13, color: Colors.grey.shade800),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        const Text('About Me:', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                        const SizedBox(height: 4),
                        Text(
                          _cv?.aboutMe.isNotEmpty == true
                              ? _cv!.aboutMe
                              : 'Reliable worker skilled in ${worker.skillType}. Dedicated to high quality work and prompt site arrival.',
                          style: TextStyle(fontSize: 13, color: Colors.grey.shade800, height: 1.4),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 14),

                  // Employer Reviews Section
                  _buildSectionCard(
                    title: '⭐ Employer Ratings & Reviews (${_reviews.length})',
                    child: _reviews.isEmpty
                        ? const Text(
                            'No employer reviews recorded yet. Hire this worker and be the first to leave feedback!',
                            style: TextStyle(color: Colors.grey, fontSize: 13),
                          )
                        : Column(
                            children: _reviews.map((r) {
                              final ratingVal = r['rating']?.toString() ?? '5.0';
                              final comment = r['comment']?.toString() ?? '';
                              final date = r['created_at']?.toString() ?? '';
                              return Container(
                                margin: const EdgeInsets.only(bottom: 10),
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: Colors.white,
                                  borderRadius: BorderRadius.circular(10),
                                  border: Border.all(color: Colors.grey.shade200),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                      children: [
                                        Row(
                                          children: [
                                            const Icon(Icons.star, color: Color(0xFFF59E0B), size: 16),
                                            const SizedBox(width: 4),
                                            Text(
                                              '$ratingVal / 5.0',
                                              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
                                            ),
                                          ],
                                        ),
                                        Text(
                                          date.isNotEmpty ? date.split(' ')[0] : '',
                                          style: TextStyle(color: Colors.grey.shade500, fontSize: 11),
                                        ),
                                      ],
                                    ),
                                    if (comment.isNotEmpty) ...[
                                      const SizedBox(height: 6),
                                      Text(
                                        '"$comment"',
                                        style: TextStyle(
                                          fontSize: 12.5,
                                          fontStyle: FontStyle.italic,
                                          color: Colors.grey.shade800,
                                        ),
                                      ),
                                    ],
                                  ],
                                ),
                              );
                            }).toList(),
                          ),
                  ),

                  const SizedBox(height: 24),
                ],
              ),
            ),
    );
  }

  Widget _buildMetric(String label, String value, IconData icon) {
    return Column(
      children: [
        Icon(icon, size: 20, color: const Color(0xFF0284C7)),
        const SizedBox(height: 4),
        Text(value, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
        Text(label, style: TextStyle(fontSize: 11, color: Colors.grey.shade600)),
      ],
    );
  }

  Widget _buildSectionCard({required String title, required Widget child}) {
    return Card(
      elevation: 1,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: const TextStyle(
                fontSize: 14.5,
                fontWeight: FontWeight.w800,
                color: Color(0xFF0F172A),
              ),
            ),
            const SizedBox(height: 10),
            child,
          ],
        ),
      ),
    );
  }
}
