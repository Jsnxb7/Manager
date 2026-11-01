const path = require('node:path');
const command = process.argv[2];
if (process.platform === 'win32' && ['run-windows', 'init-windows', 'autolink-windows', 'codegen-windows'].includes(command)) {
  try {
    // Community CLI suppresses plugin-load errors; expose the actual dependency failure first.
    const config = require('react-native-windows/react-native.config.js');
    if (!config.commands.some(item => item.name.split(' ')[0] === command)) {
      throw new Error(`The installed Windows plugin does not provide ${command}.`);
    }
  } catch (error) {
    console.error(`Windows CLI dependency check failed: ${error.message}`);
    console.error('PowerShell 7 (pwsh.exe) and the .NET SDK must be available. Windows PowerShell 5.1 is insufficient.');
    process.exit(1);
  }
}
const entry = path.resolve(__dirname, '../node_modules/@react-native-community/cli/build/bin.js');
process.argv[1] = entry;
require(entry);
