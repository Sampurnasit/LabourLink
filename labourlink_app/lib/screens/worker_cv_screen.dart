import 'package:flutter/material.dart';
import '../models/worker.dart';
import '../services/api_service.dart';
import 'worker_dashboard_screen.dart';

class WorkerCvScreen extends StatefulWidget {
  final Worker worker;
  final bool isFirstTime;

  const WorkerCvScreen({
    super.key,
    required this.worker,
    this.isFirstTime = false,
  });

  @override
  State<WorkerCvScreen> createState() => _WorkerCvScreenState();
}

class _WorkEntry {
  final TextEditingController companyController = TextEditingController();
  final TextEditingController durationController = TextEditingController();
  final TextEditingController roleController = TextEditingController();

  _WorkEntry({String company = '', String duration = '', String role = ''}) {
    companyController.text = company;
    durationController.text = duration;
    roleController.text = role;
  }

  void dispose() {
    companyController.dispose();
    durationController.dispose();
    roleController.dispose();
  }
}

class _WorkerCvScreenState extends State<WorkerCvScreen> {
  final _formKey = GlobalKey<FormState>();

  late TextEditingController _fullNameController;
  late TextEditingController _dobAgeController;
  late TextEditingController _phoneController;
  late TextEditingController _locationController;
  late TextEditingController _wageController;
  late TextEditingController _languagesController;
  late TextEditingController _aboutMeController;

  int _yearsOfExperience = 3;
  String _availabilityType = 'Full-time';

  final List<String> _availableSkills = [
    'Mason',
    'Bricklayer',
    'Electrician',
    'Plumber',
    'Painter',
    'Carpenter',
    'Welder',
    'Loading & Unloading',
    'Domestic Help',
    'Tiling',
    'Waterproofing',
    'Bar Bender',
    'Fabricator',
    'Helper',
  ];

  final Set<String> _selectedSkills = {};
  final List<_WorkEntry> _workHistory = [];

  bool _isLoading = true;
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    _fullNameController = TextEditingController(text: widget.worker.name);
    _dobAgeController = TextEditingController();
    _phoneController = TextEditingController(text: widget.worker.phoneNumber);
    _locationController = TextEditingController(text: widget.worker.location);
    _wageController = TextEditingController(text: '₹800/day');
    _languagesController = TextEditingController(text: 'Hindi, Kannada');
    _aboutMeController = TextEditingController();

    if (widget.worker.skillType.isNotEmpty) {
      _selectedSkills.add(widget.worker.skillType);
    }

