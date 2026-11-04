#!/usr/bin/env python3
"""Sonidos del barrio, sintetizados (sin grabaciones): ambiente de día y de noche, pájaros, palomas, bocinas, colectivo, moto,
perros a lo lejos y una cumbia que suena lejos en la villa.

  python3 herramientas/sonidos.py          -> sfx/*.mp3 (mono, 22 050 Hz; MP3 porque lo abren todos los navegadores, también Safari)

Todo sale de ruido filtrado, osciladores y envolventes; cada sonido con su semilla, así se puede volver a generar igual.
Las cosas "lejanas" (perros, cumbia, colectivo) pasan por un pasabajos y una reverberación corta para que suenen a distancia.
"""
import os, subprocess, tempfile
import numpy as np
from scipy import signal

SR = 22050
OUT = os.path.join(os.path.dirname(__file__), "..", "sfx")


def t_(dur):
    return np.arange(int(dur * SR)) / SR


def lp(x, f, order=2):
    b, a = signal.butter(order, f / (SR / 2), "low"); return signal.lfilter(b, a, x)


def hp(x, f, order=2):
    b, a = signal.butter(order, f / (SR / 2), "high"); return signal.lfilter(b, a, x)


def bp(x, f0, f1, order=2):
    b, a = signal.butter(order, [f0 / (SR / 2), f1 / (SR / 2)], "band"); return signal.lfilter(b, a, x)


def env(n, a, r, sustain=None):
    """attack a s, release r s (exponential), over n samples"""
    e = np.ones(n); na = max(1, int(a * SR)); e[:na] = np.linspace(0, 1, na)
    nr = max(1, int(r * SR)); e[-nr:] *= np.exp(-np.linspace(0, 5, nr)); return e


def chirp_phase(f):
    return 2 * np.pi * np.cumsum(f) / SR


def reverb(x, dur=.5, mix=.3, rng=None):
    rng = rng or np.random.default_rng(1)
    n = int(dur * SR); ir = rng.standard_normal(n) * np.exp(-np.linspace(0, 6, n)); ir = lp(ir, 3000); ir /= np.abs(ir).sum() / 6
    wet = signal.fftconvolve(x, ir)[:len(x)]; return x * (1 - mix) + wet * mix


def pad(x, before=.02, after=.3):
    return np.concatenate([np.zeros(int(before * SR)), x, np.zeros(int(after * SR))])


def norm(x, peak=.9):
    m = np.abs(x).max(); return x / m * peak if m > 0 else x


def loop_xfade(x, xf=2.0):
    """loop sin corte: el final se funde con el principio"""
    n = int(xf * SR); a, b = x[:n], x[-n:]; w = np.linspace(0, 1, n)
    y = x[:-n].copy(); y[:n] = a * w + b * (1 - w); return y


def save(name, x, q=5):
    os.makedirs(OUT, exist_ok=True)
    x = np.clip(x, -1, 1)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        from scipy.io import wavfile
        wavfile.write(f.name, SR, (x * 32767).astype(np.int16)); tmp = f.name
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-c:a", "libmp3lame", "-q:a", str(q), os.path.join(OUT, name + ".mp3")], check=True)
    os.unlink(tmp); print(f"  {name}.mp3  {len(x) / SR:.1f} s")


# ---------- ambiente
def ambiente_dia(rng):
    d = 42; n = int(d * SR)
    brown = np.cumsum(rng.standard_normal(n)); brown = hp(brown, 20); brown = lp(brown, 180, 3)
    swell = .6 + .4 * np.sin(2 * np.pi * (.05 * t_(d) + rng.random())) * np.sin(2 * np.pi * (.013 * t_(d)))
    rumble = norm(brown) * swell
    hiss = norm(bp(rng.standard_normal(n), 400, 1800)) * .12 * (.7 + .3 * np.sin(2 * np.pi * .07 * t_(d)))
    # autos que pasan lejos: soplidos de ruido que suben y bajan
    pasos = np.zeros(n)
    for _ in range(14):
        c = rng.uniform(1, d - 4); L = rng.uniform(2.5, 4.5); i0 = int(c * SR); m = int(L * SR)
        if i0 + m >= n: continue
        w = np.hanning(m) ** 2; pasos[i0:i0 + m] += bp(rng.standard_normal(m), 150, 900) * w * rng.uniform(.15, .35)
    return loop_xfade(norm(rumble * .7 + hiss + pasos, .55))


def grillo(rng, d, f0, rate, amp):
    tt = t_(d); out = np.zeros(len(tt)); per = 1 / rate; tcur = rng.uniform(0, per)
    while tcur < d - .2:
        for k in range(3):   # tres pulsos por canto
            i = int((tcur + k * .028) * SR); m = int(.016 * SR)
            if i + m < len(out): out[i:i + m] += np.sin(2 * np.pi * f0 * tt[:m]) * np.hanning(m)
        tcur += per * rng.uniform(.85, 1.15)
    return out * amp


