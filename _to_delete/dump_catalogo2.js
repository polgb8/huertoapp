const fs = require('fs');
const vm = require('vm');

let src = fs.readFileSync('catalogoPlantas.js', 'utf8');
src = src.replace(/export const/g, 'const');
src += '\nmodule.exports = { CATALOGO_PLANTAS };\n';

const script = new vm.Script(src, { filename: 'catalogoPlantas.js' });
const sandbox = { module: { exports: {} }, exports: {}, require, console };
vm.createContext(sandbox);
script.runInContext(sandbox);

const cat = sandbox.module.exports.CATALOGO_PLANTAS;
const rows = [];
cat.forEach((categoria) => {
  categoria.plantas.forEach((p) => {
    if (p.tipo === '🌳 Árbol frutal' || p.tipo === '🌺 Arbusto') {
      rows.push({ nombre: p.nombre, tipo: p.tipo, poda: p.poda });
    }
  });
});
console.log(JSON.stringify(rows, null, 1));
