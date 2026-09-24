/**
 * Post-build steps that are not part of electron-builder's pipeline.
 *
 * The Windows icon and version information are embedded by scripts/afterPack.js, before the
 * installer and the portable exe are created (editing release/win-unpacked afterwards did not
 * reach the installed app).
 */
const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..');

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
