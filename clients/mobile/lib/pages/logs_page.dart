import 'package:flutter/material.dart';
import '../models/verification_log.dart';
import '../services/api_service.dart';
import '../widgets/shimmer_loading.dart';

class LogsPage extends StatefulWidget {
  final String? userId;

  const LogsPage({super.key, this.userId});

  @override
  State<LogsPage> createState() => _LogsPageState();
}

class _LogsPageState extends State<LogsPage> {
  final _api = ApiService();
  List<VerificationLog> _logs = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadLogs();
  }

  Future<void> _loadLogs() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final logs = await _api.listLogs(userId: widget.userId, pageSize: 100);
      if (mounted) setState(() { _logs = logs; _isLoading = false; });
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _isLoading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.userId != null ? 'Logs: ${widget.userId}' : 'Verification Logs'),
      ),
      body: _buildBody(theme, colorScheme),
    );
  }

  Widget _buildBody(ThemeData theme, ColorScheme colorScheme) {
    if (_isLoading) return const ShimmerLogList();

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_off, size: 48, color: colorScheme.error),
            const SizedBox(height: 12),
            Text('Failed to load logs', style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(_error!, style: theme.textTheme.bodySmall, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton.tonalIcon(
              onPressed: _loadLogs,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      );
    }

    if (_logs.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.history, size: 64, color: colorScheme.onSurfaceVariant.withValues(alpha: 0.4)),
            const SizedBox(height: 12),
            Text('No logs found', style: theme.textTheme.titleMedium),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadLogs,
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        itemCount: _logs.length,
        separatorBuilder: (_, _) => const SizedBox(height: 8),
        itemBuilder: (ctx, i) {
          final log = _logs[i];
          return _LogCard(log: log, colorScheme: colorScheme, theme: theme);
        },
      ),
    );
  }
}

class _LogCard extends StatelessWidget {
  final VerificationLog log;
  final ColorScheme colorScheme;
  final ThemeData theme;

  const _LogCard({
    required this.log,
    required this.colorScheme,
    required this.theme,
  });

  @override
  Widget build(BuildContext context) {
    final icon = log.userId != null ? Icons.person : Icons.help_outline;
    final iconColor = log.userId != null ? Colors.green.shade600 : Colors.orange.shade600;
    final distanceStr = log.distance?.toStringAsFixed(4);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            CircleAvatar(
              backgroundColor: iconColor.withValues(alpha: 0.12),
              child: Icon(icon, color: iconColor, size: 20),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    log.userId ?? 'Unknown',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    _formatDate(log.createdAt),
                    style: theme.textTheme.bodySmall?.copyWith(color: colorScheme.onSurfaceVariant),
                  ),
                ],
              ),
            ),
            if (distanceStr != null)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: colorScheme.secondaryContainer.withValues(alpha: 0.5),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(distanceStr,
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: colorScheme.onSecondaryContainer)),
              ),
          ],
        ),
      ),
    );
  }

  String _formatDate(DateTime dt) {
    final now = DateTime.now();
    final diff = now.difference(dt);
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return '${dt.month}/${dt.day}/${dt.year}';
  }
}
