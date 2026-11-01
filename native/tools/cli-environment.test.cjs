const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path').win32;
const {prepareEnvironment} = require('./cli-environment.cjs');
const standard = 'C:\\Program Files\\PowerShell\\7';
const fallback = 'C:\\Users\\dev\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\powershell';
function prepare(source, files) {
  return prepareEnvironment(source, {platform:'win32',home:'C:\\Users\\dev',exists:file => files.includes(file)});
}
test('finds installed PowerShell 7 and .NET without changing the source environment', () => {
  const source = {Path:'C:\\Windows\\System32'};
  const env = prepare(source, [path.join(standard,'pwsh.exe'),'C:\\Program Files\\dotnet\\dotnet.exe']);
  assert.ok(env.Path.split(';').includes(standard));
  assert.ok(env.Path.split(';').includes('C:\\Program Files\\dotnet'));
  assert.equal(source.Path,'C:\\Windows\\System32');
});
test('uses an existing developer runtime only when PowerShell 7 is otherwise unavailable', () => {
  const files = [path.join(fallback,'pwsh.exe')];
  assert.ok(prepare({Path:'C:\\Windows'},files).Path.includes(fallback));
  const existing = 'D:\\PowerShell';
  assert.equal(prepare({Path:existing},[...files,path.join(existing,'pwsh.exe')]).Path,existing);
  assert.ok(!prepare({Path:'C:\\Windows'},[...files,path.join(standard,'pwsh.exe')]).Path.includes(fallback));
});
test('preserves paths and merges Windows casing aliases without inventing missing tools', () => {
  const env = prepare({PATH:'C:\\one',Path:'D:\\two'},[]);
  assert.equal(env.Path,'C:\\one;D:\\two');
  assert.equal(env.PATH,undefined);
});
