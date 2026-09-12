class Worker {
  final int id;
  final String name;
  final String phoneNumber;
  final String skillType;
  final String location;
  final bool available;
  final String status;
  final int? currentActiveJobId;
  final String? currentLocationZone;
  final bool isHiredByOther;
  final String? registeredAt;

  Worker({
    required this.id,
    required this.name,
    required this.phoneNumber,
    required this.skillType,
    required this.location,
    required this.available,
    this.status = 'AVAILABLE',
    this.currentActiveJobId,
    this.currentLocationZone,
    this.isHiredByOther = false,
    this.registeredAt,
  });

  factory Worker.fromJson(Map<String, dynamic> json) {
    final statusStr = json['status']?.toString() ?? (json['available'] == 0 ? 'HIRED' : 'AVAILABLE');
    final isHired = json['is_hired_by_other'] == 1 ||
                    json['is_hired_by_other'] == true ||
                    statusStr == 'HIRED' ||
                    json['current_active_job_id'] != null;

    return Worker(
      id: json['id'] is int ? json['id'] : int.parse(json['id'].toString()),
      name: json['name'] ?? '',
      phoneNumber: json['phone_number'] ?? '',
      skillType: json['skill_type'] ?? '',
      location: json['location'] ?? '',
      available: (json['available'] == 1 || json['available'] == true) && !isHired,
      status: statusStr,
      currentActiveJobId: json['current_active_job_id'] != null
          ? int.tryParse(json['current_active_job_id'].toString())
          : null,
      currentLocationZone: json['current_location_zone'] ?? json['active_zone'],
      isHiredByOther: isHired,
      registeredAt: json['registered_at'],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'phone_number': phoneNumber,
      'skill_type': skillType,
      'location': location,
      'available': available ? 1 : 0,
      'status': status,
      'current_active_job_id': currentActiveJobId,
      'current_location_zone': currentLocationZone,
    };
  }
}
