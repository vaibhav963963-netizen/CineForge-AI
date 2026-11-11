"""Narration with Kokoro-82M (Apache-2.0) via kokoro-onnx: fully offline, models from <workspace>/models/kokoro.

  python voice.py --script <project>/script.json --out-dir <project>/audio --voice hm_omega --lang hi --speed 1.0
  python voice.py --list                       installed voices (read from voices-v1.0.bin)

Everything is explicit: the voice, the phonemizer language and the speed come from the validated generation config.
Nothing is inferred from the voice name and nothing falls back to another language or voice. A voice whose language
does not match --lang, or Hindi narration text that is not in Devanagari, is an error (exit code 2).

script.json lines: [{ "text": "<display/caption text>", "say": "<what the voice reads, optional>", "gap": 0.3 }, ...]
  · "say" is used when present (Hinglish: Roman-script captions, Devanagari narration).
  · Lines are grouped into whole sentences (ending in . ? ! । ॥) and each sentence is spoken in ONE pass so the
    intonation flows; cut points inside a sentence are placed by phoneme share and snapped to the nearest pause.
Outputs: <out-dir>/narration.wav (24 kHz mono) and <out-dir>/lines.json (exact line times, voice, lang, speed).
Progress for the studio: "@@PROGRESS {json}" lines; final "@@RESULT {json}".
"""
import argparse, json, os, re, sys, time, zipfile
from pathlib import Path
import numpy as np
from scipy.io import wavfile

ROOT = Path(os.environ.get('STUDIO_ROOT') or Path(__file__).resolve().parents[2])
KDIR = Path(os.environ.get('KOKORO_DIR') or ROOT / 'models' / 'kokoro')
ONNX, VOICES = KDIR / 'kokoro-v1.0.onnx', KDIR / 'voices-v1.0.bin'
SR = 24000
VOICE_LANG = {'a': 'en-us', 'b': 'en-gb', 'h': 'hi'}
SENT_END = re.compile(r'[.?!।॥]["\'”’)\]]*$')
DEVA = re.compile(r'[ऀ-ॿ]')
LATIN = re.compile(r'[A-Za-z]')


def emit(kind, obj): print(f'@@{kind} ' + json.dumps(obj, ensure_ascii=False), flush=True)
def progress(cur, tot, msg): emit('PROGRESS', {'current': cur, 'total': tot, 'message': msg, 'unit': 'sentence'})
def fail(msg): print(f'ERROR: {msg}', file=sys.stderr, flush=True); sys.exit(2)


def installed_voices():
    with zipfile.ZipFile(VOICES) as z: return sorted(n[:-4] for n in z.namelist() if n.endswith('.npy'))


def trim(x, thr=0.008):
    """cut leading/trailing silence so line start/end times are exact"""
    idx = np.where(np.abs(x) > thr)[0]
    if not len(idx): return x
    a = max(0, idx[0] - int(0.01 * SR)); b = min(len(x), idx[-1] + int(0.03 * SR)); return x[a:b]