def ambiente_noche(rng):
    d = 32; n = int(d * SR)
    x = sum(grillo(rng, d, rng.uniform(4000, 5200), rng.uniform(1.6, 2.6), rng.uniform(.2, .5)) for _ in range(6))
    x = lp(x, 6000) + lp(hp(np.cumsum(rng.standard_normal(n)), 20), 140, 3) * 0.0
    brown = np.cumsum(rng.standard_normal(n)); rumble = norm(lp(hp(brown, 20), 150, 3)) * .25
    return loop_xfade(norm(x * .8 + rumble, .45))


# ---------- pájaros
def gorrion(rng):
    parts = []
    for _ in range(rng.integers(4, 9)):
        dur = rng.uniform(.05, .11); tt = t_(dur); f0 = rng.uniform(3200, 4600)
        f = f0 + rng.uniform(-900, 900) * np.sin(np.pi * tt / dur) - rng.uniform(0, 600) * tt / dur
        s = np.sin(chirp_phase(f)) + .25 * np.sin(2 * chirp_phase(f)); parts += [s * env(len(tt), .005, dur * .6), np.zeros(int(rng.uniform(.04, .16) * SR))]
    return norm(reverb(pad(np.concatenate(parts)), .25, .15, rng), .6)


def benteveo(rng):
    def nota(f0, f1, dur, vib=0):
        tt = t_(dur); f = np.linspace(f0, f1, len(tt)) + vib * np.sin(2 * np.pi * 28 * tt)
        p = chirp_phase(f); return (np.sin(p) + .45 * np.sin(2 * p) + .2 * np.sin(3 * p)) * env(len(tt), .01, dur * .5)
    g = lambda s: np.zeros(int(s * SR))
    x = np.concatenate([nota(2100, 2400, .14), g(.06), nota(2600, 2900, .12), g(.07), nota(3300, 2300, .36, 60)])
    return norm(reverb(pad(lp(x, 7000)), .3, .2, rng), .55)


def zorzal(rng):
    parts = []
    for _ in range(rng.integers(5, 9)):
        dur = rng.uniform(.08, .22); tt = t_(dur); a, b = rng.uniform(1800, 3600, 2)
        f = np.linspace(a, b, len(tt)) + 40 * np.sin(2 * np.pi * rng.uniform(15, 35) * tt)
        p = chirp_phase(f); parts += [(np.sin(p) + .3 * np.sin(2 * p)) * env(len(tt), .01, dur * .5), np.zeros(int(rng.uniform(.03, .12) * SR))]
    return norm(reverb(pad(np.concatenate(parts)), .35, .2, rng), .5)


def paloma(rng):
    parts = []
    for k in range(3):
        dur = [.35, .25, .5][k]; tt = t_(dur); f = 330 + 60 * np.sin(np.pi * tt / dur) - 30 * tt
        p = chirp_phase(f); s = (np.sin(p) + .5 * np.sin(2 * p)) * (1 + .4 * np.sin(2 * np.pi * 22 * tt))
        s = lp(s + .1 * rng.standard_normal(len(tt)), 1200) * env(len(tt), .06, dur * .5); parts += [s, np.zeros(int(.12 * SR))]
    return norm(pad(np.concatenate(parts)), .5)


# ---------- calle
def bocina(rng, doble=False):
    def toque(dur):
        tt = t_(dur); f1, f2 = rng.uniform(380, 440), 0
        f2 = f1 * 1.26
        s = signal.square(2 * np.pi * f1 * tt, .5) + .8 * signal.square(2 * np.pi * f2 * tt, .5)
        return lp(s, 2500, 2) * env(len(tt), .01, .05)
    x = np.concatenate([toque(.18), np.zeros(int(.1 * SR)), toque(.45)]) if doble else toque(rng.uniform(.35, .7))
    return norm(reverb(pad(x), .3, .2, rng), .5)


def pasada(rng, dur, f0, armonicos, ruido, doppler=.06):
    """un motor que pasa: frecuencia que baja al pasar (Doppler), volumen que sube y baja"""
    tt = t_(dur); u = (tt - dur / 2) / (dur / 6)
    f = f0 * (1 + doppler * (-np.tanh(u))); p = chirp_phase(f)
    s = sum(a * np.sin((k + 1) * p + rng.uniform(0, 6)) for k, a in enumerate(armonicos))
    s += ruido * bp(rng.standard_normal(len(tt)), 200, 2500)
    vol = 1 / (1 + u * u)
    return s * vol


