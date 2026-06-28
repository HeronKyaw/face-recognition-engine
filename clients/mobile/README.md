# Face Recognition Mobile

Flutter mobile app (Android / iOS) for face enrollment and verification using the backend API.

Requires the backend API to be running — see [docs/setup.md](../../docs/setup.md) for the full stack setup.

## Setup

```bash
flutter pub get
```

## Configuration

The app connects to the backend API (`/health`, `/api/v1/users`, `/api/v1/enroll`, `/api/v1/verify`, `/api/v1/verification-logs`).

**API URL** is auto-detected:
- Android emulator: `http://10.0.2.2:5050`
- iOS simulator / other: `http://localhost:5050`

Override at runtime:
```dart
ApiService.overrideBaseUrl = 'http://your-host:5050';
```

## Run

```powershell
flutter run
```

## App Flow

1. **User Selection** — Main page. Lists all users with search and shimmer loading. Tap a user to select them.
2. **Enroll** — Take or pick a photo to enroll a face for the selected user.
3. **Verify** — Take or pick a photo for 1:N face identification.
4. **Logs** — View verification history filtered to the selected user.

## Project Structure

```
lib/
  main.dart                     Entry point
  app.dart                      Material 3 theme
  models/
    user.dart                   User model
    verification_log.dart       Verification log model
  services/
    api_service.dart            REST API client
  widgets/
    shimmer_loading.dart        Shimmer loading placeholders
    user_card.dart              Selectable user card
  pages/
    user_selection_page.dart    Main hub — select user, action buttons
    enroll_page.dart            Face enrollment
    verify_page.dart            Face verification
    logs_page.dart              Verification logs
```

## Dependencies

- `shimmer` — Shimmer loading effect
- `http` — HTTP client
- `image_picker` — Camera / gallery access

## Build

```powershell
flutter build apk --debug
flutter build ios --debug --no-codesign
```
