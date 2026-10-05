// Stands in for api.typesafe.ai so gate behaviour can be tested for free.
// NOUL=<n> sets the probability it returns; MODE=error|hang forces a failure
// so the fail-open path can be proved.
import http from 'http';
const NOUL = Number(process.env.NOUL ?? 0.9);
const MODE = process.env.MODE || 'ok';
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (MODE === 'error') { res.writeHead(500); return res.end('nope'); }
    if (MODE === 'hang') return;            // never responds; exercises the timeout
    const q = JSON.parse(body || '{}').questions || {};
    const answers = {};
    for (const id of Object.keys(q)) answers[id] = { type: 'noul', noul: NOUL };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ model: 'jev-stub', answers, usage: { input_tokens: 120, output_tokens: 4 } }));
  });
}).listen(Number(process.env.PORT || 3399));
