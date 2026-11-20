rustup default stable-msvc
npm install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npx tauri icon app-icon.png
npm run tauri build
explorer src-tauri\target\release\bundle\nsis
