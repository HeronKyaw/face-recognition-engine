import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';
import '../models/user.dart';
import '../models/verification_log.dart';

class ApiService {
  static final ApiService _instance = ApiService._internal();
  factory ApiService() => _instance;
  ApiService._internal();

  static String? overrideBaseUrl;

  String get baseUrl {
    if (overrideBaseUrl != null) return overrideBaseUrl!;
    if (Platform.isAndroid) return 'http://10.0.2.2:5050';
    return 'http://localhost:5050';
  }

  Future<List<User>> listUsers({int page = 1, int pageSize = 100}) async {
    final uri = Uri.parse('$baseUrl/api/v1/users?page=$page&page_size=$pageSize');
    final response = await http.get(uri, headers: _jsonHeaders);
    _checkResponse(response);
    final data = jsonDecode(response.body) as Map<String, dynamic>;
    return (data['users'] as List).map((u) => User.fromJson(u as Map<String, dynamic>)).toList();
  }

  Future<User> createUser(String userId, String name, {String? metadata}) async {
    final body = <String, dynamic>{'user_id': userId, 'name': name};
    if (metadata != null) body['metadata'] = metadata;
    final response = await http.post(
      Uri.parse('$baseUrl/api/v1/users'),
      headers: _jsonHeaders,
      body: jsonEncode(body),
    );
    _checkResponse(response);
    return User.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<Map<String, dynamic>> enroll(String userId, XFile image) async {
    final request = http.MultipartRequest('POST', Uri.parse('$baseUrl/api/v1/enroll'));
    request.fields['user_id'] = userId;
    request.files.add(await http.MultipartFile.fromPath('face_image', image.path));
    final streamed = await request.send();
    final response = await http.Response.fromStream(streamed);
    _checkResponse(response);
    return jsonDecode(response.body) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> verify(XFile image, {String? deviceId}) async {
    final request = http.MultipartRequest('POST', Uri.parse('$baseUrl/api/v1/verify'));
    request.files.add(await http.MultipartFile.fromPath('face_image', image.path));
    if (deviceId != null) request.fields['device_id'] = deviceId;
    final streamed = await request.send();
    final response = await http.Response.fromStream(streamed);
    _checkResponse(response);
    return jsonDecode(response.body) as Map<String, dynamic>;
  }

  Future<List<VerificationLog>> listLogs({String? userId, int page = 1, int pageSize = 50}) async {
    var uri = '$baseUrl/api/v1/verification-logs?page=$page&page_size=$pageSize';
    if (userId != null) uri += '&user_id=$userId';
    final response = await http.get(Uri.parse(uri), headers: _jsonHeaders);
    _checkResponse(response);
    final data = jsonDecode(response.body) as Map<String, dynamic>;
    return (data['logs'] as List).map((l) => VerificationLog.fromJson(l as Map<String, dynamic>)).toList();
  }

  Map<String, String> get _jsonHeaders => {'Content-Type': 'application/json'};

  void _checkResponse(http.Response response) {
    if (response.statusCode >= 400) {
      throw HttpException('${response.statusCode}: ${response.body} (url: $baseUrl)');
    }
  }
}
