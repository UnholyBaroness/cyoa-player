# CYOA Audio Player Application

A free, client-side, interactive audio player for branching CYOA (`.cyoa`) packages.

## Features
1. **Client-Side ZIP Processing**: Extracts and plays `.cyoa` files entirely in memory using JSZip. No backend, database, or network uploads required.
2. **Audiobook Player UI**: Modern, dark studio design with waveform visualizer, progress scrubbing, speed controls, volume slider, keyboard navigation, and transcript view.
3. **Church Bell Signaling**: Plays a synthesized church bell chime 1.5s after scene narration ends to signal decision time.
4. **Timed Choices**: Supports optional countdown timers for high-stakes branching choices.
5. **Future Compatible Format**: Pre-structured for variables, conditions, transcripts, cover images, and scene state.
6. **Built-in Demo Generator**: Instant testing with synthesized multi-scene story packages directly in the browser.

---

## File Format Specification (`.cyoa`)

A `.cyoa` file is a ZIP archive renamed with the `.cyoa` extension containing a `story.json` manifest and audio files.

### Directory Structure Example:
