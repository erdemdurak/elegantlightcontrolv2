type Rgb = {
  r: number;
  g: number;
  b: number;
};

type Hsv = {
  h: number;
  s: number;
  v: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function hsvToRgb(h: number, s: number, v: number): Rgb {
  const normalizedHue = ((h % 360) + 360) % 360;
  const normalizedSat = clamp(s, 0, 100) / 100;
  const normalizedVal = clamp(v, 0, 100) / 100;

  const c = normalizedVal * normalizedSat;
  const x = c * (1 - Math.abs(((normalizedHue / 60) % 2) - 1));
  const m = normalizedVal - c;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;

  if (normalizedHue < 60) {
    rPrime = c;
    gPrime = x;
  } else if (normalizedHue < 120) {
    rPrime = x;
    gPrime = c;
  } else if (normalizedHue < 180) {
    gPrime = c;
    bPrime = x;
  } else if (normalizedHue < 240) {
    gPrime = x;
    bPrime = c;
  } else if (normalizedHue < 300) {
    rPrime = x;
    bPrime = c;
  } else {
    rPrime = c;
    bPrime = x;
  }

  return {
    r: Math.round((rPrime + m) * 255),
    g: Math.round((gPrime + m) * 255),
    b: Math.round((bPrime + m) * 255),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const rr = clamp(Math.round(r), 0, 255).toString(16).padStart(2, "0");
  const gg = clamp(Math.round(g), 0, 255).toString(16).padStart(2, "0");
  const bb = clamp(Math.round(b), 0, 255).toString(16).padStart(2, "0");
  return `#${rr}${gg}${bb}`.toUpperCase();
}

export function hexToRgb(hex: string): Rgb {
  const cleaned = hex.replace("#", "").trim();
  const normalized = cleaned.length === 3
    ? cleaned
        .split("")
        .map((char) => char + char)
        .join("")
    : cleaned;

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return { r: 255, g: 255, b: 255 };
  }

  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = clamp(r, 0, 255) / 255;
  const gn = clamp(g, 0, 255) / 255;
  const bn = clamp(b, 0, 255) / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) {
      h = 60 * (((gn - bn) / delta) % 6);
    } else if (max === gn) {
      h = 60 * ((bn - rn) / delta + 2);
    } else {
      h = 60 * ((rn - gn) / delta + 4);
    }
  }

  const s = max === 0 ? 0 : (delta / max) * 100;
  const v = max * 100;

  return {
    h: h < 0 ? h + 360 : h,
    s,
    v,
  };
}

export function hsvToHex(h: number, s: number, v: number): string {
  return rgbToHex(hsvToRgb(h, s, v));
}

export function hexToHsv(hex: string): Hsv {
  return rgbToHsv(hexToRgb(hex));
}
