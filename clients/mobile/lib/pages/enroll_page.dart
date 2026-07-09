import 'package:flutter/material.dart';
import 'package:camera/camera.dart';
import '../models/user.dart';
import '../services/api_service.dart';

const _livenessFrameCount = 10;
const _livenessFrameDelay = Duration(milliseconds: 200);

class EnrollPage extends StatefulWidget {
  final User user;

  const EnrollPage({super.key, required this.user});

  @override
  State<EnrollPage> createState() => _EnrollPageState();
}

class _EnrollPageState extends State<EnrollPage>
    with SingleTickerProviderStateMixin {
  final _api = ApiService();
  CameraController? _controller;
  late AnimationController _pulseController;
  late Animation<double> _pulseAnimation;
  bool _isInitialized = false;
  bool _isEnrolling = false;
  bool _isCapturing = false;
  int _captureProgress = 0;
  String? _resultMessage;
  bool? _success;
  Map<String, dynamic>? _liveness;
  String? _selectedMethod;
  bool _cameraActive = false;

  // Challenge-specific state
  String? _challengeId;
  List<dynamic>? _challengeSteps;
  int _currentStepIndex = 0;

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
    if (_selectedMethod == 'challenge') {
      try {
        final challenge = await _api.initChallenge();
        _challengeId = challenge['challenge_id'] as String;
        _challengeSteps = challenge['steps'] as List<dynamic>;
        _currentStepIndex = 0;
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Failed to init challenge: $e'), backgroundColor: Colors.red),
          );
        }
        return;
      }
    }
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

  Future<void> _enroll() async {
    if (_controller == null || !_isInitialized || _isEnrolling) return;
    setState(() { _isEnrolling = true; _resultMessage = null; _liveness = null; });

    try {
      final faceImage = await _controller!.takePicture();

      if (_selectedMethod == 'challenge' && _challengeId != null) {
        // Send face image as the first frame, then complete remaining challenge steps
        final livenessFrames = <XFile>[];
        setState(() { _isCapturing = true; _captureProgress = 0; });

        for (int i = 0; i < _livenessFrameCount; i++) {
          await Future.delayed(_livenessFrameDelay);
          final frame = await _controller!.takePicture();
          livenessFrames.add(frame);
          if (mounted) setState(() { _captureProgress = i + 1; });
        }

        setState(() { _isCapturing = false; });

        final result = await _api.enroll(
          widget.user.userId,
          faceImage,
          livenessFrames: livenessFrames,
          method: 'challenge',
          challengeId: _challengeId,
        );
        if (mounted) {
          final success = result['success'] as bool;
          setState(() {
            _success = success;
            _resultMessage = result['message'] as String;
            _liveness = result['liveness'] as Map<String, dynamic>?;
            _isEnrolling = false;
          });
          if (success) _stopCamera();
        }
      } else {
        final livenessFrames = <XFile>[];
        setState(() { _isCapturing = true; _captureProgress = 0; });

        for (int i = 0; i < _livenessFrameCount; i++) {
          await Future.delayed(_livenessFrameDelay);
          final frame = await _controller!.takePicture();
          livenessFrames.add(frame);
          if (mounted) setState(() { _captureProgress = i + 1; });
        }

        setState(() { _isCapturing = false; });

        final result = await _api.enroll(
          widget.user.userId,
          faceImage,
          livenessFrames: livenessFrames,
          method: 'frame_burst',
        );
        if (mounted) {
          final success = result['success'] as bool;
          setState(() {
            _success = success;
            _resultMessage = result['message'] as String;
            _liveness = result['liveness'] as Map<String, dynamic>?;
            _isEnrolling = false;
          });
          if (success) _stopCamera();
        }
      }
    } catch (e) {
      if (mounted) { setState(() {
        _success = false;
        _resultMessage = '$e';
        _isEnrolling = false;
        _isCapturing = false;
      }); }
    }
  }

  void _resetAndRestart() {
    setState(() {
      _resultMessage = null;
      _liveness = null;
      _success = null;
      _challengeId = null;
      _challengeSteps = null;
      _currentStepIndex = 0;
    });
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
    final colorScheme = Theme.of(context).colorScheme;

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
        title: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: Colors.black26,
            borderRadius: BorderRadius.circular(20),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircleAvatar(
                radius: 10,
                backgroundColor: colorScheme.primaryContainer,
                child: Text(widget.user.name[0].toUpperCase(),
                  style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: colorScheme.onPrimaryContainer)),
              ),
              const SizedBox(width: 8),
              Text(widget.user.name,
                style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w500)),
            ],
          ),
        ),
        centerTitle: true,
      ),
      body: Stack(
        children: [
          if (_cameraActive && _isInitialized)
            CameraPreview(_controller!)
          else if (_cameraActive)
            Container(color: Colors.black, child: const Center(child: CircularProgressIndicator(color: Colors.white)))
          else
            _buildModeSelection(colorScheme),

          if (_cameraActive && _resultMessage == null)
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

          if (_cameraActive && _resultMessage == null)
            Positioned(
              top: MediaQuery.of(context).padding.top + 100,
              left: 0,
              right: 0,
              child: Text(
                _isCapturing
                  ? 'Hold still...'
                  : (_selectedMethod == 'challenge' && _challengeSteps != null && _currentStepIndex < _challengeSteps!.length)
                      ? 'Step ${_currentStepIndex + 1}: ${_challengeSteps![_currentStepIndex]['action']}'
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

          if (_resultMessage != null)
            Positioned(
              top: MediaQuery.of(context).padding.top + 80,
              left: 20,
              right: 20,
              child: AnimatedSlide(
                duration: const Duration(milliseconds: 300),
                offset: const Offset(0, 0),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  decoration: BoxDecoration(
                    color: _success == true ? Colors.green.shade600 : Colors.red.shade600,
                    borderRadius: BorderRadius.circular(16),
                    boxShadow: [
                      BoxShadow(
                        color: (_success == true ? Colors.green : Colors.red).withValues(alpha: 0.3),
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
                            _success == true ? Icons.check_circle_rounded : Icons.error_rounded,
                            color: Colors.white,
                            size: 22,
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(_resultMessage!,
                              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w500)),
                          ),
                        ],
                      ),
                      if (_liveness != null) ...[
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
                                    _liveness!['passed'] == true ? Icons.check_circle : Icons.cancel,
                                    size: 14,
                                    color: Colors.white,
                                  ),
                                  const SizedBox(width: 6),
                                  Text(
                                    _liveness!['passed'] == true ? 'Liveness: Passed' : 'Liveness: Failed',
                                    style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w500),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 4),
                              Text(
                                'Blur: ${((_liveness!['blur_score'] as num) * 100).toInt()}%  |  '
                                'Color: ${((_liveness!['color_score'] as num) * 100).toInt()}%  |  '
                                'Blink: ${_liveness!['blink_detected'] == true ? 'Yes' : 'No'}',
                                style: TextStyle(color: Colors.white.withValues(alpha: 0.7), fontSize: 11),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ],
                  ),
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
                if (_resultMessage != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: TextButton.icon(
                      onPressed: _resetAndRestart,
                      icon: const Icon(Icons.refresh, color: Colors.white, size: 18),
                      label: const Text('Capture Again',
                        style: TextStyle(color: Colors.white)),
                    ),
                  ),
                if (_cameraActive && _resultMessage == null)
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      AnimatedBuilder(
                        animation: _pulseAnimation,
                        builder: (context, child) => Transform.scale(
                          scale: (_isEnrolling || _isCapturing) ? 1.0 : _pulseAnimation.value,
                          child: child,
                        ),
                        child: GestureDetector(
                          onTap: (_isEnrolling || _isCapturing) ? null : _enroll,
                          child: Container(
                            width: 72,
                            height: 72,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: (_isEnrolling || _isCapturing) ? Colors.grey.shade400 : Colors.white,
                              boxShadow: [
                                BoxShadow(
                                  color: Colors.black.withValues(alpha: 0.25),
                                  blurRadius: 16,
                                  offset: const Offset(0, 4),
                                ),
                              ],
                            ),
                            child: _isEnrolling || _isCapturing
                              ? const CircularProgressIndicator(strokeWidth: 3, color: Colors.white)
                              : const Icon(Icons.camera_alt_rounded, color: Colors.black87, size: 30),
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _isCapturing
                          ? 'Capturing $_captureProgress/$_livenessFrameCount...'
                          : _isEnrolling
                            ? 'Enrolling...'
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

  Widget _buildModeSelection(ColorScheme colorScheme) {
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
