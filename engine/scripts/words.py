"""Word timings with local faster-whisper (MIT): <project>/audio/words.json [{w, line, s, e}].

  python words.py --project <dir> --model <whisper model dir> --language en|hi

Run after voice.py (needs audio/narration.wav + audio/lines.json + script.json). The model directory is passed
explicitly by the studio (models/whisper = small.en for English, models/whisper-multilingual for Hindi): nothing is
downloaded and there is no silent fallback; if Whisper can't load or transcribe, this exits with an error.

Words keep the SCRIPT's spelling with the times Whisper heard. Matching is Unicode-aware (Devanagari is kept, nukta /
chandrabindu variants are folded), words Whisper heard differently share the time between matched neighbours.
For Hinglish the voice reads the Devanagari "say" text: spoken-word times are mapped back onto the Roman caption words.
Every word stays inside its line's exact TTS window. Progress: "@@PROGRESS {json}"; final "@@RESULT {json}".
"""
import argparse, json, os, re, subprocess, sys, unicodedata
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(os.environ.get('STUDIO_ROOT') or Path(__file__).resolve().parents[2])
FFMPEG = ROOT / 'runtime' / 'ffmpeg' / 'bin' / ('ffmpeg.exe' if os.name == 'nt' else 'ffmpeg')
PUNCT = re.compile(r'[\s.,!?;:"\'“”‘’()\[\]{}«»।॥…\-–—/\\*|]+')


def emit(kind, obj): print(f'@@{kind} ' + json.dumps(obj, ensure_ascii=False), flush=True)
def fail(msg): print(f'ERROR: {msg}', file=sys.stderr, flush=True); sys.exit(2)


def norm(w):
    w = unicodedata.normalize('NFC', w).lower()
    w = w.replace('़', '').replace('ँ', 'ं')       # nukta, chandrabindu → anusvara
    return PUNCT.sub('', w)


def tokens(text): return [w for w in text.split() if norm(w)]


# Phonetic skeleton for matching Whisper's Hindi spelling against the script's: Whisper hears the right sounds but
# often spells them differently (इस्रो/इसरो, दर्ती/धरती, ज़्यादा/जियादा). Fold aspiration, vowel length, nasalisation,
# virama and sibilant/nasal variants; Latin text is only lower-cased.
_FOLD = str.maketrans({'ध': 'द', 'भ': 'ब', 'थ': 'त', 'घ': 'ग', 'झ': 'ज', 'ढ': 'ड', 'ठ': 'ट', 'छ': 'च', 'ख': 'क', 'फ': 'प',
                       'ष': 'स', 'श': 'स', 'ण': 'न', 'ञ': 'न', 'ङ': 'न', 'ऋ': 'र', 'ृ': 'र',
                       'ी': 'ि', 'ू': 'ु', 'ै': 'े', 'ौ': 'ो', 'ई': 'इ', 'ऊ': 'उ', 'ऐ': 'ए', 'औ': 'ओ', 'ॉ': 'ा', 'ऑ': 'आ',
                       '्': None, 'ं': None, 'ँ': None, 'ः': None, '़': None})
def key(w): return norm(w).translate(_FOLD)


def align(script_words, heard, t0, t1):
    """script_words: [str]; heard: [(word, s, e)] → ([(s, e)] per script word inside [t0, t1], matched count)"""
    a = [key(w) for w in script_words]; b = [key(h[0]) for h in heard]
    times = [None] * len(a); matched = 0
    for blk in SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks():
        for k in range(blk.size): times[blk.a + k] = (heard[blk.b + k][1], heard[blk.b + k][2]); matched += 1
    # second pass: fuzzy-match inside unmatched gaps (Whisper spells Hindi words slightly differently)
    i = 0
    while i < len(a):
        if times[i] is not None: i += 1; continue
        j = i
        while j < len(a) and times[j] is None: j += 1
        lo_t = times[i - 1][1] if i > 0 else t0; hi_t = times[j][0] if j < len(a) else t1
        cand = [k for k, h in enumerate(heard) if h[1] >= lo_t - 0.05 and h[2] <= hi_t + 0.05]
        used, nxt = set(), 0
        for q in range(i, j):
            best, span = 0.0, None
            # a script word may be heard as 1-3 consecutive fragments ("भरो से मंद" → "भरोसेमंद")
            for x, k in enumerate(cand):
                if x < nxt: continue
                for n in (1, 2, 3):
                    ks = cand[x:x + n]
                    if len(ks) < n or any(y in used for y in ks) or (n > 1 and ks[-1] - ks[0] != n - 1): break
                    r = SequenceMatcher(None, a[q], ''.join(b[y] for y in ks)).ratio()
                    if r > best: best, span = r, (x, ks)
            if span and best >= 0.62:
                x, ks = span
                times[q] = (heard[ks[0]][1], heard[ks[-1]][2]); used.update(ks); matched += 1; nxt = x + len(ks)
        i = j
    # enforce order, then fill the remaining gaps between matched neighbours, split by word length
    last = t0
    for q in range(len(a)):
        if times[q] is not None:
            if times[q][0] < last: times[q] = None
            else: last = times[q][1]
    i = 0
    while i < len(a):
        if times[i] is not None: i += 1; continue
        j = i
        while j < len(a) and times[j] is None: j += 1
        lo = times[i - 1][1] if i > 0 else t0; hi = times[j][0] if j < len(a) else t1
        if hi <= lo: hi = lo + 0.05 * (j - i)
        Ls = [max(1, len(a[k])) for k in range(i, j)]; tot = sum(Ls); c = lo
        for k, l in zip(range(i, j), Ls): d = (hi - lo) * l / tot; times[k] = (c, c + d * 0.9); c += d
        i = j
    return times, matched


