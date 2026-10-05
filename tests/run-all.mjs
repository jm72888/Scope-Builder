import { execFileSync } from 'child_process';
const suites = ['shell-test', 'flow-test', 'responsive-test', 'motion-test', 'buttons-test', 'conn-test', 'persist-test', 'timeline-test', 'metrics-test', 'dlv-test', 'risk-test', 'ms-test', 'overview-test', 'update-test', 'undo-test', 'gate-test', 'cache-test', 'example-test', 'details-test', 'limit-test'];
let total = 0, failed = 0;
for (const s of suites) {
  let out = '';
  try { out = execFileSync('node', [s + '.mjs'], { encoding: 'utf8' }); }
  catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  const pass = (out.match(/^ {2}pass/gm) || []).length;
  const fail = (out.match(/^ {2}FAIL/gm) || []).length;
  const threw = /TimeoutError|Error:/.test(out) && !fail;
  total += pass; failed += fail;
  if (fail || threw) { console.log(`=== ${s} ===`); console.log(out.split('\n').filter(l => /FAIL|Error|Timeout/.test(l)).slice(0, 6).join('\n')); }
  else console.log(`${s.padEnd(18)} clean (${pass} pass)`);
}
console.log(`\nTOTAL: ${total} passing, ${failed} failing`);
process.exit(failed ? 1 : 0);
