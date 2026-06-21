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

const db = new sqlite3.Database("./database.sqlite");

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
  return (u || "")
    .toLowerCase()
    .replace("@", "")
    .trim();
}

app.post("/vouch", (req, res) => {
  const username = cleanUser(req.body.username);
  const ip = req.ip;

  if (!username) {
    return res.json({ success: false, message: "Enter a username" });
  }

  db.run(
    `INSERT INTO vouches(username, ip) VALUES (?, ?)`,
    [username, ip],
    function (err) {
      if (err) {
        return res.json({
          success: false,
          message: "You already vouched this user"
        });
      }

      res.json({
        success: true,
        message: "Vouch added"
      });
    }
  );
});

app.get("/user/:name", (req, res) => {
  const username = cleanUser(req.params.name);

  db.get(
    `SELECT COUNT(*) as count FROM vouches WHERE username = ?`,
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
    `
    SELECT username, COUNT(*) as vouches
    FROM vouches
    GROUP BY username
    ORDER BY vouches DESC
    LIMIT 10
    `,
    [],
    (err, rows) => {
      if (err) {
        return res.json([]);
      }

      res.json(
        rows.map(r => ({
          username: "@" + r.username,
          vouches: r.vouches
        }))
      );
    }
  );
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
