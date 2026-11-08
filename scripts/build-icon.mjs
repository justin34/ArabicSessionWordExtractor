// Builds build/icon.ico (the app's and the Installer's icon) from Assets/6133924.png,
// Flaticon's "Arabic" icon by Magnific (credited on the Credits screen). Windows only: the
// sizes are drawn by System.Drawing through PowerShell. The .ico is committed, so this only
// needs running again when the icon changes: `node scripts/build-icon.mjs`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = join(root, 'Assets', '6133924.png');
const out = join(root, 'build', 'icon.ico');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const work = mkdtempSync(join(tmpdir(), 'icon-'));
try {
  const script = `
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile($args[0])
foreach ($size in ${SIZES.join(',')}) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($src, 0, 0, $size, $size)
  $bmp.Save((Join-Path $args[1] "$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
$src.Dispose()`;
  const ps1 = join(work, 'resize.ps1');
  writeFileSync(ps1, script);
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, source, work], { stdio: 'inherit' });

  // ICO: a header, one 16-byte directory entry per image, then the PNG images themselves.
  const images = SIZES.map((size) => ({ size, data: readFileSync(join(work, `${size}.png`)) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // no palette
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  mkdirSync(join(root, 'build'), { recursive: true });
  writeFileSync(out, Buffer.concat([header, ...entries, ...images.map((i) => i.data)]));
  console.log(`Wrote ${out} (${SIZES.join(', ')} px)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
