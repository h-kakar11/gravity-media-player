#!/usr/bin/env node
/**
 * Generates a small but varied sample library with ffmpeg so the app (and its tests) can be
 * tried without any real media: movies with multiple audio tracks, subtitles and chapters,
 * an HEVC/AC3 file that needs transcoding, a 300 fps clip, TV episodes, tagged music with
 * cover art and lyrics, photos and GIFs, CBZ and folder-based manga, and an EPUB.
 *
 *   node scripts/make-sample-media.mjs [outDir] [--quick]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { strToU8, zipSync } from 'fflate';

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const out = resolve(args.find((a) => !a.startsWith('--')) ?? 'sample-media');
const tmp = mkdtempSync(join(tmpdir(), 'gravity-sample-'));

function findFfmpeg() {
  for (const bin of ['ffmpeg', 'ffmpeg.exe']) {
    if (spawnSync(bin, ['-version']).status === 0) return bin;
  }
  try {
    return createRequire(import.meta.url)('@ffmpeg-installer/ffmpeg').path;
  } catch {
    throw new Error('ffmpeg not found. Install ffmpeg or `npm install` to get the bundled one.');
  }
}
import { createRequire } from 'node:module';
const FFMPEG = findFfmpeg();

function fontFile() {
  const candidates = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/opentype/inter/InterDisplay-Bold.otf',
    '/Library/Fonts/Arial Bold.ttf', '/System/Library/Fonts/Helvetica.ttc', 'C:/Windows/Fonts/arialbd.ttf', 'C:/Windows/Fonts/arial.ttf'
  ];
  return candidates.find((p) => existsSync(p));
}
const FONT = fontFile();
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '');
// Text containing %{...} expansions is passed through verbatim; plain text is escaped for the filtergraph.
const text = (t, o = '') => (FONT ? `drawtext=fontfile='${esc(FONT)}':text='${t.includes('%{') ? t : esc(t)}':${o}` : null);
const chain = (...f) => f.filter(Boolean).join(',');

function ff(...a) {
  const t0 = Date.now();
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...a], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (process.env.SAMPLE_VERBOSE) console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s ${a[a.length - 1].split(/[\\/]/).pop()}`);
}
const mk = (...p) => { const d = join(out, ...p); mkdirSync(d, { recursive: true }); return d; };

const D = quick ? 6 : 24; // base duration for features
console.log(`Writing sample library to ${out}${quick ? ' (quick)' : ''} using ${FFMPEG}`);
rmSync(out, { recursive: true, force: true });

// -- artwork ---------------------------------------------------------------

function poster(file, title, hue, w = 600, h = 900) {
  const c0 = `0x${hue[0]}`, c1 = `0x${hue[1]}`;
  ff('-f', 'lavfi', '-i', `gradients=s=${w}x${h}:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=${w}:y1=${h}:duration=1:speed=0.001:seed=${hue[0].length + title.length}`,
    '-vf', chain(text(title, `fontsize=${Math.round(w / 9)}:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:shadowcolor=black@0.5:shadowx=2:shadowy=2`) ?? 'null'), '-frames:v', '1', '-q:v', '3', file);
}
function cover(file, title, hue, s = 640) { poster(file, title, hue, s, s); }

// -- movies ----------------------------------------------------------------

function video({ file, title, w = 1280, h = 720, fps = 30, dur = D, vcodec = ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-pix_fmt', 'yuv420p'], audio = [{ f: 440, lang: 'eng', title: 'English' }], acodec = ['-c:a', 'aac', '-b:a', '96k'], extra = [], inputs = [], maps = [] }) {
  const vf = chain(`hue=h=${(title.length * 37) % 360}`, text(title, 'fontsize=h/14:fontcolor=white:x=(w-text_w)/2:y=h*0.08:box=1:boxcolor=black@0.5:boxborderw=10'), text('%{pts\\:hms}', 'fontsize=h/12:fontcolor=yellow:x=w*0.04:y=h*0.84:box=1:boxcolor=black@0.5:boxborderw=8'));
  const a = ['-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=${fps}`, ...audio.flatMap((x) => ['-f', 'lavfi', '-i', `sine=frequency=${x.f}:sample_rate=48000`]), ...inputs];
  const map = ['-map', '0:v', ...audio.flatMap((_, i) => ['-map', `${i + 1}:a`]), ...maps];
  const meta = audio.flatMap((x, i) => [`-metadata:s:a:${i}`, `language=${x.lang}`, `-metadata:s:a:${i}`, `title=${x.title}`]);
  ff(...a, '-vf', vf, ...map, ...vcodec, ...acodec, ...meta, ...extra, '-t', String(dur), file);
}

const movies = mk('Movies');
const orbit = mk('Movies', 'Orbit Study (2021)');
poster(join(orbit, 'poster.jpg'), 'ORBIT STUDY', ['2b1055', '7597de']);
writeFileSync(join(orbit, 'Orbit Study (2021).nfo'), '<movie><title>Orbit Study</title><year>2021</year><plot>A quiet study of bodies in motion, told in two languages. Features two audio tracks, embedded and external subtitles, and chapters.</plot><genre>Science Fiction</genre><genre>Drama</genre></movie>');
writeFileSync(join(tmp, 'sub.srt'), `1\n00:00:01,000 --> 00:00:03,000\nWelcome to the <i>Orbit Study</i>.\n\n2\n00:00:04,000 --> 00:00:06,000\nThis is the English track.\n\n3\n00:00:08,000 --> 00:00:11,000\nSubtitles are rendered by the player,\nso size, colour and delay are yours to set.\n`);
writeFileSync(join(tmp, 'sub-es.srt'), `1\n00:00:01,000 --> 00:00:03,000\nBienvenido al <i>Estudio de Órbita</i>.\n\n2\n00:00:04,000 --> 00:00:06,000\nEsta es la pista en español.\n`);
writeFileSync(join(tmp, 'chapters.txt'), `;FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=${Math.floor(D * 400)}\ntitle=Overture\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.floor(D * 400)}\nEND=${D * 1000}\ntitle=Perihelion\n`);
video({
  file: join(orbit, 'Orbit Study (2021).mkv'), title: 'Orbit Study (2021)', dur: D,
  audio: [{ f: 440, lang: 'eng', title: 'English 2.0' }, { f: 880, lang: 'spa', title: 'Español 2.0' }],
  inputs: ['-i', join(tmp, 'sub.srt'), '-i', join(tmp, 'sub-es.srt'), '-i', join(tmp, 'chapters.txt')],
  maps: ['-map', '3:s', '-map', '4:s', '-map_metadata', '5', '-map_chapters', '5', '-c:s', 'srt', '-metadata:s:s:0', 'language=eng', '-metadata:s:s:1', 'language=spa', '-metadata:s:s:0', 'title=English', '-metadata:s:s:1', 'title=Español'],
  acodec: ['-c:a', 'aac', '-b:a', '96k']
});
writeFileSync(join(orbit, 'Orbit Study (2021).en.srt'), readFileSync(join(tmp, 'sub.srt')));
writeFileSync(join(orbit, 'Orbit Study (2021).fr.srt'), `1\n00:00:01,000 --> 00:00:03,000\nBienvenue dans l'étude de l'orbite.\n`);

poster(join(movies, 'Neon Drift (2019)-poster.jpg'), 'NEON DRIFT', ['ff0f7b', 'f89b29']);
video({ file: join(movies, 'Neon Drift (2019).mp4'), title: 'Neon Drift (2019)', dur: D, extra: ['-movflags', '+faststart'] });
video({
  file: join(movies, 'Hevc Test (2020).mkv'), title: 'HEVC + AC3 (2020)', dur: Math.min(D, 12), w: 960, h: 540,
  vcodec: ['-c:v', 'libx265', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p', '-x265-params', 'log-level=error'],
  audio: [{ f: 523, lang: 'eng', title: 'Surround' }], acodec: ['-c:a', 'ac3', '-b:a', '192k']
});
video({ file: join(movies, 'High Frame Rate (2023).mp4'), title: '300 FPS (2023)', w: 640, h: 360, fps: 300, dur: 3 });
video({ file: join(movies, 'Smooth 120 (2022).mp4'), title: '120 FPS (2022)', w: 960, h: 540, fps: 120, dur: 4 });
video({ file: join(movies, 'Ten Bit (2024).mkv'), title: 'H.264 10-bit (2024)', w: 640, h: 360, dur: 4, vcodec: ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-pix_fmt', 'yuv420p10le', '-profile:v', 'high10'] });
video({ file: join(movies, 'Holiday Clip.avi'), title: 'AVI clip', w: 480, h: 270, dur: 4, vcodec: ['-c:v', 'mpeg4', '-q:v', '5'], acodec: ['-c:a', 'mp3'] });

// -- TV --------------------------------------------------------------------

const tv = mk('TV', 'Signal Lost', 'Season 1');
poster(join(mk('TV', 'Signal Lost'), 'poster.jpg'), 'SIGNAL LOST', ['0f2027', '2c5364']);
[['01', 'Pilot'], ['02', 'Static'], ['03', 'Dead Air']].forEach(([n, t], i) => {
  video({ file: join(tv, `Signal Lost - S01E${n} - ${t}.mp4`), title: `Signal Lost S01E${n}`, w: 854, h: 480, dur: Math.min(D, 8) + i, extra: ['-movflags', '+faststart'] });
});

// -- music -----------------------------------------------------------------

const album = mk('Music', 'Aurora Quartet', 'Night Signals');
cover(join(album, 'cover.jpg'), 'NIGHT SIGNALS', ['134e5e', '71b280']);
const tracks = [
  { n: 1, t: 'Opening', f: 261.63, ext: 'mp3', codec: ['-c:a', 'libmp3lame', '-b:a', '192k', '-id3v2_version', '3'] },
  { n: 2, t: 'Drift', f: 329.63, ext: 'flac', codec: ['-c:a', 'flac'] },
  { n: 3, t: 'Return', f: 392.0, ext: 'm4a', codec: ['-c:a', 'aac', '-b:a', '160k'] },
  { n: 4, t: 'Afterglow', f: 493.88, ext: 'ogg', codec: ['-c:a', 'libvorbis', '-q:a', '4'] }
];
for (const t of tracks) {
  const dur = quick ? 8 : 20;
  const copyArt = t.ext === 'mp3' || t.ext === 'm4a';
  ff('-f', 'lavfi', '-i', `sine=frequency=${t.f}:sample_rate=44100:duration=${dur}`, ...(copyArt ? ['-i', join(album, 'cover.jpg'), '-map', '0:a', '-map', '1:v', '-c:v', 'mjpeg', '-disposition:v:0', 'attached_pic'] : []),
    ...t.codec, '-metadata', `title=${t.t}`, '-metadata', 'artist=Aurora Quartet', '-metadata', 'album_artist=Aurora Quartet', '-metadata', 'album=Night Signals',
    '-metadata', `track=${t.n}/4`, '-metadata', 'date=2020', '-metadata', 'genre=Ambient', join(album, `0${t.n} - ${t.t}.${t.ext}`));
}
writeFileSync(join(album, '01 - Opening.lrc'), '[ti:Opening]\n[00:00.50]Signals rise over the dark\n[00:02.00]A single note, a gentle spark\n[00:04.00]Gravity pulls the chorus in\n[00:06.00]And now the song can begin\n');
const single = mk('Music', 'Lumen', 'Singles');
ff('-f', 'lavfi', '-i', 'sine=frequency=587:sample_rate=48000:duration=8', '-c:a', 'libopus', '-b:a', '96k', '-metadata', 'title=Glow', '-metadata', 'artist=Lumen', '-metadata', 'album=Singles', '-metadata', 'genre=Electronic', '-metadata', 'date=2023', join(single, 'Lumen - Glow.opus'));
ff('-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=6', '-c:a', 'pcm_s16le', join(mk('Music', 'Untagged Folder'), '05 - Plain Wave.wav'));

// -- photos ----------------------------------------------------------------

const photos = mk('Photos', 'Trip');
['jpg', 'png', 'webp'].forEach((ext, i) => {
  ff('-f', 'lavfi', '-i', `gradients=s=1600x1067:c0=0x${['f12711', '1d976c', '2193b0'][i]}:c1=0x${['f5af19', '93f9b9', '6dd5ed'][i]}:duration=1:speed=0.001:seed=${i + 3}`,
    '-vf', chain(text(`Photo ${i + 1}`, 'fontsize=120:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2') ?? 'null'), '-frames:v', '1', ...(ext === 'jpg' ? ['-q:v', '3'] : []), join(photos, `photo-0${i + 1}.${ext}`));
});
ff('-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=10:duration=2', '-vf', 'split[a][b];[a]palettegen[p];[b][p]paletteuse', join(photos, 'animation.gif'));

// -- manga -----------------------------------------------------------------

function pagesTo(dir, count, tint, ext = 'jpg') {
  mkdirSync(dir, { recursive: true });
  ff('-f', 'lavfi', '-i', `gradients=s=800x1200:c0=0x${tint[0]}:c1=0x${tint[1]}:duration=${count}:speed=0.05:rate=1:seed=7`,
    '-vf', chain(text('PAGE %{eif\\:n+1\\:d}', 'fontsize=160:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:shadowcolor=black@0.6:shadowx=3:shadowy=3') ?? 'null'),
    '-frames:v', String(count), '-q:v', '4', join(dir, `%03d.${ext}`));
}
function cbz(file, files) {
  const entries = {};
  for (const f of files) entries[f.name] = [readFileSync(f.path), { level: 0 }];
  writeFileSync(file, zipSync(entries));
}
const manga = mk('Manga', 'Planet Walker');
poster(join(manga, 'cover.jpg'), 'PLANET WALKER', ['41295a', '2f0743']);
[1, 2].forEach((v, i) => {
  const dir = join(tmp, `pw${v}`);
  pagesTo(dir, quick ? 6 : 12, [['41295a', 'ff9966'], ['134e5e', 'f7971e']][i]);
  cbz(join(manga, `Planet Walker v0${v}.cbz`), readdirSync(dir).sort().map((n) => ({ name: n, path: join(dir, n) })));
});
pagesTo(join(mk('Manga', 'Dungeon Tales'), 'Chapter 1'), quick ? 6 : 10, ['0f0c29', '24243e']);
pagesTo(join(mk('Manga', 'Dungeon Tales'), 'Chapter 2'), quick ? 6 : 10, ['302b63', '24243e']);

// -- books -----------------------------------------------------------------

function epub(file, title, author, chapters) {
  const files = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:gravity-sample</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>en</dc:language><meta name="cover" content="cover"/></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/><item id="css" href="style.css" media-type="text/css"/>${chapters.map((_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${chapters.map((_, i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>`),
    'OEBPS/nav.xhtml': strToU8(`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>${chapters.map((c, i) => `<li><a href="c${i}.xhtml">${c.title}</a></li>`).join('')}</ol></nav></body></html>`),
    'OEBPS/style.css': strToU8('body{font-family:serif;line-height:1.5} h1{margin-top:2em} p{margin:0 0 1em}'),
    'OEBPS/cover.jpg': readFileSync(join(tmp, 'epub-cover.jpg'))
  };
  chapters.forEach((c, i) => {
    files[`OEBPS/c${i}.xhtml`] = strToU8(`<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${c.title}</title><link rel="stylesheet" href="style.css"/></head><body><h1>${c.title}</h1>${c.paragraphs.map((p) => `<p>${p}</p>`).join('')}</body></html>`);
  });
  writeFileSync(file, zipSync(files));
}
cover(join(tmp, 'epub-cover.jpg'), 'THE QUIET ORBIT', ['4b134f', 'c94b4b'], 600);
const lorem = 'Gravity is the quietest of the forces, and the most patient. It does not shout; it simply waits, and everything that moves eventually bends toward it. ';
epub(join(mk('Books'), 'The Quiet Orbit.epub'), 'The Quiet Orbit', 'A. Writer', [
  { title: 'Chapter One: Falling', paragraphs: Array.from({ length: 28 }, (_, i) => `${lorem.repeat(2)}(${i + 1})`) },
  { title: 'Chapter Two: Orbit', paragraphs: Array.from({ length: 28 }, (_, i) => `${lorem.repeat(2)}The second chapter paragraph ${i + 1}.`) },
  { title: 'Chapter Three: Return', paragraphs: Array.from({ length: 20 }, (_, i) => `${lorem}Final chapter, paragraph ${i + 1}, concludes the sample.`) }
]);

rmSync(tmp, { recursive: true, force: true });
console.log('Done.');
