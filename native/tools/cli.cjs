// Invoke the installed community CLI from this project, never a global/cached CLI.
// This launcher only executes the command explicitly supplied by its caller.
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {prepareEnvironment} = require('./cli-environment.cjs');
const root = path.resolve(__dirname, '..');
const entry = path.join(root, 'node_modules', '@react-native-community', 'cli', 'build', 'bin.js');
if (!fs.existsSync(entry)) {
  console.error('Project dependencies are missing. Run npm ci --ignore-scripts in native/.');
  process.exit(1);
}
const env = prepareEnvironment(process.env);
const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [path.join(__dirname, 'cli-entry.cjs'), ...(args.length ? args : ['--help'])], {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: false,
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
