import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../models/worker.dart';
import '../models/job.dart';
import '../models/worker_cv.dart';

class ApiService {
  static const Duration requestTimeout = Duration(seconds: 4);
  static String? lastErrorMessage;

  // Candidate URLs for auto-discovery across all platforms & network setups
  static List<String> get candidateUrls => [
    'http://127.0.0.1:3000',
    'http://localhost:3000',
    'http://192.168.0.196:3000',
    'http://10.0.2.2:3000',
  ];

  static String get defaultBaseUrl {
    if (kIsWeb) {
      return 'http://localhost:3000';
    }
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return 'http://127.0.0.1:3000'; // Default to 127.0.0.1 (ADB reverse) with fast auto-fallback to Wi-Fi LAN
      default:
        return 'http://127.0.0.1:3000';
    }
  }

  static String baseUrl = defaultBaseUrl;

  static Future<void> init() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final savedUrl = prefs.getString('api_base_url');
      if (savedUrl != null) {
        final clean = savedUrl.trim().replaceAll(RegExp(r'/+$'), '');
        // Clear dead or unverified saved URLs
        if (clean.isNotEmpty) {
          final ok = await testConnection(clean);
          if (ok) {
            baseUrl = clean;
            return;
          }
        }
        await prefs.remove('api_base_url');
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

  // Safe HTTP GET with auto-retry and auto-recovery across all candidate URLs
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

    // Try primary baseUrl with 1 immediate retry
    for (int attempt = 0; attempt < 2; attempt++) {
      try {
        return await http.get(buildUri(baseUrl)).timeout(const Duration(seconds: 4));
      } catch (e) {
        if (attempt == 0) {
          await Future.delayed(const Duration(milliseconds: 250));
          continue;
        }
      }
    }

    // Auto-scan all candidate URLs if primary baseUrl failed
    for (final fallbackUrl in candidateUrls) {
      if (fallbackUrl == baseUrl) continue;
      try {
        final fallback = await http.get(buildUri(fallbackUrl)).timeout(const Duration(seconds: 2));
        if (fallback.statusCode == 200) {
          setBaseUrl(fallbackUrl);
          return fallback;
        }
      } catch (_) {}
    }
    return null;
  }

  // Safe HTTP POST with auto-retry and auto-recovery across all candidate URLs
  static Future<http.Response?> _safePost(String path, Map<String, dynamic> body) async {
    Uri buildUri(String base) {
      final clean = base.replaceAll(RegExp(r'/+$'), '');
      return Uri.parse('$clean$path');
    }

    for (int attempt = 0; attempt < 2; attempt++) {
      try {
        return await http.post(
          buildUri(baseUrl),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode(body),
        ).timeout(const Duration(seconds: 4));
      } catch (e) {
        if (attempt == 0) {
          await Future.delayed(const Duration(milliseconds: 250));
          continue;
        }
      }
    }

    // Auto-scan all candidate URLs if primary baseUrl failed
    for (final fallbackUrl in candidateUrls) {
      if (fallbackUrl == baseUrl) continue;
      try {
        final fallback = await http.post(
          buildUri(fallbackUrl),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode(body),
        ).timeout(const Duration(seconds: 3));
        if (fallback.statusCode >= 200 && fallback.statusCode < 300) {
          setBaseUrl(fallbackUrl);
          return fallback;
        }
      } catch (_) {}
    }
    return null;
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

  // 2. Open Jobs Feed (authenticated/internal)
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

  // 2a. Public Jobs Feed — masked data, no auth required
  static Future<List<Job>> getPublicJobs({
    String? skill,
    String? location,
    int? minWage,
    int? maxWage,
  }) async {
    try {
      final uri =
          Uri.parse('$baseUrl/api/public/jobs').replace(queryParameters: {
        if (skill != null && skill.isNotEmpty) 'skill': skill,
        if (location != null && location.isNotEmpty) 'location': location,
        if (minWage != null) 'minWage': '$minWage',
        if (maxWage != null) 'maxWage': '$maxWage',
      });

      final res = await http.get(uri);
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final list = data['jobs'] as List? ?? [];
        return list.map((j) => Job.fromJson(j)).toList();
      }
      return [];
    } catch (e) {
      debugPrint('Error getting public jobs: $e');
      return [];
    }
  }

  // 2b. Public Workers Feed — masked data, no auth required
  static Future<List<Map<String, dynamic>>> getPublicWorkers({
    String? skill,
    String? location,
    bool availableOnly = true,
  }) async {
    try {
      final uri =
          Uri.parse('$baseUrl/api/public/workers').replace(queryParameters: {
        if (skill != null && skill.isNotEmpty) 'skill': skill,
        if (location != null && location.isNotEmpty) 'location': location,
        'availableOnly': availableOnly ? 'true' : 'false',
      });

      final res = await http.get(uri);
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        return List<Map<String, dynamic>>.from(data['workers'] ?? []);
      }
      return [];
    } catch (e) {
      debugPrint('Error getting public workers: $e');
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
      lastErrorMessage = null;
      final res = await _safePost('/api/jobs', {
        'employer_name': employerName,
        'employer_phone': employerPhone,
        'skill_needed': skillNeeded,
        'location': location,
        'wage_offered': wageOffered,
        'date_needed': dateNeeded,
      });

      if (res != null) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          final data = jsonDecode(res.body);
          return Job.fromJson(data['job']);
        } else {
          try {
            final data = jsonDecode(res.body);
            lastErrorMessage = data['message'] ?? data['error'] ?? 'Failed to post job (${res.statusCode})';
          } catch (_) {
            lastErrorMessage = 'Failed to post job (${res.statusCode})';
          }
        }
      } else {
        lastErrorMessage = 'Cannot connect to server at $baseUrl. Please ensure the backend is running.';
      }
      return null;
    } catch (e) {
      debugPrint('Error posting job: $e');
      lastErrorMessage = 'Error posting job: $e';
      return null;
    }
  }

  // 4. Instant Matches for a Job
  static Future<Map<String, dynamic>?> getJobMatches(int jobId) async {
    try {
      final res = await _safeGet('/api/jobs/$jobId/matches');
      if (res != null && (res.statusCode >= 200 && res.statusCode < 300)) {
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
      lastErrorMessage = null;
      final res = await _safePost('/api/workers/register', {
        'name': name,
        'phone_number': phoneNumber,
        'skill_type': skillType,
        'location': location,
        'available': available,
      });

      if (res != null) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          final data = jsonDecode(res.body);
          return Worker.fromJson(data['worker']);
        } else {
          try {
            final data = jsonDecode(res.body);
            lastErrorMessage = data['message'] ?? data['error'] ?? 'Registration failed with code ${res.statusCode}';
          } catch (_) {
            lastErrorMessage = 'Registration failed with code ${res.statusCode}';
          }
        }
      } else {
        lastErrorMessage = 'Cannot connect to server at $baseUrl. Please ensure the backend is running.';
      }
      return null;
    } catch (e) {
      debugPrint('Error registering worker: $e');
      lastErrorMessage = 'Error registering worker: $e';
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

  static Future<Worker?> toggleWorkerAvailability(String phone, bool available) =>
      toggleAvailability(phone, available);

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

  // 10b. Reject / Pass a Worker for a Specific Job
  static Future<bool> rejectWorker(int jobId, int workerId, {String? reason, String? employerPhone}) async {
    try {
      final Map<String, dynamic> payload = {
        'job_id': jobId,
        'worker_id': workerId,
        'reason': reason ?? '',
      };
      if (employerPhone != null && employerPhone.isNotEmpty) {
        payload['employer_phone'] = employerPhone;
      }
      final res = await _safePost('/api/employers/reject-worker', payload);
      return res != null && (res.statusCode == 200 || res.statusCode == 201);
    } catch (e) {
      debugPrint('Error rejecting worker: $e');
      return false;
    }
  }

  // 10c. Undo Rejection (Optional)
  static Future<bool> unrejectWorker(int jobId, int workerId) async {
    try {
      final res = await _safePost('/api/employers/unreject-worker', {
        'job_id': jobId,
        'worker_id': workerId,
      });
      return res != null && res.statusCode == 200;
    } catch (e) {
      debugPrint('Error unrejecting worker: $e');
      return false;
    }
  }

  // 11. Complete a Job (Frees up labourer and returns assigned worker info)
  static Future<Map<String, dynamic>?> completeJob(int jobId) async {
    try {
      final res = await _safePost('/api/jobs/$jobId/complete', {});
      if (res != null && res.statusCode == 200) {
        return jsonDecode(res.body) as Map<String, dynamic>;
      }
      return null;
    } catch (e) {
      debugPrint('Error completing job: $e');
      return null;
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

  // 13. Get Worker CV (Structured Form Data)
  static Future<WorkerCv?> getWorkerCv(int workerId, {String? phone}) async {
    try {
      final path = workerId > 0 ? '/api/workers/$workerId/cv' : (phone != null ? '/api/workers/$phone/cv' : '/api/workers/$workerId/cv');
      final res = await _safeGet(path);
      if (res != null && res.statusCode == 200) {
        final data = jsonDecode(res.body);
        if (data['has_cv'] == true && data['cv'] != null) {
          return WorkerCv.fromJson(data['cv']);
        }
      }
      return null;
    } catch (e) {
      debugPrint('Error getting worker CV: $e');
      return null;
    }
  }

  // 14. Save Worker CV
  static Future<bool> saveWorkerCv(int workerId, Map<String, dynamic> cvData) async {
    try {
      lastErrorMessage = null;
      final path = workerId > 0 ? '/api/workers/$workerId/cv' : '/api/workers/cv';
      final res = await _safePost(path, cvData);
      if (res != null) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          return true;
        } else {
          try {
            final data = jsonDecode(res.body);
            lastErrorMessage = data['message'] ?? data['error'] ?? 'Error saving CV (HTTP ${res.statusCode})';
          } catch (_) {
            lastErrorMessage = 'Error saving CV (HTTP ${res.statusCode})';
          }
        }
      } else {
        lastErrorMessage = 'Cannot reach backend at $baseUrl. Please verify server connection.';
      }
      return false;
    } catch (e) {
      debugPrint('Error saving worker CV: $e');
      lastErrorMessage = 'Error saving worker CV: $e';
      return false;
    }
  }

  // 15. Submit Worker Rating (1–5 Stars)
  static Future<Map<String, dynamic>> rateWorker({
    required int workerId,
    required int jobId,
    required String employerPhone,
    required double rating,
    String? comment,
  }) async {
    try {
      final res = await _safePost('/api/workers/$workerId/ratings', {
        'job_id': jobId,
        'employer_phone': employerPhone,
        'rating': rating,
        'comment': comment ?? '',
      });
      if (res != null) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        return {
          'success': res.statusCode == 200,
          'status': res.statusCode,
          ...data,
        };
      }
      return {'success': false, 'error': 'No response from server'};
    } catch (e) {
      debugPrint('Error rating worker: $e');
      return {'success': false, 'error': e.toString()};
    }
  }

  // 16. Get Worker Ratings & Reviews
  static Future<Map<String, dynamic>?> getWorkerRatings(int workerId) async {
    try {
      final res = await _safeGet('/api/workers/$workerId/ratings');
      if (res != null && res.statusCode == 200) {
        return jsonDecode(res.body) as Map<String, dynamic>;
      }
      return null;
    } catch (e) {
      debugPrint('Error fetching worker ratings: $e');
      return null;
    }
  }

  // 17. Check if Job is already rated
  static Future<bool> isJobRated(int jobId, {int? workerId}) async {
    try {
      var query = <String, String>{};
      if (workerId != null) query['worker_id'] = '$workerId';
      final res = await _safeGet('/api/jobs/$jobId/rating', query: query);
      if (res != null && res.statusCode == 200) {
        final data = jsonDecode(res.body);
        return data['is_rated'] == true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // 18. Voice AI Agent Backend Automation Tools
  static Future<Map<String, dynamic>> executeVoiceTool(
    String toolName,
    Map<String, dynamic> params,
  ) async {
    try {
      final res = await _safePost('/api/voice/tools/$toolName', params);
      if (res != null && res.statusCode == 200) {
        return jsonDecode(res.body) as Map<String, dynamic>;
      }
      return {};
    } catch (e) {
      debugPrint('Error executing voice tool $toolName: $e');
      return {};
    }
  }

  // 19. Get ElevenLabs Signed WebSocket URL (authenticated via backend)
  static Future<String?> getElevenLabsSignedUrl() async {
    try {
      final res = await _safeGet('/api/voice/signed-url');
      if (res != null && res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        return data['signed_url'] as String?;
      }
      return null;
    } catch (e) {
      debugPrint('Error fetching ElevenLabs signed URL: $e');
      return null;
    }
  }

  // 20. Get ElevenLabs API key from backend (for mobile WebSocket auth)
  static Future<String?> getElevenLabsApiKey() async {
    try {
      final res = await _safeGet('/api/voice/config');
      if (res != null && res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        return data['api_key'] as String?;
      }
      return null;
    } catch (e) {
      debugPrint('Error fetching ElevenLabs config: $e');
      return null;
    }
  }

  // 21. Get TTS Audio URL & Bytes for voice speech playback
  static String getTtsUrl(String text) {
    return '$baseUrl/api/voice/tts?text=${Uri.encodeComponent(text)}';
  }

  static Future<Uint8List?> fetchTtsAudio(String text) async {
    try {
      final uri = Uri.parse(getTtsUrl(text));
      final res = await http.get(uri).timeout(const Duration(seconds: 6));
      if (res.statusCode == 200 && res.bodyBytes.isNotEmpty) {
        return res.bodyBytes;
      }
      return null;
    } catch (e) {
      debugPrint('[ApiService] fetchTtsAudio error: $e');
      return null;
    }
  }

  // 22. Get Voice Job Categories from DB
  static Future<List<Map<String, dynamic>>> getVoiceCategories() async {
    try {
      final res = await _safeGet('/api/voice/categories');
      if (res != null && res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        final list = data['categories'] as List?;
        if (list != null && list.isNotEmpty) {
          return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
        }
      }
    } catch (e) {
      debugPrint('[ApiService] getVoiceCategories error: $e');
    }
    // Reliable fallback categories matching database
    return [
      {'digit': '1', 'category_name': 'Construction', 'hiring_agency_name': 'LabourLink Construction Desk', 'hiring_agency_phone': '+91 98765 43211'},
      {'digit': '2', 'category_name': 'Plumbing', 'hiring_agency_name': 'LabourLink Plumbing Desk', 'hiring_agency_phone': '+91 98450 22002'},
      {'digit': '3', 'category_name': 'Painting', 'hiring_agency_name': 'LabourLink Painting Desk', 'hiring_agency_phone': '+91 98450 33003'},
      {'digit': '4', 'category_name': 'Electrician', 'hiring_agency_name': 'LabourLink Electrical Desk', 'hiring_agency_phone': '+91 98450 44004'},
      {'digit': '5', 'category_name': 'Driving', 'hiring_agency_name': 'City Drivers & Logistics', 'hiring_agency_phone': '+91 97000 11122'},
      {'digit': '6', 'category_name': 'Housekeeping', 'hiring_agency_name': 'LabourLink Cleaning & Care', 'hiring_agency_phone': '+91 98450 55005'},
      {'digit': '7', 'category_name': 'Security', 'hiring_agency_name': 'LabourLink Guard Security', 'hiring_agency_phone': '+91 98450 66006'},
      {'digit': '8', 'category_name': 'Warehouse / Helper', 'hiring_agency_name': 'LabourLink Warehouse Desk', 'hiring_agency_phone': '+91 98450 77007'},
    ];
  }
}

