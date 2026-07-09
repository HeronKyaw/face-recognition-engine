import 'package:flutter/material.dart';
import 'package:camera/camera.dart';
import '../services/api_service.dart';

const _livenessFrameCount = 10;
const _livenessFrameDelay = Duration(milliseconds: 200);

class VerifyPage extends StatefulWidget {
  const VerifyPage({super.key});

  @override
  State<VerifyPage> createState() => _VerifyPageState();
}

class _VerifyPageState extends State<VerifyPage>
    with SingleTickerProviderStateMixin {
  final _api = ApiService();
  CameraController? _controller;
  late AnimationController _pulseController;
  late Animation<double> _pulseAnimation;
  bool _isInitialized = false;
  bool _isVerifying = false;
  bool _isCapturing = false;
  int _captureProgress = 0;
  Map<String, dynamic>? _result;
  String? _selectedMethod;
  bool _cameraActive = false;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat(reverse: true);
    _pulseAnimation = Tween<double>(begin: 1.0, end: 1.08).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );
  }

  Future<void> _initCamera() async {
    final cameras = await availableCameras();
    if (cameras.isEmpty) return;
    final front = cameras.firstWhere(
      (c) => c.lensDirection == CameraLensDirection.front,
      orElse: () => cameras.first,
    );
    _controller = CameraController(front, ResolutionPreset.medium);
    await _controller!.initialize();
    if (mounted) setState(() => _isInitialized = true);
  }

  Future<void> _startCamera() async {
    await _initCamera();
    if (mounted) {
      setState(() => _cameraActive = true);
    }
  }

  void _stopCamera() {
    _controller?.dispose();
    _controller = null;
    if (mounted) {
      setState(() {
        _isInitialized = false;
        _cameraActive = false;
      });
    }
  }

  Future<void> _verify() async {
    if (_controller == null || !_isInitialized || _isVerifying) return;
    setState(() { _isVerifying = true; _result = null; });

    try {
      final faceImage = await _controller!.takePicture();

      final livenessFrames = <XFile>[];
      setState(() { _isCapturing = true; _captureProgress = 0; });

      for (int i = 0; i < _livenessFrameCount; i++) {
        await Future.delayed(_livenessFrameDelay);
        final frame = await _controller!.takePicture();
        livenessFrames.add(frame);
        if (mounted) setState(() { _captureProgress = i + 1; });
      }

      setState(() { _isCapturing = false; });

      final result = await _api.verify(
        faceImage,
        livenessFrames: livenessFrames,
        method: _selectedMethod ?? 'frame_burst',
      );
      if (mounted) {
        final success = result['success'] as bool? ?? false;
        setState(() { _result = result; _isVerifying = false; });
        if (success) _stopCamera();
      }
    } catch (e) {
      if (mounted) { setState(() {
        _result = {'success': false, 'message': '$e'};
        _isVerifying = false;
        _isCapturing = false;
      }); }
    }
  }

  void _resetAndRestart() {
    setState(() { _result = null; });
    _startCamera();
  }

  @override
  void dispose() {
    _pulseController.dispose();
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final success = _result?['success'] as bool?;
    final matchedUserId = _result?['user_id'] as String?;
    final matchedName = _result?['name'] as String?;
    final distance = _result?['distance'] as num?;
    final message = _result?['message'] as String?;
    final liveness = _result?['liveness'] as Map<String, dynamic>?;

    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: Colors.black26,
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.arrow_back, color: Colors.white, size: 20),
          ),
          onPressed: () => Navigator.pop(context),
        ),
        title: const Text('Verify Face',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
        centerTitle: true,
      ),
      body: Stack(
        children: [
          if (_cameraActive && _isInitialized)
            CameraPreview(_controller!)
          else if (_cameraActive)
            Container(color: Colors.black, child: const Center(child: CircularProgressIndicator(color: Colors.white)))
          else
            _buildModeSelection(),

          if (_cameraActive && _result == null)
            Center(
              child: Container(
                width: 260,
                height: 320,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(130),
                  border: Border.all(color: Colors.white.withValues(alpha: 0.5), width: 2),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.15),
                      blurRadius: 40,
                      spreadRadius: 10,
                    ),
                  ],
                ),
              ),
            ),

          if (_cameraActive && _result == null)
            Positioned(
              top: MediaQuery.of(context).padding.top + 100,
              left: 0,
              right: 0,
              child: Text(
                _isCapturing
                  ? 'Hold still...'
                  : 'Look at the camera and blink naturally',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.9),
                  fontSize: 16,
                  fontWeight: FontWeight.w500,
                  shadows: [Shadow(color: Colors.black.withValues(alpha: 0.4), blurRadius: 8)],
                ),
              ),
            ),

          if (_isCapturing)
            Positioned(
              top: MediaQuery.of(context).padding.top + 130,
              left: 40,
              right: 40,
              child: Column(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value: _captureProgress / _livenessFrameCount,
                      backgroundColor: Colors.white24,
                      valueColor: const AlwaysStoppedAnimation<Color>(Colors.white),
                      minHeight: 6,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    '$_captureProgress/$_livenessFrameCount',
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.7),
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),

          if (_result != null)
            Positioned(
              top: MediaQuery.of(context).padding.top + 80,
              left: 20,
              right: 20,
              child: Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: success == true ? Colors.green.shade600 : Colors.red.shade600,
                  borderRadius: BorderRadius.circular(20),
                  boxShadow: [
                    BoxShadow(
                      color: (success == true ? Colors.green : Colors.red).withValues(alpha: 0.3),
                      blurRadius: 20,
                      offset: const Offset(0, 4),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(
                          success == true ? Icons.check_circle_rounded : Icons.error_rounded,
                          color: Colors.white,
                          size: 22,
                        ),
                        const SizedBox(width: 10),
                        Text(
                          success == true ? 'Match Found' : 'No Match',
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w600,
                            fontSize: 16,
                          ),
                        ),
                      ],
                    ),
                    if (matchedName != null) ...[
                      const SizedBox(height: 6),
                      Text('$matchedName ($matchedUserId)',
                        style: TextStyle(color: Colors.white.withValues(alpha: 0.9), fontSize: 14)),
                    ],
                    if (distance != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text('Confidence: ${(distance as double).toStringAsFixed(4)}',
                          style: TextStyle(color: Colors.white.withValues(alpha: 0.7), fontSize: 13)),
                      ),
                    if (liveness != null) ...[
                      const SizedBox(height: 8),
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Icon(
                                  liveness['passed'] == true ? Icons.check_circle : Icons.cancel,
                                  size: 14,
                                  color: Colors.white,
                                ),
                                const SizedBox(width: 6),
                                Text(
                                  liveness['passed'] == true ? 'Liveness: Passed' : 'Liveness: Failed',
                                  style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w500),
                                ),
                              ],
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'Blur: ${((liveness['blur_score'] as num) * 100).toInt()}%  |  '
                              'Color: ${((liveness['color_score'] as num) * 100).toInt()}%  |  '
                              'Blink: ${liveness['blink_detected'] == true ? 'Yes' : 'No'}',
                              style: TextStyle(color: Colors.white.withValues(alpha: 0.7), fontSize: 11),
                            ),
                          ],
                        ),
                      ),
                    ],
                    if (message != null && matchedUserId == null)
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text(message,
                          style: TextStyle(color: Colors.white.withValues(alpha: 0.9), fontSize: 14)),
                      ),
                  ],
                ),
              ),
            ),

          Positioned(
            left: 0,
            right: 0,
            bottom: MediaQuery.of(context).padding.bottom + 20,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (_result != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: TextButton.icon(
                      onPressed: _resetAndRestart,
                      icon: const Icon(Icons.refresh, color: Colors.white, size: 18),
                      label: const Text('Capture Again',
                        style: TextStyle(color: Colors.white)),
                    ),
                  ),
                if (_cameraActive && _result == null)
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      AnimatedBuilder(
                        animation: _pulseAnimation,
                        builder: (context, child) => Transform.scale(
                          scale: (_isVerifying || _isCapturing) ? 1.0 : _pulseAnimation.value,
                          child: child,
                        ),
                        child: GestureDetector(
                          onTap: (_isVerifying || _isCapturing) ? null : _verify,
                          child: Container(
                            width: 72,
                            height: 72,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: (_isVerifying || _isCapturing) ? Colors.grey.shade400 : Colors.white,
                              boxShadow: [
                                BoxShadow(
                                  color: Colors.black.withValues(alpha: 0.25),
                                  blurRadius: 16,
                                  offset: const Offset(0, 4),
                                ),
                              ],
                            ),
                            child: _isVerifying || _isCapturing
                              ? const CircularProgressIndicator(strokeWidth: 3, color: Colors.white)
                              : const Icon(Icons.camera_alt_rounded, color: Colors.black87, size: 30),
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _isCapturing
                          ? 'Capturing $_captureProgress/$_livenessFrameCount...'
                          : _isVerifying
                            ? 'Verifying...'
                            : 'Tap to capture',
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.8),
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                          shadows: [Shadow(color: Colors.black.withValues(alpha: 0.3), blurRadius: 4)],
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextButton.icon(
                        onPressed: _stopCamera,
                        icon: const Icon(Icons.videocam_off, color: Colors.white, size: 18),
                        label: const Text('Stop Camera',
                          style: TextStyle(color: Colors.white)),
                      ),
                    ],
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildModeSelection() {
    return Container(
      color: Colors.black,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Select Liveness Method',
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.9),
                  fontSize: 22,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 32),
              _ModeCard(
                icon: Icons.burst_mode,
                title: 'Frame Burst',
                description: 'Captures a burst of frames to detect blinks and passive liveness',
                isSelected: _selectedMethod == 'frame_burst',
                onTap: () => setState(() => _selectedMethod = 'frame_burst'),
              ),
              const SizedBox(height: 12),
              _ModeCard(
                icon: Icons.assignment,
                title: 'Challenge',
                description: 'Performs a sequence of actions (blink, turn head, etc.) for liveness verification',
                isSelected: _selectedMethod == 'challenge',
                onTap: () => setState(() => _selectedMethod = 'challenge'),
              ),
              const SizedBox(height: 32),
              FilledButton.icon(
                onPressed: _selectedMethod != null ? _startCamera : null,
                icon: const Icon(Icons.videocam, size: 20),
                label: const Text('Start Camera'),
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ModeCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String description;
  final bool isSelected;
  final VoidCallback onTap;

  const _ModeCard({
    required this.icon,
    required this.title,
    required this.description,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: isSelected ? Colors.white.withValues(alpha: 0.15) : Colors.white.withValues(alpha: 0.05),
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: isSelected
              ? Border.all(color: Colors.white.withValues(alpha: 0.5))
              : null,
          ),
          child: Row(
            children: [
              Icon(icon, color: Colors.white, size: 28),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(description,
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.6),
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              if (isSelected)
                Icon(Icons.check_circle, color: Colors.green.shade300, size: 22),
            ],
          ),
        ),
      ),
    );
  }
}
