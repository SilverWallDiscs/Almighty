#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const RELEASE_API: &str = "https://api.github.com/repos/SilverWallDiscs/Almighty/releases/latest";
const INSTALLER_NAME: &str = "Almighty-setup.exe";
const CHECKSUM_NAME: &str = "Almighty-setup.exe.sha256";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo { version: String, ffmpeg_available: bool, ffprobe_available: bool, platform: String }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeResult { duration: f64, width: Option<u32>, height: Option<u32>, has_audio: bool, has_video: bool }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GeneratedAsset { id: String, name: String, path: String, kind: String, duration: f64, has_audio: bool, has_video: bool }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo { current_version: String, latest_version: String, update_available: bool, notes: Option<String>, message: String, download_url: Option<String> }
#[derive(Deserialize)]
struct GithubRelease { tag_name: String, name: Option<String>, body: Option<String>, prerelease: bool, draft: bool, assets: Vec<GithubAsset> }
#[derive(Deserialize)]
struct GithubAsset { name: String, browser_download_url: String }

fn program_works(program: &str, argument: &str) -> bool {
    Command::new(program).arg(argument).output().map(|output| output.status.success()).unwrap_or(false)
}

#[tauri::command]
fn get_runtime_info() -> RuntimeInfo {
    RuntimeInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        ffmpeg_available: program_works("ffmpeg", "-version"),
        ffprobe_available: program_works("ffprobe", "-version"),
        platform: std::env::consts::OS.to_string(),
    }
}

#[tauri::command]
fn probe_media(path: String) -> Result<ProbeResult, String> {
    if !Path::new(&path).is_file() { return Err("The selected media file no longer exists.".into()); }
    let output = Command::new("ffprobe")
        .args(["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", &path])
        .output().map_err(|_| "FFprobe was not found on PATH. Install FFmpeg to inspect media.".to_string())?;
    if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).trim().to_string()); }
    let data: Value = serde_json::from_slice(&output.stdout).map_err(|error| format!("Could not read media metadata: {error}"))?;
    let duration = data.get("format").and_then(|format| format.get("duration"))
        .and_then(|duration| duration.as_str().and_then(|s| s.parse::<f64>().ok()).or_else(|| duration.as_f64())).unwrap_or(0.0);
    let streams = data.get("streams").and_then(Value::as_array).cloned().unwrap_or_default();
    let has_audio = streams.iter().any(|stream| stream.get("codec_type").and_then(Value::as_str) == Some("audio"));
    let video = streams.iter().find(|stream| stream.get("codec_type").and_then(Value::as_str) == Some("video"));
    Ok(ProbeResult {
        duration: duration.max(0.0),
        width: video.and_then(|stream| stream.get("width")).and_then(Value::as_u64).map(|value| value as u32),
        height: video.and_then(|stream| stream.get("height")).and_then(Value::as_u64).map(|value| value as u32),
        has_audio, has_video: video.is_some(),
    })
}

#[tauri::command]
fn read_project_file(path: String) -> Result<String, String> {
    let file = Path::new(&path);
    if !file.is_file() { return Err("Project file could not be found.".into()); }
    let metadata = fs::metadata(file).map_err(|error| error.to_string())?;
    if metadata.len() > 32 * 1024 * 1024 { return Err("This project file is unexpectedly large.".into()); }
    fs::read_to_string(file).map_err(|error| format!("Could not read project: {error}"))
}

#[tauri::command]
fn write_project_file(path: String, data: String) -> Result<String, String> {
    let _: Value = serde_json::from_str(&data).map_err(|_| "The project data is not valid JSON.".to_string())?;
    if data.len() > 32 * 1024 * 1024 { return Err("This project file is too large to save.".into()); }
    fs::write(&path, data).map_err(|error| format!("Could not save project: {error}"))?;
    Ok(format!("Saved project to {path}"))
}

