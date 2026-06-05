# shoRDs

shoRDs is a mobile-first research discovery app built with React Native, Expo, TypeScript, Expo Router, and Firebase.

## What Is Included

- Animated splash screen
- Email login and signup UI with domain interests
- Bottom tabs: Home, Explore, Upload, Profile
- Inshorts-style vertical research feed
- Research detail reader
- Search, filters, and domain discovery
- PDF upload picker flow
- Profile stats, interests, saved papers
- Firebase service layer for Auth, Firestore, and Storage
- Sample research data so the app runs before Firebase is configured

## Run Locally

```bash
npm install
npm run start
```

For web preview:

```bash
npm run web
```

## Firebase Setup

Copy `.env.example` to `.env` and add your Firebase project values:

```bash
EXPO_PUBLIC_FIREBASE_API_KEY=
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=
EXPO_PUBLIC_FIREBASE_PROJECT_ID=
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
EXPO_PUBLIC_FIREBASE_APP_ID=
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=
```

Until those values are added, the app falls back to demo data so the product experience remains testable.

## Verification

```bash
npm run typecheck
npx expo export --platform web
```
