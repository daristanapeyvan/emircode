const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..');
const exePath = path.join(projectRoot, 'release', 'win-unpacked', 'EmirCode.exe');
const iconPath = path.join(projectRoot, 'build', 'icon.ico');

if (fs.existsSync(exePath) && fs.existsSync(iconPath)) {
  const cacheBase = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign');
  let rceditPath = null;
  if (fs.existsSync(cacheBase)) {
    const entries = fs.readdirSync(cacheBase);
    for (const entry of entries) {
      const candidate = path.join(cacheBase, entry, 'rcedit-x64.exe');
      if (fs.existsSync(candidate)) {
        rceditPath = candidate;
        break;
      }
    }
  }

  if (rceditPath) {
    try {
      execSync(
        `"${rceditPath}" "${exePath}" --set-icon "${iconPath}" --set-version-string "FileDescription" "Emir Code - AI Native Coding Agent Desktop Client" --set-version-string "ProductName" "Emir Code" --set-version-string "LegalCopyright" "Copyright (C) 2026 Agah Emir"`,
        { stdio: 'inherit' }
      );
      console.log('Successfully embedded Emir Code icon and metadata into EmirCode.exe!');
    } catch (e) {
      console.warn('Warning: rcedit could not update metadata:', e.message);
    }
  }
}

// Linux unpacked packaging enhancements
const linuxUnpacked = path.join(projectRoot, 'release', 'linux-unpacked');
const linuxInstaller = path.join(projectRoot, 'build', 'linux-installer.sh');
const linuxPng = path.join(projectRoot, 'build', 'icon.png');

if (fs.existsSync(linuxUnpacked)) {
  if (fs.existsSync(linuxInstaller)) {
    fs.copyFileSync(linuxInstaller, path.join(linuxUnpacked, 'install.sh'));
    fs.copyFileSync(linuxInstaller, path.join(projectRoot, 'release', 'linux-installer.sh'));
    console.log('✓ Linux GUI installer script bundled into release directory.');
  }
  if (fs.existsSync(linuxPng)) {
    fs.copyFileSync(linuxPng, path.join(linuxUnpacked, 'icon.png'));
  }
}

