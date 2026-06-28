import 'package:flutter/material.dart';
import 'package:camera/camera.dart';
import '../models/user.dart';
import '../services/api_service.dart';

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
  String? _resultMessage;
  bool? _success;

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
    _initCamera();
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

  Future<void> _enroll() async {
    if (_controller == null || !_isInitialized || _isEnrolling) return;
    setState(() { _isEnrolling = true; _resultMessage = null; });
    try {
      final image = await _controller!.takePicture();
      final result = await _api.enroll(widget.user.userId, image);
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
          _isInitialized
            ? CameraPreview(_controller!)
            : Container(color: Colors.black, child: const Center(child: CircularProgressIndicator(color: Colors.white))),

          // Face guide overlay
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

          // Instruction text
          Positioned(
            top: MediaQuery.of(context).padding.top + 100,
            left: 0,
            right: 0,
            child: Text(
              'Position your face in the frame',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Colors.white.withValues(alpha: 0.9),
                fontSize: 16,
                fontWeight: FontWeight.w500,
                shadows: [Shadow(color: Colors.black.withValues(alpha: 0.4), blurRadius: 8)],
              ),
            ),
          ),

          // Result banner
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
                  child: Row(
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
                ),
              ),
            ),

          // Bottom action area
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
                      onPressed: () => setState(() => _resultMessage = null),
                      icon: const Icon(Icons.refresh, color: Colors.white, size: 18),
                      label: const Text('Capture Again',
                        style: TextStyle(color: Colors.white)),
                    ),
                  ),
                AnimatedBuilder(
                  animation: _pulseAnimation,
                  builder: (context, child) => Transform.scale(
                    scale: _isEnrolling ? 1.0 : _pulseAnimation.value,
                    child: child,
                  ),
                  child: GestureDetector(
                    onTap: _isEnrolling ? null : _enroll,
                    child: Container(
                      width: 72,
                      height: 72,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: _isEnrolling ? Colors.grey.shade400 : Colors.white,
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.25),
                            blurRadius: 16,
                            offset: const Offset(0, 4),
                          ),
                        ],
                      ),
                      child: _isEnrolling
                        ? const CircularProgressIndicator(strokeWidth: 3, color: Colors.white)
                        : const Icon(Icons.camera_alt_rounded, color: Colors.black87, size: 30),
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  _isEnrolling ? 'Enrolling...' : 'Tap to capture',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.8),
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    shadows: [Shadow(color: Colors.black.withValues(alpha: 0.3), blurRadius: 4)],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
