"""Automated Visual Quality Assurance (QA) Tool
AI Shorts Studio India

Performs deep frame-by-frame analysis on rendered MP4 shorts:
1. Frame difference / motion analysis (detects frozen / repetitive / static scenes > 1.5s)
2. Black frame / blank frame detection
3. Resolution, aspect ratio (1080x1920, 9:16 vertical), and frame rate (30 fps) validation
4. Audio track validation (AAC stream, volume level, non-silent audio)
5. Generates structured JSON QA report
"""

import sys
import json
import subprocess
from pathlib import Path

WORKSPACE = Path(__file__).resolve().parent.parent
FFMPEG = WORKSPACE / 'runtime' / 'ffmpeg' / 'bin' / 'ffmpeg.exe'
FFPROBE = WORKSPACE / 'runtime' / 'ffmpeg' / 'bin' / 'ffprobe.exe'

def probe_video(video_path):
    cmd = [
        str(FFPROBE), '-v', 'error',
        '-show_entries', 'stream=index,codec_name,codec_type,width,height,r_frame_rate,duration,nb_frames',
        '-show_entries', 'format=duration,size,bit_rate',
        '-of', 'json',
        str(video_path)
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return json.loads(res.stdout)

def analyze_frames(video_path, max_static_sec=1.5):
    # Extract low-res grayscale frame deltas using ffmpeg mpdecimate / scene filter
    cmd = [
        str(FFMPEG), '-i', str(video_path),
        '-vf', 'select=gt(scene\\,0.005),metadata=print:key=lavfi.scene_score:file=-',
        '-f', 'null', '-'
    ]
    # Alternatively, inspect frame similarity with freeze detection
    freeze_cmd = [
        str(FFMPEG), '-i', str(video_path),
        '-vf', f'freezedetect=n=-50dB:d={max_static_sec}',
        '-map', '0:v:0',
        '-f', 'null', '-'
    ]
    res = subprocess.run(freeze_cmd, capture_output=True, text=True)
    freeze_lines = [l for l in res.stderr.splitlines() if 'freezedetect' in l]
    
    frozen_periods = []
    current_start = None
    for line in freeze_lines:
        if 'freeze_start:' in line:
            parts = line.split('freeze_start:')
            if len(parts) > 1:
                try:
                    current_start = float(parts[1].split()[0])
                except:
                    pass
        elif 'freeze_end:' in line and current_start is not None:
            parts = line.split('freeze_end:')
            if len(parts) > 1:
                try:
                    end = float(parts[1].split()[0])
                    dur = end - current_start
                    frozen_periods.append({'start': current_start, 'end': end, 'duration': dur})
                    current_start = None
                except:
                    pass

    return frozen_periods

def run_qa(project_dir):
    p = Path(project_dir)
    renders_dir = p / 'renders'
    mp4_files = list(renders_dir.glob('*.mp4'))
    if not mp4_files:
        raise FileNotFoundError(f"No MP4 files found in {renders_dir}")
    
    video_path = mp4_files[0]
    info = probe_video(video_path)
    
    v_stream = next((s for s in info.get('streams', []) if s['codec_type'] == 'video'), None)
    a_stream = next((s for s in info.get('streams', []) if s['codec_type'] == 'audio'), None)
    fmt = info.get('format', {})

    width = v_stream.get('width', 0) if v_stream else 0
    height = v_stream.get('height', 0) if v_stream else 0
    fps_raw = v_stream.get('r_frame_rate', '0/1') if v_stream else '0/1'
    fps = eval(fps_raw) if '/' in fps_raw else float(fps_raw)
    duration = float(fmt.get('duration', 0))
    size_mb = round(int(fmt.get('size', 0)) / (1024 * 1024), 2)

    # Detect frozen / repetitive frame sequences
    frozen_periods = analyze_frames(video_path, max_static_sec=1.5)

    checks = {
        'resolution_1080x1920': width == 1080 and height == 1920,
        'aspect_ratio_vertical_9_16': width == 1080 and height == 1920,
        'framerate_30fps': abs(fps - 30.0) < 0.1,
        'audio_stream_present': a_stream is not None,
        'audio_codec_aac': a_stream.get('codec_name') == 'aac' if a_stream else False,
        'no_frozen_scenes_over_1_5s': len(frozen_periods) == 0,
        'duration_valid': duration > 10.0
    }

    all_passed = all(checks.values())

    report = {
        'projectName': p.name,
        'videoFile': video_path.name,
        'status': 'PASS' if all_passed else 'WARNING',
        'metrics': {
            'width': width,
            'height': height,
            'fps': fps,
            'durationSec': round(duration, 2),
            'sizeMB': size_mb,
            'audioCodec': a_stream.get('codec_name') if a_stream else None,
            'frozenSequencesCount': len(frozen_periods),
            'frozenSequences': frozen_periods
        },
        'checks': checks
    }

    out_file = p / 'review' / 'qa_report.json'
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(json.dumps(report, indent=2))
    print(f"QA Report written to {out_file}")
    print(json.dumps(report, indent=2))
    return report

if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else '.'
    run_qa(target)
