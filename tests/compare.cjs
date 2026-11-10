// Fails if the JavaScript and PHP feed builders disagree on any case.
const a = require('./out_js.json'), b = require('./out_php.json');
const same = JSON.stringify(a) === JSON.stringify(b);
console.log(same ? 'JS and PHP outputs identical' : 'MISMATCH between JS and PHP outputs');
process.exit(same ? 0 : 1);
