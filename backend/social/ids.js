"use strict";
const crypto = require("crypto");

const PREFIX = { application: "mapp", request: "mreq", relationship: "mrel", conversation: "conv", assistant: "asst" };
const ID_PATTERNS = {
  application: /^mapp_[0-9a-f]{18}$/,
  request: /^mreq_[0-9a-f]{18}$/,
  relationship: /^mrel_[0-9a-f]{18}$/,
  conversation: /^conv_[0-9a-f]{18}$/,
  assistant: /^asst_[0-9a-f]{18}$/
};
const newId = (kind) => `${PREFIX[kind]}_${crypto.randomBytes(9).toString("hex")}`;
const isId = (kind, v) => typeof v === "string" && ID_PATTERNS[kind].test(v);
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const NUMERIC_ID_RE = /^[1-9]\d{0,14}$/;

module.exports = { newId, isId, UID_RE, NUMERIC_ID_RE };
