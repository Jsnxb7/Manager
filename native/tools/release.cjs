#!/usr/bin/env node
/*
 * Builds an update for both platforms in one go:
 *   npm run release                 next patch version (1.0.0 -> 1.0.1)
 *   npm run release -- 1.2.0        a chosen version
 *   options: --skip-windows --skip-android --no-publish --no-checks
 *
 * Every release raises the build number, so the Windows installer upgrades the
 * installed app in place and Android installs the APK over the old one; the
 * library (kept in app data, not the install folder) is untouched.
 *
 * Output: release/installers/AnimeManager-Setup-<v>.exe,
 *         release/android/AnimeManager-<v>.apk, release/update.json.
 * Publish: copies them to %LOCALAPPDATA%\AnimeManager\updates, where the PC app
 * finds its installer and from where it hands the APK to the phone over sync.
 */
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareEnvironment } = require('./cli-environment.cjs');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const chosen = args.find(a => /^\d+\.\d+\.\d+$/.test(a));

function run(command, commandArgs, options = {}) {
  console.log(`\n> ${command} ${commandArgs.join(' ')}`);
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    shell: process.platform === 'win32' && !command.endsWith('.exe'),
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} failed (${result.status ?? result.error})`);
  }
}
const sha256 = file =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function findMsBuild() {
  const vswhere = path.join(
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio\\Installer\\vswhere.exe',
  );
  const found = spawnSync(vswhere, [
    '-latest', '-prerelease', '-products', '*',
    '-requires', 'Microsoft.Component.MSBuild',
    '-find', 'MSBuild\\**\\Bin\\MSBuild.exe',
  ]).stdout?.toString().trim().split(/\r?\n/)[0];
  if (!found) throw new Error('MSBuild not found; install Visual Studio with C++ workloads.');
  return found;
}
function findInno() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs\\Inno Setup 6\\ISCC.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Inno Setup 6\\ISCC.exe'),
    path.join(process.env.ProgramFiles || '', 'Inno Setup 6\\ISCC.exe'),
  ];
  const found = candidates.find(c => fs.existsSync(c));
  if (!found) throw new Error('Inno Setup 6 not found (winget install JRSoftware.InnoSetup).');
  return found;
}

function bumpVersion() {
  const file = path.join(root, 'version.json');
  const current = JSON.parse(fs.readFileSync(file, 'utf8'));
  const [major, minor, patch] = current.version.split('.').map(Number);
  const next = {
    version: chosen ?? `${major}.${minor}.${patch + 1}`,
    build: current.build + 1,
  };
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  fs.writeFileSync(
    path.join(root, 'src/app/version.ts'),
    "// Written by tools/release.cjs from version.json. Do not edit by hand.\n" +
      `export const APP_VERSION = '${next.version}';\n` +
      `export const APP_BUILD = ${next.build};\n`,
  );
  console.log(`Version ${current.version} (build ${current.build}) -> ${next.version} (build ${next.build})`);
  return next;
}

function buildWindows(version) {
  const env = prepareEnvironment(process.env);
  run('node', ['tools/cli.cjs', 'bundle', '--platform', 'windows', '--entry-file', 'index.js',
    '--bundle-output', 'windows/AnimeManager/Bundle/index.windows.bundle',
    '--assets-dest', 'windows/AnimeManager/Bundle', '--dev', 'false', '--minify', 'false'],
    { cwd: root, env });
  run(findMsBuild(), ['AnimeManager.sln', '/p:Configuration=Release', '/p:Platform=x64',
    '/m', '/v:minimal', '/nologo', '/t:AnimeManager'], { cwd: path.join(root, 'windows'), env });
  // Mirror the build into the staged folder; the redistributable stays.
  const staged = path.join(root, 'release/windows');
  const copy = spawnSync('robocopy', [path.join(root, 'windows/x64/Release'), staged,
    '/MIR', '/XD', 'redist', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], { stdio: 'inherit' });
  if (copy.status >= 8) throw new Error('Could not stage the Windows release');
  run(findInno(), [`/DAppVersion=${version}`, 'packaging/windows/AnimeManager.iss'], { cwd: root });
  return path.join(root, `release/installers/AnimeManager-Setup-${version}.exe`);
}

function buildAndroid(version) {
  const signing = path.join(os.homedir(), '.anime-manager-signing', 'signing.env.ps1');
  if (!fs.existsSync(signing)) throw new Error(`Signing settings not found: ${signing}`);
  // The signing script sets environment variables for the Gradle run only.
  run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    `. '${signing}'; & .\\gradlew.bat assembleRelease --no-daemon --console=plain; exit $LASTEXITCODE`],
    { cwd: path.join(root, 'android') });
  const output = path.join(root, `release/android/AnimeManager-${version}.apk`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.copyFileSync(path.join(root, 'android/app/build/outputs/apk/release/app-release.apk'), output);
  return output;
}

function publish(manifest, files) {
  const target = path.join(process.env.LOCALAPPDATA || '', 'AnimeManager', 'updates');
  fs.mkdirSync(target, { recursive: true });
  for (const old of fs.readdirSync(target)) {
    if (/^AnimeManager-.*\.(exe|apk)$/.test(old) && !files.some(f => path.basename(f) === old)) {
      fs.rmSync(path.join(target, old));
    }
  }
  for (const file of files) fs.copyFileSync(file, path.join(target, path.basename(file)));
  fs.writeFileSync(path.join(target, 'update.json'), JSON.stringify(manifest, null, 2));
  console.log(`Published to ${target}`);
}

function main() {
  const next = bumpVersion();
  if (!flag('--no-checks')) {
    run('npx', ['tsc', '--noEmit'], { cwd: root });
    run('npx', ['jest', '--runInBand'], { cwd: root });
  }
  const manifest = { version: next.version, build: next.build, publishedAt: new Date().toISOString() };
  const files = [];
  if (!flag('--skip-windows')) {
    const installer = buildWindows(next.version);
    manifest.windows = { file: path.basename(installer), sha256: sha256(installer), size: fs.statSync(installer).size };
    files.push(installer);
  }
  if (!flag('--skip-android')) {
    const apk = buildAndroid(next.version);
    manifest.android = { file: path.basename(apk), sha256: sha256(apk), size: fs.statSync(apk).size };
    files.push(apk);
  }
  fs.writeFileSync(path.join(root, 'release/update.json'), JSON.stringify(manifest, null, 2));
  if (!flag('--no-publish')) publish(manifest, files);
  console.log(`\nRelease ${next.version} (build ${next.build}) ready.`);
}

try {
  main();
} catch (error) {
  console.error(`\nRelease failed: ${error.message}`);
  process.exit(1);
}
