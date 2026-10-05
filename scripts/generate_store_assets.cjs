const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

if (!fs.existsSync('store-assets')) {
  fs.mkdirSync('store-assets');
}

fs.copyFileSync('extension/icons/icon128.png', 'store-assets/icon-128.png');

async function createSmallPromo() {
  const width = 440;
  const height = 280;
  const iconSize = 130;

  const iconBuffer = await sharp('store-assets/icon-master.png')
    .resize(iconSize, iconSize)
    .toBuffer();

  const svgOverlay = Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="bg-glow" cx="30%" cy="45%" r="65%">
          <stop offset="0%" stop-color="#1e293b" stop-opacity="0.9"/>
          <stop offset="60%" stop-color="#0a0d16" stop-opacity="0.98"/>
          <stop offset="100%" stop-color="#05070a" stop-opacity="1"/>
        </radialGradient>
        <linearGradient id="title-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="60%" stop-color="#38bdf8"/>
          <stop offset="100%" stop-color="#818cf8"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bg-glow)"/>
      <g transform="translate(170, 92)">
        <text x="0" y="0" font-family="system-ui, -apple-system, sans-serif" font-size="32" font-weight="800" fill="url(#title-grad)" letter-spacing="1.5">AUGUST</text>
        <text x="0" y="26" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="600" fill="#94a3b8" letter-spacing="0.5">Voice Browser Agent</text>
        
        <rect x="0" y="46" width="138" height="22" rx="11" fill="rgba(16, 185, 129, 0.15)" stroke="rgba(16, 185, 129, 0.4)" stroke-width="1"/>
        <text x="69" y="61" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="700" fill="#34d399" text-anchor="middle">🔒 100% Offline Whisper</text>

        <rect x="0" y="76" width="122" height="22" rx="11" fill="rgba(56, 189, 248, 0.15)" stroke="rgba(56, 189, 248, 0.4)" stroke-width="1"/>
        <text x="61" y="91" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="700" fill="#38bdf8" text-anchor="middle">Hands-Free Voice</text>

        <rect x="130" y="76" width="114" height="22" rx="11" fill="rgba(99, 102, 241, 0.15)" stroke="rgba(99, 102, 241, 0.4)" stroke-width="1"/>
        <text x="187" y="91" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="700" fill="#a5b4fc" text-anchor="middle">Zero Cloud Audio</text>
      </g>
    </svg>
  `);

  await sharp(svgOverlay)
    .composite([
      { input: iconBuffer, top: 75, left: 24 }
    ])
    .png()
    .toFile('store-assets/promo-small-440x280.png');
  console.log('Created store-assets/promo-small-440x280.png');
}

async function createMarquee() {
  const width = 1400;
  const height = 560;
  const iconSize = 340;

  const iconBuffer = await sharp('store-assets/icon-master.png')
    .resize(iconSize, iconSize)
    .toBuffer();

  const svgOverlay = Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="bg-glow-m" cx="35%" cy="50%" r="70%">
          <stop offset="0%" stop-color="#1e293b" stop-opacity="0.95"/>
          <stop offset="50%" stop-color="#0b0f19" stop-opacity="0.98"/>
          <stop offset="100%" stop-color="#040608" stop-opacity="1"/>
        </radialGradient>
        <linearGradient id="title-grad-m" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="50%" stop-color="#38bdf8"/>
          <stop offset="100%" stop-color="#818cf8"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bg-glow-m)"/>
      <g transform="translate(540, 185)">
        <text x="0" y="0" font-family="system-ui, -apple-system, sans-serif" font-size="76" font-weight="900" fill="url(#title-grad-m)" letter-spacing="3">AUGUST</text>
        <text x="0" y="58" font-family="system-ui, -apple-system, sans-serif" font-size="30" font-weight="600" fill="#94a3b8" letter-spacing="1">Private Voice Browser Assistant for Chrome</text>
        
        <g transform="translate(0, 105)">
          <rect x="0" y="0" width="280" height="44" rx="22" fill="rgba(16, 185, 129, 0.15)" stroke="rgba(16, 185, 129, 0.4)" stroke-width="1.5"/>
          <text x="140" y="28" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="700" fill="#34d399" text-anchor="middle">🔒 100% Offline Whisper</text>

          <rect x="300" y="0" width="230" height="44" rx="22" fill="rgba(56, 189, 248, 0.15)" stroke="rgba(56, 189, 248, 0.4)" stroke-width="1.5"/>
          <text x="415" y="28" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="700" fill="#38bdf8" text-anchor="middle">⚡ Zero Cloud Audio</text>

          <rect x="550" y="0" width="230" height="44" rx="22" fill="rgba(99, 102, 241, 0.15)" stroke="rgba(99, 102, 241, 0.4)" stroke-width="1.5"/>
          <text x="665" y="28" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="700" fill="#a5b4fc" text-anchor="middle">🎙 Hands-Free Control</text>
        </g>
      </g>
    </svg>
  `);

  await sharp(svgOverlay)
    .composite([
      { input: iconBuffer, top: 110, left: 120 }
    ])
    .png()
    .toFile('store-assets/promo-marquee-1400x560.png');
  console.log('Created store-assets/promo-marquee-1400x560.png');
}

Promise.all([createSmallPromo(), createMarquee()])
  .then(() => console.log('All store assets generated!'))
  .catch(console.error);
