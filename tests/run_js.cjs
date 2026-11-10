const C = require(__dirname + '/../plugin/assets/js/mspf-core.js');
const cases = require('./cases.json');
const NOW = 1794000000;
const out = cases.map(c => {
  const r = C.normalize(c.input, c.opts);
  const xml = r.errors.length ? null : C.buildXml(r.model, c.opts.platform, NOW * 1000);
  return { name: c.name, errors: r.errors, xml };
});
require('fs').writeFileSync('out_js.json', JSON.stringify(out));