def map_to_display(display, spoken_times, lo, hi):
    """display words of one line ← timed spoken words of the same line (1:1 when the counts match)."""
    if not display: return []
    if len(display) == len(spoken_times): return list(spoken_times)
    if not spoken_times: spoken_times = [(lo, hi)]
    s0, s1 = spoken_times[0][0], spoken_times[-1][1]
    Ls = [max(1, len(norm(w))) for w in display]; tot = sum(Ls); c = s0; out = []
    for l in Ls: d = (s1 - s0) * l / tot; out.append((c, c + d * 0.92)); c += d
    return out


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--project', required=True); ap.add_argument('--model', required=True)
    ap.add_argument('--language', required=True, choices=['en', 'hi']); a = ap.parse_args()
    P = Path(a.project); md = Path(a.model)
    if not (md / 'model.bin').exists(): fail(f'Whisper model not found at {md} (model.bin missing)')
    vocab = 0
    try: vocab = len((md / 'vocabulary.txt').read_text(encoding='utf-8').replace('\r', '').rstrip('\n').split('\n'))   # blank lines are real tokens
    except Exception:
        try: vocab = len(json.loads((md / 'vocabulary.json').read_text(encoding='utf-8')))
        except Exception: pass
    if a.language != 'en' and vocab and vocab < 51865: fail(f'{md.name} is an English-only Whisper model; it cannot align {a.language}')
    S = json.loads((P / 'script.json').read_text(encoding='utf-8'))
    LJ = json.loads((P / 'audio' / 'lines.json').read_text(encoding='utf-8'))
    L = LJ['lines']; dur_audio = float(LJ['duration'])
    emit('PROGRESS', {'fraction': 0.0, 'message': 'Loading Whisper model'})
    try:
        from faster_whisper import WhisperModel
        model = WhisperModel(str(md), device='cpu', compute_type='int8', local_files_only=True)
    except Exception as e: fail(f'Whisper could not load from {md}: {type(e).__name__}: {e}')
    import numpy as np
    raw = subprocess.run([str(FFMPEG), '-v', 'error', '-i', str(P / 'audio' / 'narration.wav'), '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    audio = np.frombuffer(raw, dtype=np.float32)
    spoken_lines = [(ln.get('say') or ln['text']) for ln in S['lines']]
    prompt = ' '.join(spoken_lines)[:220]
    # independent evidence of the spoken language: Whisper language-ID on the narration (not forced)
    detected = None
    if vocab >= 51865:
        try:
            lang_id, lang_p, _all = model.detect_language(audio[:16000 * 30])
            detected = {'language': lang_id, 'probability': round(float(lang_p), 3)}
            emit('PROGRESS', {'fraction': 0.03, 'message': f'Spoken language detected: {lang_id} ({lang_p:.0%})'})
            if lang_id != a.language: emit('WARN', f'Whisper identifies the narration as "{lang_id}" ({lang_p:.0%}), not "{a.language}"')
        except Exception as e:
            emit('WARN', f'language identification unavailable: {type(e).__name__}: {e}')
    try:
        # no initial_prompt: when the prompt equals the audio's own words, Whisper can treat them as already
        # transcribed and skip the opening seconds (observed: first 16 s of a Hindi narration missing)
        kw = dict(word_timestamps=True, vad_filter=False, condition_on_previous_text=False, beam_size=1, best_of=1)   # greedy: the script is known, only timings are needed
        if vocab >= 51865: kw['language'] = a.language
        segs, info = model.transcribe(audio, **kw)
        heard = []
        for s in segs:
            heard += [(w.word.strip(), w.start + 0.04, w.end) for w in (s.words or [])]
            emit('PROGRESS', {'fraction': min(0.9, 0.9 * s.end / max(dur_audio, 0.1)), 'message': f'Transcribing narration: {s.end:.1f} s of {dur_audio:.1f} s'})
    except Exception as e: fail(f'Whisper could not transcribe the narration: {type(e).__name__}: {e}')

    toks = [(w, i) for i, t in enumerate(spoken_lines) for w in tokens(t)]
    times, matched = align([w for w, _ in toks], heard, 0.0, dur_audio)
    words, total = [], sum(len(tokens(ln['text'])) for ln in S['lines'])
    done = 0
    for i, ln in enumerate(S['lines']):
        lo, hi = L[i]['start'], L[i]['end']
        st = [(min(max(s, lo), hi), min(max(e, lo), hi)) for (w, li), (s, e) in zip(toks, times) if li == i]
        disp = tokens(ln['text'])
        for w, (s, e) in zip(disp, map_to_display(disp, st, lo, hi)):
            words.append({'w': w, 'line': i, 's': round(s, 3), 'e': round(max(e, s + 0.02), 3)}); done += 1
        emit('PROGRESS', {'fraction': 0.9 + 0.1 * done / max(total, 1), 'current': done, 'total': total, 'unit': 'word', 'message': f'Aligning word {done} of {total}'})
    (P / 'audio' / 'words.json').write_text(json.dumps(words, ensure_ascii=False, indent=1), encoding='utf-8')
    (P / 'audio' / 'words.txt').write_text('\n'.join(f"{w['s']:7.2f} {w['e']:7.2f}  L{w['line']:<2d} {w['w']}" for w in words), encoding='utf-8')
    rate = matched / max(len(toks), 1)
    lang = getattr(info, 'language', None); prob = getattr(info, 'language_probability', None)
    if rate < 0.35: emit('WARN', f'Whisper matched only {rate:.0%} of the narration words; caption timing between matches is interpolated')
    emit('RESULT', {'words': len(words), 'heard': len(heard), 'matched': matched, 'matchRate': round(rate, 3), 'model': md.name,
                    'detectedLanguage': detected['language'] if detected else lang, 'languageProbability': detected['probability'] if detected else (round(prob, 3) if prob is not None else None),
                    'languageCheck': 'whisper-language-id' if detected else 'english-only-model',
                    'transcript': ' '.join(h[0] for h in heard)[:600]})
    print(f'audio/words.json: {len(words)} words (Whisper heard {len(heard)}, matched {matched}/{len(toks)})')


if __name__ == '__main__':
    main()