def colectivo(rng):
    d = 7; x = pasada(rng, d, 48, [1, .8, .6, .5, .35, .3, .2, .15], .25, .05)
    x = lp(x, 1600, 2)
    if rng.random() < .8:   # frenos de aire
        i = int(rng.uniform(.45, .6) * len(x)); m = int(.7 * SR)
        x[i:i + m] += hp(rng.standard_normal(m), 2500) * np.exp(-np.linspace(0, 4, m)) * .6
    return norm(reverb(pad(x, .02, .6), .5, .25, rng), .65)


def moto(rng):
    d = 3.5; tt = t_(d); u = (tt - d / 2) / (d / 6); f = rng.uniform(95, 130) * (1 + .09 * -np.tanh(u)); p = chirp_phase(f)
    s = signal.sawtooth(p) * .7 + signal.square(p * 2, .3) * .3
    s = lp(s, 2200) * (1 / (1 + u * u)) * (1 + .15 * np.sin(2 * np.pi * 9 * tt))
    return norm(reverb(pad(s), .35, .2, rng), .55)


def perro(rng):
    parts = []
    for _ in range(rng.integers(2, 5)):
        dur = rng.uniform(.12, .2); tt = t_(dur); f0 = rng.uniform(380, 520) * (1 - .35 * tt / dur)
        pulses = signal.sawtooth(chirp_phase(f0), .1)
        s = bp(pulses, 650, 1000) * 1.0 + bp(pulses, 1400, 2000) * .6 + bp(rng.standard_normal(len(tt)), 800, 2500) * .35
        parts += [s * env(len(tt), .004, dur * .6), np.zeros(int(rng.uniform(.18, .45) * SR))]
    x = lp(np.concatenate(parts), 2200)
    return norm(reverb(pad(x, .02, .8), .7, .45, rng), .45)


def cumbia(rng):
    """cumbia que suena lejos (un parlante en un patio): güiro, bajo, acordes de teclado a contratiempo, todo con pasabajos"""
    bpm = 94; beat = 60 / bpm; bars = 8; d = bars * 4 * beat; n = int(d * SR); x = np.zeros(n)
    prog = [(55.0, [220, 277.2, 329.6]), (73.4, [293.7, 349.2, 440]), (82.4, [329.6, 415.3, 493.9]), (55.0, [220, 277.2, 329.6])]   # La m, Re m, Mi, La m
    for bar in range(bars):
        root, chord = prog[bar % 4]
        for b4 in range(4):
            t0 = (bar * 4 + b4) * beat
            for (off, f) in [(0, root), (beat / 2, root * 1.5)]:      # bajo: tónica y quinta
                i = int((t0 + off) * SR); m = int(beat * .45 * SR); tt = t_(m / SR)
                if i + m < n: x[i:i + m] += np.sin(2 * np.pi * f * tt) * env(m, .01, .15) * .9
            i = int((t0 + beat / 2) * SR); m = int(beat * .3 * SR); tt = t_(m / SR)   # teclado a contratiempo
            if i + m < n: x[i:i + m] += sum(signal.square(2 * np.pi * fc * tt, .4) for fc in chord) * env(m, .005, .08) * .18
            for (off, L) in [(0, .55), (beat * .5, .2), (beat * .75, .2)]:   # güiro: largo, corto, corto
                i = int((t0 + off) * SR); m = int(beat * L * SR)
                if i + m < n: x[i:i + m] += bp(rng.standard_normal(m), 2500, 6000) * (1 + np.sign(np.sin(2 * np.pi * 70 * t_(m / SR)))) * .5 * env(m, .01, .05) * .35
    x = lp(x, 900, 3)          # lejos: sin agudos
    return norm(reverb(x, .6, .35, rng), .5)


SONIDOS = {
    "amb_dia": (ambiente_dia, 5), "amb_noche": (ambiente_noche, 5),
    "gorrion_1": (gorrion, 5), "gorrion_2": (gorrion, 5), "gorrion_3": (gorrion, 5), "benteveo": (benteveo, 5), "zorzal_1": (zorzal, 5), "zorzal_2": (zorzal, 5),
    "paloma": (paloma, 5), "bocina_1": (lambda r: bocina(r), 5), "bocina_2": (lambda r: bocina(r, True), 5), "bocina_3": (lambda r: bocina(r), 5),
    "colectivo_1": (colectivo, 5), "colectivo_2": (colectivo, 5), "moto": (moto, 5), "perro_1": (perro, 5), "perro_2": (perro, 5), "perro_3": (perro, 5),
    "cumbia": (cumbia, 5),
}

if __name__ == "__main__":
    for k, (name, (fn, q)) in enumerate(SONIDOS.items()):
        save(name, fn(np.random.default_rng(1000 + k)), q)
