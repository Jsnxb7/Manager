const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function prepareEnvironment(source, options = {}) {
  const env = {...source};
  if ((options.platform || process.platform) !== 'win32') return env;
  const exists = options.exists || fs.existsSync;
  const home = options.home || os.homedir();
  const entries = Object.keys(env)
    .filter(key => key.toLowerCase() === 'path')
    .flatMap(key => {
      const value = env[key];
      delete env[key];
      return value.split(';').filter(Boolean);
    });
  const programFiles = env.ProgramFiles || 'C:\\Program Files';
  const candidates = [
    [path.win32.join(programFiles, 'dotnet'), 'dotnet.exe'],
    [path.win32.join(programFiles, 'PowerShell', '7'), 'pwsh.exe'],
  ];
  // An existing developer-tool runtime is a fallback, never a bundled app dependency.
  if (!entries.some(dir => exists(path.win32.join(dir, 'pwsh.exe'))) &&
      !exists(path.win32.join(programFiles, 'PowerShell', '7', 'pwsh.exe'))) {
    candidates.push([
      path.win32.join(home, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'native', 'powershell'),
      'pwsh.exe',
    ]);
  }
  for (const [dir, executable] of candidates) {
    if (exists(path.win32.join(dir, executable)) &&
        !entries.some(item => item.toLowerCase() === dir.toLowerCase())) entries.push(dir);
  }
  env.Path = entries.join(';');
  return env;
}

module.exports = {prepareEnvironment};