fn num(value: &Value, key: &str, fallback: f64) -> f64 { value.get(key).and_then(Value::as_f64).unwrap_or(fallback) }
fn text(value: &Value, key: &str, fallback: &str) -> String { value.get(key).and_then(Value::as_str).unwrap_or(fallback).to_string() }
fn bool_value(value: &Value, key: &str, fallback: bool) -> bool { value.get(key).and_then(Value::as_bool).unwrap_or(fallback) }
fn track_option(project: &Value, track: &str, key: &str) -> bool { project.pointer(&format!("/trackSettings/{track}/{key}")).and_then(Value::as_bool).unwrap_or(false) }
fn escape_filter_path(path: &Path) -> String { path.to_string_lossy().replace('\\', "/").replace(':', "\\:") }

fn safe_transition(name: &str) -> Option<&'static str> {
    match name {
        "fade" => Some("fade"), "dissolve" => Some("dissolve"), "wipeleft" => Some("wipeleft"),
        "wiperight" => Some("wiperight"), "slideleft" => Some("slideleft"), "slideright" => Some("slideright"),
        "circleopen" => Some("circleopen"), "circleclose" => Some("circleclose"), "smoothleft" => Some("smoothleft"), "radial" => Some("radial"),
        _ => None,
    }
}
fn effect_filters(clip: &Value) -> Vec<&'static str> {
    let mut filters = Vec::new();
    if let Some(effects) = clip.get("effects").and_then(Value::as_array) {
        for effect in effects.iter().filter_map(Value::as_str) {
            let filter = match effect {
                "cinematic" => Some("eq=contrast=1.12:saturation=1.15:brightness=-0.02"),
                "warm" => Some("colorbalance=rs=0.08:gs=0.02:bs=-0.06"),
                "cool" => Some("colorbalance=rs=-0.06:gs=0.01:bs=0.08"),
                "monochrome" => Some("hue=s=0"),
                "vintage" => Some("eq=saturation=0.78:contrast=1.08:brightness=0.03,vignette=PI/5"),
                "blur" => Some("boxblur=2:1"), "sharpen" => Some("unsharp=5:5:0.8:3:3:0.4"),
                "invert" => Some("negate"), "vignette" => Some("vignette=PI/5"),
                "boost" => Some("eq=saturation=1.3:contrast=1.12"), "filmgrain" => Some("noise=alls=8:allf=t+u"),
                _ => None,
            };
            if let Some(filter) = filter { filters.push(filter); }
        }
    }
    filters
}

