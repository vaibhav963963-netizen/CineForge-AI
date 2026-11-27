import json
import math
from pathlib import Path
import numpy as np
from scipy.io import wavfile

def verify_project_audio(project_dir):
    p = Path(project_dir)
    wav_path = p / 'audio' / 'narration.wav'
    lines_path = p / 'audio' / 'lines.json'
    words_path = p / 'audio' / 'words.json'
    script_path = p / 'script.json'

    sr, data = wavfile.read(wav_path)
    if data.dtype == np.int16:
        samples = data.astype(np.float32) / 32768.0
    elif data.dtype == np.float32:
        samples = data
    else:
        samples = data.astype(np.float32) / np.max(np.abs(data))

    total_samples = len(samples)
    duration = total_samples / sr

    # Peak & RMS
    peak = float(np.max(np.abs(samples)))
    rms = float(np.sqrt(np.mean(samples ** 2)))
    rms_db = 20 * math.log10(max(rms, 1e-9))
    peak_db = 20 * math.log10(max(peak, 1e-9))
    clipped = bool(peak >= 0.999)

    lines_data = json.loads(lines_path.read_text(encoding='utf-8'))
    words_data = json.loads(words_path.read_text(encoding='utf-8'))
    script_data = json.loads(script_path.read_text(encoding='utf-8'))

    # Measure inter-sentence pauses
    # From lines.json, check gap between consecutive lines
    lines = lines_data.get('lines', [])
    gaps = []
    for i in range(len(lines) - 1):
        l_curr = lines[i]
        l_next = lines[i + 1]
        gap_dur = l_next['start'] - l_curr['end']
        
        # Measure physical silence in the audio between l_curr['end'] and l_next['start']
        s_idx = int(l_curr['end'] * sr)
        e_idx = int(l_next['start'] * sr)
        segment = samples[s_idx:e_idx] if e_idx > s_idx else np.array([])
        seg_rms = float(np.sqrt(np.mean(segment ** 2))) if len(segment) > 0 else 0.0
        
        script_text = script_data['lines'][i]['text'].strip()
        last_char = script_text[-1] if script_text else ''
        expected_gap = 0.52 if last_char == '?' else (0.36 if last_char == '!' else 0.44)

        gaps.append({
            'from_line': i,
            'to_line': i + 1,
            'last_char': last_char,
            'expected_gap': expected_gap,
            'timeline_gap': round(gap_dur, 3),
            'silence_samples_len': len(segment),
            'silence_rms_db': round(20 * math.log10(max(seg_rms, 1e-9)), 1)
        })

    # Check sync: each caption/line start/end falls within spoken segment in words.json (within 150ms)
    sync_checks = []
    all_sync_ok = True
    for i, line in enumerate(lines):
        line_words = [w for w in words_data if w.get('line') == i]
        if not line_words:
            sync_checks.append({'line': i, 'ok': False, 'error': 'no words for line'})
            all_sync_ok = False
            continue
        first_w = line_words[0]
        last_w = line_words[-1]
        
        # line start vs first word start
        start_diff_ms = abs(line['start'] - first_w['s']) * 1000
        # line end vs last word end
        end_diff_ms = abs(line['end'] - last_w['e']) * 1000

        # line start should precede or match word start (within lead margin)
        # prompt: each caption's start/end from lines.json falls within the spoken segment in words.json (within 150 ms)
        is_ok = (start_diff_ms <= 150 or line['start'] <= first_w['s'] + 0.15) and (end_diff_ms <= 150 or line['end'] >= last_w['e'] - 0.15)
        if not is_ok:
            all_sync_ok = False

        sync_checks.append({
            'line': i,
            'line_start': round(line['start'], 3),
            'first_word_s': round(first_w['s'], 3),
            'start_diff_ms': round(start_diff_ms, 1),
            'line_end': round(line['end'], 3),
            'last_word_e': round(last_w['e'], 3),
            'end_diff_ms': round(end_diff_ms, 1),
            'ok': is_ok
        })

    report = {
        'project': project_dir,
        'sr': sr,
        'duration_s': round(duration, 2),
        'peak': round(peak, 4),
        'peak_db': round(peak_db, 2),
        'rms': round(rms, 4),
        'rms_db': round(rms_db, 2),
        'clipped': clipped,
        'gaps': gaps,
        'sync_checks': sync_checks,
        'all_sync_ok': all_sync_ok
    }
    print(json.dumps(report, indent=2))
    return report

if __name__ == '__main__':
    verify_project_audio('projects/how-was-earth-born-1f0a96')
