const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));
app.set("trust proxy", true);

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 30
}));

app.use("/admin/import", express.text({ type: "*/*", limit: "10mb" }));

const db = new sqlite3.Database("./database.sqlite");

let bannerText = "Welcome! Sprite Trade Info stuff here.";

let BAD_WORDS = ["badword1", "badword2", "slurhere"];

db.run(`
CREATE TABLE IF NOT EXISTS vouches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  ip TEXT NOT NULL,
  created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(username, ip)
)
`);

function cleanUser(u) {
  return (u || "").toLowerCase().replace("@", "").trim();
}

const LEET_MAP = {
  "0": "o",
  "1": "i",
  "l": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  "$": "s"
};

function normalizeText(text) {
  if (!text) return "";
  let t = text.toLowerCase();

  t = t.split("").map(ch => LEET_MAP[ch] || ch).join("");

  t = t.replace(/[^a-z]/g, "");

  t = t.replace(/(.)\1+/g, "$1");

  return t;
}

function levenshteinWithin(a, b, maxDist) {
  if (Math.abs(a.length - b.length) > maxDist) return false;

  const dp = Array(b.length + 1);

  for (let j = 0; j <= b.length; j++) dp[j] = j;

  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;

    let minRow = dp[0];

    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j];

      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + cost
      );

      prev = temp;
      minRow = Math.min(minRow, dp[j]);
    }

    if (minRow > maxDist) return false;
  }

  return dp[b.length] <= maxDist;
}

function containsBadWord(text) {
  const clean = normalizeText(text);

  for (const word of BAD_WORDS) {
    const bad = normalizeText(word);

    if (!bad) continue;

    if (clean.includes(bad)) return true;

    if (levenshteinWithin(clean, bad, 2)) return true;
  }

  return false;
}

app.get("/banner", (req, res) => {
  res.json({ text: bannerText });
});

app.post("/admin/banner", (req, res) => {
  const text = req.body.text;

  if (!text) {
    return res.json({ success: false, message: "Empty banner" });
  }

  bannerText = text;
  res.json({ success: true, message: "Banner updated" });
});

app.post("/vouch", (req, res) => {
  const username = cleanUser(req.body.username);
  const ip = req.ip;

  if (!username) {
    return res.json({ success: false, message: "Enter username" });
  }

  if (containsBadWord(username)) {
    return res.json({ success: false, message: "Blocked username" });
  }

  db.run(
    `INSERT INTO vouches(username, ip) VALUES (?, ?)`,
    [username, ip],
    function (err) {
      if (err) {
        return res.json({ success: false, message: "Already vouched" });
      }

      res.json({ success: true, message: "Vouch added" });
    }
  );
});

app.get("/user/:name", (req, res) => {
  const username = cleanUser(req.params.name);

  db.get(
    `SELECT COUNT(*) as count FROM vouches WHERE username=?`,
    [username],
    (err, row) => {
      res.json({
        username: "@" + username,
        vouches: row?.count || 0
      });
    }
  );
});

app.get("/leaderboard", (req, res) => {
  db.all(
    `SELECT username, COUNT(*) as vouches
     FROM vouches
     GROUP BY username
     ORDER BY vouches DESC
     LIMIT 10`,
    [],
    (err, rows) => {
      if (err) return res.json([]);

      res.json(
        rows.map(r => ({
          username: "@" + r.username,
          vouches: r.vouches
        }))
      );
    }
  );
});

app.get("/admin/export", (req, res) => {
  db.all(`SELECT * FROM vouches ORDER BY created DESC`, [], (err, rows) => {

    let txt = "#USERS\n";

    rows.forEach(r => {
      txt += `${r.username}::${r.ip}::${r.created}\n`;
    });

    txt += "\n#BADWORDS\n";

    BAD_WORDS.forEach(w => {
      txt += `${w}\n`;
    });

    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", "attachment; filename=data.txt");

    res.send(txt);
  });
});

app.post("/admin/import", (req, res) => {
  const text = req.body;

  if (!text) {
    return res.json({ success: false, message: "Empty file" });
  }

  const lines = text.split("\n").map(l => l.trim());

  let mode = null;
  const users = [];
  const badwords = [];

  for (const line of lines) {
    if (line === "#USERS") {
      mode = "users";
      continue;
    }

    if (line === "#BADWORDS") {
      mode = "badwords";
      continue;
    }

    if (!line) continue;

    if (mode === "users") users.push(line);
    if (mode === "badwords") badwords.push(line.toLowerCase());
  }

  db.run(`DELETE FROM vouches`, [], (err) => {
    if (err) {
      return res.json({ success: false, message: "Reset failed" });
    }

    const stmt = db.prepare(
      `INSERT INTO vouches(username, ip, created) VALUES (?, ?, ?)`
    );

    for (const line of users) {
      const parts = line.split("::");
      if (parts.length < 3) continue;

      const username = parts[0];
      const ip = parts[1];
      const created = parts.slice(2).join("::");

      stmt.run(username, ip, created);
    }

    stmt.finalize();

    BAD_WORDS = badwords;

    res.json({
      success: true,
      message: "Full restore complete"
    });
  });
});

app.get("/admin/badwords", (req, res) => {
  res.json({ words: BAD_WORDS });
});

app.post("/admin/badwords/add", (req, res) => {
  const word = (req.body.word || "").toLowerCase().trim();

  if (!word) {
    return res.json({ success: false });
  }

  if (!BAD_WORDS.includes(word)) {
    BAD_WORDS.push(word);
  }

  res.json({ success: true, words: BAD_WORDS });
});

app.post("/admin/badwords/remove", (req, res) => {
  const word = (req.body.word || "").toLowerCase().trim();

  BAD_WORDS = BAD_WORDS.filter(w => w !== word);

  res.json({ success: true, words: BAD_WORDS });
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
