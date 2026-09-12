import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../services/api_service.dart';
import '../models/job.dart';
import 'worker_register_screen.dart';
import 'employer_post_job_screen.dart';
import 'role_login_screen.dart';

// ─────────────────────────────────────────────────────────────────────────────
// Public Board Screen — Digital Labor Chowk
// Accessible without login. Auth prompt triggered only on action.
// ─────────────────────────────────────────────────────────────────────────────
class PublicBoardScreen extends StatefulWidget {
  const PublicBoardScreen({super.key});

  @override
  State<PublicBoardScreen> createState() => _PublicBoardScreenState();
}

class _PublicBoardScreenState extends State<PublicBoardScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabCtrl;

  // ── Filter state ─────────────────────────────────────────────────────────
  String? _selectedSkill;
  String? _selectedLocation;
  bool _availableOnly = true;
  RangeValues _wageRange = const RangeValues(0, 2000);

  // ── Data ─────────────────────────────────────────────────────────────────
  List<Job> _jobs = [];
  List<Map<String, dynamic>> _workers = [];
  bool _loadingJobs = true;
  bool _loadingWorkers = true;

  static const List<String> _skills = [
    'Construction', 'Painting', 'Plumbing', 'Loading',
    'Domestic Help', 'Electrical', 'Masonry', 'Other',
  ];

  static const List<String> _locations = [
    'Koramangala', 'Indiranagar', 'Whitefield',
    'HSR Layout', 'Marathahalli', 'Jayanagar', 'BTM Layout',
  ];

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: 2, vsync: this);
    _tabCtrl.addListener(() => setState(() {}));
    _loadAll();
  }

  @override
  void dispose() {
    _tabCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadAll() async {
    _loadJobs();
    _loadWorkers();
  }

  Future<void> _loadJobs() async {
    setState(() => _loadingJobs = true);
    final jobs = await ApiService.getPublicJobs(
      skill: _selectedSkill,
      location: _selectedLocation,
      minWage: _wageRange.start > 0 ? _wageRange.start.toInt() : null,
      maxWage: _wageRange.end < 2000 ? _wageRange.end.toInt() : null,
    );
    if (mounted) setState(() { _jobs = jobs; _loadingJobs = false; });
  }

  Future<void> _loadWorkers() async {
    setState(() => _loadingWorkers = true);
    final workers = await ApiService.getPublicWorkers(
      skill: _selectedSkill,
      location: _selectedLocation,
      availableOnly: _availableOnly,
    );
    if (mounted) setState(() { _workers = workers; _loadingWorkers = false; });
  }

  void _applyFilters() {
    _loadJobs();
    _loadWorkers();
  }

  // ── Auth gate modal ───────────────────────────────────────────────────────
  void _showAuthModal(String action) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _AuthGateModal(action: action),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      body: NestedScrollView(
        headerSliverBuilder: (ctx, _) => [
          _buildSliverHeader(),
          _buildSliverFilters(),
          _buildSliverTabBar(),
        ],
        body: TabBarView(
          controller: _tabCtrl,
          children: [
            _JobsTab(
              jobs: _jobs,
              isLoading: _loadingJobs,
              onRefresh: _loadJobs,
              onAction: _showAuthModal,
            ),
            _WorkersTab(
              workers: _workers,
              isLoading: _loadingWorkers,
              onRefresh: _loadWorkers,
              onAction: _showAuthModal,
            ),
          ],
        ),
      ),
      floatingActionButton: _buildFAB(),
    );
  }

  // ── Sliver header banner ──────────────────────────────────────────────────
  SliverAppBar _buildSliverHeader() {
    return SliverAppBar(
      expandedHeight: 140,
      pinned: true,
      backgroundColor: const Color(0xFF0F172A),
      foregroundColor: Colors.white,
      actions: [
        IconButton(
          icon: const Icon(Icons.refresh_rounded),
          tooltip: 'Refresh',
          onPressed: _loadAll,
        ),
      ],
      flexibleSpace: FlexibleSpaceBar(
        collapseMode: CollapseMode.pin,
        background: Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              colors: [Color(0xFF0F172A), Color(0xFF1E3A8A)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
          ),
          padding: const EdgeInsets.fromLTRB(16, 52, 16, 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Icon(Icons.store_rounded,
                        color: Colors.white, size: 16),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'Digital Labor Chowk',
                    style: GoogleFonts.plusJakartaSans(
                      color: Colors.white,
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                'Live Labor Market – Browse Available Work & Workers Near You',
                style: GoogleFonts.plusJakartaSans(
                  color: const Color(0xFF93C5FD),
                  fontSize: 12,
                  height: 1.3,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ── Sliver filter chips ───────────────────────────────────────────────────
  SliverToBoxAdapter _buildSliverFilters() {
    return SliverToBoxAdapter(
      child: Container(
        color: Colors.white,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Skill chips
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
              child: Row(
                children: [
                  _FilterChip(
                    label: 'All Skills',
                    selected: _selectedSkill == null,
                    icon: Icons.category_outlined,
                    onTap: () {
                      setState(() => _selectedSkill = null);
                      _applyFilters();
                    },
                  ),
                  const SizedBox(width: 6),
                  ..._skills.map((s) => Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: _FilterChip(
                      label: s,
                      selected: _selectedSkill == s,
                      onTap: () {
                        setState(() =>
                            _selectedSkill = _selectedSkill == s ? null : s);
                        _applyFilters();
                      },
                    ),
                  )),
                ],
              ),
            ),
            // Location chips
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
              child: Row(
                children: [
                  _FilterChip(
                    label: 'All Areas',
                    selected: _selectedLocation == null,
                    icon: Icons.location_on_outlined,
                    onTap: () {
                      setState(() => _selectedLocation = null);
                      _applyFilters();
                    },
                  ),
                  const SizedBox(width: 6),
                  ..._locations.map((l) => Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: _FilterChip(
                      label: l,
                      selected: _selectedLocation == l,
                      onTap: () {
                        setState(() => _selectedLocation =
                            _selectedLocation == l ? null : l);
                        _applyFilters();
                      },
                    ),
                  )),
                ],
              ),
            ),
            // Wage range slider (Jobs tab) or Availability toggle (Workers tab)
            if (_tabCtrl.index == 0)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                child: Row(
                  children: [
                    Text(
                      '₹${_wageRange.start.toInt()} – '
                      '${_wageRange.end.toInt() >= 2000 ? "₹2000+" : "₹${_wageRange.end.toInt()}"}  /day',
                      style: GoogleFonts.plusJakartaSans(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: const Color(0xFF1E3A8A),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: SliderTheme(
                        data: SliderTheme.of(context).copyWith(
                          trackHeight: 3,
                          thumbShape: const RoundSliderThumbShape(
                              enabledThumbRadius: 7),
                          overlayShape: const RoundSliderOverlayShape(
                              overlayRadius: 14),
                          activeTrackColor: const Color(0xFF1E3A8A),
                          thumbColor: const Color(0xFF1E3A8A),
                          inactiveTrackColor: Colors.grey.shade200,
                          rangeThumbShape: const RoundRangeSliderThumbShape(
                              enabledThumbRadius: 7),
                        ),
                        child: RangeSlider(
                          values: _wageRange,
                          min: 0,
                          max: 2000,
                          divisions: 20,
                          onChanged: (v) => setState(() => _wageRange = v),
                          onChangeEnd: (_) => _loadJobs(),
                        ),
                      ),
                    ),
                  ],
                ),
              )
            else
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 6, 16, 10),
                child: Row(
                  children: [
                    GestureDetector(
                      onTap: () {
                        setState(() => _availableOnly = !_availableOnly);
                        _loadWorkers();
                      },
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 10, vertical: 5),
                        decoration: BoxDecoration(
                          color: _availableOnly
                              ? const Color(0xFF10B981).withValues(alpha: 0.15)
                              : Colors.grey.shade100,
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(
                            color: _availableOnly
                                ? const Color(0xFF10B981)
                                : Colors.grey.shade300,
                          ),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              _availableOnly
                                  ? Icons.check_circle_rounded
                                  : Icons.circle_outlined,
                              size: 14,
                              color: _availableOnly
                                  ? const Color(0xFF059669)
                                  : Colors.grey.shade600,
                            ),
                            const SizedBox(width: 5),
                            Text(
                              _availableOnly
                                  ? 'Showing Available Only'
                                  : 'Showing All Workers',
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                                color: _availableOnly
                                    ? const Color(0xFF059669)
                                    : Colors.grey.shade700,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            const Divider(height: 1),
          ],
        ),
      ),
    );
  }

  // ── Tab bar ───────────────────────────────────────────────────────────────
  SliverPersistentHeader _buildSliverTabBar() {
    return SliverPersistentHeader(
      pinned: true,
      delegate: _TabBarDelegate(
        TabBar(
          controller: _tabCtrl,
          labelStyle: GoogleFonts.plusJakartaSans(
              fontWeight: FontWeight.w700, fontSize: 13),
          unselectedLabelStyle: GoogleFonts.plusJakartaSans(fontSize: 13),
          labelColor: const Color(0xFF1E3A8A),
          unselectedLabelColor: Colors.grey.shade500,
          indicatorColor: const Color(0xFF1E3A8A),
          indicatorWeight: 3,
          tabs: [
            Tab(
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                const Icon(Icons.work_outline_rounded, size: 16),
                const SizedBox(width: 6),
                Text('Jobs (${_loadingJobs ? "…" : _jobs.length})'),
              ]),
            ),
            Tab(
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                const Icon(Icons.engineering_outlined, size: 16),
                const SizedBox(width: 6),
                Text(
                    'Workers (${_loadingWorkers ? "…" : _workers.length})'),
              ]),
            ),
          ],
        ),
      ),
    );
  }

  // ── Floating Action Button ────────────────────────────────────────────────
  Widget _buildFAB() {
    return FloatingActionButton.extended(
      backgroundColor: const Color(0xFF1E3A8A),
      foregroundColor: Colors.white,
      elevation: 4,
      icon: const Icon(Icons.add_rounded),
      label: Text(
        _tabCtrl.index == 0 ? 'Post a Job' : 'List My Skills',
        style: GoogleFonts.plusJakartaSans(fontWeight: FontWeight.w700),
      ),
      onPressed: () => _showAuthModal(
          _tabCtrl.index == 0 ? 'post_job' : 'register_worker'),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Jobs Tab
// ─────────────────────────────────────────────────────────────────────────────
class _JobsTab extends StatelessWidget {
  final List<Job> jobs;
  final bool isLoading;
  final Future<void> Function() onRefresh;
  final void Function(String) onAction;

  const _JobsTab({
    required this.jobs,
    required this.isLoading,
    required this.onRefresh,
    required this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    if (isLoading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (jobs.isEmpty) {
      return _EmptyState(
        icon: Icons.work_off_outlined,
        title: 'No open jobs found',
        subtitle: 'Try clearing filters or check back soon.',
        onRefresh: onRefresh,
      );
    }
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 100),
        itemCount: jobs.length,
        itemBuilder: (ctx, i) => _JobCard(job: jobs[i], onAction: onAction),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Workers Tab
// ─────────────────────────────────────────────────────────────────────────────
class _WorkersTab extends StatelessWidget {
  final List<Map<String, dynamic>> workers;
  final bool isLoading;
  final Future<void> Function() onRefresh;
  final void Function(String) onAction;

  const _WorkersTab({
    required this.workers,
    required this.isLoading,
    required this.onRefresh,
    required this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    if (isLoading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (workers.isEmpty) {
      return _EmptyState(
        icon: Icons.people_outline_rounded,
        title: 'No workers found',
        subtitle: 'Try removing filters or check back soon.',
        onRefresh: onRefresh,
      );
    }
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: GridView.builder(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 100),
        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
          maxCrossAxisExtent: 220,
          mainAxisSpacing: 12,
          crossAxisSpacing: 12,
          childAspectRatio: 0.85,
        ),
        itemCount: workers.length,
        itemBuilder: (ctx, i) =>
            _WorkerCard(worker: workers[i], onAction: onAction),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Job Card
// ─────────────────────────────────────────────────────────────────────────────
class _JobCard extends StatelessWidget {
  final Job job;
  final void Function(String) onAction;

  const _JobCard({required this.job, required this.onAction});

  String _timeAgo(String? dateStr) {
    if (dateStr == null) return 'Recently';
    try {
      final d = DateTime.parse(dateStr);
      final diff = DateTime.now().difference(d);
      if (diff.inMinutes < 1) return 'Just now';
      if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
      if (diff.inHours < 24) return '${diff.inHours}h ago';
      return '${diff.inDays}d ago';
    } catch (_) {
      return dateStr;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: Colors.grey.shade200),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── Top row: skill badge + wage + time ──────────────────────
            Row(
              children: [
                _Badge(
                  label: job.skillNeeded,
                  bg: const Color(0xFFEEF2FF),
                  fg: const Color(0xFF3730A3),
                ),
                const SizedBox(width: 8),
                _Badge(
                  label: job.wageOffered,
                  bg: const Color(0xFFFEF3C7),
                  fg: const Color(0xFF92400E),
                  icon: Icons.currency_rupee,
                ),
                const Spacer(),
                Text(
                  _timeAgo(job.createdAt),
                  style: TextStyle(
                      fontSize: 11, color: Colors.grey.shade500),
                ),
              ],
            ),
            const SizedBox(height: 10),

            // ── Employer (masked) ─────────────────────────────────────
            Row(
              children: [
                CircleAvatar(
                  radius: 18,
                  backgroundColor: const Color(0xFFEEF2FF),
                  child: Text(
                    job.employerName.isNotEmpty
                        ? job.employerName[0].toUpperCase()
                        : '?',
                    style: const TextStyle(
                      color: Color(0xFF3730A3),
                      fontWeight: FontWeight.w800,
                      fontSize: 14,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        job.employerName,
                        style: GoogleFonts.plusJakartaSans(
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      Row(
                        children: [
                          Icon(Icons.location_on_rounded,
                              size: 12, color: Colors.grey.shade500),
                          const SizedBox(width: 2),
                          Text(
                            job.location,
                            style: TextStyle(
                                fontSize: 12, color: Colors.grey.shade600),
                          ),
                          Text('  •  ',
                              style: TextStyle(color: Colors.grey.shade400)),
                          Icon(Icons.calendar_today_rounded,
                              size: 11, color: Colors.grey.shade500),
                          const SizedBox(width: 2),
                          Text(
                            job.dateNeeded,
                            style: TextStyle(
                                fontSize: 12, color: Colors.grey.shade600),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),

            const SizedBox(height: 14),

            // ── Action buttons ────────────────────────────────────────
            Row(
              children: [
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: () => onAction('apply_job'),
                    icon: const Icon(Icons.bolt_rounded, size: 16),
                    label: Text(
                      'Apply for Job',
                      style: GoogleFonts.plusJakartaSans(
                          fontWeight: FontWeight.w700, fontSize: 13),
                    ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF1E3A8A),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10)),
                      elevation: 0,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton.icon(
                  onPressed: () => onAction('contact_hirer'),
                  icon: const Icon(Icons.phone_rounded, size: 14),
                  label: Text(
                    'Contact',
                    style: GoogleFonts.plusJakartaSans(
                        fontWeight: FontWeight.w600, fontSize: 13),
                  ),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFF1E3A8A),
                    side: const BorderSide(color: Color(0xFF1E3A8A)),
                    padding: const EdgeInsets.symmetric(
                        vertical: 10, horizontal: 12),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10)),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker Card
// ─────────────────────────────────────────────────────────────────────────────
class _WorkerCard extends StatelessWidget {
  final Map<String, dynamic> worker;
  final void Function(String) onAction;

  const _WorkerCard({required this.worker, required this.onAction});

  @override
  Widget build(BuildContext context) {
    final bool available = worker['available'] == true || worker['available'] == 1;
    final String skill = worker['skill_type'] ?? 'Unknown';
    final String location = worker['location'] ?? '';
    final String name = worker['display_name'] ?? 'Worker';

    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(
          color: available
              ? const Color(0xFF10B981).withValues(alpha: 0.4)
              : Colors.grey.shade200,
          width: available ? 1.5 : 1,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            // ── Avatar ────────────────────────────────────────────────
            Stack(
              alignment: Alignment.bottomRight,
              children: [
                CircleAvatar(
                  radius: 28,
                  backgroundColor: const Color(0xFFEEF2FF),
                  child: Text(
                    name.isNotEmpty ? name[0].toUpperCase() : '?',
                    style: const TextStyle(
                      color: Color(0xFF3730A3),
                      fontWeight: FontWeight.w800,
                      fontSize: 22,
                    ),
                  ),
                ),
                Container(
                  width: 14,
                  height: 14,
                  decoration: BoxDecoration(
                    color: available
                        ? const Color(0xFF10B981)
                        : Colors.grey.shade400,
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.white, width: 2),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),

            // ── Name ─────────────────────────────────────────────────
            Text(
              name,
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: GoogleFonts.plusJakartaSans(
                fontWeight: FontWeight.w700,
                fontSize: 14,
              ),
            ),
            const SizedBox(height: 4),

            // ── Skill + Location badges ───────────────────────────────
            _Badge(
              label: skill,
              bg: const Color(0xFFEEF2FF),
              fg: const Color(0xFF3730A3),
            ),
            const SizedBox(height: 4),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.location_on_rounded,
                    size: 11, color: Colors.grey.shade500),
                const SizedBox(width: 2),
                Flexible(
                  child: Text(
                    location,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        fontSize: 11, color: Colors.grey.shade600),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),

            // ── Availability badge ────────────────────────────────────
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: available
                    ? const Color(0xFFD1FAE5)
                    : Colors.grey.shade100,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Text(
                available ? '✓ Available Today' : 'Unavailable',
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  color: available
                      ? const Color(0xFF065F46)
                      : Colors.grey.shade500,
                ),
              ),
            ),
            const SizedBox(height: 10),

            // ── Hire button ───────────────────────────────────────────
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () => onAction('hire_worker'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: available
                      ? const Color(0xFF0891B2)
                      : Colors.grey.shade300,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10)),
                  elevation: 0,
                ),
                child: Text(
                  'Hire Worker',
                  style: GoogleFonts.plusJakartaSans(
                    fontWeight: FontWeight.w700,
                    fontSize: 12,
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
// Auth Gate Modal — shown when unauthenticated user tries to take an action
// ─────────────────────────────────────────────────────────────────────────────
class _AuthGateModal extends StatelessWidget {
  final String action;
  const _AuthGateModal({required this.action});

  String get _headline {
    switch (action) {
      case 'apply_job': return 'Sign in to Apply for this Job';
      case 'contact_hirer': return "Sign in to Contact the Hirer";
      case 'hire_worker': return 'Sign in to Hire this Worker';
      case 'post_job': return 'Sign in to Post a Job';
      case 'register_worker': return 'Sign in to List Your Skills';
      default: return 'Create an account or log in to connect';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(
          24, 20, 24, MediaQuery.of(context).viewInsets.bottom + 32),
      decoration: const BoxDecoration(
        color: Color(0xFF0F172A),
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Handle
          Container(
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(height: 20),

          // Icon
          Container(
            width: 60,
            height: 60,
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF3B82F6), Color(0xFF1D4ED8)],
              ),
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFF3B82F6).withValues(alpha: 0.4),
                  blurRadius: 20,
                  offset: const Offset(0, 6),
                ),
              ],
            ),
            child: const Icon(Icons.lock_open_rounded,
                color: Colors.white, size: 28),
          ),
          const SizedBox(height: 16),

          // Headline
          Text(
            _headline,
            textAlign: TextAlign.center,
            style: GoogleFonts.plusJakartaSans(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'It\'s free and takes less than a minute.',
            textAlign: TextAlign.center,
            style: GoogleFonts.plusJakartaSans(
              color: const Color(0xFF94A3B8),
              fontSize: 13,
            ),
          ),
          const SizedBox(height: 28),

          // ── Worker actions ──────────────────────────────────────────
          _AuthRow(
            label: 'Worker',
            color: const Color(0xFFF97316),
            icon: Icons.engineering_rounded,
            onLogin: () {
              Navigator.pop(context);
              Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) => const RoleLoginScreen(role: 'worker')),
              );
            },
            onRegister: () {
              Navigator.pop(context);
              Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) => const WorkerRegisterScreen()),
              );
            },
          ),
          const SizedBox(height: 12),

          // ── Hirer actions ───────────────────────────────────────────
          _AuthRow(
            label: 'Hirer',
            color: const Color(0xFF06B6D4),
            icon: Icons.business_center_rounded,
            onLogin: () {
              Navigator.pop(context);
              Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) => const RoleLoginScreen(role: 'hirer')),
              );
            },
            onRegister: () {
              Navigator.pop(context);
              Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) => const EmployerPostJobScreen()),
              );
            },
          ),

          const SizedBox(height: 16),
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(
              'Maybe later — just browsing',
              style: GoogleFonts.plusJakartaSans(
                color: const Color(0xFF64748B),
                fontSize: 13,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _AuthRow extends StatelessWidget {
  final String label;
  final Color color;
  final IconData icon;
  final VoidCallback onLogin;
  final VoidCallback onRegister;

  const _AuthRow({
    required this.label,
    required this.color,
    required this.icon,
    required this.onLogin,
    required this.onRegister,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withValues(alpha: 0.2)),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.15),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: color, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              'As a $label',
              style: GoogleFonts.plusJakartaSans(
                color: Colors.white,
                fontWeight: FontWeight.w700,
                fontSize: 14,
              ),
            ),
          ),
          TextButton(
            onPressed: onLogin,
            style: TextButton.styleFrom(
              foregroundColor: color,
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: Text('Log In',
                style: GoogleFonts.plusJakartaSans(
                    fontWeight: FontWeight.w700, fontSize: 13)),
          ),
          const SizedBox(width: 4),
          ElevatedButton(
            onPressed: onRegister,
            style: ElevatedButton.styleFrom(
              backgroundColor: color,
              foregroundColor: Colors.white,
              elevation: 0,
              padding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8)),
            ),
            child: Text('Register',
                style: GoogleFonts.plusJakartaSans(
                    fontWeight: FontWeight.w700, fontSize: 13)),
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared widgets
// ─────────────────────────────────────────────────────────────────────────────
class _FilterChip extends StatelessWidget {
  final String label;
  final bool selected;
  final IconData? icon;
  final VoidCallback onTap;

  const _FilterChip({
    required this.label,
    required this.selected,
    this.icon,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? const Color(0xFF1E3A8A) : Colors.grey.shade100,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: selected
                ? const Color(0xFF1E3A8A)
                : Colors.grey.shade300,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(icon,
                  size: 12,
                  color: selected ? Colors.white : Colors.grey.shade600),
              const SizedBox(width: 4),
            ],
            Text(
              label,
              style: GoogleFonts.plusJakartaSans(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: selected ? Colors.white : Colors.grey.shade700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  final String label;
  final Color bg;
  final Color fg;
  final IconData? icon;

  const _Badge({
    required this.label,
    required this.bg,
    required this.fg,
    this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 10, color: fg),
            const SizedBox(width: 2),
          ],
          Text(
            label,
            style: TextStyle(
              color: fg,
              fontWeight: FontWeight.w700,
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final Future<void> Function() onRefresh;

  const _EmptyState({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onRefresh,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 56, color: Colors.grey.shade300),
            const SizedBox(height: 16),
            Text(
              title,
              style: GoogleFonts.plusJakartaSans(
                fontSize: 17,
                fontWeight: FontWeight.w700,
                color: Colors.grey.shade700,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              subtitle,
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 13, color: Colors.grey.shade500),
            ),
            const SizedBox(height: 20),
            OutlinedButton.icon(
              onPressed: onRefresh,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Try Again'),
            ),
          ],
        ),
      ),
    );
  }
}

// SliverPersistentHeader delegate for the tab bar
class _TabBarDelegate extends SliverPersistentHeaderDelegate {
  final TabBar tabBar;
  const _TabBarDelegate(this.tabBar);

  @override
  Widget build(
      BuildContext context, double shrinkOffset, bool overlapsContent) {
    return Container(
      color: Colors.white,
      child: tabBar,
    );
  }

  @override
  double get maxExtent => tabBar.preferredSize.height;
  @override
  double get minExtent => tabBar.preferredSize.height;
  @override
  bool shouldRebuild(covariant _TabBarDelegate old) =>
      old.tabBar != tabBar;
}
