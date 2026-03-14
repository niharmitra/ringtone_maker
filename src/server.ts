import express from 'express';
import multer from 'multer';
import ffmpeg from 'fluent-ffmpeg';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';

const app = express();
const PORT = 3000;
const TMP_DIR = path.join(__dirname, '..', 'tmp');

// Ensure tmp dir exists
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

// UUID v4 validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// YouTube URL validation
const YOUTUBE_REGEX = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/.+/;

const CONTENT_TYPES: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.m4r': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
};

// Multer config — store uploads in tmp/
const upload = multer({
  storage: multer.diskStorage({
    destination: TMP_DIR,
    filename: (_req, _file, cb) => {
      cb(null, `${uuidv4()}.wav`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'audio/wav',
      'audio/mpeg',
      'audio/mp4',
      'audio/ogg',
      'audio/webm',
      'audio/x-m4a',
      'audio/flac',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// POST /api/download — download audio from YouTube URL
app.post('/api/download', (req, res) => {
  const { url } = req.body as { url?: string };

  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'Missing url' });
    return;
  }

  if (!YOUTUBE_REGEX.test(url)) {
    res.status(400).json({ error: 'Only YouTube URLs (youtube.com or youtu.be) are supported' });
    return;
  }

  const id = uuidv4();
  const outputPath = path.join(TMP_DIR, `${id}.wav`);

  execFile(
    'yt-dlp',
    ['-x', '--audio-format', 'wav', '--no-part', '-o', outputPath, url],
    { maxBuffer: 10 * 1024 * 1024 },
    (err, _stdout, stderr) => {
      if (err) {
        const message = stderr
          ? stderr.trim()
          : err.message;
        res.status(500).json({ error: 'Download failed', detail: message });
        return;
      }
      res.json({ id });
    },
  );
});

// POST /api/upload — upload a local audio file
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  // Extract the UUID from the generated filename
  const id = path.basename(req.file.filename, path.extname(req.file.filename));
  res.json({ id });
});

// GET /api/audio/:id — serve audio file for waveform display
app.get('/api/audio/:id', (req, res) => {
  const { id } = req.params;

  if (!UUID_REGEX.test(id)) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }

  // Find the file with any audio extension
  const extensions = ['.wav', '.mp3', '.m4a', '.ogg', '.webm', '.flac'];
  let filePath: string | null = null;

  for (const ext of extensions) {
    const candidate = path.join(TMP_DIR, `${id}${ext}`);
    if (fs.existsSync(candidate)) {
      filePath = candidate;
      break;
    }
  }

  if (!filePath) {
    res.status(404).json({ error: 'Audio file not found' });
    return;
  }

  const ext = path.extname(filePath);
  const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  fs.createReadStream(filePath).pipe(res);
});

// Helper: trim + fade + encode audio
function processAudio(
  inputPath: string,
  startTime: number,
  duration: number,
  fadeOutDuration: number,
  outputPath: string,
  codec: string,
  bitrate: string,
  onEnd: () => void,
  onError: (err: Error) => void,
) {
  let cmd = ffmpeg(inputPath).setStartTime(startTime).setDuration(duration);

  if (fadeOutDuration > 0 && fadeOutDuration < duration) {
    const fadeStart = duration - fadeOutDuration;
    cmd = cmd.audioFilters([`afade=t=out:st=${fadeStart}:d=${fadeOutDuration}`]);
  }

  cmd
    .audioCodec(codec)
    .audioBitrate(bitrate)
    .output(outputPath)
    .on('end', onEnd)
    .on('error', onError)
    .run();
}

function findInputFile(id: string): string | null {
  const extensions = ['.wav', '.mp3', '.m4a', '.ogg', '.webm', '.flac'];
  for (const ext of extensions) {
    const candidate = path.join(TMP_DIR, `${id}${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function validateProcessRequest(
  body: { id?: string; startTime?: number; endTime?: number; fadeOutDuration?: number },
  enforceLimit: boolean,
): { error: string; status: number } | { id: string; startTime: number; endTime: number; duration: number; fadeOutDuration: number } {
  const { id, startTime, endTime, fadeOutDuration } = body;

  if (!id || !UUID_REGEX.test(id)) {
    return { error: 'Invalid or missing id', status: 400 };
  }
  if (typeof startTime !== 'number' || typeof endTime !== 'number') {
    return { error: 'startTime and endTime are required numbers', status: 400 };
  }
  const duration = endTime - startTime;
  if (duration <= 0) {
    return { error: 'endTime must be greater than startTime', status: 400 };
  }
  if (enforceLimit && duration > 30) {
    return { error: 'Ringtone duration cannot exceed 30 seconds (iOS limit)', status: 400 };
  }
  return { id, startTime, endTime, duration, fadeOutDuration: typeof fadeOutDuration === 'number' ? fadeOutDuration : 0 };
}

// POST /api/process — trim + fade + encode to .m4r
app.post('/api/process', (req, res) => {
  const result = validateProcessRequest(req.body as Parameters<typeof validateProcessRequest>[0], true);

  if ('error' in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  const { id, startTime, duration, fadeOutDuration } = result;
  const inputPath = findInputFile(id);

  if (!inputPath) {
    res.status(404).json({ error: 'Audio file not found' });
    return;
  }

  const outputId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${outputId}.m4r`);

  processAudio(
    inputPath,
    startTime,
    duration,
    fadeOutDuration,
    outputPath,
    'aac',
    '256k',
    () => res.json({ id: outputId }),
    (err) => res.status(500).json({ error: 'Processing failed', detail: err.message }),
  );
});

// POST /api/preview — trim + fade + encode to .mp3 for inline browser playback
app.post('/api/preview', (req, res) => {
  const result = validateProcessRequest(req.body as Parameters<typeof validateProcessRequest>[0], false);

  if ('error' in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  const { id, startTime, duration, fadeOutDuration } = result;
  const inputPath = findInputFile(id);

  if (!inputPath) {
    res.status(404).json({ error: 'Audio file not found' });
    return;
  }

  const outputId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${outputId}.mp3`);

  processAudio(
    inputPath,
    startTime,
    duration,
    fadeOutDuration,
    outputPath,
    'libmp3lame',
    '192k',
    () => res.json({ id: outputId }),
    (err) => res.status(500).json({ error: 'Preview generation failed', detail: err.message }),
  );
});

// GET /api/preview-audio/:id — stream the preview .mp3 for inline playback
app.get('/api/preview-audio/:id', (req, res) => {
  const { id } = req.params;

  if (!UUID_REGEX.test(id)) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }

  const filePath = path.join(TMP_DIR, `${id}.mp3`);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Preview not found' });
    return;
  }

  res.setHeader('Content-Type', 'audio/mpeg');
  fs.createReadStream(filePath).pipe(res);
});

// GET /api/download-ringtone/:id — download the processed .m4r
app.get('/api/download-ringtone/:id', (req, res) => {
  const { id } = req.params;

  if (!UUID_REGEX.test(id)) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }

  const filePath = path.join(TMP_DIR, `${id}.m4r`);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Ringtone not found' });
    return;
  }

  res.setHeader('Content-Type', 'audio/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="ringtone.m4r"`);
  fs.createReadStream(filePath).pipe(res);
});

app.listen(PORT, () => {
  console.log(`Ringtone maker running at http://localhost:${PORT}`);
});
