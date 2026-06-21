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

const BAD_WORDS = [
  "badword1",
  "badword2",
  "slurhere"
];

let bannerText = "Welcome! Promote your stuff here.";

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

function containsBadWord(text) {
  return BAD_WORDS.some(word =>
    text.includes(word.toLowerCase())
  );
}


// GET BANNER
app.get("/banner", (req, res) => {
  res.json({
    text: bannerText
  });
});


// UPDATE BANNER
app.post("/admin/banner", (req, res) => {

  const text = req.body.text;

  if (!text) {
    return res.json({
      success:false,
      message:"Empty banner"
    });
  }

  bannerText = text;

  res.json({
    success:true,
    message:"Banner updated"
  });

});


// ADD VOUCH
app.post("/vouch", (req, res) => {

  const username = cleanUser(req.body.username);
  const ip = req.ip;


  if (!username) {
    return res.json({
      success:false,
      message:"Enter username"
    });
  }


  if (containsBadWord(username)) {
    return res.json({
      success:false,
      message:"Username contains blocked words"
    });
  }


  db.run(
    `
    INSERT INTO vouches(username, ip)
    VALUES (?,?)
    `,
    [
      username,
      ip
    ],

    function(err){

      if(err){
        return res.json({
          success:false,
          message:"Already vouched"
        });
      }


      res.json({
        success:true,
        message:"Vouch added"
      });

    }
  );

});


// CHECK USER
app.get("/user/:name",(req,res)=>{

const username = cleanUser(req.params.name);


db.get(
`
SELECT COUNT(*) as count
FROM vouches
WHERE username=?
`,
[username],

(err,row)=>{

res.json({
username:"@"+username,
vouches:row?.count || 0
});

});

});


// LEADERBOARD
app.get("/leaderboard",(req,res)=>{


db.all(
`
SELECT username, COUNT(*) as vouches
FROM vouches
GROUP BY username
ORDER BY vouches DESC
LIMIT 10
`,
[],

(err,rows)=>{

if(err)
return res.json([]);


res.json(
rows.map(r=>({
username:"@"+r.username,
vouches:r.vouches
}))
);

});


});



// EXPORT TXT
app.get("/admin/export",(req,res)=>{


db.all(
`
SELECT *
FROM vouches
ORDER BY created DESC
`,
[],

(err,rows)=>{


let txt="VOUCH DATABASE\n\n";


rows.forEach(row=>{

txt +=
`User: @${row.username}
IP: ${row.ip}
Date: ${row.created}

----------------

`;

});


res.setHeader(
"Content-Type",
"text/plain"
);

res.setHeader(
"Content-Disposition",
"attachment; filename=vouches.txt"
);


res.send(txt);


});


});



app.listen(PORT,()=>{

console.log(
"Server running on port "+PORT
);

});
