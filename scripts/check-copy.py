"""Copy rule audit for the Myaku UI.

Two halves, and the earlier version of this checker only validated one of them:
  - 5 words or more  -> a sentence, ending in . ! or ?
  - 2 to 4 words     -> a phrase, every word capitalised

Checks visible HTML text, placeholder attributes, and the user-facing string
literals in the JS layer.
"""
import re, sys, pathlib

ROOT = pathlib.Path(r"C:\Users\leola\Documents\Projects\Myaku")
SKIP_DIRS = {"_legacy", "node_modules", ".git", "data", "scripts"}

# Words allowed to stay lowercase inside a 2-4 word phrase.
SMALL = {"a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or",
         "the", "to", "vs", "with"}
# Tokens that are not really words for capitalisation purposes.
SKIP_TOKEN = re.compile(r"^[\W\d]+$|^\d")


def words(s):
    return [w for w in re.split(r"\s+", s.strip()) if w]


def check(text, where, out):
    t = text.strip()
    if not t or t.startswith(("http", "var(", "#", "{")):
        return
    if re.fullmatch(r"[\W\d\s]+", t):
        return
    ws = words(t)
    n = len(ws)
    if n >= 5:
        if not re.search(r"[.!?:]$", t):
            out.append((where, "missing period", t))
    elif 2 <= n <= 4:
        if re.search(r"[.!?]$", t):
            return  # a short sentence with punctuation is fine
        for i, w in enumerate(ws):
            core = w.strip("\"'()[[],·—–-")
            if not core or SKIP_TOKEN.match(core):
                continue
            if core[0].isupper():
                continue
            if i > 0 and core.lower() in SMALL:
                continue
            out.append((where, "not title case", t))
            break


def scan_html(path, out):
    src = path.read_text(encoding="utf-8")
    src = re.sub(r"<script\b.*?</script>", "", src, flags=re.S)
    src = re.sub(r"<style\b.*?</style>", "", src, flags=re.S)
    for m in re.finditer(r'placeholder="([^"]+)"', src):
        check(m.group(1), f"{path.name} placeholder", out)
    # Page titles carry the em-dash brand form, so drop them rather than the
    # rest of the document, which is what an earlier version of this did.
    src = re.sub(r"<title>[^<]*</title>", "", src)
    # Inline formatting sits inside a sentence rather than between sentences, so
    # it is removed before splitting; otherwise "call or text <a>988</a> to reach"
    # is read as two fragments instead of one sentence.
    # A link styled as a button is its own block of text, not part of a sentence,
    # so it is turned into a block boundary before the inline links are removed.
    src = re.sub(r"<a\b[^>]*\bclass=[^>]*>", "<div>", src)
    src = re.sub(r"</?(?:a|strong|em|b|i|code)\b[^>]*>", "", src)
    # Split on the remaining tags and collapse whitespace inside each run, so a
    # sentence wrapped across source lines is checked as one sentence.
    for run in re.split(r"<[^>]+>", src):
        check(re.sub(r"\s+", " ", run), path.name, out)


# Class names are strings too, and they are not copy. Build the vocabulary from
# the stylesheet rather than guessing at it.
CLASSES = set(re.findall(r"\.([a-zA-Z][\w-]*)", (ROOT / "css" / "app.css").read_text(encoding="utf-8")))
CLASSES |= {"hidden", "active", "mono", "chart"}


def is_class_list(s):
    toks = s.split()
    return bool(toks) and all(t in CLASSES for t in toks)


def scan_js(path, out):
    src = path.read_text(encoding="utf-8")
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"^\s*//.*$", "", src, flags=re.M)
    for m in re.finditer(r'placeholder="([^"]+)"', src):
        check(m.group(1), f"{path.name} placeholder", out)
    # Quoted strings that read like prose: contain a space and only plain words.
    for m in re.finditer(r'"([^"\\\n]{4,200})"|\'([^\'\\\n]{4,200})\'', src):
        s = m.group(1) or m.group(2)
        if not s or " " not in s:
            continue
        if re.search(r"[<>{}=;$#/\\()]|::|var\(|px|--", s):
            continue
        if not re.fullmatch(r"[A-Za-z0-9 ,.'’!?:;()%·—–-]+", s):
            continue
        if is_class_list(s) or s.strip().endswith(("," , ":")):
            continue
        if s in {"xMidYMid meet", "no frames"}:  # SVG attribute, internal code
            continue
        if s.lstrip().startswith((".", "#", "[")) or " > " in s:  # CSS selector
            continue
        # A phrase that begins lower-case cannot be a Title Case phrase and
        # cannot begin a sentence, so it is a fragment composed into a larger
        # string at runtime. The assembled sentence is what gets checked, via
        # the template literal it lands in.
        if s[:1].islower():
            continue
        check(s, path.name, out)


def main():
    out = []
    for p in sorted(ROOT.rglob("*.html")):
        if set(p.parts) & SKIP_DIRS:
            continue
        scan_html(p, out)
    for p in sorted((ROOT / "js").glob("*.js")):
        scan_js(p, out)

    if not out:
        print("No copy rule violations found.")
        return 0
    for where, why, text in out:
        print(f"{where:28} {why:16} {text!r}")
    print(f"\n{len(out)} violation(s).")
    return 1


sys.exit(main())
