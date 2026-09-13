/* Where Myaku keeps everything it writes. One place, so tests can point the whole
   server at a throwaway directory with a single environment variable. */

const path = require("path");
const fs = require("fs");

const dataDir = process.env.MYAKU_DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });

module.exports = { dataDir };
