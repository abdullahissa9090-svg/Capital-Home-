'use strict';
const { send, guard } = require('../_lib/http');
const auth = require('../_lib/auth');

module.exports = async (req, res) => {
  if (!guard(req, res, 'GET')) return;
  let authenticated = false;
  try { authenticated = auth.isAuthenticated(req); } catch (e) { return send(res, 500, { error: 'auth_not_configured' }); }
  return send(res, 200, { authenticated });
};
