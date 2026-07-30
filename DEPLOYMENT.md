# Kamaraj College Campus Portal deployment

## Role directories

- Student login reads the three configured student Google Sheets.
- Staff login reads the dedicated staff sheet and accepts `Name`, `RollNumber`, and `DOB`.
- Staff records are never imported as student classes and do not receive timetable or ballot-submission access.

## Notifications and PWABuilder

Web notification permission must be requested from a user action. The first-run student and staff tours provide an **Enable official alerts** button, and the header keeps the same control available later.

Production requirements:

- Serve the frontend over HTTPS.
- Keep the generated VAPID keys stored in the production MongoDB database.
- For a PWABuilder Android package, generate and host the package-specific `.well-known/assetlinks.json` using the final Android package name and signing-certificate SHA-256 fingerprint.
- Rebuild and sign the Android package after changing the web manifest.
- Play Protect trust warnings for a sideloaded or unsigned APK cannot be removed by website code. Use a properly signed build and a trusted distribution channel.
