import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../models/job.dart';
import 'worker_dashboard_screen.dart';
import 'employer_post_job_screen.dart';

class PublicBoardScreen extends StatefulWidget {
  const PublicBoardScreen({super.key});

  @override
  State<PublicBoardScreen> createState() => _PublicBoardScreenState();
}

class _PublicBoardScreenState extends State<PublicBoardScreen> {
  List<Job> _jobs = [];
  bool _isLoading = true;
  String? _selectedSkill;
  String? _selectedLocation;

  final List<String> _skills = [
    'Construction',
    'Painting',
    'Plumbing',
    'Loading',
    'Domestic Help',
    'Other',
  ];

  final List<String> _locations = [
    'Koramangala',
    'Indiranagar',
    'Whitefield',
    'HSR Layout',
    'Marathahalli',
    'Jayanagar',
  ];

  @override
  void initState() {
    super.initState();
    _loadJobs();
  }

  Future<void> _loadJobs() async {
    setState(() => _isLoading = true);
    final jobs = await ApiService.getJobs(
      skill: _selectedSkill,
      location: _selectedLocation,
    );
    if (mounted) {
      setState(() {
        _jobs = jobs;
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Digital Labor Chowk'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadJobs,
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: const Color(0xFF2563EB),
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add),
        label: const Text('Post a Job'),
        onPressed: () {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => const EmployerPostJobScreen(),
            ),
          ).then((_) => _loadJobs());
        },
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Filter section
          Container(
            color: Colors.white,
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Row(
                    children: [
                      FilterChip(
                        label: const Text('All Skills'),
                        selected: _selectedSkill == null,
                        onSelected: (_) {
                          setState(() => _selectedSkill = null);
                          _loadJobs();
                        },
                      ),
                      const SizedBox(width: 8),
                      ..._skills.map(
                        (s) => Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: FilterChip(
                            label: Text(s),
                            selected: _selectedSkill == s,
                            onSelected: (val) {
                              setState(() => _selectedSkill = val ? s : null);
                              _loadJobs();
                            },
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 6),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Row(
                    children: [
                      FilterChip(
                        label: const Text('All Neighborhoods'),
                        selected: _selectedLocation == null,
                        onSelected: (_) {
                          setState(() => _selectedLocation = null);
                          _loadJobs();
                        },
                      ),
                      const SizedBox(width: 8),
                      ..._locations.map(
                        (l) => Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: FilterChip(
                            label: Text(l),
                            selected: _selectedLocation == l,
                            onSelected: (val) {
                              setState(() => _selectedLocation = val ? l : null);
                              _loadJobs();
                            },
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          const Divider(height: 1),

          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : _jobs.isEmpty
                    ? Center(
                        child: Text(
                          'No open jobs matching filters.',
                          style: TextStyle(color: Colors.grey.shade600),
                        ),
                      )
                    : RefreshIndicator(
                        onRefresh: _loadJobs,
                        child: ListView.builder(
                          padding: const EdgeInsets.all(16),
                          itemCount: _jobs.length,
                          itemBuilder: (ctx, i) {
                            final job = _jobs[i];
                            return Card(
                              margin: const EdgeInsets.only(bottom: 12),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(14),
                              ),
                              child: Padding(
                                padding: const EdgeInsets.all(14),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      mainAxisAlignment:
                                          MainAxisAlignment.spaceBetween,
                                      children: [
                                        Container(
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 8,
                                            vertical: 3,
                                          ),
                                          decoration: BoxDecoration(
                                            color: const Color(0xFFEEF2FF),
                                            borderRadius:
                                                BorderRadius.circular(6),
                                          ),
                                          child: Text(
                                            job.skillNeeded,
                                            style: const TextStyle(
                                              color: Color(0xFF3730A3),
                                              fontWeight: FontWeight.w700,
                                              fontSize: 12,
                                            ),
                                          ),
                                        ),
                                        Container(
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 8,
                                            vertical: 3,
                                          ),
                                          decoration: BoxDecoration(
                                            color: const Color(0xFFFEF3C7),
                                            borderRadius:
                                                BorderRadius.circular(6),
                                          ),
                                          child: Text(
                                            job.wageOffered,
                                            style: const TextStyle(
                                              color: Color(0xFF92400E),
                                              fontWeight: FontWeight.w800,
                                              fontSize: 12,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 8),
                                    Text(
                                      job.employerName,
                                      style: const TextStyle(
                                        fontSize: 16,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      '📍 ${job.location}  •  📅 ${job.dateNeeded}',
                                      style: TextStyle(
                                        fontSize: 13,
                                        color: Colors.grey.shade700,
                                      ),
                                    ),
                                    const SizedBox(height: 12),
                                    ElevatedButton(
                                      style: ElevatedButton.styleFrom(
                                        backgroundColor: const Color(0xFF0284C7),
                                        foregroundColor: Colors.white,
                                        minimumSize:
                                            const Size(double.infinity, 36),
                                        shape: RoundedRectangleBorder(
                                          borderRadius:
                                              BorderRadius.circular(8),
                                        ),
                                      ),
                                      onPressed: () {
                                        Navigator.push(
                                          context,
                                          MaterialPageRoute(
                                            builder: (_) =>
                                                const WorkerDashboardScreen(),
                                          ),
                                        );
                                      },
                                      child: const Text(
                                        'Apply on Worker Portal →',
                                        style: TextStyle(
                                          fontWeight: FontWeight.w700,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
                      ),
          ),
        ],
      ),
    );
  }
}
