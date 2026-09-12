import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../models/worker.dart';
import '../models/job.dart';

class ApiService {
  static const Duration requestTimeout = Duration(seconds: 4);

  // Candidate URLs for auto-discovery
  static List<String> get candidateUrls => [
    'http://127.0.0.1:3000',
    'http://localhost:3000',
    'http://10.0.2.2:3000',
    'http://192.168.0.161:3000',
  ];

  static String get defaultBaseUrl {
    if (kIsWeb) {
      return 'http://localhost:3000';
    }
    return 'http://127.0.0.1:3000';
  }

  static String baseUrl = defaultBaseUrl;

  static Future<void> init() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final savedUrl = prefs.getString('api_base_url');
      if (savedUrl != null) {
        final clean = savedUrl.trim().replaceAll(RegExp(r'/+$'), '');
        // Clear dead 10.0.2.2 or empty URLs
        if (clean.contains('10.0.2.2') || clean.isEmpty) {
          await prefs.remove('api_base_url');
        } else {
          final ok = await testConnection(clean);
          if (ok) {
            baseUrl = clean;
            return;
          } else {
            await prefs.remove('api_base_url');
          }
        }
      }
    } catch (_) {}

    // Auto-discover working endpoint
    await autoDiscoverServer();
  }

  static Future<bool> autoDiscoverServer() async {
    for (final candidate in candidateUrls) {
      final reachable = await testConnection(candidate);
      if (reachable) {
        baseUrl = candidate;
        try {
          final prefs = await SharedPreferences.getInstance();
          await prefs.setString('api_base_url', baseUrl);
        } catch (_) {}
        debugPrint('[ApiService] Connected to backend at: $baseUrl');
        return true;
      }
    }
    baseUrl = defaultBaseUrl;
    return false;
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
      final res = await http.get(Uri.parse('$target/api/stats')).timeout(const Duration(seconds: 2));
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  // Safe HTTP GET with auto-recovery to 127.0.0.1:3000
  static Future<http.Response?> _safeGet(String path, {Map<String, String>? query}) async {
    Uri buildUri(String base) {
      final clean = base.replaceAll(RegExp(r'/+$'), '');
      final fullUrl = '$clean$path';
      final uri = Uri.parse(fullUrl);
      if (query != null && query.isNotEmpty) {
        return uri.replace(queryParameters: query);
      }
      return uri;
    }

    try {
      return await http.get(buildUri(baseUrl)).timeout(const Duration(seconds: 4));
    } catch (e) {
      debugPrint('GET $path failed on $baseUrl: $e');
      if (baseUrl != 'http://127.0.0.1:3000') {
        try {
          final fallback = await http.get(buildUri('http://127.0.0.1:3000')).timeout(const Duration(seconds: 4));
          if (fallback.statusCode == 200) {
            setBaseUrl('http://127.0.0.1:3000');
            return fallback;
          }
        } catch (_) {}
      }
      return null;
    }
  }

  // Safe HTTP POST with auto-recovery to 127.0.0.1:3000
  static Future<http.Response?> _safePost(String path, Map<String, dynamic> body) async {
    Uri buildUri(String base) {
      final clean = base.replaceAll(RegExp(r'/+$'), '');
      return Uri.parse('$clean$path');
    }

    try {
      return await http.post(
        buildUri(baseUrl),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(body),
      ).timeout(const Duration(seconds: 5));
    } catch (e) {
      debugPrint('POST $path failed on $baseUrl: $e');
      if (baseUrl != 'http://127.0.0.1:3000') {
        try {
          final fallback = await http.post(
            buildUri('http://127.0.0.1:3000'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode(body),
          ).timeout(const Duration(seconds: 5));
          if (fallback.statusCode >= 200 && fallback.statusCode < 300) {
            setBaseUrl('http://127.0.0.1:3000');
            return fallback;
          }
        } catch (_) {}
      }
      return null;
    }
  }

  // 1. Platform Statistics
  static Future<Map<String, dynamic>> getStats() async {
    try {
      final res = await _safeGet('/api/stats');
      if (res != null && res.statusCode == 200) {
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
      final res = await _safeGet('/api/jobs', query: {
        if (skill != null && skill.isNotEmpty) 'skill': skill,
        if (location != null && location.isNotEmpty) 'location': location,
      });
      if (res != null && res.statusCode == 200) {
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
      final res = await _safePost('/api/jobs', {
        'employer_name': employerName,
        'employer_phone': employerPhone,
        'skill_needed': skillNeeded,
        'location': location,
        'wage_offered': wageOffered,
        'date_needed': dateNeeded,
      });

      if (res != null && res.statusCode == 201) {
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
      final res = await _safeGet('/api/jobs/$jobId/matches');
      if (res != null && res.statusCode == 200) {
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
      final res = await _safePost('/api/workers/register', {
        'name': name,
        'phone_number': phoneNumber,
        'skill_type': skillType,
        'location': location,
        'available': available,
      });

      if (res != null && res.statusCode == 200) {
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
      final res = await _safeGet('/api/workers/$phone');
      if (res != null && res.statusCode == 200) {
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
      final res = await _safePost('/api/workers/interest', {
        'worker_id': workerId,
        'job_id': jobId,
      });
      return res != null && res.statusCode == 200;
    } catch (e) {
      debugPrint('Error expressing interest: $e');
      return false;
    }
  }

  // 8. Toggle Worker Availability
  static Future<Worker?> toggleAvailability(String phone, bool available) async {
    try {
      final res = await _safePost('/api/workers/toggle-availability', {
        'phone': phone,
        'available': available,
      });

      if (res != null && res.statusCode == 200) {
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
      final res = await _safeGet('/api/employers/$phone/jobs');
      if (res != null && res.statusCode == 200) {
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
      final res = await _safePost('/api/employers/confirm-worker', {
        'job_id': jobId,
        'worker_id': workerId,
      });
      return res != null && res.statusCode == 200;
    } catch (e) {
      debugPrint('Error confirming worker: $e');
      return false;
    }
  }

  // 11. Complete a Job (Frees up labourer)
  static Future<bool> completeJob(int jobId) async {
    try {
      final res = await _safePost('/api/jobs/$jobId/complete', {});
      return res != null && res.statusCode == 200;
    } catch (e) {
      debugPrint('Error completing job: $e');
      return false;
    }
  }

  // 12. Cancel a Job (Frees up labourer)
  static Future<bool> cancelJob(int jobId) async {
    try {
      final res = await _safePost('/api/jobs/$jobId/cancel', {});
      return res != null && res.statusCode == 200;
    } catch (e) {
      debugPrint('Error cancelling job: $e');
      return false;
    }
  }
}
