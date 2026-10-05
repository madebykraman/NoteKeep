# NoteKeep

Mobile-first visual notes for iPhone and the web.

A NoteKeep note keeps the **thought and the references together**: write a note, attach one or more images, review the whole thing, and export it.

## Product principles

- Mobile/iPhone is the primary product, not a shrunken desktop app.
- The note list is core infrastructure.
- Images are first-class note content.
- One note can contain multiple images.
- Image presentation adapts naturally to portrait and landscape references.
- The primary image action uses the native browser/file flow; on iPhone this can expose camera capture.
- Review shows the complete note and all attached references.
- Export starts with PNG. Additional formats/variants can be added without changing the core model.
- Local-first: notes and binary image data live in browser storage; no account or backend is required for the local MVP.
- Use restrained UI, clear hierarchy, safe areas, touch-sized controls, and browser-native behavior.

## Engineering principles

Keep metadata and binary blobs separate. Use IndexedDB rather than placing screenshot data URLs in localStorage. Keep the data model small and explicit. Prefer browser APIs over unnecessary infrastructure. Test mobile Safari behavior on a real device, especially clipboard paste, file/camera input, viewport sizing, keyboard focus, safe areas, scrolling, sharing and downloads.

## Current MVP

- Create/edit/delete notes
- Search notes
- Multiple image attachments
- Image filmstrip and selection
- Clipboard image paste
- iPhone camera/photo/file input
- Local IndexedDB persistence
- Review sheet
- PNG export
- Browser Share API fallback to clipboard
- Responsive mobile-first UI
- Desktop layout as a later responsive fallback

## Global UI learning baseline

Captured in GitHub issue #1: https://github.com/madebykraman/NoteKeep/issues/1

The important lesson is to treat global UI patterns as product infrastructure: typography, spacing, touch targets, safe areas, feedback states, responsive behavior, storage boundaries and real-device QA should be carried forward across future NoteKeep work rather than rediscovered feature by feature.

## Run

```bash
npm install
npm run dev
```
