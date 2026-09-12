class Worker {
  final int id;
  final String name;
  final String phoneNumber;
  final String skillType;
  final String location;
  final bool available;
  final String? registeredAt;

  Worker({
    required this.id,
    required this.name,
    required this.phoneNumber,
    required this.skillType,
    required this.location,
    required this.available,
    this.registeredAt,
  });

  factory Worker.fromJson(Map<String, dynamic> json) {
    return Worker(
      id: json['id'] is int ? json['id'] : int.parse(json['id'].toString()),
      name: json['name'] ?? '',
      phoneNumber: json['phone_number'] ?? '',
      skillType: json['skill_type'] ?? '',
      location: json['location'] ?? '',
      available: json['available'] == 1 || json['available'] == true,
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
    };
  }
}
