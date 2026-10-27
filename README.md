# Almighty

Almighty is a Rust-powered desktop video editor in active development. This repository contains the Tauri desktop app, its Rust/FFmpeg media pipeline, and automated Windows installer workflows.

## Included in this first build

- A dark editing workspace with media bin, preview monitor, video/audio timeline tracks, clip inspector, and project settings.
- Import video, image, and audio files; inspect duration and stream metadata through FFprobe.
- Assemble clips, trim in/out points, reorder clips, control audio volume and mute, and use undo/redo.
- Export H.264 MP4 at 720p, Full HD, QHD, or 4K and common frame rates using FFmpeg.
- Transitions including cut, fade, dissolve, wipes, slides, circle reveals, smooth wipe, and radial.
- Color/effect filters: cinematic, warm, cool, monochrome, vintage, blur, sharpen, invert, vignette, color boost, and film grain.
- Text overlays rendered into exports.
- Ten procedurally generated WAV sound effects: whoosh, cinematic impact, pop, digital beep, riser, click, glitch, chime, sub drop, and vinyl texture.
- Project open/save in the Almighty project format and local browser-storage autosave.
- In-app GitHub Release checks. The updater downloads only from the project's GitHub Releases, checks the published SHA-256 file, and only launches an installer if the checksum matches.
- GitHub Actions builds a Windows NSIS installer artifact on pushes to main; version tags publish a release installer and checksum.

## Requirements

The current release target is Windows 10/11 x64. Local development requires Node.js 22+, Rust stable, and the Tauri Windows prerequisites. FFmpeg and FFprobe must be available on PATH for media inspection and MP4 export. Almighty does not automatically download or bundle third-party codec binaries.

FFmpeg downloads are available at https://ffmpeg.org/download.html. Install a Windows build, add its bin folder to PATH, and restart Almighty.

## Development

Install dependencies with npm install, then use npm run tauri -- dev to run the desktop app. Build a Windows installer with npm run tauri -- build --bundles nsis. The installer is written under src-tauri/target/release/bundle/nsis/.

## Releases and auto-updates

After a build is verified, update the version in package.json, src-tauri/Cargo.toml, and src-tauri/tauri.conf.json to the same value, then push a matching tag such as v0.1.1. The release workflow produces Almighty-setup.exe and Almighty-setup.exe.sha256. The in-app updater compares the release version with its embedded version and verifies the installer checksum before launch.

The SHA-256 file protects against a corrupted or mismatched download; it is not a substitute for a signed Windows code-signing certificate or an independently signed update manifest.

## Current limitations

This is an initial editor foundation, not yet a replacement for mature non-linear editors. The timeline UI is intentionally simple, playback is based on the currently selected source clip, and advanced keyframes, GPU rendering, proxy media, multi-camera editing, sophisticated compositing, subtitle tooling, and a licensed stock-music library remain future work. Export depends on the capabilities and filters in the FFmpeg build installed on each computer.

## License

MIT. See LICENSE.
