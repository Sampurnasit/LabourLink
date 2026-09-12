import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../models/worker.dart';
import '../models/job.dart';

class ApiService {
  // Configurable base URL
  static String get defaultBaseUrl {
    if (kIsWeb) {
      return 'http://localhost:3000';
    }
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return 'http://localhost:3000';
      default:
        return 'http://localhost:3000';
    }
  }

  static String baseUrl = defaultBaseUrl;

  static Future<void> init() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final savedUrl = prefs.getString('api_base_url');
      if (savedUrl != null && savedUrl.trim().isNotEmpty) {
        baseUrl = savedUrl.trim().replaceAll(RegExp(r'/+$'), '');
        return;
      }
    } catch (_) {}

    // Auto-detect working endpoint on Android
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      final candidates = [
        'http://localhost:3000',      // Works on physical device via adb reverse
        'http://192.168.0.196:3000',  // Works on local Wi-Fi
        'http://10.0.2.2:3000',       // Works on Android Studio emulator
      ];
      for (final candidate in candidates) {
        final reachable = await testConnection(candidate);
        if (reachable) {
          baseUrl = candidate;
          break;
        }
      }
    }
  }

  static Future<void> setBaseUrl(String newUrl) async {
    baseUrl = newUrl.trim().replaceAll(RegExp(r'/+$'), '');
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('api_base_url', baseUrl);
    } catch (e) {
      debugPrint('Error saving base URL: $e');
    }
  }

  static Future<bool> testConnection([String? candidateUrl]) async {
    try {
      final target = (candidateUrl ?? baseUrl).trim().replaceAll(RegExp(r'/+$'), '');
      final res = await http.get(Uri.parse('$target/api/stats')).timeout(const Duration(seconds: 3));
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  // 1. Platform Statistics
  static Future<Map<String, dynamic>> getStats() async {
    try {
      final res = await http.get(Uri.parse('$baseUrl/api/stats'));
      if (res.statusCode == 200) {
        return jsonDecode(res.body) as Map<String, dynamic>;
      }
      return {};
    } catch (e) {
      debugPrint('Error getting stats: $e');
      return {};
    }
  }

  // 2. Open Jobs Feed
  static Future<List<Job>> getJobs({String? skill, String? location}) async {
    try {
      final uri = Uri.parse('$baseUrl/api/jobs').replace(queryParameters: {
        if (skill != null && skill.isNotEmpty) 'skill': skill,
        if (location != null && location.isNotEmpty) 'location': location,
      });

      final res = await http.get(uri);
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final list = data['jobs'] as List? ?? [];
        return list.map((j) => Job.fromJson(j)).toList();
      }
      return [];
    } catch (e) {
      debugPrint('Error getting jobs: $e');
      return [];
    }
  }

  // 3. Post a Job (Employer)
  static Future<Job?> postJob({
    required String employerName,
    required String employerPhone,
    required String skillNeeded,
    required String location,
    required String wageOffered,
    required String dateNeeded,
  }) async {
    try {
      final res = await http.post(
        Uri.parse('$baseUrl/api/jobs'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'employer_name': employerName,
          'employer_phone': employerPhone,
          'skill_needed': skillNeeded,
          'location': location,
          'wage_offered': wageOffered,
          'date_needed': dateNeeded,
        }),
      );

      if (res.statusCode == 201) {
        final data = jsonDecode(res.body);
        return Job.fromJson(data['job']);
      }
      return null;
    } catch (e) {
      debugPrint('Error posting job: $e');
      return null;
    }
  }

  // 4. Instant Matches for a Job
  static Future<Map<String, dynamic>?> getJobMatches(int jobId) async {
    try {
      final res = await http.get(Uri.parse('$baseUrl/api/jobs/$jobId/matches'));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final job = Job.fromJson(data['job']);
        final matchedWorkers = (data['matchedWorkers'] as List? ?? [])
            .map((w) => Worker.fromJson(w))
            .toList();
        final nearbyWorkers = (data['nearbyWorkers'] as List? ?? [])
            .map((w) => Worker.fromJson(w))
            .toList();

        return {
          'job': job,
          'matchedWorkers': matchedWorkers,
          'nearbyWorkers': nearbyWorkers,
        };
      }
      return null;
    } catch (e) {
      debugPrint('Error getting matches: $e');
      return null;
    }
  }

  // 5. Register or Update Worker Profile
  static Future<Worker?> registerWorker({
    required String name,
    required String phoneNumber,
    required String skillType,
    required String location,
    required bool available,
  }) async {
    try {
      final res = await http.post(
        Uri.parse('$baseUrl/api/workers/register'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'name': name,
          'phone_number': phoneNumber,
          'skill_type': skillType,
          'location': location,
          'available': available,
        }),
      );

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        return Worker.fromJson(data['worker']);
      }
      return null;
    } catch (e) {
      debugPrint('Error registering worker: $e');
      return null;
    }
  }

  // 6. Get Worker Profile & Matched Jobs by Phone
  static Future<Map<String, dynamic>?> getWorkerProfile(String phone) async {
    try {
      final res = await http.get(Uri.parse('$baseUrl/api/workers/$phone'));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        return {
          'worker': Worker.fromJson(data['worker']),
          'matchedJobs': (data['matchedJobs'] as List? ?? [])
              .map((j) => Job.fromJson(j))
              .toList(),
          'otherSkillJobs': (data['otherSkillJobs'] as List? ?? [])
              .map((j) => Job.fromJson(j))
              .toList(),
          'appliedJobs': (data['appliedJobs'] as List? ?? [])
              .map((j) => Job.fromJson(j))
              .toList(),
        };
      }
      return null;
    } catch (e) {
      debugPrint('Error getting worker profile: $e');
      return null;
    }
  }

  // 7. Express Interest in a Job
  static Future<bool> expressInterest(int workerId, int jobId) async {
    try {
      final res = await http.post(
        Uri.parse('$baseUrl/api/workers/interest'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'worker_id': workerId,
          'job_id': jobId,
        }),
      );
      return res.statusCode == 200;
    } catch (e) {
      debugPrint('Error expressing interest: $e');
      return false;
    }
  }

  // 8. Toggle Worker Availability
  static Future<Worker?> toggleAvailability(String phone, bool available) async {
    try {
      final res = await http.post(
        Uri.parse('$baseUrl/api/workers/toggle-availability'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'phone': phone,
          'available': available,
        }),
      );

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        return Worker.fromJson(data['worker']);
      }
      return null;
    } catch (e) {
      debugPrint('Error toggling availability: $e');
      return null;
    }
  }

  // 9. Get Employer's Posted Jobs
  static Future<List<Job>> getEmployerJobs(String phone) async {
    try {
      final res = await http.get(Uri.parse('$baseUrl/api/employers/$phone/jobs'));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final list = data['jobs'] as List? ?? [];
        return list.map((j) => Job.fromJson(j)).toList();
      }
      return [];
    } catch (e) {
      debugPrint('Error getting employer jobs: $e');
      return [];
    }
  }

  // 10. Confirm an Interested Worker
  static Future<bool> confirmWorker(int jobId, int workerId) async {
    try {
      final res = await http.post(
        Uri.parse('$baseUrl/api/employers/confirm-worker'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'job_id': jobId,
          'worker_id': workerId,
        }),
      );
      return res.statusCode == 200;
    } catch (e) {
      debugPrint('Error confirming worker: $e');
      return false;
    }
  }
}
