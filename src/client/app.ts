import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js';

const MAX_DURATION = 30;
const MAX_ZOOM_PX_PER_SEC = 1000;

// Pure logic — exported for testing
export function calcZoomPxPerSec(sliderValue: number, base: number, max: number): number {
  const t = sliderValue / 1000;
  return base + t * (max - base);
}

export function isAtRegionEnd(currentTime: number, regionEnd: number, tolerance = 0.25): boolean {
  return Math.abs(currentTime - regionEnd) < tolerance;
}

export { MAX_ZOOM_PX_PER_SEC };

// ---------------------------------------------------------------------------
// App state (module-level, reset per init call)
// ---------------------------------------------------------------------------
let wavesurfer: WaveSurfer | null = null;
let regions: ReturnType<typeof RegionsPlugin.create> | null = null;
let activeRegion: { start: number; end: number; remove: () => void; setOptions: (o: object) => void } | null = null;
let currentAudioId: string | null = null;
let isLooping = false;
let isPreviewLooping = false;
let baseMinPxPerSec = 0;
let pausedAtRegionEnd = false;
let userSeeked = false;
let previewSrcActive = false;

function formatTime(seconds: number): string {
  return seconds.toFixed(2) + 's';
}

// ---------------------------------------------------------------------------
// init() — wires up all DOM event listeners; exported for testing
// ---------------------------------------------------------------------------
export function init() {
  // DOM refs — resolved inside init so they're never null
  const urlInput = document.getElementById('url-input') as HTMLInputElement;
  const loadUrlBtn = document.getElementById('load-url-btn') as HTMLButtonElement;
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const fileLabelText = document.getElementById('file-label-text') as HTMLElement;
  const loadingEl = document.getElementById('loading') as HTMLElement;
  const loadingText = document.getElementById('loading-text') as HTMLElement;
  const waveformSection = document.getElementById('waveform-section') as HTMLElement;
  const playBtn = document.getElementById('play-btn') as HTMLButtonElement;
  const playIcon = document.getElementById('play-icon') as HTMLElement;
  const pauseIcon = document.getElementById('pause-icon') as HTMLElement;
  const playBtnText = document.getElementById('play-btn-text') as HTMLElement;
  const replayBtn = document.getElementById('replay-btn') as HTMLButtonElement;
  const loopBtn = document.getElementById('loop-btn') as HTMLButtonElement;
  const exportBtn = document.getElementById('export-btn') as HTMLButtonElement;
  const fadeInput = document.getElementById('fade-input') as HTMLInputElement;
  const statusEl = document.getElementById('status') as HTMLElement;
  const timeStart = document.getElementById('time-start') as HTMLElement;
  const timeEnd = document.getElementById('time-end') as HTMLElement;
  const timeDuration = document.getElementById('time-duration') as HTMLElement;
  const regionDuration = document.getElementById('region-duration') as HTMLElement;
  const zoomSlider = document.getElementById('zoom-slider') as HTMLInputElement;
  const previewSection = document.getElementById('preview-section') as HTMLElement;
  const generatePreviewBtn = document.getElementById('generate-preview-btn') as HTMLButtonElement;
  const previewLoading = document.getElementById('preview-loading') as HTMLElement;
  const previewPlayer = document.getElementById('preview-player') as HTMLElement;
  const previewPlayBtn = document.getElementById('preview-play-btn') as HTMLButtonElement;
  const previewPlayIcon = document.getElementById('preview-play-icon') as HTMLElement;
  const previewPauseIcon = document.getElementById('preview-pause-icon') as HTMLElement;
  const previewLoopBtn = document.getElementById('preview-loop-btn') as HTMLButtonElement;
  const previewAudio = document.getElementById('preview-audio') as HTMLAudioElement;

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  function setLoading(show: boolean, text = 'Loading…') {
    loadingEl.classList.toggle('hidden', !show);
    loadingText.textContent = text;
    loadUrlBtn.disabled = show;
    exportBtn.disabled = show;
  }

  function showStatus(message: string, isError = false) {
    statusEl.textContent = message;
    statusEl.className = `text-sm rounded-lg px-4 py-3 text-center ${
      isError
        ? 'bg-red-950 border border-red-800 text-red-300'
        : 'bg-green-950 border border-green-800 text-green-300'
    }`;
    statusEl.classList.remove('hidden');
  }

  function hideStatus() {
    statusEl.classList.add('hidden');
  }

  function updateTimeDisplay(start: number, end: number) {
    const dur = end - start;
    timeStart.textContent = formatTime(start);
    timeEnd.textContent = formatTime(end);
    timeDuration.textContent = formatTime(dur);
    regionDuration.textContent = `${formatTime(dur)} / 30.00s max`;
  }

  function setLoopActive(active: boolean) {
    isLooping = active;
    if (active) {
      loopBtn.classList.remove('bg-gray-800', 'border-gray-700', 'text-gray-400');
      loopBtn.classList.add('bg-cyan-900', 'border-cyan-500', 'text-cyan-400');
    } else {
      loopBtn.classList.remove('bg-cyan-900', 'border-cyan-500', 'text-cyan-400');
      loopBtn.classList.add('bg-gray-800', 'border-gray-700', 'text-gray-400');
    }
  }

  function setPreviewLoopActive(active: boolean) {
    isPreviewLooping = active;
    previewAudio.loop = active;
    if (active) {
      previewLoopBtn.classList.remove('bg-gray-800', 'border-gray-700', 'text-gray-400');
      previewLoopBtn.classList.add('bg-cyan-900', 'border-cyan-500', 'text-cyan-400');
    } else {
      previewLoopBtn.classList.remove('bg-cyan-900', 'border-cyan-500', 'text-cyan-400');
      previewLoopBtn.classList.add('bg-gray-800', 'border-gray-700', 'text-gray-400');
    }
  }

  function resetPreview() {
    previewSrcActive = false;
    previewAudio.pause();
    previewAudio.src = '';
    previewPlayer.classList.add('hidden');
    previewLoading.classList.add('hidden');
    previewSection.classList.add('hidden');
    previewPlayIcon.classList.remove('hidden');
    previewPauseIcon.classList.add('hidden');
    setPreviewLoopActive(false);
  }

  function showPlayState() {
    playIcon.classList.add('hidden');
    pauseIcon.classList.remove('hidden');
    playBtnText.textContent = 'Pause';
  }

  function showPausedState() {
    playIcon.classList.remove('hidden');
    pauseIcon.classList.add('hidden');
    playBtnText.textContent = 'Play';
  }

  // ------------------------------------------------------------------
  // Waveform
  // ------------------------------------------------------------------
  async function initWaveform(id: string) {
    currentAudioId = id;

    if (wavesurfer) {
      wavesurfer.destroy();
      wavesurfer = null;
      regions = null;
      activeRegion = null;
    }

    setLoopActive(false);
    resetPreview();
    zoomSlider.value = '0';
    baseMinPxPerSec = 0;
    pausedAtRegionEnd = false;
    userSeeked = false;

    regions = RegionsPlugin.create();

    wavesurfer = WaveSurfer.create({
      container: '#waveform',
      waveColor: '#374151',
      progressColor: '#06b6d4',
      cursorColor: '#06b6d4',
      height: 96,
      plugins: [regions],
      autoScroll: true,
    });

    wavesurfer.on('play', showPlayState);

    // pause fires both on user pause AND when play(start,end) reaches the end.
    // Detect region-end by checking currentTime ≈ region.end → loop if enabled.
    wavesurfer.on('pause', () => {
      if (activeRegion && wavesurfer) {
        const ct = wavesurfer.getCurrentTime();
        if (isAtRegionEnd(ct, activeRegion.end)) {
          if (isLooping) {
            wavesurfer.play(activeRegion.start, activeRegion.end);
            return;
          }
          pausedAtRegionEnd = true;
        }
      }
      showPausedState();
    });

    wavesurfer.on('finish', showPausedState);

    wavesurfer.on('interaction', () => {
      userSeeked = true;
      pausedAtRegionEnd = false;
    });

    wavesurfer.on('ready', () => {
      const totalDuration = wavesurfer!.getDuration();
      const regionEnd = Math.min(totalDuration, MAX_DURATION);

      activeRegion = regions!.addRegion({
        start: 0,
        end: regionEnd,
        color: 'rgba(6, 182, 212, 0.15)',
        drag: true,
        resize: true,
      }) as typeof activeRegion;

      updateTimeDisplay(0, regionEnd);
      setLoading(false);
      waveformSection.classList.remove('hidden');
      previewSection.classList.remove('hidden');

      requestAnimationFrame(() => {
        const container = document.getElementById('waveform') as HTMLElement;
        baseMinPxPerSec = container.clientWidth / totalDuration;
      });
    });

    regions.on('region-updated', (region) => {
      let { start, end } = region;
      const dur = end - start;

      if (dur > MAX_DURATION) {
        end = start + MAX_DURATION;
        region.setOptions({ end });
        showStatus(`Region clamped to ${MAX_DURATION}s maximum`, false);
        setTimeout(hideStatus, 2500);
      } else {
        hideStatus();
      }

      activeRegion = region as typeof activeRegion;
      updateTimeDisplay(start, end);
    });

    regions.on('region-clicked', (region, e) => {
      e.stopPropagation();
      activeRegion = region as typeof activeRegion;
      if (wavesurfer) {
        const container = document.querySelector('#waveform') as HTMLElement;
        const rect = container.getBoundingClientRect();
        const relativeX = e.clientX - rect.left + container.scrollLeft;
        const duration = wavesurfer.getDuration();
        const time = (relativeX / container.scrollWidth) * duration;
        wavesurfer.setTime(Math.max(0, Math.min(time, duration)));
        userSeeked = true;
        pausedAtRegionEnd = false;
      }
    });

    wavesurfer.load(`/api/audio/${id}`);
  }

  // ------------------------------------------------------------------
  // Network helpers
  // ------------------------------------------------------------------
  async function loadFromUrl(url: string) {
    hideStatus();
    setLoading(true, 'Downloading audio…');

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = (await res.json()) as { id?: string; error?: string; detail?: string };

      if (!res.ok) {
        setLoading(false);
        showStatus(data.detail ?? data.error ?? 'Download failed', true);
        return;
      }

      setLoading(true, 'Loading waveform…');
      await initWaveform(data.id!);
    } catch (err) {
      setLoading(false);
      showStatus('Network error: ' + String(err), true);
    }
  }

  async function loadFromFile(file: File) {
    hideStatus();
    fileLabelText.textContent = file.name;
    setLoading(true, 'Uploading file…');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = (await res.json()) as { id?: string; error?: string };

      if (!res.ok) {
        setLoading(false);
        showStatus(data.error ?? 'Upload failed', true);
        return;
      }

      setLoading(true, 'Loading waveform…');
      await initWaveform(data.id!);
    } catch (err) {
      setLoading(false);
      showStatus('Network error: ' + String(err), true);
    }
  }

  function playPause() {
    if (!wavesurfer || !activeRegion) return;

    if (wavesurfer.isPlaying()) {
      wavesurfer.pause();
    } else {
      if (userSeeked || pausedAtRegionEnd) {
        const ct = wavesurfer.getCurrentTime();
        const clampedStart = Math.max(activeRegion.start, Math.min(ct, activeRegion.end));
        pausedAtRegionEnd = false;
        userSeeked = false;
        wavesurfer.play(clampedStart, activeRegion.end);
      } else {
        wavesurfer.play(activeRegion.start, activeRegion.end);
      }
    }
  }

  async function exportRingtone() {
    if (!currentAudioId || !activeRegion) return;

    const startTime = activeRegion.start;
    const endTime = activeRegion.end;
    const fadeOutDuration = parseFloat(fadeInput.value) || 0;

    if (endTime - startTime > MAX_DURATION) {
      showStatus('Selection exceeds 30 seconds. Please shorten the region.', true);
      return;
    }

    if (fadeOutDuration > 0 && fadeOutDuration / 2 >= endTime - startTime) {
      showStatus('Fade-out duration must be less than twice the selected region length.', true);
      return;
    }

    hideStatus();
    setLoading(true, 'Exporting ringtone…');

    try {
      const res = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentAudioId, startTime, endTime, fadeOutDuration }),
      });

      const data = (await res.json()) as { id?: string; error?: string; detail?: string };

      if (!res.ok) {
        setLoading(false);
        showStatus(data.detail ?? data.error ?? 'Export failed', true);
        return;
      }

      const a = document.createElement('a');
      a.href = `/api/download-ringtone/${data.id}`;
      a.download = 'ringtone.m4r';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setLoading(false);
      showStatus('Ringtone exported successfully!');
    } catch (err) {
      setLoading(false);
      showStatus('Network error: ' + String(err), true);
    }
  }

  async function generatePreview() {
    if (!currentAudioId || !activeRegion) return;

    const startTime = activeRegion.start;
    const endTime = activeRegion.end;
    const fadeOutDuration = parseFloat(fadeInput.value) || 0;

    previewLoading.classList.remove('hidden');
    previewPlayer.classList.add('hidden');
    generatePreviewBtn.disabled = true;

    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentAudioId, startTime, endTime, fadeOutDuration }),
      });

      let data: { id?: string; error?: string; detail?: string };
      try {
        data = (await res.json()) as { id?: string; error?: string; detail?: string };
      } catch {
        previewLoading.classList.add('hidden');
        generatePreviewBtn.disabled = false;
        showStatus('Preview generation failed (server error)', true);
        return;
      }

      if (!res.ok) {
        previewLoading.classList.add('hidden');
        generatePreviewBtn.disabled = false;
        showStatus(data.detail ?? data.error ?? 'Preview generation failed', true);
        return;
      }

      previewSrcActive = true;
      previewAudio.src = `/api/preview-audio/${data.id}`;
      previewPlayIcon.classList.remove('hidden');
      previewPauseIcon.classList.add('hidden');
      previewLoading.classList.add('hidden');
      previewPlayer.classList.remove('hidden');
      generatePreviewBtn.disabled = false;
    } catch (err) {
      previewLoading.classList.add('hidden');
      generatePreviewBtn.disabled = false;
      showStatus('Network error: ' + String(err), true);
    }
  }

  // ------------------------------------------------------------------
  // Event listeners
  // ------------------------------------------------------------------
  zoomSlider.addEventListener('input', () => {
    if (!wavesurfer || baseMinPxPerSec === 0) return;
    const container = document.querySelector('#waveform') as HTMLElement;
    const scrollable = container.scrollWidth - container.clientWidth;
    const scrollRatio = scrollable > 0 ? container.scrollLeft / scrollable : 0;
    const pxPerSec = calcZoomPxPerSec(parseInt(zoomSlider.value), baseMinPxPerSec, MAX_ZOOM_PX_PER_SEC);
    wavesurfer.zoom(pxPerSec);
    requestAnimationFrame(() => {
      const newScrollable = container.scrollWidth - container.clientWidth;
      container.scrollLeft = scrollRatio * newScrollable;
    });
  });

  loadUrlBtn.addEventListener('click', () => {
    const url = urlInput.value.trim();
    if (!url) {
      showStatus('Please enter a YouTube URL', true);
      return;
    }
    loadFromUrl(url);
  });

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadUrlBtn.click();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) loadFromFile(file);
  });

  playBtn.addEventListener('click', playPause);
  exportBtn.addEventListener('click', exportRingtone);

  replayBtn.addEventListener('click', () => {
    if (!wavesurfer || !activeRegion) return;
    wavesurfer.play(activeRegion.start, activeRegion.end);
  });

  loopBtn.addEventListener('click', () => {
    setLoopActive(!isLooping);
  });

  generatePreviewBtn.addEventListener('click', generatePreview);

  previewPlayBtn.addEventListener('click', () => {
    if (previewAudio.paused) {
      previewAudio.play();
    } else {
      previewAudio.pause();
    }
  });

  previewAudio.addEventListener('play', () => {
    previewPlayIcon.classList.add('hidden');
    previewPauseIcon.classList.remove('hidden');
  });

  previewAudio.addEventListener('pause', () => {
    previewPlayIcon.classList.remove('hidden');
    previewPauseIcon.classList.add('hidden');
  });

  previewAudio.addEventListener('ended', () => {
    previewPlayIcon.classList.remove('hidden');
    previewPauseIcon.classList.add('hidden');
  });

  previewAudio.addEventListener('error', () => {
    if (previewSrcActive) {
      showStatus('Preview playback failed', true);
    }
  });

  previewLoopBtn.addEventListener('click', () => {
    setPreviewLoopActive(!isPreviewLooping);
  });

  // Expose internals for testing
  return { initWaveform };
}

// ------------------------------------------------------------------
// Bootstrap — only auto-init in a real browser, not in test environments
// ------------------------------------------------------------------
if (typeof document !== 'undefined' && !('_vitest' in globalThis)) {
  document.addEventListener('DOMContentLoaded', init);
}
