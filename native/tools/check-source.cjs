const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(pkg.dependencies['react-native'], '0.85.3');
assert.equal(pkg.dependencies['react-native-windows'], '0.85.0');
for (const section of ['dependencies', 'devDependencies']) {
  for (const [name, version] of Object.entries(pkg[section])) {
    assert(!/^[~^*]/.test(version), `Dependency must be pinned: ${name}`);
  }
}
for (const [name, command] of Object.entries(pkg.scripts)) {
  assert(!/run-android|run-windows|gradlew|msbuild|assembleRelease/i.test(command), `Unapproved build script: ${name}`);
}
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(tsx?|json)$/.test(file)) {
      assert(!/http:\/\/(localhost|127\.0\.0\.1)/.test(fs.readFileSync(file, 'utf8')), `Local backend dependency: ${file}`);
    }
  }
}
walk(path.join(root, 'src'));
assert(fs.existsSync(path.join(root, 'android/app/src/main/AndroidManifest.xml')));
assert(fs.existsSync(path.join(root, 'windows/AnimeManager.sln')) || fs.existsSync(path.join(root, 'windows/AnimeManager.slnx')));
console.log('Static source/configuration checks passed. No native compilation.');
