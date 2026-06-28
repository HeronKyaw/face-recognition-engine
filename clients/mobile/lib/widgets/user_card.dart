import 'package:flutter/material.dart';
import '../models/user.dart';

class UserCard extends StatelessWidget {
  final User user;
  final bool isSelected;
  final VoidCallback onTap;

  const UserCard({
    super.key,
    required this.user,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final initials = user.name.isNotEmpty ? user.name[0].toUpperCase() : '?';

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: isSelected
            ? colorScheme.primaryContainer.withValues(alpha: 0.5)
            : colorScheme.surface,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: isSelected ? colorScheme.primary : colorScheme.outlineVariant,
                width: isSelected ? 2 : 1,
              ),
            ),
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 24,
                  backgroundColor: isSelected
                      ? colorScheme.primary
                      : colorScheme.secondaryContainer,
                  child: Text(
                    initials,
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w600,
                      color: isSelected
                          ? colorScheme.onPrimary
                          : colorScheme.onSecondaryContainer,
                    ),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        user.name,
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        user.userId,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                if (user.faceEnrolled)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: Colors.green.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      'Enrolled',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: Colors.green.shade700,
                      ),
                    ),
                  ),
                if (isSelected)
                  Padding(
                    padding: const EdgeInsets.only(left: 8),
                    child: Icon(Icons.check_circle, color: colorScheme.primary, size: 22),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
