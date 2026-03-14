import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Mark as vitest so app.ts skips the auto DOMContentLoaded init
(globalThis as Record<string, unknown>)['_vitest'] = true;

// ---------------------------------------------------------------------------
// Mocks — before app.ts import
// ---------------------------------------------------------------------------
const wavesurferHandlers: Record<string, (...args: unknown[]) => void> = {};
const regionHandlers: Record<string, (...args: unknown[]) => void> = {};

const mockRegion = { start: 0, end: 30, setOptions: vi.fn() };

const mockRegions = {
  on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    regionHandlers[event] = handler;
  }),
  addRegion: vi.fn(() => mockRegion),
};

const mockWaveSurfer = {
  on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    wavesurferHandlers[event] = handler;
  }),
  load: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  isPlaying: vi.fn(() => false),
  getCurrentTime: vi.fn(() => 0),
  zoom: vi.fn(),
  destroy: vi.fn(),
  getDuration: vi.fn(() => 60),
};

vi.mock('wavesurfer.js', () => ({
  default: { create: vi.fn(() => mockWaveSurfer) },
}));
vi.mock('wavesurfer.js/dist/plugins/regions.js', () => ({
  default: { create: vi.fn(() => mockRegions) },
}));

import { calcZoomPxPerSec, isAtRegionEnd, MAX_ZOOM_PX_PER_SEC, init } from './app';

// ---------------------------------------------------------------------------
// DOM helper
// ---------------------------------------------------------------------------
function setupDOM() {
  const html = readFileSync(join(__dirname, '../../public/index.html'), 'utf8');
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = bodyMatch ? bodyMatch[1] : html;
}

// ---------------------------------------------------------------------------
// Pure logic tests — no DOM required
// ---------------------------------------------------------------------------
describe('calcZoomPxPerSec', () => {
  it('returns base when slider is 0', () => {
    expect(calcZoomPxPerSec(0, 10, 1000)).toBe(10);
  });

  it('returns max when slider is 1000', () => {
    expect(calcZoomPxPerSec(1000, 10, 1000)).toBe(1000);
  });

  it('returns midpoint at slider 500 with base=0', () => {
    expect(calcZoomPxPerSec(500, 0, 1000)).toBe(500);
  });

  it('linearly interpolates between base and max', () => {
    expect(calcZoomPxPerSec(250, 20, 1020)).toBeCloseTo(20 + 0.25 * 1000);
  });

  it('MAX_ZOOM_PX_PER_SEC is 1000', () => {
    expect(MAX_ZOOM_PX_PER_SEC).toBe(1000);
  });
});

