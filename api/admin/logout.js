'use strict';
const { send, guard } = require('../_lib/http');
const auth = require('../_lib/auth');

module.exports = async (req, res) => {
  if (!guard(req, res, 'POST')) return;
  return send(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
};
