# Firebase security rules review (2026-11-03)

**Status: the live rules were not read.** They are not in the repository (no `firestore.rules`, `storage.rules`, `firebase.json` or `.firebaserc` anywhere), and no production or Firebase console access was used. So this review cannot say whether production is safe. It says what the code needs, what the rules must therefore allow, and what to check.

## What the client does with Firebase (from `services/firebase.ts`)

| Operation | Called by the app? | Needs |
|---|---|---|
| Email sign-up, sign-in, Google popup sign-in | yes | Auth (not governed by Firestore/Storage rules) |
| `setDoc(users/{uid}, {id,name,email,bio,interests,profileImage})` at sign-up | yes (`signupWithEmail`) | a signed-in user may write only their own `users/{uid}` |
| `getDocs(papers)` (`fetchPapers`) | **no caller found** | nothing: deny |
| `addDoc(papers)` and Storage `papers/<time>-<title>.pdf` (`createPaper`) | **no caller found** | nothing: deny |

Everything else in the product (projects, analyses, papers, chunks) goes through the backend with a verified Firebase ID token and never touches Firestore or Storage from the client.

## What to check in the Firebase console (owner; read-only, 5 minutes)

1. **Firestore → Rules.** Look for any of: `allow read, write: if true;`, a rule with an expiry date (`request.time < timestamp.date(...)`, the "test mode" default), `allow read, write: if request.auth != null;` on `/{document=**}` (any signed-in user, including a throwaway sign-up, could read and change everything), or `allow create` on `papers` for anyone. Any of these is a launch blocker.
2. **Storage → Rules.** The same patterns. Open Storage rules let anyone upload files to your bucket at your cost.
3. **Authentication → Sign-in method.** Only the providers the app uses (Email/Password, Google) should be on. **Authorized domains** should list only the real web origins (not stale preview hosts).
4. **Authentication → Settings → User actions.** Decide deliberately whether "Enable create (sign-up)" should be on; it is the only door into the backend.
5. **App Check** is not used by the app (no code); see the register for whether it is worth enabling.
6. Is the Web API key restricted (Google Cloud console → Credentials → HTTP referrers)? The key is public by design, but unrestricted keys can be abused for quota. Restrict it to the real web origin(s).

## Proposed rules (not deployed)

`docs/ops/firebase/firestore.rules.PROPOSED` and `docs/ops/firebase/storage.rules.PROPOSED`. They allow only the one write the app makes (own profile, fixed fields, size limits, no delete) and deny the rest. **They have not been run against the emulator or the Rules Playground**, because the emulator could not be installed in this environment (the npm registry was unreachable). Test them before use. Deploying them is a production change and needs the owner's approval.

Known limits of the proposal: `hasOnly` limits field names, not nested content; an `email` value is not forced to equal the token's email (a sign-up with a provider that has no email would otherwise fail); and Firestore rules cannot rate-limit sign-up spam.

## Two things the code review noticed

- `services/firebase.ts` still contains `fetchPapers` and `createPaper`. If they stay unused, delete them so the next developer does not reach for an open `papers` collection.
- The profile document stores the user's email in Firestore as well as in Auth. That is harmless if the rules above hold, and a data-minimisation point if they do not.
