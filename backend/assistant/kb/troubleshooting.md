---
id: troubleshooting
title: Troubleshooting common problems
status: implemented
tags: error, problem, not working, troubleshoot, cannot, can't, failed, sign in, not configured, rate limit, too many requests, unavailable, 503, 429, offline, network, stuck
---
## "Sign-in is not configured for this build"
This version of the app was built without its sign-in settings. It is not something the user can fix; the shoRDs administrator has to configure the build. Try again later.

## "Too many requests" or a wait time
You hit a rate limit (for example sending messages or asking the Assistant too quickly). Wait for the number of seconds shown and try again.

## "Could not reach the server" or "took too long"
Check the internet connection and retry. If it persists the server may be down or restarting.

## "Service temporarily unavailable" or AI paused
The AI features can be switched off by the administrator (to control cost) or the AI provider may be down. Papers, profiles and messages keep working. Try again later.

## "Finish your profile first"
Mentorship and messaging need a completed profile. Open the profile setup, add a name, a profile type and at least one research interest, and save with "finish".

## Analysis says content is unavailable
The paper has no usable text or only metadata. Try a paper with a DOI that is open access, or read the original.

## A mentorship request cannot be sent
Possible reasons: you already have a pending or active request with that mentor, the mentor is not taking requests, the mentor is blocked or you are blocked, or your profile is not finished.

## A message did not send
You may be offline, rate limited, or the conversation may be closed because the mentorship was completed or someone was blocked. Use the retry button on the failed message.
