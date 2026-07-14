const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const INPUT = process.argv[2] || path.join('C:/Users/rhunt/Downloads', 'ChatGPT Image Jul 13, 2026, 01_36_54 PM.png');
const OUTPUT_DIR = path.join(__dirname, 'src-tauri', 'icons');
const RADIUS_RATIO = 0.18;

const SIZES = {
  '32x32.png': 32,
  '128x128.png': 128,
  '128x128@2x.png': 256,
  'icon.png': 512,
  'Square30x30Logo.png': 30,
  'Square44x44Logo.png': 44,
  'Square71x71Logo.png': 71,
  'Square89x89Logo.png': 89,
  'Square107x107Logo.png': 107,
  'Square142x142Logo.png': 142,
  'Square150x150Logo.png': 150,
  'Square284x284Logo.png': 284,
  'Square310x310Logo.png': 310,
  'StoreLogo.png': 50,
};

async function generate() {
  if (!fs.existsSync(INPUT)) {
    console.error('Input not found:', INPUT);
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const meta = await sharp(INPUT).metadata();
  console.log(`Source: ${meta.width}x${meta.height}`);

  const svgOverlay = (w, h) => {
    const r = Math.round(Math.min(w, h) * RADIUS_RATIO);
    return Buffer.from(
      `<svg width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="white"/></svg>`
    );
  };

  for (const [name, size] of Object.entries(SIZES)) {
    const outPath = path.join(OUTPUT_DIR, name);
    const mask = svgOverlay(size, size);
    await sharp(INPUT)
      .resize(size, size, { fit: 'cover', position: 'centre' })
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toFile(outPath);
    console.log(`  ${name} (${size}x${size})`);
  }

  // Generate .ico from 256px
  try {
    const pngToIco = require('png-to-ico');
    const src256 = path.join(OUTPUT_DIR, 'icon.ico.png');
    await sharp(INPUT)
      .resize(256, 256, { fit: 'cover', position: 'centre' })
      .composite([{ input: svgOverlay(256, 256), blend: 'dest-in' }])
      .png().toFile(src256);
    const icoBuf = await pngToIco([src256]);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'icon.ico'), icoBuf);
    fs.unlinkSync(src256);
    console.log('  icon.ico');
  } catch (e) {
    console.log('  icon.ico (skipped — png-to-ico not installed)');
  }

  console.log('\nDone!');
}

generate().catch(e => { console.error(e); process.exit(1); });