#[tauri::command]
fn export_video(project: Value, output_path: String) -> Result<String, String> {
    if !program_works("ffmpeg", "-version") { return Err("FFmpeg was not found on PATH. Install FFmpeg, restart Almighty, and try again.".into()); }
    let media = project.get("media").and_then(Value::as_array).ok_or("Project has no media library.")?;
    let clips = project.get("clips").and_then(Value::as_array).ok_or("Project has no timeline.")?;
    let mut media_by_id: HashMap<String, Value> = HashMap::new();
    for asset in media { if let Some(id) = asset.get("id").and_then(Value::as_str) { media_by_id.insert(id.to_string(), asset.clone()); } }
    let mut video_clips: Vec<Value> = clips.iter().filter(|clip| text(clip, "track", "") == "V1").cloned().collect();
    video_clips.sort_by(|a, b| num(a, "start", 0.0).partial_cmp(&num(b, "start", 0.0)).unwrap_or(std::cmp::Ordering::Equal));
    if video_clips.is_empty() { return Err("Add at least one video or image clip to Video 1 before exporting.".into()); }

    let width = project.pointer("/settings/width").and_then(Value::as_u64).unwrap_or(1920).clamp(320, 7680);
    let height = project.pointer("/settings/height").and_then(Value::as_u64).unwrap_or(1080).clamp(240, 4320);
    let fps = project.pointer("/settings/fps").and_then(Value::as_u64).unwrap_or(30).clamp(12, 120);
    let mut args: Vec<String> = vec!["-hide_banner".into(), "-y".into(), "-loglevel".into(), "error".into()];
    let mut video_inputs: Vec<(Value, Value, usize)> = Vec::new();
    let mut audio_inputs: Vec<(Value, Value, usize)> = Vec::new();
    let mut next_input = 0usize;

    for clip in &video_clips {
        let media_id = text(clip, "mediaId", "");
        let asset = media_by_id.get(&media_id).cloned().ok_or("A video clip refers to missing media. Re-import the file.")?;
        let path = text(&asset, "path", "");
        if !Path::new(&path).is_file() { return Err(format!("Media file is missing: {}", text(&asset, "name", &path))); }
        if text(&asset, "kind", "video") == "image" { args.push("-loop".into()); args.push("1".into()); }
        args.push("-i".into()); args.push(path);
        video_inputs.push((clip.clone(), asset, next_input)); next_input += 1;
    }
    for clip in clips.iter().filter(|clip| {
        let track = text(clip, "track", "");
        track == "A1" || track == "A2"
    }) {
        if bool_value(clip, "muted", false) { continue; }
        let track_name = text(clip, "track", "");
        if track_option(&project, &track_name, "muted") || track_option(&project, &track_name, "hidden") { continue; }
        let media_id = text(clip, "mediaId", "");
        let asset = media_by_id.get(&media_id).cloned().ok_or("An audio clip refers to missing media.")?;
        if !bool_value(&asset, "hasAudio", text(&asset, "kind", "") == "audio") {
            return Err(format!("{} has no audio stream. Choose an audio file or a video with audio.", text(&asset, "name", "Selected media")));
        }
        let path = text(&asset, "path", "");
        if !Path::new(&path).is_file() { return Err(format!("Media file is missing: {}", text(&asset, "name", &path))); }
        args.push("-i".into()); args.push(path);
        audio_inputs.push((clip.clone(), asset, next_input)); next_input += 1;
    }

    let mut graph: Vec<String> = Vec::new();
    let mut durations: Vec<f64> = Vec::new();
    for (index, (clip, asset, input_index)) in video_inputs.iter().enumerate() {
        let kind = text(asset, "kind", "video");
        let trim_in = if kind == "image" { 0.0 } else { num(clip, "trimStart", 0.0).max(0.0) };
        let max_duration = num(asset, "duration", 0.0).max(0.1);
        let duration = (num(clip, "trimEnd", max_duration) - trim_in).min(max_duration - trim_in).max(0.1);
        durations.push(duration);
        let mut filters = vec![
            if kind == "image" { format!("trim=duration={duration:.4},setpts=PTS-STARTPTS") }
            else { format!("trim=start={trim_in:.4}:duration={duration:.4},setpts=PTS-STARTPTS") },
            format!("scale={width}:{height}:force_original_aspect_ratio=decrease"),
            format!("pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black"),
            format!("fps={fps}"), "setsar=1".into(), "format=yuv420p".into(),
        ];
        for effect in effect_filters(clip) { filters.push(effect.into()); }
        graph.push(format!("[{}:v]{}[vclip{}]", input_index, filters.join(","), index));
    }

    let first_start = num(&video_inputs[0].0, "start", 0.0).max(0.0);
    let mut current_label = "vclip0".to_string();
    let mut video_duration = durations[0];
    if first_start > 0.001 {
        graph.push(format!("color=c=black:s={width}x{height}:r={fps}:d={first_start:.4},format=yuv420p[vgapstart]"));
        graph.push("[vgapstart][vclip0]concat=n=2:v=1:a=0[vstart]".into());
        current_label = "vstart".to_string();
        video_duration += first_start;
    }
    for index in 1..video_inputs.len() {
        let clip = &video_inputs[index].0;
        let transition = text(clip, "transitionBefore", "cut");
        let output_label = format!("vjoin{index}");
        let desired_start = num(clip, "start", video_duration).max(0.0);
        if let Some(transition_name) = safe_transition(&transition) {
            let requested_blend = num(clip, "transitionDuration", 0.45).clamp(0.1, 2.0);
            let blend = requested_blend.min(durations[index]).min(video_duration.max(0.1)).max(0.1);
            let required_end = desired_start + blend;
            if required_end > video_duration + 0.001 {
                let gap = required_end - video_duration;
                let gap_label = format!("vgap{index}");
                let padded_label = format!("vgapjoin{index}");
                graph.push(format!("color=c=black:s={width}x{height}:r={fps}:d={gap:.4},format=yuv420p[{gap_label}]"));
                graph.push(format!("[{current_label}][{gap_label}]concat=n=2:v=1:a=0[{padded_label}]"));
                current_label = padded_label;
                video_duration = required_end;
            }
            let offset = desired_start.min((video_duration - blend).max(0.0));
            graph.push(format!("[{current_label}][vclip{index}]xfade=transition={transition_name}:duration={blend:.4}:offset={offset:.4}[{output_label}]"));
            video_duration = video_duration.max(offset + durations[index]);
        } else {
            let start = desired_start.max(video_duration);
            if start > video_duration + 0.001 {
                let gap = start - video_duration;
                let gap_label = format!("vgap{index}");
                let padded_label = format!("vgapjoin{index}");
                graph.push(format!("color=c=black:s={width}x{height}:r={fps}:d={gap:.4},format=yuv420p[{gap_label}]"));
                graph.push(format!("[{current_label}][{gap_label}]concat=n=2:v=1:a=0[{padded_label}]"));
                current_label = padded_label;
                video_duration = start;
            }
            graph.push(format!("[{current_label}][vclip{index}]concat=n=2:v=1:a=0[{output_label}]"));
            video_duration = start + durations[index];
        }
        current_label = output_label;
    }

    if track_option(&project, "V1", "hidden") {
        graph.push(format!("color=c=black:s={width}x{height}:r={fps}:d={video_duration:.4},format=yuv420p[vhidden]"));
        current_label = "vhidden".to_string();
    }

    let mut title_files: Vec<PathBuf> = Vec::new();
    if let Some(titles) = project.get("titles").and_then(Value::as_array) {
        for (index, title) in titles.iter().enumerate() {
            let content = text(title, "text", "");
            if content.trim().is_empty() { continue; }
            let start = num(title, "start", 0.0).max(0.0).min(video_duration);
            let end = num(title, "end", video_duration).max(start + 0.1).min(video_duration.max(start + 0.1));
            let fontsize = num(title, "fontSize", 48.0).clamp(16.0, 120.0) as u32;
            let y = num(title, "y", 0.16).clamp(0.05, 0.85);
            let color = match text(title, "color", "white").as_str() { "yellow" => "yellow", "cyan" => "cyan", _ => "white" };
            let path = std::env::temp_dir().join(format!("almighty-title-{index}.txt"));
            fs::write(&path, content).map_err(|error| format!("Could not prepare title overlay: {error}"))?;
            let escaped = escape_filter_path(&path);
            title_files.push(path);
            let output_label = format!("vtitle{index}");
            graph.push(format!("[{current_label}]drawtext=fontcolor={color}:fontsize={fontsize}:x=(w-text_w)/2:y=h*{y:.4}:box=1:boxcolor=black@0.38:boxborderw=18:textfile='{escaped}':enable='between(t,{start:.4},{end:.4})'[{output_label}]"));
            current_label = output_label;
        }
    }
    graph.push(format!("[{current_label}]format=yuv420p[vout]"));

    let mut audio_labels: Vec<String> = Vec::new();
    let mut audio_index = 0usize;
    for (clip, asset, input_index) in &video_inputs {
        if !bool_value(asset, "hasAudio", false) || bool_value(clip, "muted", false) || track_option(&project, "V1", "muted") || track_option(&project, "V1", "hidden") { continue; }
        let trim_in = num(clip, "trimStart", 0.0).max(0.0);
        let duration = (num(clip, "trimEnd", num(asset, "duration", 1.0)) - trim_in).max(0.1);
        let volume = num(clip, "volume", 1.0).clamp(0.0, 2.0);
        let delay = (num(clip, "start", 0.0).max(0.0) * 1000.0) as u64;
        let label = format!("aud{audio_index}");
        graph.push(format!("[{input_index}:a]atrim=start={trim_in:.4}:duration={duration:.4},asetpts=PTS-STARTPTS,volume={volume:.3},adelay=delays={delay}:all=1[{label}]"));
        audio_labels.push(label); audio_index += 1;
    }
    for (clip, _asset, input_index) in &audio_inputs {
        let trim_in = num(clip, "trimStart", 0.0).max(0.0);
        let duration = (num(clip, "trimEnd", 8.0) - trim_in).max(0.1);
        let volume = num(clip, "volume", 1.0).clamp(0.0, 2.0);
        let delay = (num(clip, "start", 0.0).max(0.0) * 1000.0) as u64;
        let label = format!("aud{audio_index}");
        graph.push(format!("[{input_index}:a]atrim=start={trim_in:.4}:duration={duration:.4},asetpts=PTS-STARTPTS,volume={volume:.3},adelay=delays={delay}:all=1[{label}]"));
        audio_labels.push(label); audio_index += 1;
    }
    if !audio_labels.is_empty() {
        let inputs = audio_labels.iter().map(|label| format!("[{label}]")).collect::<String>();
        graph.push(format!("{inputs}amix=inputs={}:duration=longest:dropout_transition=0,alimiter=limit=0.98[aout]", audio_labels.len()));
    }

    let output = PathBuf::from(&output_path);
    if let Some(parent) = output.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() { fs::create_dir_all(parent).map_err(|error| format!("Could not create export folder: {error}"))?; }
    }
    args.push("-filter_complex".into()); args.push(graph.join(";"));
    args.push("-map".into()); args.push("[vout]".into());
    if !audio_labels.is_empty() {
        args.push("-map".into()); args.push("[aout]".into());
        args.extend(["-c:a".into(), "aac".into(), "-b:a".into(), "192k".into()]);
    } else { args.push("-an".into()); }
    args.extend(["-c:v".into(), "libx264".into(), "-preset".into(), "medium".into(), "-crf".into(), "20".into(),
        "-pix_fmt".into(), "yuv420p".into(), "-movflags".into(), "+faststart".into(), "-t".into(), format!("{video_duration:.4}"), output_path.clone()]);
    let result = Command::new("ffmpeg").args(&args).output().map_err(|error| format!("Could not start FFmpeg: {error}"))?;
    for title_file in title_files { let _ = fs::remove_file(title_file); }
    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        let detail = stderr.chars().rev().take(2500).collect::<String>().chars().rev().collect::<String>();
        return Err(format!("FFmpeg could not render the project. Check the media and effects, then try again.\n{detail}"));
    }
    Ok(format!("Export complete: {}", output.display()))
}

