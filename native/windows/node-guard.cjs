// Loaded with --require into node programs that run in the isolated environment on Windows.
// Node starts other programs through named pipes, which an AppContainer cannot create; without
// this guard such a call would wait forever. It fails at once with a clear message instead.
'use strict';
const childProcess = require('child_process');

function refuse() {
  const error = new Error(
    'Programs cannot start other programs in the isolated environment of Emir Code. Run the other program as its own command.'
  );
  error.code = 'EMIRCODE_ISOLATED';
  throw error;
}

for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  childProcess[name] = refuse;
}
require('module').syncBuiltinESMExports();
