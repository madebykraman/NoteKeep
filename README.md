# NoteKeep

A mobile-first notes app for keeping written context next to visual references.

## Current direction

NoteKeep is intentionally simple and local-first.

- iPhone/iOS-first responsive web UI
- Geist typography
- Paste, drop, or capture an image
- Write notes beside the visual reference
- Search notes
- Create and delete notes
- Local persistence with IndexedDB
- No account or backend required for the MVP
- Desktop layout exists only as a responsive fallback; mobile is the primary design target

## Engineering principles

Keep the data model small. Store note metadata separately from image blobs. Prefer browser-native storage and APIs over a server for local-only features. Treat mobile Safari as a first-class runtime, including safe areas, touch targets, clipboard behavior, viewport sizing, and camera capture.

## Run locally

```bash
npm install
npm run dev
```
