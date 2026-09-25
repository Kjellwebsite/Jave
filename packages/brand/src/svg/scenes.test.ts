import { describe, expect, it } from 'vitest';
import { loadBrandTypography } from '../../scripts/lib/brand-typography';
import {
  INVITE_SPLASH_CLEARANCE,
  INVITE_SPLASH_SIZE,
  INVITE_SPLASH_VIEWPORTS,
  coverView,
  inviteSplashBrandBox,
  inviteSplashSvg,
} from './invite-splash';
import { MOTTO_MIN_DISPLAY_CAP_PX, displayedCapHeight } from './scene-parts';
import {
  OG_IMAGE_SIZE,
  SERVER_BANNER_NAME_BAND,
  SERVER_BANNER_SIDEBAR_WIDTH,
  SERVER_BANNER_SIZE,
  ogImageBlockBox,
  ogImageSvg,
  sceneMottoDisplays,
  serverBannerBlockBox,
  serverBannerSidebarStandardDensity,
  serverBannerSvg,
  serverBannerWidths,
} from './scenes';

/** Absorbs floating-point error in scale products such as 12 × (1280 / 1920). */
const FLOAT_TOLERANCE = 1e-9;
/** Least space between a scene's brand block and the sides of its frame, canvas px. */
const FRAME_MARGIN = 64;
/** The banner motto's cap height in a 1× desktop sidebar, as the README states it (px). */
const README_BANNER_STANDARD_DENSITY_CAP = 4.5;

const typography = loadBrandTypography();

describe('Discord cover scaling of the invite splash', () => {
  it('matches hand-computed crops and card positions', () => {
    const full = coverView({ label: '16:9', width: 1920, height: 1080 });
    expect(full.scale).toBe(1);
    expect(full.visible).toEqual({ left: 0, top: 0, right: 1920, bottom: 1080 });
    expect(full.cardLeft).toBe(720);

    const small = coverView({ label: '16:9 small', width: 1280, height: 720 });
    expect(small.visible.left).toBeCloseTo(0, 9);
    expect(small.cardLeft).toBeCloseTo(600, 9);

    // 16:10: scaled by height, 96 splash px cropped from each side.
    expect(coverView({ label: '16:10', width: 1440, height: 900 }).visible.left).toBeCloseTo(96, 9);
    // 4:3: 240 splash px cropped from each side, whatever the window size.
    expect(coverView({ label: '4:3', width: 1024, height: 768 }).visible.left).toBeCloseTo(240, 9);
    // 21:9: scaled by width, top and bottom cropped instead.
    expect(coverView({ label: '21:9', width: 2560, height: 1080 }).visible.top).toBeCloseTo(135, 9);
  });

  const block = inviteSplashBrandBox(typography);

  it.each(INVITE_SPLASH_VIEWPORTS.map((viewport) => [viewport.label, viewport] as const))(
    '%s: the brand block is visible and clear of the invite card',
    (_label, viewport) => {
      const view = coverView(viewport);
      expect(block.left).toBeGreaterThanOrEqual(view.visible.left + INVITE_SPLASH_CLEARANCE);
      expect(block.right).toBeLessThanOrEqual(view.cardLeft - INVITE_SPLASH_CLEARANCE);
      expect(block.top).toBeGreaterThanOrEqual(view.visible.top + INVITE_SPLASH_CLEARANCE);
      expect(block.bottom).toBeLessThanOrEqual(view.visible.bottom - INVITE_SPLASH_CLEARANCE);
    },
  );

  it('covers 16:9, 16:10, 4:3 and ultrawide windows', () => {
    const aspects = new Set(
      INVITE_SPLASH_VIEWPORTS.map((viewport) => (viewport.width / viewport.height).toFixed(2)),
    );
    for (const aspect of ['1.78', '1.60', '1.33', '2.37']) expect(aspects).toContain(aspect);
  });

  it('BREAK: the earlier left-edge column would be cropped on a 16:10 window', () => {
    // First layout: brand block from x = 81.6 to 558.4 (one-line motto, 0.32 em).
    const earlierLeft = 81.6;
    const view = coverView({ label: '16:10', width: 1440, height: 900 });
    expect(earlierLeft).toBeLessThan(view.visible.left);
  });

  it('keeps the block inside the canvas', () => {
    expect(block.left).toBeGreaterThan(0);
    expect(block.bottom).toBeLessThan(INVITE_SPLASH_SIZE.height);
  });
});

describe('motto size where it is displayed', () => {
  const displays = Object.entries(sceneMottoDisplays()).flatMap(([scene, list]) =>
    list.map((display) => [scene, display.context, display] as const),
  );

  it.each(displays)('%s, %s: motto cap height meets the minimum', (_scene, _context, display) => {
    expect(displayedCapHeight(display)).toBeGreaterThanOrEqual(
      MOTTO_MIN_DISPLAY_CAP_PX - FLOAT_TOLERANCE,
    );
  });

  it('sizes every scene for at least one display context', () => {
    for (const list of Object.values(sceneMottoDisplays())) expect(list.length).toBeGreaterThan(0);
  });

  it('draws the full two-line motto on every scene', () => {
    const outlines = typography.mottoLines.map((line) => line.d);
    expect(outlines).toHaveLength(2);
    for (const svg of [
      serverBannerSvg(typography),
      inviteSplashSvg(typography),
      ogImageSvg(typography),
    ]) {
      for (const d of outlines) expect(svg).toContain(d);
    }
  });

  it('documents the one context the banner motto is not sized for (README → Minimum sizes)', () => {
    const standard = displayedCapHeight(serverBannerSidebarStandardDensity());
    expect(standard).toBeLessThan(MOTTO_MIN_DISPLAY_CAP_PX);
    expect(standard).toBeCloseTo(README_BANNER_STANDARD_DENSITY_CAP, 9);
  });

  it('BREAK: the first release’s banner motto (12 px cap) fell short even on a 2× screen', () => {
    const earlier = {
      context: 'desktop sidebar, 2× screen',
      capHeight: 12,
      scale: SERVER_BANNER_SIDEBAR_WIDTH / SERVER_BANNER_SIZE.width,
      pixelRatio: 2,
    };
    expect(displayedCapHeight(earlier)).toBeLessThan(MOTTO_MIN_DISPLAY_CAP_PX);
  });
});

describe('scene layout', () => {
  it('keeps the banner block below Discord’s name header and inside the frame', () => {
    const box = serverBannerBlockBox(typography);
    expect(box.top).toBeGreaterThanOrEqual(SERVER_BANNER_NAME_BAND);
    expect(box.bottom).toBeLessThanOrEqual(SERVER_BANNER_SIZE.height - FRAME_MARGIN / 2);
    expect(box.left).toBeGreaterThanOrEqual(FRAME_MARGIN);
    expect(box.right).toBeLessThanOrEqual(SERVER_BANNER_SIZE.width - FRAME_MARGIN);
  });

  it('keeps the banner motto secondary: narrower than the lockup', () => {
    const widths = serverBannerWidths(typography);
    expect(widths.motto).toBeLessThan(widths.lockup);
  });

  it('keeps the Open Graph block inside its frame, vertically centred', () => {
    const box = ogImageBlockBox(typography);
    expect(box.left).toBeGreaterThanOrEqual(FRAME_MARGIN);
    expect(box.right).toBeLessThanOrEqual(OG_IMAGE_SIZE.width - FRAME_MARGIN);
    expect(box.top).toBeGreaterThanOrEqual(FRAME_MARGIN);
    expect(box.top).toBeCloseTo(OG_IMAGE_SIZE.height - box.bottom, 9);
  });
});