#[tauri::command]
fn create_sound_effect(app: AppHandle, effect: String) -> Result<GeneratedAsset, String> {
    let (duration, name) = match effect.as_str() {
        "whoosh" => (1.0, "Whoosh"), "impact" => (0.8, "Cinematic impact"), "pop" => (0.2, "Pop"),
        "beep" => (0.4, "Digital beep"), "riser" => (1.4, "Riser"), "click" => (0.1, "Soft click"),
        "glitch" => (0.4, "Glitch"), "chime" => (0.8, "Chime"), "subdrop" => (0.9, "Sub drop"),
        "vinyl" => (1.2, "Vinyl texture"), _ => return Err("Unknown sound effect preset.".into()),
    };
    let folder = app.path().app_data_dir().map_err(|error| error.to_string())?.join("generated-sounds");
    fs::create_dir_all(&folder).map_err(|error| format!("Could not create sound library: {error}"))?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
    let path = folder.join(format!("{effect}-{stamp}.wav"));
    write_procedural_wav(&path, &effect, duration)?;
    Ok(GeneratedAsset { id: format!("sfx-{effect}-{stamp}"), name: format!("{name}.wav"), path: path.to_string_lossy().to_string(), kind: "audio".into(), duration, has_audio: true, has_video: false })
}
fn write_procedural_wav(path: &Path, effect: &str, duration: f64) -> Result<(), String> {
    let sample_rate = 44_100_u32;
    let count = (duration * sample_rate as f64) as usize;
    let mut samples: Vec<i16> = Vec::with_capacity(count);
    let mut seed = 0xA17A_2D51_u32;
    for i in 0..count {
        let t = i as f64 / sample_rate as f64;
        let p = t / duration;
        seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5;
        let noise = ((seed & 0xffff) as f64 / 32767.5) - 1.0;
        let (signal, envelope) = match effect {
            "whoosh" => (noise * (0.2 + (p * std::f64::consts::PI).sin().abs() * 0.8), (1.0 - p).powf(0.7)),
            "impact" => { let f = 88.0 * (-5.0 * p).exp() + 28.0; ((2.0 * std::f64::consts::PI * f * t).sin() * 0.9 + noise * (-45.0 * p).exp() * 0.35, (-5.5 * p).exp()) },
            "pop" => ((2.0 * std::f64::consts::PI * (420.0 - 220.0 * p) * t).sin(), (-9.0 * p).exp()),
            "beep" => ((2.0 * std::f64::consts::PI * 880.0 * t).sin(), (-(p * 5.0).powi(2)).exp().max(0.15)),
            "riser" => { let f = 160.0 + 1250.0 * p; (((2.0 * std::f64::consts::PI * f * t).sin() * 0.45) + noise * 0.4, p.powf(1.5)) },
            "click" => (noise * 0.7 + (2.0 * std::f64::consts::PI * 1800.0 * t).sin() * 0.3, (-70.0 * p).exp()),
            "glitch" => { let gate = if ((t * 31.0) as u32) % 4 == 0 { 1.0 } else { 0.24 }; ((2.0 * std::f64::consts::PI * (170.0 + ((t * 17.0).sin() + 1.0) * 470.0) * t).sin() * 0.7 + noise * 0.3, gate * (1.0 - p).max(0.0)) },
            "chime" => { let bell = (2.0 * std::f64::consts::PI * 660.0 * t).sin() * 0.55 + (2.0 * std::f64::consts::PI * 990.0 * t).sin() * 0.28 + (2.0 * std::f64::consts::PI * 1320.0 * t).sin() * 0.17; (bell, (-4.0 * p).exp()) },
            "subdrop" => { let f = 120.0 * (-2.7 * p).exp() + 28.0; ((2.0 * std::f64::consts::PI * f * t).sin(), (-(p * 3.7).powi(2)).exp()) },
            "vinyl" => (noise * 0.22 + if (seed & 0x3fff) < 18 { noise * 0.7 } else { 0.0 }, 0.5),
            _ => (0.0, 0.0),
        };
        samples.push(((signal * envelope * 0.62).clamp(-1.0, 1.0) * i16::MAX as f64) as i16);
    }
    let data_len = (samples.len() * 2) as u32;
    let mut file = fs::File::create(path).map_err(|error| format!("Could not create sound file: {error}"))?;
    file.write_all(b"RIFF").map_err(|error| error.to_string())?;
    file.write_all(&(36 + data_len).to_le_bytes()).map_err(|error| error.to_string())?;
    file.write_all(b"WAVEfmt ").map_err(|error| error.to_string())?;
    file.write_all(&16_u32.to_le_bytes()).map_err(|error| error.to_string())?;
    file.write_all(&1_u16.to_le_bytes()).map_err(|error| error.to_string())?;
    file.write_all(&1_u16.to_le_bytes()).map_err(|error| error.to_string())?;
    file.write_all(&sample_rate.to_le_bytes()).map_err(|error| error.to_string())?;
    file.write_all(&(sample_rate * 2).to_le_bytes()).map_err(|error| error.to_string())?;
    file.write_all(&2_u16.to_le_bytes()).map_err(|error| error.to_string())?;
    file.write_all(&16_u16.to_le_bytes()).map_err(|error| error.to_string())?;
    file.write_all(b"data").map_err(|error| error.to_string())?;
    file.write_all(&data_len.to_le_bytes()).map_err(|error| error.to_string())?;
    for sample in samples { file.write_all(&sample.to_le_bytes()).map_err(|error| error.to_string())?; }
    Ok(())
}

