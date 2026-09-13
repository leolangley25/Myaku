/* Myaku — HTML escaping for anything user-entered or externally fetched.
   Every template literal that interpolates stored or third-party text must
   pass it through esc() before it reaches innerHTML. */

function esc(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
