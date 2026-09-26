/**
 * color.ts — CSS color parsing, perceptual lightness (OKLab/OKLCH) and WCAG contrast.
 * Used to map the colors a model wrote to the roles of a design theme and to verify
 * that every theme meets its contrast targets.
 */

export interface Rgba {
  r: number; // 0-255
  g: number;
  b: number;
  a: number; // 0-1
}

export interface Oklch {
  /** Perceptual lightness 0-1 (0 = black, 1 = white). */
  L: number;
  /** Chroma: ~0 for grays, 0.1+ for clearly colored values. */
  C: number;
  /** Hue angle in degrees (meaningless when C is ~0). */
  h: number;
}

// The CSS named colors (CSS Color Module Level 4).
const NAMED_SOURCE =
  'aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,' +
  'black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,' +
  'chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,' +
  'darkblue:00008b,darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,' +
  'darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,' +
  'darksalmon:e9967a,darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,' +
  'darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,dimgrey:696969,' +
  'dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff,gainsboro:dcdcdc,' +
  'ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,grey:808080,' +
  'honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,' +
  'lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,' +
  'lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,' +
  'lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,' +
  'lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,' +
  'mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,' +
  'mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,' +
  'midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,' +
  'oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,' +
  'palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,' +
  'peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399,' +
  'red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,' +
  'seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,slategray:708090,' +
  'slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,' +
  'tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,' +
  'yellowgreen:9acd32';

export const NAMED_COLORS: Record<string, string> = Object.fromEntries(
  NAMED_SOURCE.split(',').map((pair) => {
    const [name, hex] = pair.split(':');
    return [name, `#${hex}`];
  })
);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function parseHex(hex: string): Rgba | null {
  const h = hex.replace('#', '');
  if (!/^[0-9a-f]+$/i.test(h)) return null;
  if (h.length === 3 || h.length === 4) {
    const [r, g, b, a] = h.split('').map((c) => parseInt(c + c, 16));
    return { r, g, b, a: h.length === 4 ? a / 255 : 1 };
  }
  if (h.length === 6 || h.length === 8) {
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  return null;
}

function parseChannel(v: string, max: number): number {
  const s = v.trim();
  if (s.endsWith('%')) return (parseFloat(s) / 100) * max;
  return parseFloat(s);
}

function parseAlpha(v: string | undefined): number {
  if (v === undefined || v.trim() === '') return 1;
  const s = v.trim();
  return clamp(s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s), 0, 1);
}

/** Splits "a, b, c / d" or "a b c / d" into [a, b, c, d?]. */
function splitArgs(inner: string): string[] | null {
  const [main, alphaPart] = inner.split('/');
  const parts = main.includes(',') ? main.split(',') : main.trim().split(/\s+/);
  const cleaned = parts.map((p) => p.trim()).filter(Boolean);
  if (alphaPart !== undefined) cleaned.push(alphaPart.trim());
  return cleaned.length >= 3 ? cleaned : null;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** Parses a CSS color value. Returns null for anything that is not a concrete color. */
export function parseColor(value: string): Rgba | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (v.startsWith('#')) return parseHex(v);
  if (NAMED_COLORS[v]) return parseHex(NAMED_COLORS[v]);
  const fn = v.match(/^(rgba?|hsla?)\((.*)\)$/);
  if (!fn) return null;
  const args = splitArgs(fn[2]);
  if (!args || args.some((a) => /var\(|calc\(/.test(a))) return null;
  if (fn[1].startsWith('rgb')) {
    const [r, g, b] = args.slice(0, 3).map((a) => parseChannel(a, 255));
    if ([r, g, b].some((n) => !isFinite(n))) return null;
    return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: parseAlpha(args[3]) };
  }
  const h = parseFloat(args[0]);
  const s = parseChannel(args[1], 1);
  const l = parseChannel(args[2], 1);
  if ([h, s, l].some((n) => !isFinite(n))) return null;
  const [r, g, b] = hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1));
  return { r, g, b, a: parseAlpha(args[3]) };
}

const toLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

/** OKLCH of an sRGB color (alpha ignored). */
export function toOklch(c: Rgba): Oklch {
  const r = toLinear(c.r);
  const g = toLinear(c.g);
  const b = toLinear(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.sqrt(A * A + B * B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}

/** WCAG 2 relative luminance. */
export function relativeLuminance(c: Rgba): number {
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

/** WCAG 2 contrast ratio between two opaque colors (1-21). */
export function contrastRatio(a: Rgba | string, b: Rgba | string): number {
  const ca = typeof a === 'string' ? parseColor(a) : a;
  const cb = typeof b === 'string' ? parseColor(b) : b;
  if (!ca || !cb) return 1;
  const la = relativeLuminance(ca);
  const lb = relativeLuminance(cb);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Smallest angle between two hues, 0-180. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
