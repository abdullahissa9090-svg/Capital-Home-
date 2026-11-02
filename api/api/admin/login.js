"use strict";
const { send, readJsonBody, guard, sendError } = require("../_lib/http");
const auth = require("../_lib/auth");

module.exports = async (req, res) => {
  if (!guard(req, res, "POST")) return;
  try {
    if (auth.isLocked(req))
      return send(res, 429, { error: "too_many_attempts" });
    const body = await readJsonBody(req);
    if (!auth.checkPassword(body && body.password)) {
      auth.recordFailure(req);
      await new Promise((r) => setTimeout(r, 500)); // تبطيء بسيط لتخمين الباسورد
      return send(res, 401, { error: "wrong_password" });
    }
    auth.clearFailures(req);
    return send(
      res,
      200,
      { ok: true },
      { "Set-Cookie": auth.sessionCookie(auth.createSessionToken()) }
    );
  } catch (e) {
    return sendError(res, e);
  }
};