    _loadExistingCv();
  }

  Future<void> _loadExistingCv() async {
    final cv = await ApiService.getWorkerCv(widget.worker.id);
    if (mounted) {
      if (cv != null) {
        setState(() {
          if (cv.fullName.isNotEmpty) _fullNameController.text = cv.fullName;
          if (cv.dobOrAge.isNotEmpty) _dobAgeController.text = cv.dobOrAge;
          if (cv.phoneNumber.isNotEmpty) _phoneController.text = cv.phoneNumber;
          if (cv.workLocation.isNotEmpty) _locationController.text = cv.workLocation;
          if (cv.dailyWageExpectation.isNotEmpty) _wageController.text = cv.dailyWageExpectation;
          if (cv.languages.isNotEmpty) _languagesController.text = cv.languages;
          if (cv.aboutMe.isNotEmpty) _aboutMeController.text = cv.aboutMe;
          _yearsOfExperience = cv.yearsOfExperience;
          if (cv.availabilityType.isNotEmpty) _availabilityType = cv.availabilityType;

          for (final s in cv.skills) {
            _selectedSkills.add(s);
          }

          for (final w in cv.previousWork) {
            _workHistory.add(_WorkEntry(
              company: w.company,
              duration: w.duration,
              role: w.role,
            ));
          }
          _isLoading = false;
        });
      } else {
        // Prepopulate at least 1 empty work entry
        _workHistory.add(_WorkEntry(
          company: '',
          duration: '2022 - 2024',
          role: widget.worker.skillType.isNotEmpty ? widget.worker.skillType : 'Helper',
        ));
        setState(() => _isLoading = false);
      }
    }
  }

  @override
  void dispose() {
    _fullNameController.dispose();
    _dobAgeController.dispose();
    _phoneController.dispose();
    _locationController.dispose();
    _wageController.dispose();
    _languagesController.dispose();
    _aboutMeController.dispose();
    for (final e in _workHistory) {
      e.dispose();
    }
    super.dispose();
  }

  void _addWorkEntry() {
    setState(() {
      _workHistory.add(_WorkEntry());
    });
  }

  void _removeWorkEntry(int index) {
    setState(() {
      _workHistory[index].dispose();
      _workHistory.removeAt(index);
    });
  }

  Future<void> _saveCv() async {
    if (!_formKey.currentState!.validate()) return;
    if (_selectedSkills.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select at least one skill / trade tag.')),
      );
      return;
    }

    setState(() => _isSaving = true);

    final previousWorkList = _workHistory
        .where((e) => e.companyController.text.trim().isNotEmpty)
        .map((e) => {
              'company': e.companyController.text.trim(),
              'duration': e.durationController.text.trim(),
              'role': e.roleController.text.trim(),
            })
        .toList();

    final cvData = {
      'full_name': _fullNameController.text.trim(),
      'dob_or_age': _dobAgeController.text.trim(),
      'phone_number': _phoneController.text.trim(),
      'skills': _selectedSkills.toList(),
      'years_of_experience': _yearsOfExperience,
      'previous_work': previousWorkList,
      'work_location': _locationController.text.trim(),
      'daily_wage_expectation': _wageController.text.trim(),
      'availability_type': _availabilityType,
      'languages': _languagesController.text.trim(),
      'about_me': _aboutMeController.text.trim(),
    };

    final success = await ApiService.saveWorkerCv(widget.worker.id, cvData);

    if (!mounted) return;
    setState(() => _isSaving = false);

    if (success) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('✓ Profile / CV successfully updated!'),
          backgroundColor: Color(0xFF10B981),
        ),
      );
      if (widget.isFirstTime) {
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(
            builder: (_) => WorkerDashboardScreen(initialPhone: widget.worker.phoneNumber),
          ),
        );
      } else {
        Navigator.pop(context, true);
      }
    } else {
      final errorMsg = ApiService.lastErrorMessage ?? 'Failed to save CV. Please check backend connection.';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(errorMsg),
          backgroundColor: Colors.red,
          action: SnackBarAction(
            label: 'Configure',
            textColor: Colors.white,
            onPressed: _showSettings,
          ),
        ),
      );
    }
  }

  void _showSettings() {
    final controller = TextEditingController(text: ApiService.baseUrl);
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Backend Server URL'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Change the backend connection URL if your server is on a different IP or port:',
              style: TextStyle(fontSize: 13, color: Colors.black87),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              decoration: const InputDecoration(
                labelText: 'Server Base URL',
                hintText: 'e.g. http://127.0.0.1:3000 or http://192.168.0.x:3000',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () async {
              final newUrl = controller.text.trim();
              if (newUrl.isNotEmpty) {
                Navigator.pop(ctx);
                await ApiService.setBaseUrl(newUrl);
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('Backend URL set to: ${ApiService.baseUrl}'),
                      backgroundColor: const Color(0xFF10B981),
                    ),
                  );
                }
              }
            },
            child: const Text('Save & Reconnect'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.isFirstTime ? 'Complete Your Profile / CV' : 'Edit My CV'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            tooltip: 'Server Settings',
            onPressed: _showSettings,
          ),
          if (widget.isFirstTime)
            TextButton(
              onPressed: () {
                Navigator.pushReplacement(
                  context,
                  MaterialPageRoute(
                    builder: (_) => WorkerDashboardScreen(initialPhone: widget.worker.phoneNumber),
                  ),
                );
              },
              child: const Text('Skip', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
            ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Form(
              key: _formKey,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  if (widget.isFirstTime)
                    Container(
                      margin: const EdgeInsets.only(bottom: 16),
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: const Color(0xFFEFF6FF),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFF93C5FD)),
                      ),
                      child: const Row(
                        children: [
                          Icon(Icons.workspace_premium, color: Color(0xFF1D4ED8), size: 28),
                          SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'Completing your structured CV increases your chances of being hired by 300%!',
                              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF1E40AF)),
                            ),
                          ),
                        ],
                      ),
                    ),

                  // Basic Details
                  _buildSectionHeader('👤 Personal & Contact Info'),
                  const SizedBox(height: 8),
                  TextFormField(
                    controller: _fullNameController,
                    decoration: const InputDecoration(
                      labelText: 'Full Name *',
                      prefixIcon: Icon(Icons.person_outline),
                      border: OutlineInputBorder(),
                    ),
                    validator: (v) => v == null || v.trim().isEmpty ? 'Please enter your full name' : null,
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: TextFormField(
                          controller: _dobAgeController,
                          decoration: const InputDecoration(
                            labelText: 'Age / Date of Birth',
                            hintText: 'e.g. 32 years',
                            prefixIcon: Icon(Icons.cake_outlined),
                            border: OutlineInputBorder(),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextFormField(
                          controller: _phoneController,
                          keyboardType: TextInputType.phone,
                          decoration: const InputDecoration(
                            labelText: 'Phone Number',
                            prefixIcon: Icon(Icons.phone_outlined),
                            border: OutlineInputBorder(),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _locationController,
                    decoration: const InputDecoration(
                      labelText: 'Preferred Location / Area of Work *',
                      hintText: 'e.g. Koramangala, Indiranagar',
                      prefixIcon: Icon(Icons.place_outlined),
                      border: OutlineInputBorder(),
                    ),
                    validator: (v) => v == null || v.trim().isEmpty ? 'Please enter work location' : null,
                  ),

                  const SizedBox(height: 24),
                  // Skills / Trade Tags
                  _buildSectionHeader('🛠 Skills & Trades (Select All That Apply) *'),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: _availableSkills.map((skill) {
                      final isSelected = _selectedSkills.contains(skill);
                      return FilterChip(
                        label: Text(skill),
                        selected: isSelected,
                        selectedColor: const Color(0xFF0284C7).withValues(alpha: 0.2),
                        checkmarkColor: const Color(0xFF0284C7),
                        labelStyle: TextStyle(
                          fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                          color: isSelected ? const Color(0xFF0369A1) : Colors.black87,
                        ),
                        onSelected: (selected) {
                          setState(() {
                            if (selected) {
                              _selectedSkills.add(skill);
                            } else {
                              _selectedSkills.remove(skill);
                            }
                          });
                        },
                      );
                    }).toList(),
                  ),

                  const SizedBox(height: 24),
                  // Experience & Wages
                  _buildSectionHeader('💼 Experience & Wage Expectation'),
                  const SizedBox(height: 8),
                  Card(
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              const Text('Total Experience:', style: TextStyle(fontWeight: FontWeight.w600)),
                              Text('$_yearsOfExperience Years', style: const TextStyle(fontWeight: FontWeight.w800, color: Color(0xFF0284C7))),
                            ],
                          ),
                          Slider(
                            value: _yearsOfExperience.toDouble(),
                            min: 0,
                            max: 30,
                            divisions: 30,
                            label: '$_yearsOfExperience years',
                            activeColor: const Color(0xFF0284C7),
                            onChanged: (val) => setState(() => _yearsOfExperience = val.toInt()),
                          ),
                          const Divider(),
                          TextFormField(
                            controller: _wageController,
                            decoration: const InputDecoration(
                              labelText: 'Daily Wage Expectation',
                              hintText: 'e.g. ₹850/day',
                              prefixIcon: Icon(Icons.currency_rupee),
                              border: OutlineInputBorder(),
                            ),
                          ),
                          const SizedBox(height: 14),
                          DropdownButtonFormField<String>(
                            isExpanded: true,
                            initialValue: _availabilityType,
                            decoration: const InputDecoration(
                              labelText: 'Availability',
                              prefixIcon: Icon(Icons.schedule_rounded),
                              border: OutlineInputBorder(),
                            ),
                            items: const [
                              DropdownMenuItem(value: 'Full-time', child: Text('Full-time', overflow: TextOverflow.ellipsis)),
                              DropdownMenuItem(value: 'Part-time', child: Text('Part-time', overflow: TextOverflow.ellipsis)),
                              DropdownMenuItem(value: 'Immediate', child: Text('Immediate', overflow: TextOverflow.ellipsis)),
                              DropdownMenuItem(value: 'Weekends Only', child: Text('Weekends Only', overflow: TextOverflow.ellipsis)),
                            ],
                            onChanged: (val) {
                              if (val != null) setState(() => _availabilityType = val);
                            },
                          ),
                        ],
                      ),
                    ),
                  ),

                  const SizedBox(height: 24),
                  // Previous Work & Employers (Repeatable List)
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      _buildSectionHeader('🏢 Previous Work / Employers'),
                      TextButton.icon(
                        icon: const Icon(Icons.add_circle, size: 18),
                        label: const Text('Add Employer'),
                        onPressed: _addWorkEntry,
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  if (_workHistory.isEmpty)
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Colors.grey.shade50,
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: Colors.grey.shade300),
                      ),
                      child: const Center(
                        child: Text(
                          'No previous work added yet. Click "+ Add Employer" to list past projects or contractors.',
                          style: TextStyle(color: Colors.grey, fontSize: 13),
                          textAlign: TextAlign.center,
                        ),
                      ),
                    )
                  else
                    ..._workHistory.asMap().entries.map((entry) {
                      final idx = entry.key;
                      final item = entry.value;
                      return Container(
                        margin: const EdgeInsets.only(bottom: 12),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: Colors.grey.shade300),
                        ),
                        child: Column(
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text('Employer #${idx + 1}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                                IconButton(
                                  icon: const Icon(Icons.delete_outline, color: Colors.red, size: 20),
                                  onPressed: () => _removeWorkEntry(idx),
                                  visualDensity: VisualDensity.compact,
                                ),
                              ],
                            ),
                            TextFormField(
                              controller: item.companyController,
                              decoration: const InputDecoration(
                                labelText: 'Company / Contractor Name',
                                hintText: 'e.g. Prestige Construction or Anand Buildcon',
                                isDense: true,
                                border: OutlineInputBorder(),
                              ),
                            ),
                            const SizedBox(height: 8),
                            Row(
                              children: [
                                Expanded(
                                  child: TextFormField(
                                    controller: item.durationController,
                                    decoration: const InputDecoration(
                                      labelText: 'Duration',
                                      hintText: 'e.g. 2021 - 2023',
                                      isDense: true,
                                      border: OutlineInputBorder(),
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: TextFormField(
                                    controller: item.roleController,
                                    decoration: const InputDecoration(
                                      labelText: 'Role / Job Done',
                                      hintText: 'e.g. Lead Mason',
                                      isDense: true,
                                      border: OutlineInputBorder(),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      );
                    }),

                  const SizedBox(height: 24),
                  // Languages & Bio
                  _buildSectionHeader('🗣 Languages & About Me'),
                  const SizedBox(height: 8),
                  TextFormField(
                    controller: _languagesController,
                    decoration: const InputDecoration(
                      labelText: 'Languages Known',
                      hintText: 'e.g. Hindi, Kannada, Tamil, English',
                      prefixIcon: Icon(Icons.translate),
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _aboutMeController,
                    maxLines: 3,
                    decoration: const InputDecoration(
                      labelText: 'Short "About Me" Bio',
                      hintText: 'Mention your specialties, punctuality, tools you own, or work ethic...',
                      alignLabelWithHint: true,
                      border: OutlineInputBorder(),
                    ),
                  ),

                  const SizedBox(height: 28),
                  ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF0284C7),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    icon: _isSaving
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                          )
                        : const Icon(Icons.check_circle_outline),
                    label: Text(
                      _isSaving ? 'Saving Profile...' : 'Save & Update CV',
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                    ),
                    onPressed: _isSaving ? null : _saveCv,
                  ),
                  const SizedBox(height: 32),
                ],
              ),
            ),
    );
  }

  Widget _buildSectionHeader(String title) {
    return Text(
      title,
      style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
    );
  }
}
