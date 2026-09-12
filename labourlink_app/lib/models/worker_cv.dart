class PreviousWork {
  final String company;
  final String duration;
  final String role;

  PreviousWork({
    required this.company,
    required this.duration,
    required this.role,
  });

  factory PreviousWork.fromJson(Map<String, dynamic> json) {
    return PreviousWork(
      company: json['company']?.toString() ?? '',
      duration: json['duration']?.toString() ?? '',
      role: json['role']?.toString() ?? '',
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'company': company,
      'duration': duration,
      'role': role,
    };
  }
}

class WorkerCv {
  final int? id;
  final int workerId;
  final String fullName;
  final String dobOrAge;
  final String phoneNumber;
  final List<String> skills;
  final int yearsOfExperience;
  final List<PreviousWork> previousWork;
  final String workLocation;
  final String dailyWageExpectation;
  final String availabilityType;
  final String languages;
  final String aboutMe;
  final String? updatedAt;

  WorkerCv({
    this.id,
    required this.workerId,
    required this.fullName,
    this.dobOrAge = '',
    this.phoneNumber = '',
    this.skills = const [],
    this.yearsOfExperience = 0,
    this.previousWork = const [],
    this.workLocation = '',
    this.dailyWageExpectation = '',
    this.availabilityType = 'Full-time',
    this.languages = '',
    this.aboutMe = '',
    this.updatedAt,
  });

  factory WorkerCv.fromJson(Map<String, dynamic> json) {
    List<String> parsedSkills = [];
    if (json['skills'] is List) {
      parsedSkills = (json['skills'] as List).map((e) => e.toString()).toList();
    } else if (json['skills'] is String && json['skills'].toString().isNotEmpty) {
      final str = json['skills'].toString();
      if (str.startsWith('[') && str.endsWith(']')) {
        parsedSkills = str
            .replaceAll(RegExp(r'[\[\]"]'), '')
            .split(',')
            .map((s) => s.trim())
            .where((s) => s.isNotEmpty)
            .toList();
      } else {
        parsedSkills = str.split(',').map((s) => s.trim()).where((s) => s.isNotEmpty).toList();
      }
    }

    List<PreviousWork> parsedWork = [];
    if (json['previous_work'] is List) {
      parsedWork = (json['previous_work'] as List)
          .map((item) => item is Map<String, dynamic>
              ? PreviousWork.fromJson(item)
              : PreviousWork(company: item.toString(), duration: '', role: ''))
          .toList();
    }

    return WorkerCv(
      id: json['id'] is int ? json['id'] : int.tryParse(json['id']?.toString() ?? ''),
      workerId: json['worker_id'] is int
          ? json['worker_id']
          : int.tryParse(json['worker_id']?.toString() ?? '0') ?? 0,
      fullName: json['full_name']?.toString() ?? '',
      dobOrAge: json['dob_or_age']?.toString() ?? '',
      phoneNumber: json['phone_number']?.toString() ?? '',
      skills: parsedSkills,
      yearsOfExperience: json['years_of_experience'] is int
          ? json['years_of_experience']
          : int.tryParse(json['years_of_experience']?.toString() ?? '0') ?? 0,
      previousWork: parsedWork,
      workLocation: json['work_location']?.toString() ?? '',
      dailyWageExpectation: json['daily_wage_expectation']?.toString() ?? '',
      availabilityType: json['availability_type']?.toString() ?? 'Full-time',
      languages: json['languages']?.toString() ?? '',
      aboutMe: json['about_me']?.toString() ?? '',
      updatedAt: json['updated_at']?.toString(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      if (id != null) 'id': id,
      'worker_id': workerId,
      'full_name': fullName,
      'dob_or_age': dobOrAge,
      'phone_number': phoneNumber,
      'skills': skills,
      'years_of_experience': yearsOfExperience,
      'previous_work': previousWork.map((w) => w.toJson()).toList(),
      'work_location': workLocation,
      'daily_wage_expectation': dailyWageExpectation,
      'availability_type': availabilityType,
      'languages': languages,
      'about_me': aboutMe,
    };
  }
}
