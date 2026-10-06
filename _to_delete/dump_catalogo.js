const babel = require('@babel/core');
const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync('catalogoPlantas.js', 'utf8');
const out = babel.transform(src, {
  babelrc: false, configFile: false,
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
}).code;

const moduleObj = { exports: {} };
const fn = new Function('module', 'exports', 'require', out);
fn(moduleObj, moduleObj.exports, require);

const cat = moduleObj.exports.CATALOGO_PLANTAS;
const rows = [];
cat.forEach((categoria) => {
  categoria.plantas.forEach((p) => {
    if (p.tipo === '🌳 Árbol frutal' || p.tipo === '🌺 Arbusto') {
      rows.push({ nombre: p.nombre, tipo: p.tipo, poda: p.poda });
    }
  });
});
console.log(JSON.stringify(rows, null, 1));
