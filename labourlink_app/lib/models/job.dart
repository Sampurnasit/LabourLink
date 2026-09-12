class Job {
  final int id;
  final String employerName;
  final String employerPhone;
  final String skillNeeded;
  final String location;
  final String wageOffered;
  final String dateNeeded;
  final String status;
  final String? createdAt;
  final String? interestStatus;
  final List<InterestedWorker>? interestedWorkers;

  Job({
    required this.id,
    required this.employerName,
    required this.employerPhone,
    required this.skillNeeded,
    required this.location,
    required this.wageOffered,
    required this.dateNeeded,
    required this.status,
    this.createdAt,
    this.interestStatus,
    this.interestedWorkers,
  });

  factory Job.fromJson(Map<String, dynamic> json) {
    List<InterestedWorker>? applicants;
    if (json['interestedWorkers'] != null && json['interestedWorkers'] is List) {
      applicants = (json['interestedWorkers'] as List)
          .map((item) => InterestedWorker.fromJson(item))
          .toList();
    }

    return Job(
      id: json['id'] is int ? json['id'] : int.parse(json['id'].toString()),
      employerName: json['employer_name'] ?? '',
      employerPhone: json['employer_phone'] ?? '',
      skillNeeded: json['skill_needed'] ?? '',
      location: json['location'] ?? '',
      wageOffered: json['wage_offered'] ?? '',
      dateNeeded: json['date_needed'] ?? '',
      status: json['status'] ?? 'open',
      createdAt: json['created_at'],
      interestStatus: json['interest_status'],
      interestedWorkers: applicants,
    );
  }
}

class InterestedWorker {
  final int workerId;
  final String name;
  final String phoneNumber;
  final String skillType;
  final String location;
  final bool available;
  final String status;

  InterestedWorker({
    required this.workerId,
    required this.name,
    required this.phoneNumber,
    required this.skillType,
    required this.location,
    required this.available,
    required this.status,
  });

  factory InterestedWorker.fromJson(Map<String, dynamic> json) {
    return InterestedWorker(
      workerId: json['worker_id'] is int
          ? json['worker_id']
          : int.parse(json['worker_id'].toString()),
      name: json['name'] ?? '',
      phoneNumber: json['phone_number'] ?? '',
      skillType: json['skill_type'] ?? '',
      location: json['location'] ?? '',
      available: json['available'] == 1 || json['available'] == true,
      status: json['status'] ?? 'interested',
    );
  }
}
