import type { Project, TimelineClip, TrackId } from "../types";

export const APP_VERSION = "0.1.0";
export const TRACKS: { id: TrackId; label: string; hint: string }[] = [
  { id: "V1", label: "Video 1", hint: "Picture" },
  { id: "A1", label: "Audio 1", hint: "Music / SFX" },
  { id: "A2", label: "Audio 2", hint: "Voice / ambience" }
];

export function createEmptyProject(): Project {
  return {
    formatVersion: 1,
    name: "Untitled project",
    settings: { width: 1920, height: 1080, fps: 30 },
    media: [],
    clips: [],
    titles: [],
    updatedAt: new Date().toISOString()
  };
}
export function clipDuration(clip: TimelineClip): number {
  return Math.max(0.1, clip.trimEnd - clip.trimStart);
}
export function timelineDuration(project: Project): number {
  const clipEnd = project.clips.reduce((end, clip) => Math.max(end, clip.start + clipDuration(clip)), 0);
  const titleEnd = project.titles.reduce((end, title) => Math.max(end, title.end), 0);
  return Math.max(12, clipEnd, titleEnd);
}
export function reflowVideoClips(clips: TimelineClip[]): TimelineClip[] {
  const videos = clips.filter((clip) => clip.track === "V1").sort((a, b) => a.start - b.start);
  let cursor = 0;
  const positions = new Map<string, number>();
  videos.forEach((clip, index) => {
    positions.set(clip.id, Math.max(0, cursor));
    cursor = Math.max(0, cursor) + clipDuration(clip);
    const next = videos[index + 1];
    if (next && next.transitionBefore !== "cut") cursor = Math.max(0, cursor - 0.45);
  });
  return clips.map((clip) => clip.track === "V1" ? { ...clip, start: positions.get(clip.id) ?? clip.start } : clip);
}
export function makeClip(mediaId: string, track: TrackId, start: number, duration: number): TimelineClip {
  return {
    id: Math.random().toString(36).slice(2) + Date.now().toString(36),
    mediaId, track, start, trimStart: 0, trimEnd: Math.max(0.1, duration),
    volume: 1, muted: false, effects: [], transitionBefore: "cut"
  };
}
export function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds || 0));
  return String(Math.floor(safe / 60)).padStart(2, "0") + ":" + String(safe % 60).padStart(2, "0");
}
export function fileName(path: string): string {
  const bits = path.split(/[\\/]/);
  return bits[bits.length - 1] || path;
}
export function mediaKindFromPath(path: string): "video" | "audio" | "image" {
  const ext = (path.split(".").pop() || "").toLowerCase();
  if (["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff"].includes(ext)) return "image";
  if (["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "wma"].includes(ext)) return "audio";
  return "video";
}