import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../models/job.dart';
import 'worker_register_screen.dart';
import 'worker_dashboard_screen.dart';
import 'employer_post_job_screen.dart';
import 'employer_dashboard_screen.dart';
import 'public_board_screen.dart';
import '../widgets/mock_phone_call_widget.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Map<String, dynamic> _stats = {};
  List<Job> _recentJobs = [];
  bool _isLoading = true;

  bool _isServerConnected = false;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() => _isLoading = true);
    var statsMap = await ApiService.getStats();
    if (statsMap.isEmpty) {
      final found = await ApiService.autoDiscoverServer();
      if (found) {
        statsMap = await ApiService.getStats();
      }
    }
    final jobsList = (await ApiService.getJobs()).take(4).toList();

    if (mounted) {
      setState(() {
        if (statsMap.isNotEmpty) {
          _stats = statsMap;
          _isServerConnected = true;
        } else if (_stats.isEmpty) {
          _isServerConnected = false;
        }
        if (jobsList.isNotEmpty) {
          _recentJobs = jobsList;
        }
        _isLoading = false;
      });
    }
  }

  Future<void> _autoReconnect() async {
    setState(() => _isLoading = true);
    final connected = await ApiService.autoDiscoverServer();
    if (connected) {
      await _loadData();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: const Color(0xFF10B981),
            content: Text('✓ Connected to backend at: ${ApiService.baseUrl}'),
            duration: const Duration(seconds: 3),
          ),
        );
      }
    } else {
      if (mounted) {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            backgroundColor: Colors.red,
            content: Text('Could not reach backend server on any known IP.'),
            duration: Duration(seconds: 3),
          ),
        );
      }
    }
  }

  void _showApiSettingsDialog() {
    final controller = TextEditingController(text: ApiService.baseUrl);
    String? testStatus;
    bool isTesting = false;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: const Row(
            children: [
              Icon(Icons.dns_rounded, color: Color(0xFF2563EB)),
              SizedBox(width: 8),
              Text('Server Connection', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            ],
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Quick Presets:',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Colors.grey),
                ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    ActionChip(
                      avatar: const Icon(Icons.computer, size: 14),
                      label: const Text('Localhost (3000)', style: TextStyle(fontSize: 12)),
                      onPressed: () => setDialogState(() => controller.text = 'http://localhost:3000'),
                    ),
                    ActionChip(
                      avatar: const Icon(Icons.wifi, size: 14),
                      label: const Text('Wi-Fi (192.168.0.161)', style: TextStyle(fontSize: 12)),
                      onPressed: () => setDialogState(() => controller.text = 'http://192.168.0.161:3000'),
                    ),
                    ActionChip(
                      avatar: const Icon(Icons.phone_android, size: 14),
                      label: const Text('Emulator (10.0.2.2)', style: TextStyle(fontSize: 12)),
                      onPressed: () => setDialogState(() => controller.text = 'http://10.0.2.2:3000'),
                    ),
                    ActionChip(
                      avatar: const Icon(Icons.lan, size: 14),
                      label: const Text('Loopback (127.0.0.1)', style: TextStyle(fontSize: 12)),
                      onPressed: () => setDialogState(() => controller.text = 'http://127.0.0.1:3000'),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: controller,
                  decoration: InputDecoration(
                    labelText: 'Server Base URL',
                    hintText: 'http://localhost:3000',
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                    prefixIcon: const Icon(Icons.link),
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    OutlinedButton.icon(
                      icon: isTesting
                          ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Icon(Icons.network_check, size: 16),
                      label: const Text('Test Ping'),
                      onPressed: isTesting
                          ? null
                          : () async {
                              setDialogState(() {
                                isTesting = true;
                                testStatus = null;
                              });
                              final ok = await ApiService.testConnection(controller.text);
                              setDialogState(() {
                                isTesting = false;
                                testStatus = ok ? '✓ Connected!' : '✗ Cannot reach';
                              });
                            },
                    ),
                    const SizedBox(width: 6),
                    TextButton.icon(
                      icon: const Icon(Icons.auto_mode, size: 16),
                      label: const Text('Auto-Detect', style: TextStyle(fontSize: 12)),
                      onPressed: isTesting
                          ? null
                          : () async {
                              setDialogState(() {
                                isTesting = true;
                                testStatus = null;
                              });
                              final ok = await ApiService.autoDiscoverServer();
                              setDialogState(() {
                                isTesting = false;
                                controller.text = ApiService.baseUrl;
                                testStatus = ok ? '✓ Auto-found server!' : '✗ No server found';
                              });
                            },
                    ),
                  ],
                ),
                if (testStatus != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      testStatus!,
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: testStatus!.startsWith('✓') ? const Color(0xFF10B981) : Colors.red,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () async {
                await ApiService.setBaseUrl(controller.text);
                if (ctx.mounted) Navigator.pop(ctx);
                _loadData();
              },
              child: const Text('Save & Apply'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFF2563EB), Color(0xFF1D4ED8)],
                ),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.bolt, color: Colors.white, size: 20),
            ),
            const SizedBox(width: 8),
            const Text(
              'LabourLink',
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 19),
            ),
            const SizedBox(width: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: const Color(0xFFFEF3C7),
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Text(
                'CHOWK',
                style: TextStyle(
                  color: Color(0xFF92400E),
                  fontSize: 10,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
            onPressed: _loadData,
          ),
          IconButton(
            icon: Stack(
              clipBehavior: Clip.none,
              children: [
                const Icon(Icons.settings_outlined),
                Positioned(
                  right: -1,
                  top: -1,
                  child: Container(
                    width: 9,
                    height: 9,
                    decoration: BoxDecoration(
                      color: _isServerConnected ? const Color(0xFF10B981) : Colors.red,
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 1.5),
                    ),
                  ),
                ),
              ],
            ),
            tooltip: _isServerConnected ? 'Server Connected' : 'Server Offline - Tap to configure',
            onPressed: _showApiSettingsDialog,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadData,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (!_isLoading && !_isServerConnected)
                Container(
                  margin: const EdgeInsets.only(bottom: 16),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFEF2F2),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFFFCA5A5)),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.cloud_off, color: Colors.red),
                      const SizedBox(width: 10),
                      const Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Database Server Offline',
                              style: TextStyle(fontWeight: FontWeight.bold, color: Colors.red, fontSize: 13),
                            ),
                            Text(
                              'Cannot reach backend. Tap "Auto-Fix" to automatically connect to live server.',
                              style: TextStyle(fontSize: 11, color: Color(0xFF7F1D1D)),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      FilledButton(
                        style: FilledButton.styleFrom(
                          backgroundColor: const Color(0xFF2563EB),
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          visualDensity: VisualDensity.compact,
                        ),
                        onPressed: _autoReconnect,
                        child: const Text('Auto-Fix', style: TextStyle(fontSize: 12, color: Colors.white, fontWeight: FontWeight.bold)),
                      ),
                      const SizedBox(width: 6),
                      FilledButton.tonal(
                        style: FilledButton.styleFrom(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                          visualDensity: VisualDensity.compact,
                        ),
                        onPressed: _showApiSettingsDialog,
                        child: const Icon(Icons.settings, size: 16),
                      ),
                    ],
                  ),
                ),
              // 1. Hero Banner
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFF0F172A), Color(0xFF1E293B)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(20),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.12),
                      blurRadius: 10,
                      offset: const Offset(0, 4),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: const Text(
                        '⚡ Direct 1-Day Labor Matching',
                        style: TextStyle(
                          color: Color(0xFF93C5FD),
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    const Text(
                      'Connecting Daily Workers With Employers.',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 22,
                        fontWeight: FontWeight.w800,
                        height: 1.2,
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Instant short-term gig matching without middlemen. Register skills, post jobs, and confirm hires directly.',
                      style: TextStyle(
                        color: Color(0xFFCBD5E1),
                        fontSize: 13,
                        height: 1.4,
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 16),

              // 2. Dual Action Role Cards
              _buildRoleCard(
                context,
                title: "I'm Looking for Work",
                subtitle:
                    'Register your skill, indicate availability today, and get matched with hiring employers.',
                icon: Icons.construction,
                accentColor: const Color(0xFF0284C7),
                bgGradient: const [Color(0xFF0284C7), Color(0xFF0369A1)],
                primaryActionText: 'Register as Worker',
                onPrimaryAction: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => const WorkerRegisterScreen(),
                    ),
                  ).then((_) => _loadData());
                },
                secondaryActionText: 'Worker Dashboard',
                onSecondaryAction: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => const WorkerDashboardScreen(),
                    ),
                  ).then((_) => _loadData());
                },
              ),

              const SizedBox(height: 12),

              _buildRoleCard(
                context,
                title: 'I Need to Hire Someone',
                subtitle:
                    'Post a 1-day job requirement with wage and location to see available local workers instantly.',
                icon: Icons.business,
                accentColor: const Color(0xFFD97706),
                bgGradient: const [Color(0xFFD97706), Color(0xFFB45309)],
                primaryActionText: 'Post a 1-Day Job',
                onPrimaryAction: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => const EmployerPostJobScreen(),
                    ),
                  ).then((_) => _loadData());
                },
                secondaryActionText: 'Employer Dashboard',
                onSecondaryAction: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => const EmployerDashboardScreen(),
                    ),
                  ).then((_) => _loadData());
                },
              ),

              const SizedBox(height: 18),

              // Mock Phone Call Interface
              const MockPhoneCallWidget(),

              const SizedBox(height: 18),

              // 3. Platform Live Stats
              Text(
                'Live Platform Activity',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 8),

              Row(
                children: [
                  Expanded(
                    child: _buildStatTile(
                      label: 'Workers',
                      value: '${_stats['totalWorkers'] ?? 0}',
                      icon: Icons.people_alt,
                      color: const Color(0xFF2563EB),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _buildStatTile(
                      label: 'Available Today',
                      value: '${_stats['availableWorkers'] ?? 0}',
                      icon: Icons.check_circle,
                      color: const Color(0xFF10B981),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _buildStatTile(
                      label: 'Open Jobs',
                      value: '${_stats['openJobs'] ?? 0}',
                      icon: Icons.work,
                      color: const Color(0xFFF59E0B),
                    ),
                  ),
                ],
              ),

              const SizedBox(height: 20),

              // 4. Public Board Shortcut & Recent Jobs
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    '🔥 Recent Open Jobs',
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  TextButton(
                    onPressed: () {
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => const PublicBoardScreen(),
                        ),
                      ).then((_) => _loadData());
                    },
                    child: const Text('View All Jobs →'),
                  ),
                ],
              ),

              if (_isLoading)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.all(24.0),
                    child: CircularProgressIndicator(),
                  ),
                )
              else if (_recentJobs.isEmpty)
                Container(
                  padding: const EdgeInsets.all(20),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: Colors.grey.shade100,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Text('No open jobs available right now.'),
                )
              else
                ..._recentJobs.map((job) => _buildJobCard(context, job)),

              const SizedBox(height: 20),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRoleCard(
    BuildContext context, {
    required String title,
    required String subtitle,
    required IconData icon,
    required Color accentColor,
    required List<Color> bgGradient,
    required String primaryActionText,
    required VoidCallback onPrimaryAction,
    required String secondaryActionText,
    required VoidCallback onSecondaryAction,
  }) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  backgroundColor: accentColor.withValues(alpha: 0.12),
                  foregroundColor: accentColor,
                  child: Icon(icon, size: 22),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    title,
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              subtitle,
              style: TextStyle(fontSize: 13, color: Colors.grey.shade600),
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: bgGradient.first,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                      padding: const EdgeInsets.symmetric(vertical: 11),
                    ),
                    onPressed: onPrimaryAction,
                    child: Text(
                      primaryActionText,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton(
                  style: OutlinedButton.styleFrom(
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 11,
                    ),
                  ),
                  onPressed: onSecondaryAction,
                  child: const Text('Dashboard'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatTile({
    required String label,
    required String value,
    required IconData icon,
    required Color color,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.grey.shade200),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 4,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(height: 4),
          Text(
            value,
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              color: Colors.grey.shade900,
            ),
          ),
          Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 11, color: Colors.grey.shade600),
          ),
        ],
      ),
    );
  }

  Widget _buildJobCard(BuildContext context, Job job) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: const Color(0xFFEEF2FF),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                job.skillNeeded,
                style: const TextStyle(
                  color: Color(0xFF3730A3),
                  fontWeight: FontWeight.w700,
                  fontSize: 11,
                ),
              ),
            ),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: const Color(0xFFFEF3C7),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                job.wageOffered,
                style: const TextStyle(
                  color: Color(0xFF92400E),
                  fontWeight: FontWeight.w700,
                  fontSize: 11,
                ),
              ),
            ),
          ],
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                job.employerName,
                style: const TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 14,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                '📍 ${job.location}  •  📅 ${job.dateNeeded}',
                style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
              ),
            ],
          ),
        ),
        trailing: const Icon(Icons.chevron_right, color: Colors.grey),
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const WorkerDashboardScreen()),
          );
        },
      ),
    );
  }
}
