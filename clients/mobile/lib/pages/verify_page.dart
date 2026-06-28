import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../services/api_service.dart';

class VerifyPage extends StatefulWidget {
  const VerifyPage({super.key});

  @override
  State<VerifyPage> createState() => _VerifyPageState();
}

class _VerifyPageState extends State<VerifyPage> {
  final _api = ApiService();
  final _picker = ImagePicker();
  XFile? _image;
  bool _isVerifying = false;
  Map<String, dynamic>? _result;

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
      if (image != null) setState(() { _image = image; _result = null; });
    }
  }

  Future<void> _verify() async {
    if (_image == null) return;
    setState(() { _isVerifying = true; _result = null; });
    try {
      final result = await _api.verify(_image!);
      if (mounted) setState(() { _result = result; _isVerifying = false; });
    } catch (e) {
      if (mounted) { setState(() {
        _result = {'success': false, 'message': '$e'};
        _isVerifying = false;
      }); }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    final success = _result?['success'] as bool?;
    final matchedUserId = _result?['user_id'] as String?;
    final matchedName = _result?['name'] as String?;
    final distance = _result?['distance'] as num?;
    final message = _result?['message'] as String?;

    return Scaffold(
      appBar: AppBar(title: const Text('Verify Face')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
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
            if (_result != null)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                margin: const EdgeInsets.only(bottom: 12),
                decoration: BoxDecoration(
                  color: success == true
                    ? Colors.green.withValues(alpha: 0.08)
                    : Colors.red.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: success == true ? Colors.green.shade300 : Colors.red.shade300,
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(
                          success == true ? Icons.check_circle : Icons.error_outline,
                          color: success == true ? Colors.green.shade700 : Colors.red.shade700,
                          size: 20,
                        ),
                        const SizedBox(width: 10),
                        Text(
                          success == true ? 'Match Found' : 'No Match',
                          style: TextStyle(
                            fontWeight: FontWeight.w600,
                            color: success == true ? Colors.green.shade800 : Colors.red.shade800,
                          ),
                        ),
                      ],
                    ),
                    if (matchedUserId != null) ...[
                      const SizedBox(height: 8),
                      Text('User: $matchedName ($matchedUserId)',
                        style: theme.textTheme.bodyMedium),
                    ],
                    if (distance != null)
                      Text('Confidence: ${(distance as double).toStringAsFixed(4)}',
                        style: theme.textTheme.bodySmall?.copyWith(color: colorScheme.onSurfaceVariant)),
                    if (message != null && matchedUserId == null)
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text(message, style: theme.textTheme.bodyMedium),
                      ),
                  ],
                ),
              ),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: FilledButton.icon(
                onPressed: _image != null && !_isVerifying ? _verify : null,
                icon: _isVerifying
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.search),
                label: Text(_isVerifying ? 'Verifying...' : 'Verify Face'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