describe('isAtRegionEnd', () => {
  it('returns true when currentTime equals regionEnd exactly', () => {
    expect(isAtRegionEnd(10, 10)).toBe(true);
  });

  it('returns true just inside the default 0.25s tolerance', () => {
    expect(isAtRegionEnd(10.24, 10)).toBe(true);
    expect(isAtRegionEnd(9.76, 10)).toBe(true);
  });

  it('returns false just outside the default 0.25s tolerance', () => {
    expect(isAtRegionEnd(10.3, 10)).toBe(false);
    expect(isAtRegionEnd(9.7, 10)).toBe(false);
  });

  it('respects custom tolerance', () => {
    expect(isAtRegionEnd(10.06, 10, 0.05)).toBe(false);
    expect(isAtRegionEnd(10.04, 10, 0.05)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DOM integration tests
// ---------------------------------------------------------------------------
describe('DOM integration', () => {
  let initWaveform: (id: string) => Promise<void>;

  beforeAll(() => {
    setupDOM();
    ({ initWaveform } = init());
  });

  // Simulate loading a waveform: call initWaveform then fire ready
  async function loadWaveform() {
    // Clear captured handlers so each test starts fresh
    Object.keys(wavesurferHandlers).forEach((k) => delete wavesurferHandlers[k]);
    await initWaveform('test-id');
    // Simulate WaveSurfer firing ready
    wavesurferHandlers['ready']?.();
  }

  // -- loop button appearance --
  describe('loop button', () => {
    beforeEach(() => {
      // ensure loop starts inactive
      const loopBtn = document.getElementById('loop-btn')!;
      if (loopBtn.classList.contains('bg-cyan-900')) loopBtn.click();
    });

    it('starts with inactive styling', () => {
      const loopBtn = document.getElementById('loop-btn')!;
      expect(loopBtn.classList.contains('bg-gray-800')).toBe(true);
      expect(loopBtn.classList.contains('border-gray-700')).toBe(true);
      expect(loopBtn.classList.contains('bg-cyan-900')).toBe(false);
    });

    it('toggles to active styling on click', () => {
      const loopBtn = document.getElementById('loop-btn')!;
      loopBtn.click();
      expect(loopBtn.classList.contains('bg-cyan-900')).toBe(true);
      expect(loopBtn.classList.contains('border-cyan-500')).toBe(true);
      expect(loopBtn.classList.contains('text-cyan-400')).toBe(true);
      expect(loopBtn.classList.contains('bg-gray-800')).toBe(false);
    });

    it('toggles back to inactive on second click', () => {
      const loopBtn = document.getElementById('loop-btn')!;
      loopBtn.click(); // → active
      loopBtn.click(); // → inactive
      expect(loopBtn.classList.contains('bg-gray-800')).toBe(true);
      expect(loopBtn.classList.contains('bg-cyan-900')).toBe(false);
    });
  });

  // -- play / replay after waveform loads --
  describe('play and replay buttons', () => {
    beforeEach(async () => {
      mockWaveSurfer.play.mockClear();
      mockWaveSurfer.pause.mockClear();
      mockWaveSurfer.isPlaying.mockReturnValue(false);
      mockWaveSurfer.getCurrentTime.mockReturnValue(0);
      await loadWaveform();
    });

    it('play button calls wavesurfer.play with region bounds', () => {
      document.getElementById('play-btn')!.click();
      expect(mockWaveSurfer.play).toHaveBeenCalledWith(mockRegion.start, mockRegion.end);
    });

    it('replay button calls wavesurfer.play with region bounds', () => {
      document.getElementById('replay-btn')!.click();
      expect(mockWaveSurfer.play).toHaveBeenCalledWith(mockRegion.start, mockRegion.end);
    });

    it('play button calls wavesurfer.pause when already playing', () => {
      mockWaveSurfer.isPlaying.mockReturnValue(true);
      document.getElementById('play-btn')!.click();
      expect(mockWaveSurfer.pause).toHaveBeenCalled();
    });

    it('play icon swaps to pause icon when play event fires', () => {
      wavesurferHandlers['play']?.();
      expect(document.getElementById('play-icon')!.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('pause-icon')!.classList.contains('hidden')).toBe(false);
    });

    it('pause icon swaps back to play icon on mid-region pause', () => {
      wavesurferHandlers['play']?.();
      mockWaveSurfer.getCurrentTime.mockReturnValue(5); // not at region end
      wavesurferHandlers['pause']?.();
      expect(document.getElementById('play-icon')!.classList.contains('hidden')).toBe(false);
      expect(document.getElementById('pause-icon')!.classList.contains('hidden')).toBe(true);
    });
  });

  // -- loop playback behavior --
  describe('loop playback behavior', () => {
    beforeEach(async () => {
      mockWaveSurfer.play.mockClear();
      mockWaveSurfer.getCurrentTime.mockReturnValue(0);
      await loadWaveform();
      // ensure loop is off
      const loopBtn = document.getElementById('loop-btn')!;
      if (loopBtn.classList.contains('bg-cyan-900')) loopBtn.click();
    });

    it('does NOT restart when loop is off and pause fires at region end', () => {
      mockWaveSurfer.getCurrentTime.mockReturnValue(mockRegion.end);
      wavesurferHandlers['pause']?.();
      expect(mockWaveSurfer.play).not.toHaveBeenCalled();
    });

    it('restarts playback when loop is on and pause fires near region end', () => {
      document.getElementById('loop-btn')!.click(); // enable loop
      mockWaveSurfer.getCurrentTime.mockReturnValue(mockRegion.end - 0.1);
      wavesurferHandlers['pause']?.();
      expect(mockWaveSurfer.play).toHaveBeenCalledWith(mockRegion.start, mockRegion.end);
    });

    it('does NOT restart when loop is on but user pauses mid-region', () => {
      document.getElementById('loop-btn')!.click(); // enable loop
      mockWaveSurfer.getCurrentTime.mockReturnValue(10); // mid-region
      wavesurferHandlers['pause']?.();
      expect(mockWaveSurfer.play).not.toHaveBeenCalled();
    });
  });

  // -- zoom slider --
  describe('zoom slider', () => {
    beforeEach(async () => {
      mockWaveSurfer.zoom.mockClear();
      await loadWaveform();
    });

    it('does not call zoom when baseMinPxPerSec is 0 (no layout in jsdom)', () => {
      const slider = document.getElementById('zoom-slider') as HTMLInputElement;
      slider.value = '500';
      slider.dispatchEvent(new Event('input'));
      // clientWidth is 0 in jsdom → baseMinPxPerSec stays 0 → guard fires
      expect(mockWaveSurfer.zoom).not.toHaveBeenCalled();
    });
  });
});
