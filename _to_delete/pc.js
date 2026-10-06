const babel = require('@babel/core');
const fs = require('fs');
const files = process.argv.slice(2);
let ok = true;
for (const f of files) {
  try {
    babel.parse(fs.readFileSync(f, 'utf8'), { babelrc: false, configFile: false, filename: f, plugins: ['@babel/plugin-transform-react-jsx'] });
    console.log('OK  ', f);
  } catch (e) { ok = false; console.log('FAIL', f, '->', e.message); }
}
process.exit(ok ? 0 : 1);