def silences(x, thr=0.012, min_len=0.06):
    """pauses inside speech: [(start_s, end_s)] where the 10 ms RMS stays under thr for >= min_len"""
    hop = int(0.01 * SR); n = len(x) // hop
    if n == 0: return []
    rms = np.sqrt(np.mean(x[:n * hop].reshape(n, hop) ** 2, axis=1)); quiet = rms < thr * np.abs(x).max()
    out, st = [], None
    for f, q in enumerate(quiet):
        if q and st is None: st = f
        if (not q or f == n - 1) and st is not None:
            if (f - st) * 0.01 >= min_len: out.append((st * 0.01, f * 0.01))
            st = None
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--script'); ap.add_argument('--out-dir'); ap.add_argument('--voice'); ap.add_argument('--lang')
    ap.add_argument('--speed', type=float); ap.add_argument('--list', action='store_true')
    a = ap.parse_args()
    if not ONNX.exists() or not VOICES.exists():
        fail(f'Kokoro model files missing in {KDIR} (expected kokoro-v1.0.onnx + voices-v1.0.bin). Run setup-workspace.bat.')
    voices = installed_voices()
    if a.list:
        for v in voices:
            if v[0] in VOICE_LANG: print(f'{v:12s} {VOICE_LANG[v[0]]}')
        return
    for k in ('script', 'out_dir', 'voice', 'lang', 'speed'):
        if getattr(a, k) in (None, ''): fail(f'--{k.replace("_", "-")} is required (no defaults: the studio passes the validated selection)')
    if a.voice not in voices: fail(f'voice "{a.voice}" is not in {VOICES.name}')
    if a.lang not in set(VOICE_LANG.values()): fail(f'unsupported --lang "{a.lang}" (supported: en-us, en-gb, hi)')
    if VOICE_LANG.get(a.voice[0]) != a.lang:
        fail(f'voice "{a.voice}" speaks {VOICE_LANG.get(a.voice[0], "an unsupported language")}, not {a.lang}; choose a matching voice')
    if not 0.5 <= a.speed <= 2.0: fail('--speed out of range')

    S = json.loads(Path(a.script).read_text(encoding='utf-8'))
    L = S['lines']
    spoken = [(ln.get('say') or ln['text']).strip() for ln in L]
    for i, t in enumerate(spoken):
        if not t: fail(f'line {i + 1} is empty')
        deva, lat = len(DEVA.findall(t)), len(LATIN.findall(t))
        if a.lang == 'hi' and deva < max(1, 0.6 * (deva + lat)):
            fail(f'line {i + 1} must be Devanagari for the Hindi voice (Kokoro reads Roman-script text with English phonemes): "{t[:60]}"')
        if a.lang.startswith('en') and deva > 0:
            fail(f'line {i + 1} contains Devanagari text but the narration language is English')

    from kokoro_onnx import Kokoro
    from kokoro_onnx.tokenizer import Tokenizer
    progress(0, 1, 'Loading Kokoro model')
    t0 = time.time()
    k = Kokoro(str(ONNX), str(VOICES)); tok = Tokenizer()
    say = lambda text: trim(np.asarray(k.create(text, voice=a.voice, speed=a.speed, lang=a.lang)[0], dtype=np.float64))
    phon_len = lambda text: max(1, len(re.sub(r'[ˈˌ\s]', '', tok.phonemize(text, a.lang))))

    groups, cur = [], []
    for i, ln in enumerate(L):
        cur.append(i)
        if SENT_END.search(spoken[i]) or ln.get('break') or i == len(L) - 1: groups.append(cur); cur = []
    out = [np.zeros(int(float(S.get('lead', 0.4)) * SR))]; t = len(out[0]) / SR; lines = [None] * len(L)
    for gi, g in enumerate(groups):
        progress(gi, len(groups), f'Synthesizing sentence {gi + 1} of {len(groups)}')
        x = say(' '.join(spoken[i] for i in g))
        cuts = [0.0]
        if len(g) > 1:                                    # each cut inside the sentence: phoneme share, snapped to a pause
            lens = np.array([phon_len(spoken[i]) for i in g], dtype=float)
            pauses = silences(x)
            for c in np.cumsum(lens)[:-1] / lens.sum() * len(x) / SR:
                near = [p for p in pauses if abs((p[0] + p[1]) / 2 - c) < 0.45]
                if near: p = min(near, key=lambda p: abs((p[0] + p[1]) / 2 - c)); cuts.append((p[0], p[1]))
                else: cuts.append((c, c))
        n = len(x) / SR
        for j, i in enumerate(g):
            a0 = 0.0 if j == 0 else cuts[j][1]; b0 = n if j == len(g) - 1 else cuts[j + 1][0]
            lines[i] = {'i': i, 'text': L[i]['text'], 'say': spoken[i], 'start': round(t + a0, 3), 'end': round(t + b0, 3)}
            print(f'{i:2d} {lines[i]["start"]:6.2f}-{lines[i]["end"]:6.2f}  {spoken[i]}', flush=True)
        gap = np.zeros(int(float(L[g[-1]].get('gap', S.get('gap', 0.3))) * SR))
        out += [x, gap]; t += (len(x) + len(gap)) / SR
    out.append(np.zeros(int(float(S.get('outro', 0.9)) * SR)))
    y = np.concatenate(out); y = y / (np.abs(y).max() + 1e-9) * 0.9
    od = Path(a.out_dir); od.mkdir(parents=True, exist_ok=True)
    wavfile.write(od / 'narration.wav', SR, (y * 32767).astype(np.int16))
    dur = len(y) / SR
    speech = sum(l['end'] - l['start'] for l in lines)
    meta = {'duration': round(dur, 3), 'speechSeconds': round(speech, 3), 'voice': a.voice, 'lang': a.lang, 'speed': a.speed,
            'model': 'Kokoro-82M v1.0 ONNX', 'synthSeconds': round(time.time() - t0, 1), 'lines': lines}
    (od / 'lines.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding='utf-8')
    progress(len(groups), len(groups), f'Narration synthesized: {dur:.2f} s')
    emit('RESULT', {'duration': round(dur, 3), 'speechSeconds': round(speech, 3), 'voice': a.voice, 'lang': a.lang, 'speed': a.speed, 'sentences': len(groups), 'synthSeconds': meta['synthSeconds']})


if __name__ == '__main__':
    main()
