import 'package:flutter/material.dart';
import 'pages/user_selection_page.dart';

class FaceRecognitionApp extends StatelessWidget {
  const FaceRecognitionApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Face Recognition',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF4F46E5),
          brightness: Brightness.light,
        ),
      ),
      home: const UserSelectionPage(),
    );
  }
}
