import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/api_service.dart';
import 'employer_matches_screen.dart';
import 'employer_dashboard_screen.dart';

class EmployerPostJobScreen extends StatefulWidget {
  const EmployerPostJobScreen({super.key});

  @override
  State<EmployerPostJobScreen> createState() => _EmployerPostJobScreenState();
}

class _EmployerPostJobScreenState extends State<EmployerPostJobScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _wageController = TextEditingController(text: '₹850/day');

  String? _selectedSkill;
  String? _selectedLocation;
  String _selectedDate = 'Today';
  bool _isSubmitting = false;

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
    'BTM Layout',
    'Electronic City',
    'Other Area',
  ];

  final List<String> _dates = ['Today', 'Tomorrow', 'This Weekend', 'Flexible'];

  @override
  void initState() {
    super.initState();
    _loadSavedPhone();
  }

  Future<void> _loadSavedPhone() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString('employer_phone');
    if (saved != null && saved.isNotEmpty) {
      _phoneController.text = saved;
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_selectedSkill == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select skill needed')),
      );
      return;
    }
    if (_selectedLocation == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select job location')),
      );
      return;
    }

    setState(() => _isSubmitting = true);

    final phone = _phoneController.text.trim();
    final job = await ApiService.postJob(
      employerName: _nameController.text.trim(),
      employerPhone: phone,
      skillNeeded: _selectedSkill!,
      location: _selectedLocation!,
      wageOffered: _wageController.text.trim(),
      dateNeeded: _selectedDate,
    );

    if (!mounted) return;
    setState(() => _isSubmitting = false);

    if (job != null) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('employer_phone', phone);

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('✓ Job successfully posted! Finding available workers...'),
          backgroundColor: Color(0xFF10B981),
        ),
      );

      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (_) => EmployerMatchesScreen(jobId: job.id),
        ),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to post job: Cannot connect to ${ApiService.baseUrl}.'),
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
          children: [
            const Text('Enter your Node server address (e.g., http://localhost:3000 or http://192.168.0.161:3000):', style: TextStyle(fontSize: 12)),
            const SizedBox(height: 10),
            TextField(
              controller: controller,
              decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'Server Base URL'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            onPressed: () async {
              await ApiService.setBaseUrl(controller.text);
              if (ctx.mounted) Navigator.pop(ctx);
              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text('Server URL set to: ${ApiService.baseUrl}')),
                );
              }
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Post a 1-Day Job'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            tooltip: 'Server Settings',
            onPressed: _showSettings,
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: const Color(0xFFFEF3C7),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFFFDE68A)),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.bolt, color: Color(0xFF92400E)),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Post your single-day requirement. You will immediately see workers available in your neighborhood.',
                        style: TextStyle(
                          fontSize: 12.5,
                          color: Color(0xFF92400E),
                          height: 1.3,
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 20),

              TextFormField(
                controller: _nameController,
                decoration: InputDecoration(
                  labelText: 'Employer / Business Name *',
                  hintText: 'e.g. Anand Buildcon or Rahul Sharma',
                  prefixIcon: const Icon(Icons.business),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                validator: (val) {
                  if (val == null || val.trim().isEmpty) {
                    return 'Please enter employer name';
                  }
                  return null;
                },
              ),

              const SizedBox(height: 16),

              TextFormField(
                controller: _phoneController,
                keyboardType: TextInputType.phone,
                maxLength: 10,
                decoration: InputDecoration(
                  labelText: 'Contact Phone Number (10 digits) *',
                  hintText: '9900112233',
                  prefixIcon: const Icon(Icons.phone),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  counterText: '',
                ),
                validator: (val) {
                  if (val == null || val.trim().length != 10) {
                    return 'Please enter a valid 10-digit phone number';
                  }
                  return null;
                },
              ),

              const SizedBox(height: 16),

              DropdownButtonFormField<String>(
                initialValue: _selectedSkill,
                decoration: InputDecoration(
                  labelText: 'Skill Needed *',
                  prefixIcon: const Icon(Icons.build),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                hint: const Text('Select skill required...'),
                items: _skills
                    .map((s) => DropdownMenuItem(value: s, child: Text(s)))
                    .toList(),
                onChanged: (val) => setState(() => _selectedSkill = val),
              ),

              const SizedBox(height: 16),

              DropdownButtonFormField<String>(
                initialValue: _selectedLocation,
                decoration: InputDecoration(
                  labelText: 'Job Location / Area *',
                  prefixIcon: const Icon(Icons.location_on),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                hint: const Text('Select neighborhood...'),
                items: _locations
                    .map((l) => DropdownMenuItem(value: l, child: Text(l)))
                    .toList(),
                onChanged: (val) => setState(() => _selectedLocation = val),
              ),

              const SizedBox(height: 16),

              Row(
                children: [
                  Expanded(
                    child: TextFormField(
                      controller: _wageController,
                      decoration: InputDecoration(
                        labelText: 'Daily Wage *',
                        hintText: '₹850/day',
                        prefixIcon: const Icon(Icons.currency_rupee),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      validator: (val) {
                        if (val == null || val.trim().isEmpty) {
                          return 'Enter wage';
                        }
                        return null;
                      },
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: _selectedDate,
                      decoration: InputDecoration(
                        labelText: 'Date Needed *',
                        prefixIcon: const Icon(Icons.calendar_today),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      items: _dates
                          .map((d) => DropdownMenuItem(value: d, child: Text(d)))
                          .toList(),
                      onChanged: (val) {
                        if (val != null) setState(() => _selectedDate = val);
                      },
                    ),
                  ),
                ],
              ),

              const SizedBox(height: 24),

              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFD97706),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                onPressed: _isSubmitting ? null : _submit,
                child: _isSubmitting
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(
                          color: Colors.white,
                          strokeWidth: 2,
                        ),
                      )
                    : const Text(
                        'Post Job & Find Available Workers →',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
              ),

              const SizedBox(height: 14),

              Center(
                child: TextButton(
                  onPressed: () {
                    Navigator.pushReplacement(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const EmployerDashboardScreen(),
                      ),
                    );
                  },
                  child: const Text('Manage posted jobs on Employer Dashboard'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
