/* Works cited stays complete. Any research link a page shows has to be in the
   list behind references.html, and the generated page and markdown have to match
   that list, so nobody edits one and forgets the other. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { REFS, GROUPS } = require("../scripts/make-references");

const ROOT = path.join(__dirname, "..");

/* Links that are not research: fonts, the crisis line, the app's own pages. */
const NOT_RESEARCH = /fonts\.googleapis|fonts\.gstatic|^tel:|^mailto:/;

test("every research link on a page is in the works cited list", () => {
  const listed = new Set(REFS.map((r) => r.url));
  const missing = [];
  for (const file of fs.readdirSync(ROOT).filter((f) => f.endsWith(".html") && f !== "references.html")) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const m of src.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
      if (!NOT_RESEARCH.test(m[1]) && !listed.has(m[1])) missing.push(`${file}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, [], "add these to scripts/make-references.js");
});

test("every source is complete, in a known group, and listed once", () => {
  const groups = new Set(GROUPS.map((g) => g.id));
  const urls = new Set();
  for (const r of REFS) {
    for (const field of ["authors", "title", "venue", "url", "shapes"]) assert.ok(r[field], `${r.title || r.url} is missing ${field}`);
    assert.ok(groups.has(r.group), `${r.title} has an unknown group`);
    assert.ok(Number.isInteger(r.year) && r.year > 1900, `${r.title} has no year`);
    assert.ok(/^https:\/\//.test(r.url), `${r.title} is not an https link`);
    assert.ok(!urls.has(r.url), `${r.url} is listed twice`);
    urls.add(r.url);
  }
});

test("the generated page and markdown match the list", () => {
  const page = fs.readFileSync(path.join(ROOT, "references.html"), "utf8");
  const md = fs.readFileSync(path.join(ROOT, "REFERENCES.md"), "utf8");
  for (const r of REFS) {
    const inPage = page.includes(`href="${r.url.replace(/&/g, "&amp;")}"`);
    assert.ok(inPage && md.includes(`](${r.url})`), `run node scripts/make-references.js (${r.url})`);
  }
  assert.equal((page.match(/class="row ref-row"/g) || []).length, REFS.length, "run node scripts/make-references.js");
});
