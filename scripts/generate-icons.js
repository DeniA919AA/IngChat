#!/usr/bin/env node
/**
 * Generates PNG icons for the IngChat PWA manifest.
 * Uses only pngjs (pure JavaScript, no native dependencies).
 */

try {
  const { PNG } = require('pngjs');
  const fs = require('fs');
  const path = require('path');

  const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
  const iconsDir = path.join(__dirname, '../public/icons');
  fs.mkdirSync(iconsDir, { recursive: true });

  // Colors
  const BG    = [7, 94, 84, 255];      // #075e54 dark green
  const ACC   = [0, 168, 132, 255];    // #00a884 teal
  const WHITE = [255, 255, 255, 255];
  const TRANS = [0, 0, 0, 0];

  function setPixel(data, w, x, y, c) {
    if (x < 0 || y < 0 || x >= w || y >= w) return;
    const i = (w * y + x) << 2;
    data[i] = c[0]; data[i+1] = c[1]; data[i+2] = c[2]; data[i+3] = c[3];
  }

  function fillRect(data, w, x1, y1, x2, y2, c) {
    for (let y = Math.round(y1); y < Math.round(y2); y++)
      for (let x = Math.round(x1); x < Math.round(x2); x++)
        setPixel(data, w, x, y, c);
  }

  function fillCircle(data, w, cx, cy, r, c) {
    const r2 = r * r;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if ((x-cx)**2 + (y-cy)**2 <= r2) setPixel(data, w, x, y, c);
  }

  function fillRoundRect(data, w, x1, y1, x2, y2, r, c) {
    fillRect(data, w, x1 + r, y1, x2 - r, y2, c);
    fillRect(data, w, x1, y1 + r, x2, y2 - r, c);
    fillCircle(data, w, x1 + r, y1 + r, r, c);
    fillCircle(data, w, x2 - r, y1 + r, r, c);
    fillCircle(data, w, x1 + r, y2 - r, r, c);
    fillCircle(data, w, x2 - r, y2 - r, r, c);
  }

  function fillTriangle(data, w, x1, y1, x2, y2, x3, y3, c) {
    const minY = Math.round(Math.min(y1, y2, y3));
    const maxY = Math.round(Math.max(y1, y2, y3));
    for (let y = minY; y <= maxY; y++) {
      const t = maxY === minY ? 0 : (y - minY) / (maxY - minY);
      const lx = x1 + (x3 - x1) * t;
      const rx = x2 + (x3 - x2) * t;
      fillRect(data, w, Math.min(lx, rx), y, Math.max(lx, rx), y + 1, c);
    }
  }

  function createIcon(size) {
    const s = size;
    const png = new PNG({ width: s, height: s, filterType: -1 });
    png.data.fill(0);
    const d = png.data;

    const pad = s * 0.06;
    const rad = s * 0.22;

    // Background rounded square
    fillRoundRect(d, s, pad, pad, s - pad, s - pad, rad, BG);

    // Chat bubble body
    const bL = s * 0.15, bR = s * 0.85;
    const bT = s * 0.18, bB = s * 0.70;
    const bR2 = s * 0.10;
    fillRoundRect(d, s, bL, bT, bR, bB, bR2, ACC);

    // Chat bubble tail (triangle)
    fillTriangle(d, s,
      s * 0.15, s * 0.62,
      s * 0.36, s * 0.68,
      s * 0.20, s * 0.82,
      ACC
    );

    // Letter "I" in white inside bubble
    const cx = s * 0.50;
    const iT = s * 0.28, iB = s * 0.60;
    const stemW = s * 0.08;
    const barW = s * 0.22, barH = s * 0.06;

    // Top bar
    fillRoundRect(d, s, cx - barW/2, iT, cx + barW/2, iT + barH, s * 0.03, WHITE);
    // Stem
    fillRoundRect(d, s, cx - stemW/2, iT, cx + stemW/2, iB, s * 0.03, WHITE);
    // Bottom bar
    fillRoundRect(d, s, cx - barW/2, iB - barH, cx + barW/2, iB, s * 0.03, WHITE);

    return png;
  }

  for (const size of SIZES) {
    const png = createIcon(size);
    const buf = PNG.sync.write(png);
    fs.writeFileSync(path.join(iconsDir, `icon-${size}x${size}.png`), buf);
    console.log(`  ✓ Generated ${size}x${size} icon`);
  }

  console.log('\nIngChat icons generated successfully!\n');

} catch (err) {
  // pngjs not yet installed — skip silently, icons will be generated after npm install
  if (err.code === 'MODULE_NOT_FOUND') {
    console.log('Icon generator: pngjs not found, skipping (will run after npm install)');
  } else {
    console.error('Icon generation error:', err.message);
  }
}
