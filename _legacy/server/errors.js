/* Ensures every error message reaching the client is properly punctuated, even ones
   that came from a third-party library, a native JS error, or an unforeseen code path.
   Short 2-4 word phrases are left alone (per house style, they don't take a period);
   anything 5+ words gets a period if it's missing one. */

function normalizeErrorMessage(message) {
  const trimmed = String(message == null ? "" : message).trim();
  if (!trimmed) return "Something went wrong. Please try again.";
  if (/[.!?]$/.test(trimmed)) return trimmed;
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  return wordCount >= 5 ? `${trimmed}.` : trimmed;
}

function sendError(res, status, message) {
  res.status(status).json({ error: normalizeErrorMessage(message) });
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { normalizeErrorMessage, sendError, asyncHandler };
