// Vercel function for /api/questions. The work is in lib/core.js, shared with the
// local server, so the two cannot drift apart.
const { handleQuestions } = require('../lib/core');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const out = await handleQuestions(body, req.headers);
    return res.status(out.status).json(out.body);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
