// Invoke the installed community CLI from this project, never a global/cached CLI.
// This launcher only executes the command explicitly supplied by its caller.
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const entry = path.join(root, 'node_modules', '@react-native-community', 'cli', 'build', 'bin.js');
if (!fs.existsSync(entry)) {
  console.error('Project dependencies are missing. Run npm ci --ignore-scripts in native/.');
  process.exit(1);
}
const env = {...process.env};
if (process.platform === 'win32') {
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'Path';
  const entries = (env[pathKey] || '').split(';').filter(Boolean);
  const dotnet = path.join(env.ProgramFiles || 'C:\\Program Files', 'dotnet');
  if (fs.existsSync(path.join(dotnet, 'dotnet.exe')) && !entries.some(item => path.resolve(item).toLowerCase() === dotnet.toLowerCase())) {
    entries.push(dotnet);
  }
  env[pathKey] = entries.join(';');
}
const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [entry, ...(args.length ? args : ['--help'])], {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: false,
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