async fn request_latest_release() -> Result<Option<GithubRelease>, String> {
    let client = reqwest::Client::builder().user_agent(format!("Almighty-Video-Editor/{}", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(20)).build().map_err(|error| error.to_string())?;
    let response = client.get(RELEASE_API).send().await.map_err(|error| format!("Could not reach GitHub Releases: {error}"))?;
    if response.status() == reqwest::StatusCode::NOT_FOUND { return Ok(None); }
    if !response.status().is_success() { return Err(format!("GitHub Releases returned HTTP {}.", response.status())); }
    let release = response.json::<GithubRelease>().await.map_err(|error| format!("Could not read the latest release: {error}"))?;
    if release.draft || release.prerelease { return Ok(None); }
    Ok(Some(release))
}
async fn get_update_info() -> Result<UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let Some(release) = request_latest_release().await? else {
        return Ok(UpdateInfo { current_version: current.clone(), latest_version: current, update_available: false, notes: None, message: "No stable GitHub Release has been published yet.".into(), download_url: None });
    };
    let latest = release.tag_name.trim_start_matches('v').to_string();
    let current_semver = semver::Version::parse(&current).map_err(|error| error.to_string())?;
    let latest_semver = semver::Version::parse(&latest).map_err(|error| format!("Invalid release version tag: {error}"))?;
    let installer = release.assets.iter().find(|asset| asset.name == INSTALLER_NAME);
    let checksum = release.assets.iter().find(|asset| asset.name == CHECKSUM_NAME);
    let has_download = installer.is_some() && checksum.is_some();
    let update_available = latest_semver > current_semver && has_download;
    let message = if update_available { format!("Almighty {latest} is available to install.") }
        else if latest_semver > current_semver && !has_download { format!("Version {latest} exists, but its installer or checksum is missing.") }
        else { format!("Almighty is up to date (version {current}).") };
    Ok(UpdateInfo { current_version: current, latest_version: latest, update_available, notes: release.body.or(release.name), message, download_url: installer.map(|asset| asset.browser_download_url.clone()) })
}
#[tauri::command]
async fn check_for_updates() -> Result<UpdateInfo, String> { get_update_info().await }

