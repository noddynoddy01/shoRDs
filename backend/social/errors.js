"use strict";
/** Errors of the community layer. Messages are client-safe by construction; the route layer sends them as they are. */

class SocialError extends Error {
  /** code: a stable machine string (e.g. NOT_FOUND, FORBIDDEN, STATE_CONFLICT); httpStatus: 400/403/404/409/422/503. */
  constructor(code, message, httpStatus = 400, extra = {}) {
    super(message);
    this.name = "SocialError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.extra = extra;
  }
}

const notFound = (what = "item") => new SocialError("NOT_FOUND", `That ${what} was not found.`, 404);
const forbidden = (message = "You are not allowed to do that.", code = "FORBIDDEN") => new SocialError(code, message, 403);
const conflict = (code, message) => new SocialError(code, message, 409);
const invalid = (code, message) => new SocialError(code, message, 400);

module.exports = { SocialError, notFound, forbidden, conflict, invalid };
