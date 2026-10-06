// Verifies each given file parses as valid JS/JSX using the project's
// own @babel/core (node --check misses real syntax errors in files with
// top-level import/export, per this project's own prior audit notes).
const babel = require('@babel/core');
const fs = require('fs');

const files = process.argv.slice(2);
let ok = 0;
let fail = 0;

for (const f of files) {
  try {
    const code = fs.readFileSync(f, 'utf8');
    babel.parse(code, {
      filename: f,
      babelrc: false,
      configFile: false,
      parserOpts: {
        sourceType: 'module',
        plugins: ['jsx', 'classProperties', 'objectRestSpread', 'optionalChaining', 'nullishCoalescingOperator'],
      },
    });
    console.log('OK   ' + f);
    ok++;
  } catch (e) {
    console.log('FAIL ' + f);
    console.log('     ' + e.message);
    fail++;
  }
}
console.log(`\n${ok} ok, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
