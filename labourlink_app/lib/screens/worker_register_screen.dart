import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/api_service.dart';
import 'worker_dashboard_screen.dart';

class WorkerRegisterScreen extends StatefulWidget {
  const WorkerRegisterScreen({super.key});

  @override
  State<WorkerRegisterScreen> createState() => _WorkerRegisterScreenState();
}

class _WorkerRegisterScreenState extends State<WorkerRegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();

  String? _selectedSkill;
  String? _selectedLocation;
  bool _available = true;
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

  @override
  void initState() {
    super.initState();
    _loadSavedPhone();
  }

  Future<void> _loadSavedPhone() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString('worker_phone');
    if (saved != null && saved.isNotEmpty) {
      _phoneController.text = saved;
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_selectedSkill == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select your skill type')),
      );
      return;
    }
    if (_selectedLocation == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select your location')),
      );
      return;
    }

    setState(() => _isSubmitting = true);

    final phone = _phoneController.text.trim();
    final worker = await ApiService.registerWorker(
      name: _nameController.text.trim(),
      phoneNumber: phone,
      skillType: _selectedSkill!,
      location: _selectedLocation!,
      available: _available,
    );

    if (!mounted) return;
    setState(() => _isSubmitting = false);

    if (worker != null) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('worker_phone', phone);

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('✓ Welcome ${worker.name}! Profile registered.'),
          backgroundColor: const Color(0xFF10B981),
        ),
      );

      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (_) => WorkerDashboardScreen(initialPhone: phone),
        ),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Registration failed. Please check server connection.'),
          backgroundColor: Colors.red,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Worker Registration'),
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
                  color: const Color(0xFFE0F2FE),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFFBAE6FD)),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.info_outline, color: Color(0xFF0369A1)),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Register your skills once. Local employers will see you in instant search results and contact you for 1-day work.',
                        style: TextStyle(
                          fontSize: 12.5,
                          color: Color(0xFF0369A1),
                          height: 1.3,
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 20),

              // Full Name
              TextFormField(
                controller: _nameController,
                decoration: InputDecoration(
                  labelText: 'Full Name *',
                  hintText: 'e.g. Ramesh Kumar',
                  prefixIcon: const Icon(Icons.person),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                validator: (val) {
                  if (val == null || val.trim().isEmpty) {
                    return 'Please enter your name';
                  }
                  return null;
                },
              ),

              const SizedBox(height: 16),

              // Phone Number
              TextFormField(
                controller: _phoneController,
                keyboardType: TextInputType.phone,
                maxLength: 10,
                decoration: InputDecoration(
                  labelText: 'Phone Number (10 digits) *',
                  hintText: '9876543210',
                  prefixIcon: const Icon(Icons.phone),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  counterText: '',
                ),
                validator: (val) {
                  if (val == null || val.trim().length != 10) {
                    return 'Please enter a valid 10-digit mobile number';
                  }
                  return null;
                },
              ),

              const SizedBox(height: 16),

              // Skill Type Dropdown
              DropdownButtonFormField<String>(
                initialValue: _selectedSkill,
                decoration: InputDecoration(
                  labelText: 'Primary Skill *',
                  prefixIcon: const Icon(Icons.handyman),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                hint: const Text('Select your skill...'),
                items: _skills
                    .map((s) => DropdownMenuItem(value: s, child: Text(s)))
                    .toList(),
                onChanged: (val) => setState(() => _selectedSkill = val),
              ),

              const SizedBox(height: 16),

              // Location Dropdown
              DropdownButtonFormField<String>(
                initialValue: _selectedLocation,
                decoration: InputDecoration(
                  labelText: 'Your Location / Area *',
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

              // Available Today Switch
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                decoration: BoxDecoration(
                  color: Colors.grey.shade50,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.grey.shade300),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Available for Work Today?',
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 14,
                          ),
                        ),
                        Text(
                          'Turn off when taking rest or already engaged',
                          style: TextStyle(fontSize: 11, color: Colors.grey),
                        ),
                      ],
                    ),
                    Switch(
                      value: _available,
                      activeThumbColor: const Color(0xFF10B981),
                      onChanged: (val) => setState(() => _available = val),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 24),

              // Submit Button
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF0284C7),
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
                        'Complete Registration →',
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
                        builder: (_) => const WorkerDashboardScreen(),
                      ),
                    );
                  },
                  child: const Text('Already registered? Open Worker Dashboard'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
