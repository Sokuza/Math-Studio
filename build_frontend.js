/**
 * Build Script for bundling frontend assets with esbuild into 'web_dist'.
 */

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

async function build() {
  console.log("Building frontend bundle into web_dist...");

  // Ensure output dirs
  fs.mkdirSync('web_dist/lib', { recursive: true });
  fs.mkdirSync('web_dist/styles', { recursive: true });

  // 1. Bundle JS
  await esbuild.build({
    entryPoints: ['src/main.js'],
    bundle: true,
    outfile: 'web_dist/bundle.js',
    format: 'iife',
    minify: false,
    sourcemap: false,
    platform: 'browser',
    target: ['chrome100', 'edge100']
  });
  console.log("✓ JS bundled successfully to web_dist/bundle.js");

  // 2. Copy HTML
  fs.copyFileSync('src/index.html', 'web_dist/index.html');
  console.log("✓ Copied index.html");

  // 3. Copy Styles
  fs.copyFileSync('src/styles/win11_settings.css', 'web_dist/styles/win11_settings.css');
  console.log("✓ Copied win11_settings.css");

  // 4. Copy Icons
  if (fs.existsSync('app_icon.png')) {
    fs.copyFileSync('app_icon.png', 'web_dist/app_icon.png');
    console.log("✓ Copied app_icon.png");
  }
  if (fs.existsSync('app_icon.ico')) {
    fs.copyFileSync('app_icon.ico', 'web_dist/app_icon.ico');
    console.log("✓ Copied app_icon.ico");
  }

  // 5. Copy KaTeX CSS & fonts
  if (fs.existsSync('node_modules/katex/dist/katex.min.css')) {
    fs.copyFileSync('node_modules/katex/dist/katex.min.css', 'web_dist/lib/katex.min.css');
    console.log("✓ Copied katex.min.css");
  }

  const katexFontsDir = 'node_modules/katex/dist/fonts';
  if (fs.existsSync(katexFontsDir)) {
    fs.cpSync(katexFontsDir, 'web_dist/lib/fonts', { recursive: true });
    console.log("✓ Copied katex fonts");
  }

  console.log("Frontend build to web_dist complete!");
}

build().catch(err => {
  console.error("Build failed:", err);
  process.exit(1);
});
