import 'package:flutter/material.dart';
import '../models/user.dart';
import '../services/api_service.dart';
import '../widgets/shimmer_loading.dart';
import '../widgets/user_card.dart';
import 'enroll_page.dart';
import 'verify_page.dart';
import 'logs_page.dart';

class UserSelectionPage extends StatefulWidget {
  const UserSelectionPage({super.key});

  @override
  State<UserSelectionPage> createState() => _UserSelectionPageState();
}

class _UserSelectionPageState extends State<UserSelectionPage> {
  final _api = ApiService();
  List<User> _users = [];
  String? _selectedUserId;
  bool _isLoading = true;
  String? _error;
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadUsers();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadUsers() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final users = await _api.listUsers(pageSize: 100);
      if (mounted) setState(() { _users = users; _isLoading = false; });
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _isLoading = false; });
    }
  }

  List<User> get _filteredUsers {
    final query = _searchController.text.toLowerCase().trim();
    if (query.isEmpty) return _users;
    return _users.where((u) =>
      u.name.toLowerCase().contains(query) ||
      u.userId.toLowerCase().contains(query)
    ).toList();
  }

  Future<void> _createUser() async {
    final result = await showDialog<Map<String, String>>(
      context: context,
      builder: (ctx) => const _CreateUserDialog(),
    );
    if (result != null) {
      try {
        final user = await _api.createUser(result['userId']!, result['name']!);
        setState(() { _users.add(user); });
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Created ${user.name}')),
          );
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('$e'), backgroundColor: Colors.red),
          );
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final filtered = _filteredUsers;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Face Recognition'),
        centerTitle: true,
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: 'Search users...',
                prefixIcon: const Icon(Icons.search),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
                filled: true,
                fillColor: colorScheme.surfaceContainerHighest.withValues(alpha: 0.3),
                contentPadding: const EdgeInsets.symmetric(vertical: 0, horizontal: 16),
              ),
              onChanged: (_) => setState(() {}),
            ),
          ),
          Expanded(child: _buildContent(theme, colorScheme, filtered)),
          _buildBottomActions(theme, colorScheme),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _createUser,
        icon: const Icon(Icons.person_add),
        label: const Text('New User'),
      ),
    );
  }

  Widget _buildContent(ThemeData theme, ColorScheme colorScheme, List<User> filtered) {
    if (_isLoading) return const ShimmerUserList();

    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.cloud_off, size: 64, color: colorScheme.error),
              const SizedBox(height: 16),
              Text('Connection Error', style: theme.textTheme.titleMedium),
              const SizedBox(height: 8),
              Text(_error!, style: theme.textTheme.bodySmall, textAlign: TextAlign.center),
              const SizedBox(height: 20),
              FilledButton.tonalIcon(
                onPressed: _loadUsers,
                icon: const Icon(Icons.refresh),
                label: const Text('Retry'),
              ),
            ],
          ),
        ),
      );
    }

    if (_users.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.face_6, size: 80, color: colorScheme.primary.withValues(alpha: 0.4)),
            const SizedBox(height: 16),
            Text('No users yet', style: theme.textTheme.titleLarge),
            const SizedBox(height: 8),
            Text('Tap + to create your first user',
              style: theme.textTheme.bodyMedium?.copyWith(color: colorScheme.onSurfaceVariant)),
          ],
        ),
      );
    }

    if (filtered.isEmpty) {
      return Center(
        child: Text('No users match "${_searchController.text}"',
          style: theme.textTheme.bodyLarge?.copyWith(color: colorScheme.onSurfaceVariant)),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadUsers,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
        itemCount: filtered.length,
        itemBuilder: (ctx, i) {
          final user = filtered[i];
          final isSelected = user.userId == _selectedUserId;
          return UserCard(
            user: user,
            isSelected: isSelected,
            onTap: () => setState(() {
              _selectedUserId = isSelected ? null : user.userId;
            }),
          );
        },
      ),
    );
  }

  Widget _buildBottomActions(ThemeData theme, ColorScheme colorScheme) {
    final selectedUser = _users.where((u) => u.userId == _selectedUserId).firstOrNull;

    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
      decoration: BoxDecoration(
        color: colorScheme.surface,
        border: Border(top: BorderSide(color: colorScheme.outlineVariant)),
      ),
      child: selectedUser == null
        ? Center(
            child: Text('Select a user to continue',
              style: theme.textTheme.bodyMedium?.copyWith(color: colorScheme.onSurfaceVariant)),
          )
        : Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Selected: ${selectedUser.name}',
                style: theme.textTheme.labelLarge?.copyWith(color: colorScheme.primary)),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(child: _ActionButton(
                    icon: Icons.fingerprint,
                    label: 'Enroll',
                    color: colorScheme.primary,
                    onPressed: () => Navigator.push(
                      context, MaterialPageRoute(builder: (_) => EnrollPage(user: selectedUser))),
                  )),
                  const SizedBox(width: 10),
                  Expanded(child: _ActionButton(
                    icon: Icons.face_retouching_natural,
                    label: 'Verify',
                    color: colorScheme.secondary,
                    onPressed: () => Navigator.push(
                      context, MaterialPageRoute(builder: (_) => const VerifyPage())),
                  )),
                  const SizedBox(width: 10),
                  Expanded(child: _ActionButton(
                    icon: Icons.history,
                    label: 'Logs',
                    color: colorScheme.tertiary,
                    onPressed: () => Navigator.push(
                      context, MaterialPageRoute(builder: (_) => LogsPage(userId: selectedUser.userId))),
                  )),
                ],
              ),
            ],
          ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onPressed;

  const _ActionButton({
    required this.icon,
    required this.label,
    required this.color,
    required this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    return FilledButton.tonal(
      style: FilledButton.styleFrom(
        backgroundColor: color.withValues(alpha: 0.12),
        foregroundColor: color,
        padding: const EdgeInsets.symmetric(vertical: 10),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      onPressed: onPressed,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 22),
          const SizedBox(height: 3),
          Text(label, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}

class _CreateUserDialog extends StatefulWidget {
  const _CreateUserDialog();

  @override
  State<_CreateUserDialog> createState() => _CreateUserDialogState();
}

class _CreateUserDialogState extends State<_CreateUserDialog> {
  final _formKey = GlobalKey<FormState>();
  final _userIdController = TextEditingController();
  final _nameController = TextEditingController();

  @override
  void dispose() {
    _userIdController.dispose();
    _nameController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Create User'),
      content: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextFormField(
              controller: _userIdController,
              decoration: const InputDecoration(
                labelText: 'User ID',
                hintText: 'e.g. user_001',
                border: OutlineInputBorder(),
              ),
              validator: (v) => v == null || v.trim().isEmpty ? 'Required' : null,
              textCapitalization: TextCapitalization.none,
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _nameController,
              decoration: const InputDecoration(
                labelText: 'Name',
                hintText: 'e.g. John Doe',
                border: OutlineInputBorder(),
              ),
              validator: (v) => v == null || v.trim().isEmpty ? 'Required' : null,
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () {
            if (_formKey.currentState!.validate()) {
              Navigator.pop(context, {
                'userId': _userIdController.text.trim(),
                'name': _nameController.text.trim(),
              });
            }
          },
          child: const Text('Create'),
        ),
      ],
    );
  }
}
