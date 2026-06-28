class User {
  final String userId;
  final String name;
  final String? metadata;
  final bool faceEnrolled;
  final DateTime createdAt;

  User({
    required this.userId,
    required this.name,
    this.metadata,
    required this.faceEnrolled,
    required this.createdAt,
  });

  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      userId: json['user_id'] as String,
      name: json['name'] as String,
      metadata: json['metadata'] as String?,
      faceEnrolled: json['face_enrolled'] as bool,
      createdAt: DateTime.parse(json['created_at'] as String),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'user_id': userId,
      'name': name,
      'metadata': metadata,
      'face_enrolled': faceEnrolled,
      'created_at': createdAt.toIso8601String(),
    };
  }
}
