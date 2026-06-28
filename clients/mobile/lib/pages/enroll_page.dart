import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../models/user.dart';
import '../services/api_service.dart';

class EnrollPage extends StatefulWidget {
  final User user;

  const EnrollPage({super.key, required this.user});

  @override
  State<EnrollPage> createState() => _EnrollPageState();
}

class _EnrollPageState extends State<EnrollPage> {
  final _api = ApiService();
  final _picker = ImagePicker();
  XFile? _image;
  bool _isEnrolling = false;
  String? _resultMessage;
  bool? _success;

  Future<void> _pickImage() async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.camera_alt),
              title: const Text('Take Photo'),
              onTap: () => Navigator.pop(ctx, ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library),
              title: const Text('Choose from Gallery'),
              onTap: () => Navigator.pop(ctx, ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source != null) {
      final image = await _picker.pickImage(source: source, maxWidth: 1024);
      if (image != null) setState(() { _image = image; _resultMessage = null; });
    }
  }

  Future<void> _enroll() async {
    if (_image == null) return;
    setState(() { _isEnrolling = true; _resultMessage = null; });
    try {
      final result = await _api.enroll(widget.user.userId, _image!);
      if (mounted) { setState(() {
        _success = result['success'] as bool;
        _resultMessage = result['message'] as String;
        _isEnrolling = false;
      }); }
    } catch (e) {
      if (mounted) { setState(() {
        _success = false;
        _resultMessage = '$e';
        _isEnrolling = false;
      }); }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Enroll Face')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Card(
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: colorScheme.primaryContainer,
                  child: Text(widget.user.name[0].toUpperCase(),
                    style: TextStyle(fontWeight: FontWeight.bold, color: colorScheme.onPrimaryContainer)),
                ),
                title: Text(widget.user.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                subtitle: Text(widget.user.userId),
              ),
            ),
            const SizedBox(height: 20),
            Expanded(
              child: GestureDetector(
                onTap: _pickImage,
                child: Container(
                  width: double.infinity,
                  decoration: BoxDecoration(
                    color: colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: colorScheme.outlineVariant),
                  ),
                  child: _image == null
                    ? Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.add_photo_alternate_outlined, size: 64,
                            color: colorScheme.primary.withValues(alpha: 0.4)),
                          const SizedBox(height: 12),
                          Text('Tap to select a face image',
                            style: theme.textTheme.bodyLarge?.copyWith(
                              color: colorScheme.onSurfaceVariant)),
                        ],
                      )
                    : ClipRRect(
                        borderRadius: BorderRadius.circular(16),
                        child: Image.file(File(_image!.path), fit: BoxFit.cover),
                      ),
                ),
              ),
            ),
            const SizedBox(height: 16),
            if (_resultMessage != null)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                margin: const EdgeInsets.only(bottom: 12),
                decoration: BoxDecoration(
                  color: _success == true
                    ? Colors.green.withValues(alpha: 0.08)
                    : Colors.red.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: _success == true ? Colors.green.shade300 : Colors.red.shade300,
                  ),
                ),
                child: Row(
                  children: [
                    Icon(
                      _success == true ? Icons.check_circle : Icons.error_outline,
                      color: _success == true ? Colors.green.shade700 : Colors.red.shade700,
                      size: 20,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(_resultMessage!,
                        style: TextStyle(color: _success == true ? Colors.green.shade800 : Colors.red.shade800)),
                    ),
                  ],
                ),
              ),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: FilledButton.icon(
                onPressed: _image != null && !_isEnrolling ? _enroll : null,
                icon: _isEnrolling
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.cloud_upload_outlined),
                label: Text(_isEnrolling ? 'Enrolling...' : 'Enroll Face'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
