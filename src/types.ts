export type MediaKind = "video" | "audio" | "image";
export type TrackId = "V1" | "A1" | "A2";
export type EffectId = "cinematic" | "warm" | "cool" | "monochrome" | "vintage" | "blur" | "sharpen" | "invert" | "vignette" | "boost" | "filmgrain";
export type TransitionId = "cut" | "fade" | "dissolve" | "wipeleft" | "wiperight" | "slideleft" | "slideright" | "circleopen" | "circleclose" | "smoothleft" | "radial";

export interface MediaAsset {
  id: string;
  name: string;
  path: string;
  kind: MediaKind;
  duration: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  hasVideo?: boolean;
}
export interface TimelineClip {
  id: string;
  mediaId: string;
  track: TrackId;
  start: number;
  trimStart: number;
  trimEnd: number;
  volume: number;
  muted: boolean;
  effects: EffectId[];
  transitionBefore: TransitionId;
}
export interface TitleOverlay {
  id: string;
  text: string;
  start: number;
  end: number;
  fontSize: number;
  color: "white" | "yellow" | "cyan";
  y: number;
}
export interface Project {
  formatVersion: 1;
  name: string;
  settings: { width: number; height: number; fps: number };
  media: MediaAsset[];
  clips: TimelineClip[];
  titles: TitleOverlay[];
  updatedAt: string;
}
export interface RuntimeInfo {
  version: string;
  ffmpegAvailable: boolean;
  ffprobeAvailable: boolean;
  platform: string;
}
export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  notes?: string;
  message: string;
  downloadUrl?: string;
}