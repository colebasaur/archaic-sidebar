export const SIDEBAR_PRESETS = [
  '#e9e4f2',
  '#dbe8f7',
  '#dcefe4',
  '#f6e2d6',
  '#f3dde4',
  '#efe8d8',
  '#2b2f3a',
  '#1b1f2e',
  '#1f2b24',
  '#2a1f2e',
];

const THEME_VARS = [
  '--bg',
  '--text',
  '--muted',
  '--hover',
  '--active',
  '--surface',
  '--surface-strong',
  '--border',
  'color-scheme',
];

export function isDarkColor(hex: string): boolean {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.4;
}

/** Overrides the theme tokens with a custom background, picking readable text for it. */
export function applySidebarColor(color: string | undefined): void {
  const style = document.documentElement.style;
  for (const name of THEME_VARS) style.removeProperty(name);
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return;

  const dark = isDarkColor(color);
  const vars: Record<string, string> = dark
    ? {
        '--text': '#f1eef6',
        '--muted': 'rgba(241, 238, 246, 0.62)',
        '--hover': 'rgba(255, 255, 255, 0.08)',
        '--active': 'rgba(255, 255, 255, 0.16)',
        '--surface': 'rgba(255, 255, 255, 0.07)',
        '--surface-strong': `color-mix(in srgb, ${color}, white 12%)`,
        '--border': 'rgba(255, 255, 255, 0.1)',
        'color-scheme': 'dark',
      }
    : {
        '--text': '#1f1b24',
        '--muted': 'rgba(31, 27, 36, 0.6)',
        '--hover': 'rgba(255, 255, 255, 0.45)',
        '--active': '#ffffff',
        '--surface': 'rgba(255, 255, 255, 0.55)',
        '--surface-strong': '#ffffff',
        '--border': 'rgba(31, 27, 36, 0.1)',
        'color-scheme': 'light',
      };
  style.setProperty('--bg', color);
  for (const [name, value] of Object.entries(vars)) style.setProperty(name, value);
}

const GRAIN_TILE = 256;
const MAX_GRAIN_OPACITY = 0.6;
let grainReady = false;

// Per-pixel random gray at device resolution; a smooth SVG turbulence reads as tint, not grain.
function installGrainTexture(): void {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = GRAIN_TILE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const image = ctx.createImageData(GRAIN_TILE, GRAIN_TILE);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = Math.random() * 255;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const style = document.documentElement.style;
  style.setProperty('--grain-image', `url(${canvas.toDataURL()})`);
  style.setProperty('--grain-size', `${GRAIN_TILE / window.devicePixelRatio}px`);
  grainReady = true;
}

/** Sets the strength (0–100) of the noise texture layered over the sidebar background. */
export function applySidebarGrain(amount: number | undefined): void {
  const value = Math.min(100, Math.max(0, amount ?? 0)) / 100;
  if (value > 0 && !grainReady) installGrainTexture();
  document.documentElement.style.setProperty('--grain', String(value * MAX_GRAIN_OPACITY));
}
