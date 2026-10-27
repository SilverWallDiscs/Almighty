import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, ArrowLeftRight, AudioLines, Check, ChevronDown, Clapperboard,
  Clock3, Download, ExternalLink, FileAudio, FileImage, FileVideo, Film, FolderOpen,
  HardDrive, Layers3, Loader2, Music2, Palette, Play, Plus, RefreshCw, Redo2, Save,
  Scissors, Search, Settings2, SlidersHorizontal, Sparkles, Trash2, Type, Undo2,
  Upload, Volume2, Wand2, Waves, X, Zap, Monitor
} from "lucide-react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { EffectId, MediaAsset, Project, RuntimeInfo, TitleOverlay, TimelineClip, TrackId, TransitionId, UpdateInfo } from "./types";
import { APP_VERSION, clipDuration, createEmptyProject, fileName, formatTime, makeClip, mediaKindFromPath, reflowVideoClips, timelineDuration, TRACKS } from "./lib/project";

type ToolId = "media" | "audio" | "effects" | "transitions" | "titles" | "settings";
type ProbeResult = { duration: number; width?: number; height?: number; hasAudio: boolean; hasVideo: boolean };
const TOOLS: { id: ToolId; label: string; icon: typeof Film; hint: string }[] = [
  { id: "media", label: "Media", icon: Film, hint: "Your files" },
  { id: "audio", label: "Audio", icon: AudioLines, hint: "Sound library" },
  { id: "effects", label: "Effects", icon: Wand2, hint: "Looks and filters" },
  { id: "transitions", label: "Transitions", icon: ArrowLeftRight, hint: "Between clips" },
  { id: "titles", label: "Titles", icon: Type, hint: "Text overlays" },
  { id: "settings", label: "Settings", icon: Settings2, hint: "Editor setup" }
];
const EFFECTS: { id: EffectId; name: string; note: string; swatch: string }[] = [
  { id: "cinematic", name: "Cinematic", note: "Punchy contrast and color", swatch: "violet" },
  { id: "warm", name: "Golden hour", note: "Warm highlights", swatch: "amber" },
  { id: "cool", name: "Cool tone", note: "Cool blue shadows", swatch: "blue" },
  { id: "monochrome", name: "Monochrome", note: "Classic black and white", swatch: "gray" },
  { id: "vintage", name: "Vintage film", note: "Faded color and vignette", swatch: "peach" },
  { id: "blur", name: "Soft focus", note: "Gentle blur", swatch: "mint" },
  { id: "sharpen", name: "Sharpen", note: "Crisper details", swatch: "cyan" },
  { id: "invert", name: "Negative", note: "Invert image colors", swatch: "pink" },
  { id: "vignette", name: "Vignette", note: "Draw focus to center", swatch: "violet" },
  { id: "boost", name: "Color boost", note: "More saturation and contrast", swatch: "amber" },
  { id: "filmgrain", name: "Film grain", note: "Subtle moving grain", swatch: "gray" }
];
const TRANSITIONS: { id: TransitionId; name: string; note: string }[] = [
  { id: "cut", name: "Cut", note: "Instant switch" },
  { id: "fade", name: "Fade", note: "Smooth fade" },
  { id: "dissolve", name: "Dissolve", note: "Classic cross dissolve" },
  { id: "wipeleft", name: "Wipe left", note: "Reveal from right" },
  { id: "wiperight", name: "Wipe right", note: "Reveal from left" },
  { id: "slideleft", name: "Slide left", note: "Push the next shot in" },
  { id: "slideright", name: "Slide right", note: "Push the next shot in" },
  { id: "circleopen", name: "Circle open", note: "Expand from center" },
  { id: "circleclose", name: "Circle close", note: "Close into center" },
  { id: "smoothleft", name: "Smooth left", note: "Soft directional wipe" },
  { id: "radial", name: "Radial", note: "Circular reveal" }
];
const SOUNDS = [
  { id: "whoosh", name: "Whoosh", note: "Airy transition sweep", icon: Waves, length: "1.0s" },
  { id: "impact", name: "Cinematic impact", note: "Deep hit and transient", icon: Zap, length: "0.8s" },
  { id: "pop", name: "Pop", note: "Short, bright accent", icon: Sparkles, length: "0.2s" },
  { id: "beep", name: "Digital beep", note: "Clean UI tone", icon: AudioLines, length: "0.4s" },
  { id: "riser", name: "Riser", note: "Build tension into a cut", icon: ArrowLeftRight, length: "1.4s" },
  { id: "click", name: "Soft click", note: "Subtle interface tap", icon: Check, length: "0.1s" },
  { id: "glitch", name: "Glitch", note: "Choppy digital burst", icon: Zap, length: "0.4s" },
  { id: "chime", name: "Chime", note: "Bright bell accent", icon: Sparkles, length: "0.8s" },
  { id: "subdrop", name: "Sub drop", note: "Low cinematic drop", icon: Waves, length: "0.9s" },
  { id: "vinyl", name: "Vinyl texture", note: "Light crackle ambience", icon: Music2, length: "1.2s" }
];
const isTauri = () => typeof window !== "undefined" && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
function assetUrl(path: string): string {
  try { return isTauri() ? convertFileSrc(path) : path; } catch { return path; }
}
function IconForMedia({ kind }: { kind: MediaAsset["kind"] }) {
  if (kind === "audio") return <FileAudio size={15} />;
  if (kind === "image") return <FileImage size={15} />;
  return <FileVideo size={15} />;
}
function Preview({ asset, clip, project }: { asset?: MediaAsset; clip?: TimelineClip; project: Project }) {
  const time = clip?.start ?? 0;
  const activeTitle = project.titles.find((title) => title.start <= time + 0.1 && title.end >= time);
  if (!asset) return <div className="empty-preview"><div className="empty-preview-mark"><Clapperboard size={28} /></div><strong>Your canvas is ready</strong><span>Import media, then add clips to the timeline to start editing.</span></div>;
  if (asset.kind === "image") return <div className="preview-frame"><img className="preview-media" src={assetUrl(asset.path)} alt={asset.name} />{activeTitle && <div className="preview-title" style={{ color: activeTitle.color, top: (activeTitle.y * 100) + "%" }}>{activeTitle.text}</div>}</div>;
  if (asset.kind === "audio") return <div className="audio-preview"><div className="audio-preview-art"><AudioLines size={50} strokeWidth={1.4} /></div><strong>{asset.name}</strong><span>Audio asset · {formatTime(asset.duration)}</span><audio controls preload="metadata" src={assetUrl(asset.path)} /></div>;
  return <div className="preview-frame"><video key={asset.path} className="preview-media" src={assetUrl(asset.path)} controls preload="metadata" />{activeTitle && <div className="preview-title" style={{ color: activeTitle.color, top: (activeTitle.y * 100) + "%" }}>{activeTitle.text}</div>}</div>;
}
function playSoundPreview(id: string) {
  try {
    const context = new AudioContext();
    const duration = id === "riser" ? 1.25 : id === "whoosh" ? 0.9 : id === "impact" || id === "subdrop" ? 0.72 : id === "vinyl" ? 0.8 : 0.32;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.linearRampToValueAtTime(id === "click" ? 0.12 : 0.28, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    gain.connect(context.destination);
    if (["whoosh", "riser", "glitch", "vinyl"].includes(id)) {
      const count = Math.floor(context.sampleRate * duration);
      const buffer = context.createBuffer(1, count, context.sampleRate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < count; i += 1) channel[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / count);
      const source = context.createBufferSource();
      source.buffer = buffer;
      const filter = context.createBiquadFilter();
      filter.type = id === "vinyl" ? "lowpass" : "highpass";
      filter.frequency.value = id === "riser" ? 1800 : 900;
      source.connect(filter).connect(gain);
      source.start(); source.stop(context.currentTime + duration);
    } else {
      const oscillator = context.createOscillator();
      oscillator.type = id === "impact" || id === "subdrop" ? "sine" : "triangle";
      const startHz = id === "impact" ? 95 : id === "subdrop" ? 120 : id === "beep" ? 880 : id === "chime" ? 660 : id === "pop" ? 420 : 1150;
      oscillator.frequency.setValueAtTime(startHz, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(id === "impact" ? 34 : id === "subdrop" ? 28 : id === "pop" ? 170 : startHz, context.currentTime + duration);
      oscillator.connect(gain); oscillator.start(); oscillator.stop(context.currentTime + duration);
    }
    window.setTimeout(() => void context.close(), Math.ceil(duration * 1000) + 200);
  } catch { /* Sound preview is optional; WAV generation runs in Rust. */ }
}

export default function App() {
  const [project, setProject] = useState<Project>(() => createEmptyProject());
  const [ready, setReady] = useState(false);
  const [past, setPast] = useState<Project[]>([]);
  const [future, setFuture] = useState<Project[]>([]);
  const [activeTool, setActiveTool] = useState<ToolId>("media");
  const [selectedClipId, setSelectedClipId] = useState<string>();
  const [selectedMediaId, setSelectedMediaId] = useState<string>();
  const [search, setSearch] = useState("");
  const [titleDraft, setTitleDraft] = useState("Your title");
  const [runtime, setRuntime] = useState<RuntimeInfo>();
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo>();
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState("");
  const [projectMenu, setProjectMenu] = useState(false);

  const selectedClip = project.clips.find((clip) => clip.id === selectedClipId);
  const selectedAsset = project.media.find((media) => media.id === (selectedClip?.mediaId ?? selectedMediaId));
  const timelineEnd = timelineDuration(project);
  const pxPerSecond = 86;
  const timelineWidth = Math.max(1100, timelineEnd * pxPerSecond + 90);
  const filteredMedia = project.media.filter((media) => media.name.toLowerCase().includes(search.toLowerCase()));
  const totalDuration = project.clips.filter((clip) => clip.track === "V1").reduce((total, clip) => Math.max(total, clip.start + clipDuration(clip)), 0);
  const selectedClipAsset = selectedClip ? project.media.find((media) => media.id === selectedClip.mediaId) : undefined;

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 4200);
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("almighty-autosave");
      if (saved) {
        const parsed = JSON.parse(saved) as Project;
        if (parsed && parsed.formatVersion === 1 && Array.isArray(parsed.media) && Array.isArray(parsed.clips)) setProject(parsed);
      }
    } catch { /* Keep an empty project if autosave is damaged. */ }
    setReady(true);
    if (isTauri()) {
      invoke<RuntimeInfo>("get_runtime_info").then(setRuntime).catch(() => undefined);
      invoke<UpdateInfo>("check_for_updates").then(setUpdateInfo).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (ready) {
      try { localStorage.setItem("almighty-autosave", JSON.stringify(project)); }
      catch { /* The project stores paths, not actual media bytes. */ }
    }
  }, [project, ready]);

  const updateProject = (mutator: (current: Project) => Project) => {
    setPast((items) => [...items.slice(-39), project]);
    setFuture([]);
    setProject((current) => ({ ...mutator(current), updatedAt: new Date().toISOString() }));
  };
  const undo = () => {
    if (!past.length) return;
    setFuture((items) => [project, ...items].slice(0, 40));
    setProject(past[past.length - 1]);
    setPast((items) => items.slice(0, -1));
  };
  const redo = () => {
    if (!future.length) return;
    setPast((items) => [...items, project].slice(-40));
    setProject(future[0]);
    setFuture((items) => items.slice(1));
  };

  const importMedia = async () => {
    if (!isTauri()) return notify("Open Almighty as the desktop app to import files.");
    try {
      const selection = await open({
        multiple: true, title: "Import media",
        filters: [{ name: "Media", extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v", "mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff"] }]
      });
      if (!selection) return;
      const paths = Array.isArray(selection) ? selection : [selection];
      const added: MediaAsset[] = [];
      for (const path of paths) {
        const kind = mediaKindFromPath(path);
        let probe: ProbeResult | undefined;
        try { probe = await invoke<ProbeResult>("probe_media", { path }); } catch { /* File remains importable; export will explain if FFmpeg is missing. */ }
        const fallbackDuration = kind === "image" ? 5 : kind === "audio" ? 8 : 5;
        added.push({
          id: Math.random().toString(36).slice(2) + Date.now().toString(36),
          name: fileName(path), path, kind,
          duration: Math.max(0.1, probe?.duration || fallbackDuration),
          width: probe?.width, height: probe?.height,
          hasAudio: probe?.hasAudio ?? kind === "audio",
          hasVideo: probe?.hasVideo ?? kind === "video"
        });
      }
      updateProject((current) => ({ ...current, media: [...current.media, ...added] }));
      if (added[0]) setSelectedMediaId(added[0].id);
      if (!runtime?.ffmpegAvailable) notify("Media imported. Install FFmpeg to probe and export full-quality video.");
      else notify("Imported " + added.length + (added.length === 1 ? " item." : " items."));
    } catch (error) { notify("Import failed: " + String(error)); }
  };

  const addAssetToTimeline = (asset: MediaAsset, track: TrackId = "V1") => {
    if (track === "V1" && asset.kind === "audio") return notify("Audio-only files belong on Audio 1 or Audio 2.");
    if (track !== "V1" && asset.kind !== "audio" && !asset.hasAudio) return notify("This file has no audio stream to add to an audio track.");
    const sameTrack = project.clips.filter((clip) => clip.track === track);
    const start = sameTrack.reduce((end, clip) => Math.max(end, clip.start + clipDuration(clip)), 0);
    const clip = makeClip(asset.id, track, start, asset.duration || 5);
    const clips = [...project.clips, clip];
    updateProject((current) => ({ ...current, clips: track === "V1" ? reflowVideoClips(clips) : clips }));
    setSelectedClipId(clip.id); setSelectedMediaId(asset.id);
    notify("Added " + asset.name + " to " + track + ".");
  };
  const addSoundToTimeline = async (effectId: string) => {
    if (!isTauri()) return notify("Sound generation is available in the desktop app.");
    try {
      const asset = await invoke<MediaAsset>("create_sound_effect", { effect: effectId });
      const start = project.clips.filter((clip) => clip.track === "A1").reduce((end, clip) => Math.max(end, clip.start + clipDuration(clip)), 0);
      const clip = makeClip(asset.id, "A1", start, asset.duration);
      updateProject((current) => ({ ...current, media: [...current.media, asset], clips: [...current.clips, clip] }));
      setSelectedClipId(clip.id); setSelectedMediaId(asset.id); setActiveTool("audio");
      notify("Generated " + asset.name + " and added it to Audio 1.");
    } catch (error) { notify("Sound generation failed: " + String(error)); }
  };
  const updateClip = (clipId: string, mutator: (clip: TimelineClip) => TimelineClip) => {
    updateProject((current) => ({ ...current, clips: reflowVideoClips(current.clips.map((clip) => clip.id === clipId ? mutator(clip) : clip)) }));
  };
  const removeClip = (clipId: string) => {
    updateProject((current) => ({ ...current, clips: reflowVideoClips(current.clips.filter((clip) => clip.id !== clipId)) }));
    setSelectedClipId(undefined);
  };
  const moveClip = (clipId: string, delta: number) => {
    const clip = project.clips.find((item) => item.id === clipId);
    if (!clip) return;
    const peers = project.clips.filter((item) => item.track === clip.track).sort((a, b) => a.start - b.start);
    const index = peers.findIndex((item) => item.id === clipId);
    if (!peers[index + delta]) return;
    const reordered = peers.slice();
    reordered.splice(index, 1); reordered.splice(index + delta, 0, clip);
    const startMap = new Map<string, number>();
    let cursor = 0;
    reordered.forEach((item, i) => {
      startMap.set(item.id, cursor); cursor += clipDuration(item);
      const next = reordered[i + 1];
      if (next && item.track === "V1" && next.transitionBefore !== "cut") cursor = Math.max(0, cursor - 0.45);
    });
    updateProject((current) => ({ ...current, clips: current.clips.map((item) => startMap.has(item.id) ? { ...item, start: startMap.get(item.id)! } : item) }));
  };
  const applyEffect = (effect: EffectId) => {
    if (!selectedClip || selectedClip.track !== "V1") return notify("Select a video clip in the timeline first.");
    updateClip(selectedClip.id, (clip) => ({ ...clip, effects: clip.effects.includes(effect) ? clip.effects.filter((item) => item !== effect) : [...clip.effects, effect] }));
  };
  const addTitle = () => {
    const baseStart = selectedClip?.start ?? 0;
    const baseEnd = selectedClip ? selectedClip.start + clipDuration(selectedClip) : 3.5;
    const title: TitleOverlay = {
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      text: titleDraft.trim() || "Your title", start: baseStart, end: Math.max(baseStart + 0.5, baseEnd),
      fontSize: 48, color: "white", y: 0.16
    };
    updateProject((current) => ({ ...current, titles: [...current.titles, title] }));
    setActiveTool("titles"); notify("Title overlay added to the project.");
  };
  const saveProjectFile = async () => {
    if (!isTauri()) return notify("Project files can be saved from the desktop app.");
    try {
      const path = await save({
        title: "Save Almighty project",
        defaultPath: project.name.replace(/[<>:"/\\|?*]/g, "-") + ".almighty",
        filters: [{ name: "Almighty Project", extensions: ["almighty"] }]
      });
      if (!path) return;
      await invoke("write_project_file", { path, data: JSON.stringify(project, null, 2) });
      notify("Project saved."); setProjectMenu(false);
    } catch (error) { notify("Could not save project: " + String(error)); }
  };
  const openProjectFile = async () => {
    if (!isTauri()) return notify("Project files can be opened from the desktop app.");
    try {
      const path = await open({ multiple: false, title: "Open Almighty project", filters: [{ name: "Almighty Project", extensions: ["almighty", "json"] }] });
      if (!path || Array.isArray(path)) return;
      const data = await invoke<string>("read_project_file", { path });
      const parsed = JSON.parse(data) as Project;
      if (parsed.formatVersion !== 1 || !Array.isArray(parsed.media) || !Array.isArray(parsed.clips)) throw new Error("Unsupported or invalid project format");
      setPast((items) => [...items.slice(-39), project]); setFuture([]); setProject(parsed);
      setSelectedClipId(undefined); setSelectedMediaId(parsed.media[0]?.id); setProjectMenu(false); notify("Project opened.");
    } catch (error) { notify("Could not open project: " + String(error)); }
  };
  const exportProject = async () => {
    if (!isTauri()) return notify("Export is available in the installed desktop app.");
    if (!project.clips.some((clip) => clip.track === "V1")) return notify("Add at least one video or image clip to Video 1 before exporting.");
    if (!runtime?.ffmpegAvailable) return notify("FFmpeg was not found. Open Settings for setup instructions.");
    try {
      const path = await save({ title: "Export video", defaultPath: project.name.replace(/[<>:"/\\|?*]/g, "-") + ".mp4", filters: [{ name: "MP4 Video", extensions: ["mp4"] }] });
      if (!path) return;
      setExporting(true); notify("Rendering your project. Long videos may take a while.");
      const result = await invoke<string>("export_video", { project, outputPath: path });
      notify(result || "Export complete.");
    } catch (error) { notify("Export failed: " + String(error)); }
    finally { setExporting(false); }
  };
  const checkUpdates = async () => {
    if (!isTauri()) return notify("Update checks run in the installed desktop app.");
    setCheckingUpdates(true);
    try {
      const info = await invoke<UpdateInfo>("check_for_updates");
      setUpdateInfo(info); notify(info.updateAvailable ? "Almighty " + info.latestVersion + " is ready to install." : info.message);
    } catch (error) { notify("Update check failed: " + String(error)); }
    finally { setCheckingUpdates(false); }
  };
  const installUpdate = async () => {
    if (!updateInfo?.updateAvailable) return;
    if (!window.confirm("Download and install Almighty " + updateInfo.latestVersion + "? The app will close while the installer runs.")) return;
    try { await invoke<string>("install_latest_update"); notify("The update installer is starting."); }
    catch (error) { notify("Update could not be installed: " + String(error)); }
  };

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-area">
        <div className="brand-mark"><Play size={16} fill="currentColor" /></div>
        <div className="brand-copy"><strong>almighty</strong><span>VIDEO EDITOR</span></div>
        <div className="top-divider" />
        <button className="project-name" onClick={() => setProjectMenu(!projectMenu)}><span>{project.name}</span><ChevronDown size={14} /></button>
        {projectMenu && <div className="project-menu">
          <button onClick={openProjectFile}><FolderOpen size={15} /> Open project</button>
          <button onClick={saveProjectFile}><Save size={15} /> Save project</button>
          <button onClick={() => { updateProject(() => createEmptyProject()); setSelectedClipId(undefined); setSelectedMediaId(undefined); setProjectMenu(false); }}><Plus size={15} /> New project</button>
        </div>}
      </div>
      <div className="top-center-status"><span className="save-dot" /> Autosaved locally <span className="status-separator">·</span> {project.settings.width} × {project.settings.height} <span className="status-separator">·</span> {project.settings.fps} fps</div>
      <div className="top-actions">
        <button className="icon-button" title="Undo" disabled={!past.length} onClick={undo}><Undo2 size={17} /></button>
        <button className="icon-button" title="Redo" disabled={!future.length} onClick={redo}><Redo2 size={17} /></button>
        <button className="button button-quiet update-button" onClick={checkUpdates} disabled={checkingUpdates}>{checkingUpdates ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />} <span>Check updates</span></button>
        <button className="button button-primary" onClick={exportProject} disabled={exporting}>{exporting ? <Loader2 className="spin" size={16} /> : <Download size={16} />} <span>{exporting ? "Exporting…" : "Export video"}</span></button>
      </div>
    </header>

    {updateInfo?.updateAvailable && <div className="update-banner"><div className="update-banner-icon"><Download size={17} /></div><div><strong>Almighty {updateInfo.latestVersion} is available</strong><span>{(updateInfo.notes || "A newer version is ready.").split("\n")[0].slice(0, 150)}</span></div><button className="button button-primary button-small" onClick={installUpdate}>Install update</button><button className="icon-button" title="Dismiss" onClick={() => setUpdateInfo(undefined)}><X size={16} /></button></div>}

    <div className="workspace">
      <aside className="tool-rail">
        {TOOLS.map((tool) => { const ToolIcon = tool.icon; return <button key={tool.id} className={"tool-rail-item " + (activeTool === tool.id ? "active" : "")} onClick={() => setActiveTool(tool.id)} title={tool.hint}><ToolIcon size={19} strokeWidth={1.8} /><span>{tool.label}</span></button>; })}
        <div className="rail-bottom"><div className="user-dot">A</div></div>
      </aside>

      <section className="media-panel">
        <div className="panel-heading"><div><span className="eyebrow">{activeTool === "media" ? "PROJECT ASSETS" : activeTool === "audio" ? "SOUND LIBRARY" : activeTool === "effects" ? "IMAGE PROCESSING" : activeTool === "transitions" ? "CLIP MOTION" : activeTool === "titles" ? "TEXT OVERLAYS" : "PREFERENCES"}</span><h2>{TOOLS.find((tool) => tool.id === activeTool)?.label}</h2></div>{activeTool === "media" && <button className="square-button" onClick={importMedia} title="Import media"><Plus size={17} /></button>}</div>

        {activeTool === "media" && <div className="panel-content">
          <button className="import-drop" onClick={importMedia}><div className="import-icon"><Upload size={19} /></div><strong>Import media</strong><span>Video, images and audio</span><small>Browse files on your computer</small></button>
          <div className="library-toolbar"><span>MEDIA BIN <b>{project.media.length}</b></span><div className="search-wrap"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search assets" /></div></div>
          {filteredMedia.length === 0 ? <div className="library-empty"><div className="library-empty-icon"><Layers3 size={23} /></div><strong>{project.media.length ? "No matching files" : "Your media lives here"}</strong><span>Import your clips, images, music and voiceovers to begin.</span></div> : <div className="media-list">{filteredMedia.map((asset) => <div className={"media-card " + (selectedMediaId === asset.id ? "selected" : "")} key={asset.id} onClick={() => { setSelectedMediaId(asset.id); setSelectedClipId(undefined); }}>
            <button className="media-thumb" onClick={(event) => { event.stopPropagation(); setSelectedMediaId(asset.id); setSelectedClipId(undefined); }}>{asset.kind === "image" ? <img src={assetUrl(asset.path)} alt="" /> : <div className={"thumb-placeholder " + asset.kind}><IconForMedia kind={asset.kind} /></div>}<span className="thumb-duration">{formatTime(asset.duration)}</span></button>
            <div className="media-meta"><strong title={asset.name}>{asset.name}</strong><span><IconForMedia kind={asset.kind} /> {asset.kind.toUpperCase()} {asset.width && asset.height ? "· " + asset.width + "×" + asset.height : ""}</span><div className="media-add-actions">{asset.kind !== "audio" && <button onClick={(event) => { event.stopPropagation(); addAssetToTimeline(asset, "V1"); }}><Plus size={12} /> V1</button>}{(asset.kind === "audio" || asset.hasAudio) && <button onClick={(event) => { event.stopPropagation(); addAssetToTimeline(asset, "A1"); }}><Plus size={12} /> A1</button>}</div></div>
          </div>)}</div>}
          <div className="panel-footnote"><HardDrive size={13} /><span>Media stays on your device. Projects store file paths, not copies.</span></div>
        </div>}

        {activeTool === "audio" && <div className="panel-content">
          <div className="section-intro"><div className="intro-art sound-art"><AudioLines size={22} /></div><strong>Almighty sound lab</strong><span>Original procedural sound effects, generated on your device as WAV files.</span></div>
          <div className="sound-list">{SOUNDS.map((sound) => { return <div className="sound-card" key={sound.id}><button className="sound-play" title={"Preview " + sound.name} onClick={() => playSoundPreview(sound.id)}><Play size={13} fill="currentColor" /></button><div className="sound-info"><strong>{sound.name}</strong><span>{sound.note}</span><div className="sound-wave">{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ height: (4 + ((i * 17 + sound.id.length * 7) % 12)) + "px" }} />)}</div></div><div className="sound-right"><span>{sound.length}</span><button className="square-button tiny" title={"Generate and add " + sound.name} onClick={() => addSoundToTimeline(sound.id)}><Plus size={14} /></button></div></div>; })}</div>
          <button className="button button-secondary full-width" onClick={importMedia}><Upload size={15} /> Import audio file</button>
        </div>}

        {activeTool === "effects" && <div className="panel-content">
          <div className="section-intro compact"><div className="intro-art effect-art"><Palette size={21} /></div><strong>Creative looks</strong><span>Stack effects on the selected video clip. Click an effect again to remove it.</span></div>
          <div className="effect-list">{EFFECTS.map((effect) => { const applied = selectedClip?.effects.includes(effect.id) ?? false; return <button key={effect.id} className={"effect-card " + (applied ? "applied" : "")} onClick={() => applyEffect(effect.id)}><span className={"effect-swatch swatch-" + effect.swatch}><span /></span><span className="effect-copy"><strong>{effect.name}</strong><small>{effect.note}</small></span>{applied ? <span className="applied-check"><Check size={14} /></span> : <Plus size={15} className="effect-plus" />}</button>; })}</div>
          {!selectedClip && <div className="inline-hint"><AlertTriangle size={14} /> Select a video clip in the timeline to apply looks.</div>}
        </div>}

        {activeTool === "transitions" && <div className="panel-content">
          <div className="section-intro compact"><div className="intro-art transition-art"><ArrowLeftRight size={22} /></div><strong>Move between moments</strong><span>Apply a transition to the selected clip. It blends from the clip before it.</span></div>
          <div className="transition-list">{TRANSITIONS.map((transition) => <button key={transition.id} className={"transition-card " + (selectedClip?.transitionBefore === transition.id ? "applied" : "")} onClick={() => { if (!selectedClip || selectedClip.track !== "V1") return notify("Select a video clip in Video 1 first."); updateClip(selectedClip.id, (clip) => ({ ...clip, transitionBefore: transition.id })); }}><span className={"transition-preview transition-" + transition.id}><i /><i /></span><span className="transition-copy"><strong>{transition.name}</strong><small>{transition.note}</small></span>{selectedClip?.transitionBefore === transition.id ? <Check size={15} className="transition-check" /> : null}</button>)}</div>
          {!selectedClip && <div className="inline-hint"><AlertTriangle size={14} /> Select a video clip in the timeline first.</div>}
        </div>}

        {activeTool === "titles" && <div className="panel-content">
          <div className="section-intro compact"><div className="intro-art title-art"><Type size={22} /></div><strong>Make it say something</strong><span>Title overlays are included in the MP4 export. Select a clip to set title timing.</span></div>
          <label className="field-label" htmlFor="title-text">TITLE TEXT</label><textarea id="title-text" className="title-input" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} rows={3} maxLength={180} placeholder="Type your title…" />
          <button className="button button-primary full-width" onClick={addTitle}><Plus size={15} /> Add title overlay</button>
          <div className="list-heading">PROJECT TITLES <b>{project.titles.length}</b></div>
          {project.titles.length === 0 ? <div className="empty-mini">No title overlays yet.</div> : project.titles.map((title) => <div className="title-row" key={title.id}><div><strong>{title.text}</strong><small>{formatTime(title.start)}–{formatTime(title.end)}</small></div><button className="icon-button" title="Remove title" onClick={() => updateProject((current) => ({ ...current, titles: current.titles.filter((item) => item.id !== title.id) }))}><Trash2 size={14} /></button></div>)}
        </div>}

        {activeTool === "settings" && <div className="panel-content">
          <div className="setting-card"><div className="setting-title"><HardDrive size={17} /><strong>Media engine</strong></div><div className="setting-status"><span className={"status-indicator " + (runtime?.ffmpegAvailable ? "ok" : "warn")} /><span>{runtime?.ffmpegAvailable ? "FFmpeg detected" : "FFmpeg not found"}</span><small>{runtime?.ffprobeAvailable ? "FFprobe ready" : "FFprobe unavailable"}</small></div><p>FFmpeg inspects media and renders your final video. Install it and add its bin folder to PATH.</p><button className="button button-secondary full-width" onClick={() => openUrl("https://ffmpeg.org/download.html")}>Get FFmpeg <ExternalLink size={14} /></button></div>
          <div className="setting-card"><div className="setting-title"><RefreshCw size={17} /><strong>Almighty updates</strong></div><p>Checks the latest stable GitHub Release and verifies the installer checksum before installation.</p><button className="button button-secondary full-width" onClick={checkUpdates} disabled={checkingUpdates}>{checkingUpdates ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Check for updates</button>{updateInfo && <small className="setting-detail">{updateInfo.message}</small>}</div>
          <div className="setting-card"><div className="setting-title"><Film size={17} /><strong>Project defaults</strong></div><div className="setting-values"><label>Resolution<select value={project.settings.width + "x" + project.settings.height} onChange={(event) => { const bits = event.target.value.split("x").map(Number); updateProject((current) => ({ ...current, settings: { ...current.settings, width: bits[0], height: bits[1] } })); }}><option value="1920x1080">1920 × 1080 · Full HD</option><option value="2560x1440">2560 × 1440 · QHD</option><option value="3840x2160">3840 × 2160 · 4K</option><option value="1280x720">1280 × 720 · HD</option></select></label><label>Frame rate<select value={project.settings.fps} onChange={(event) => updateProject((current) => ({ ...current, settings: { ...current.settings, fps: Number(event.target.value) } }))}><option value={24}>24 fps · Cinema</option><option value={25}>25 fps · PAL</option><option value={30}>30 fps · Standard</option><option value={60}>60 fps · Smooth</option></select></label></div></div>
          <div className="version-card"><span>ALMIGHTY VERSION</span><strong>{runtime?.version ?? APP_VERSION}</strong><small>Built for creators. More features are on the way.</small></div>
        </div>}
      </section>

      <main className="editor-main">
        <section className="preview-section">
          <div className="section-toolbar"><div className="section-toolbar-title"><Monitor size={15} /><span>PREVIEW</span><span className="toolbar-muted">· {project.settings.width} × {project.settings.height}</span></div><div className="preview-toolbar-actions"><span className="preview-fit">Fit <ChevronDown size={13} /></span><span className="preview-timecode">{formatTime(selectedClip?.start ?? 0)} <span>/</span> {formatTime(totalDuration)}</span></div></div>
          <div className="preview-stage"><div className="preview-monitor"><Preview asset={selectedAsset} clip={selectedClip} project={project} /></div></div>
          <div className="preview-bottom"><div className="preview-file"><span className="file-dot" />{selectedAsset ? selectedAsset.name : "No media selected"}</div><div className="preview-controls"><button className="mini-control" title="Trim selected clip" onClick={() => notify("Set exact trim points in the Inspector.")}><Scissors size={14} /></button><span className="control-divider" /><span>{selectedClip ? formatTime(clipDuration(selectedClip)) : "00:00"}</span><span className="control-muted">clip duration</span></div></div>
        </section>
        <section className="timeline-section">
          <div className="timeline-header"><div><div className="timeline-title"><Layers3 size={16} /><h3>Timeline</h3><span className="clip-count">{project.clips.length} clips</span></div><p>Arrange your story, layer sound, and fine-tune each shot.</p></div><div className="timeline-tools"><button className="icon-button" title="Import media" onClick={importMedia}><Upload size={15} /></button><button className="button button-quiet button-small" onClick={saveProjectFile}><Save size={14} /> Save project</button></div></div>
          <div className="timeline-scroll"><div className="timeline-board" style={{ width: timelineWidth + 72 }}>
            <div className="timeline-ruler"><div className="track-label ruler-label"><Clock3 size={13} /> TIME</div><div className="ruler-content" style={{ width: timelineWidth }}>{Array.from({ length: Math.ceil(timelineEnd / 5) + 1 }, (_, index) => index * 5).map((seconds) => <div className="ruler-tick" key={seconds} style={{ left: seconds * pxPerSecond }}><span>{formatTime(seconds)}</span><i /></div>)}</div></div>
            {TRACKS.map((track) => {
              const trackClips = project.clips.filter((clip) => clip.track === track.id);
              return <div className={"timeline-track track-" + track.id.toLowerCase()} key={track.id}><div className="track-label"><strong>{track.id}</strong><span>{track.label}</span><small>{track.hint}</small></div><div className="track-canvas" style={{ width: timelineWidth }} onClick={() => setSelectedClipId(undefined)}>
                {Array.from({ length: Math.ceil(timelineEnd / 5) + 1 }, (_, index) => index * 5).map((seconds) => <i className="track-gridline" key={seconds} style={{ left: seconds * pxPerSecond }} />)}
                {trackClips.map((clip) => {
                  const asset = project.media.find((media) => media.id === clip.mediaId);
                  const duration = clipDuration(clip);
                  return <button key={clip.id} className={"timeline-clip " + clip.track.toLowerCase() + "-clip " + (selectedClipId === clip.id ? "selected" : "")} style={{ left: clip.start * pxPerSecond, width: Math.max(74, duration * pxPerSecond - 4) }} onClick={(event) => { event.stopPropagation(); setSelectedClipId(clip.id); setSelectedMediaId(clip.mediaId); }}>
                    <span className="clip-edge left-edge" /><span className="clip-art">{clip.track === "V1" ? <Film size={13} /> : <Waves size={13} />}</span><span className="clip-text"><strong>{asset?.name ?? "Missing media"}</strong><small>{formatTime(duration)}{clip.effects.length ? " · " + clip.effects.length + " FX" : ""}</small></span>
                    {clip.track === "V1" && clip.transitionBefore !== "cut" && <span className="clip-transition" title={clip.transitionBefore}><ArrowLeftRight size={11} /></span>}
                    {clip.track !== "V1" && <span className="waveform-decoration">{Array.from({ length: 30 }, (_, i) => <i key={i} style={{ height: (4 + ((i * 17 + clip.id.length * 7) % 21)) + "px" }} />)}</span>}
                    <span className="clip-edge right-edge" />
                  </button>;
                })}
                {trackClips.length === 0 && <button className="track-empty" onClick={(event) => { event.stopPropagation(); setActiveTool(track.id === "V1" ? "media" : "audio"); }}>{track.id === "V1" ? "Add video or image clips" : "Add audio, music or sound effects"} <Plus size={13} /></button>}
              </div></div>;
            })}
            {project.titles.length > 0 && <div className="title-lane"><div className="track-label"><strong>T</strong><span>Titles</span></div><div className="title-lane-canvas" style={{ width: timelineWidth }}>{project.titles.map((title) => <button key={title.id} className="title-timeline-clip" style={{ left: title.start * pxPerSecond, width: Math.max(90, (title.end - title.start) * pxPerSecond) }} onClick={() => setActiveTool("titles")}><Type size={12} />{title.text}</button>)}</div></div>}
          </div></div>
          <div className="timeline-footer"><div><span className="timeline-legend video-legend" /> Video <span className="timeline-legend audio-legend" /> Audio <span className="timeline-legend title-legend" /> Titles</div><span>{formatTime(totalDuration)} total video duration <span className="status-separator">·</span> {project.clips.filter((clip) => clip.track === "A1" || clip.track === "A2").length} audio clips</span></div>
        </section>
      </main>

      <aside className="inspector-panel">
        <div className="inspector-heading"><div><span className="eyebrow">CONTROL ROOM</span><h2>Inspector</h2></div><Settings2 size={18} /></div>
        {!selectedClip ? <div className="inspector-empty"><div className="inspector-empty-art"><SlidersHorizontal size={23} strokeWidth={1.5} /></div><strong>Nothing selected</strong><span>Select a clip on the timeline to adjust its timing, volume, effects and transitions.</span>{selectedAsset && <div className="selected-media-summary"><IconForMedia kind={selectedAsset.kind} /><div><strong>{selectedAsset.name}</strong><small>{selectedAsset.kind} · {formatTime(selectedAsset.duration)}</small></div></div>}</div> :
          <div className="inspector-content">
            <div className="inspector-clip-id"><div className={"inspector-asset-icon " + selectedClip.track.toLowerCase()}><IconForMedia kind={selectedClipAsset?.kind ?? "video"} /></div><div><strong>{selectedClipAsset?.name ?? "Missing asset"}</strong><span>{selectedClip.track} · {selectedClipAsset?.kind ?? "unknown media"}</span></div><button className="icon-button" title="Remove clip" onClick={() => removeClip(selectedClip.id)}><Trash2 size={15} /></button></div>
            <div className="inspector-section"><div className="inspector-section-title"><Scissors size={14} /><strong>Timing</strong></div>
              <div className="number-field-grid"><label>Trim in <div className="number-input"><input type="number" min="0" step="0.1" value={selectedClip.trimStart} onChange={(event) => updateClip(selectedClip.id, (clip) => ({ ...clip, trimStart: Math.max(0, Math.min(Number(event.target.value), clip.trimEnd - 0.1)) }))} /><span>s</span></div></label><label>Trim out <div className="number-input"><input type="number" min="0.1" step="0.1" value={selectedClip.trimEnd} onChange={(event) => updateClip(selectedClip.id, (clip) => ({ ...clip, trimEnd: Math.max(clip.trimStart + 0.1, Math.min(Number(event.target.value), selectedClipAsset?.duration || 999999)) }))} /><span>s</span></div></label></div>
              <div className="inspector-metric"><span>Clip length</span><strong>{formatTime(clipDuration(selectedClip))}</strong></div><div className="inspector-metric"><span>Timeline position</span><strong>{formatTime(selectedClip.start)}</strong></div>
              <div className="move-actions"><button className="button button-quiet button-small" onClick={() => moveClip(selectedClip.id, -1)}>← Move earlier</button><button className="button button-quiet button-small" onClick={() => moveClip(selectedClip.id, 1)}>Move later →</button></div>
            </div>
            {selectedClip.track !== "V1" ? <div className="inspector-section"><div className="inspector-section-title"><Volume2 size={14} /><strong>Audio</strong></div><label className="range-label"><span>Volume</span><strong>{Math.round(selectedClip.volume * 100)}%</strong><input type="range" min="0" max="1.5" step="0.05" value={selectedClip.volume} onChange={(event) => updateClip(selectedClip.id, (clip) => ({ ...clip, volume: Number(event.target.value) }))} /></label><label className="toggle-row"><span>Mute clip</span><input type="checkbox" checked={selectedClip.muted} onChange={(event) => updateClip(selectedClip.id, (clip) => ({ ...clip, muted: event.target.checked }))} /><i /></label></div> :
              <div className="inspector-section"><div className="inspector-section-title"><Sparkles size={14} /><strong>Applied effects</strong><span className="count-pill">{selectedClip.effects.length}</span></div>{selectedClip.effects.length === 0 ? <p className="inspector-muted">No effects applied. Open Effects to style this clip.</p> : <div className="applied-effects">{selectedClip.effects.map((effect) => <span key={effect}>{EFFECTS.find((item) => item.id === effect)?.name ?? effect}<button onClick={() => applyEffect(effect)}><X size={11} /></button></span>)}</div>}<button className="button button-secondary full-width" onClick={() => setActiveTool("effects")}><Wand2 size={14} /> Browse effects</button></div>}
            {selectedClip.track === "V1" && <div className="inspector-section"><div className="inspector-section-title"><ArrowLeftRight size={14} /><strong>Transition before</strong></div><select className="inspector-select" value={selectedClip.transitionBefore} onChange={(event) => updateClip(selectedClip.id, (clip) => ({ ...clip, transitionBefore: event.target.value as TransitionId }))}>{TRANSITIONS.map((transition) => <option key={transition.id} value={transition.id}>{transition.name}</option>)}</select><p className="inspector-muted">Transitions overlap adjacent clips during export.</p><button className="button button-secondary full-width" onClick={() => setActiveTool("transitions")}>Explore transitions <ArrowLeftRight size={14} /></button></div>}
            <div className="inspector-section"><div className="inspector-section-title"><Layers3 size={14} /><strong>Clip actions</strong></div><button className="button button-danger-quiet full-width" onClick={() => removeClip(selectedClip.id)}><Trash2 size={14} /> Remove from timeline</button></div>
          </div>}
        <div className="inspector-footer"><span className={runtime?.ffmpegAvailable ? "engine-ready" : "engine-warning"}><i />{runtime?.ffmpegAvailable ? "Render engine ready" : "Render engine needs setup"}</span><span>Almighty {runtime?.version ?? APP_VERSION}</span></div>
      </aside>
    </div>

    <footer className="app-statusbar"><div><span className="status-led" /> {runtime?.ffmpegAvailable ? "FFmpeg ready" : "Setup needed: FFmpeg"} <span className="status-separator">·</span> {project.name}</div><div><span>{project.media.length} media</span><span className="status-separator">·</span><span>{project.clips.length} timeline clips</span><span className="status-separator">·</span><span>{project.settings.width}×{project.settings.height} / {project.settings.fps} FPS</span></div></footer>
    {toast && <div className="toast"><span className="toast-icon"><Check size={15} /></span><span>{toast}</span><button onClick={() => setToast("")}><X size={14} /></button></div>}
  </div>;
}