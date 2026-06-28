class VerificationLog {
  final int id;
  final String? userId;
  final String? deviceId;
  final double? distance;
  final DateTime createdAt;

  VerificationLog({
    required this.id,
    this.userId,
    this.deviceId,
    this.distance,
    required this.createdAt,
  });

  factory VerificationLog.fromJson(Map<String, dynamic> json) {
    return VerificationLog(
      id: json['id'] as int,
      userId: json['user_id'] as String?,
      deviceId: json['device_id'] as String?,
      distance: (json['distance'] as num?)?.toDouble(),
      createdAt: DateTime.parse(json['created_at'] as String),
    );
  }
}