#[tauri::command]
async fn install_latest_update(app: AppHandle) -> Result<String, String> {
    let info = get_update_info().await?;
    if !info.update_available { return Err("There is no newer stable installer available.".into()); }
    let release = request_latest_release().await?.ok_or("No stable release was found.")?;
    let installer = release.assets.iter().find(|asset| asset.name == INSTALLER_NAME).ok_or("The release installer is missing.")?;
    let checksum = release.assets.iter().find(|asset| asset.name == CHECKSUM_NAME).ok_or("The installer checksum is missing.")?;
    let prefix = "https://github.com/SilverWallDiscs/Almighty/releases/download/";
    if !installer.browser_download_url.starts_with(prefix) || !checksum.browser_download_url.starts_with(prefix) {
        return Err("GitHub returned an unexpected installer URL; update cancelled.".into());
    }
    let client = reqwest::Client::builder().user_agent(format!("Almighty-Video-Editor/{}", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(180)).build().map_err(|error| error.to_string())?;
    let checksum_text = client.get(&checksum.browser_download_url).send().await.map_err(|error| error.to_string())?
        .error_for_status().map_err(|error| error.to_string())?.text().await.map_err(|error| error.to_string())?;
    let expected = checksum_text.split_whitespace().next().unwrap_or("").to_ascii_lowercase();
    if expected.len() != 64 || !expected.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err("The release checksum is invalid; update cancelled.".into());
    }
    let bytes = client.get(&installer.browser_download_url).send().await.map_err(|error| error.to_string())?
        .error_for_status().map_err(|error| error.to_string())?.bytes().await.map_err(|error| error.to_string())?;
    let actual = format!("{:x}", Sha256::digest(&bytes));
    if actual != expected { return Err("Installer SHA-256 verification failed. The file was not launched.".into()); }
    let safe_version = info.latest_version.chars().filter(|character| character.is_ascii_alphanumeric() || *character == '.' || *character == '-').collect::<String>();
    let path = std::env::temp_dir().join(format!("Almighty-update-{safe_version}.exe"));
    fs::write(&path, &bytes).map_err(|error| format!("Could not save verified installer: {error}"))?;
    Command::new(&path).arg("/S").spawn().map_err(|error| format!("The installer was verified but could not launch: {error}"))?;
    app.exit(0);
    Ok("The verified installer is starting.".into())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_runtime_info, probe_media, read_project_file, write_project_file,
            export_video, create_sound_effect, check_for_updates, install_latest_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running Almighty");
}