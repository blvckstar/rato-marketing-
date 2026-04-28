const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const fs = require("fs");

const app = express();
const PORT = 3000;
const SECRET = "rato_secret";

fs.mkdirSync("data", { recursive: true });
fs.mkdirSync("uploads", { recursive: true });

const db = new sqlite3.Database("./data/rato.db");

app.use(cors());
app.use(express.json());
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const upload = multer({ storage });

const docUpload = upload.fields([
  { name: "idDocument", maxCount: 1 },
  { name: "cvDocument", maxCount: 1 },
  { name: "bankLetter", maxCount: 1 }
]);

function run(sql, params = []) {
  return new Promise((res, rej) => {
    db.run(sql, params, function (err) {
      if (err) rej(err);
      else res(this);
    });
  });
}

function all(sql, params = []) {
  return new Promise((res, rej) => {
    db.all(sql, params, (err, rows) => {
      if (err) rej(err);
      else res(rows);
    });
  });
}

function one(sql, params = []) {
  return new Promise((res, rej) => {
    db.get(sql, params, (err, row) => {
      if (err) rej(err);
      else res(row);
    });
  });
}

function auth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token" });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
}

async function init() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT,
      email TEXT UNIQUE,
      phone TEXT,
      password TEXT,
      role TEXT,
      idDocument TEXT,
      cvDocument TEXT,
      bankLetter TEXT
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY,
      brand TEXT,
      store TEXT,
      rate INTEGER,
      date TEXT
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY,
      userId INTEGER,
      campaignId INTEGER,
      status TEXT
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY,
      userId INTEGER,
      campaignId INTEGER,
      type TEXT,
      photo TEXT,
      lat TEXT,
      lng TEXT,
      time TEXT
    )
  `);

  const admin = await one("SELECT * FROM users WHERE email=?", ["admin@rato.com"]);

  if (!admin) {
    const pass = await bcrypt.hash("admin123", 10);
    await run(
      "INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)",
      ["Admin", "admin@rato.com", pass, "admin"]
    );
  }
}

app.post("/api/register", docUpload, async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    const hash = await bcrypt.hash(password, 10);

    await run(
      `INSERT INTO users 
      (name,email,phone,password,role,idDocument,cvDocument,bankLetter)
      VALUES (?,?,?,?,?,?,?,?)`,
      [
        name,
        email,
        phone,
        hash,
        "promoter",
        req.files.idDocument?.[0]?.filename || "",
        req.files.cvDocument?.[0]?.filename || "",
        req.files.bankLetter?.[0]?.filename || ""
      ]
    );

    res.json({ message: "Registered ✔️" });
  } catch (e) {
    res.status(400).json({ message: "Registration failed" });
  }
});

app.post("/api/login", async (req, res) => {
  const user = await one("SELECT * FROM users WHERE email=?", [req.body.email]);
  if (!user) return res.status(400).json({ message: "Invalid" });

  const valid = await bcrypt.compare(req.body.password, user.password);
  if (!valid) return res.status(400).json({ message: "Invalid" });

  const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, SECRET);

  res.json({ token, user });
});

app.get("/api/campaigns", auth, async (req, res) => {
  res.json(await all("SELECT * FROM campaigns"));
});

app.post("/api/campaigns", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.sendStatus(403);

  await run(
    "INSERT INTO campaigns (brand,store,rate,date) VALUES (?,?,?,?)",
    [req.body.brand, req.body.store, req.body.rate, req.body.date]
  );

  res.json({ message: "Campaign added" });
});

app.post("/api/apply", auth, async (req, res) => {
  await run(
    "INSERT INTO applications (userId,campaignId,status) VALUES (?,?,?)",
    [req.user.id, req.body.campaignId, "Pending"]
  );

  res.json({ message: "Applied" });
});

app.post("/api/clock", auth, upload.single("photo"), async (req, res) => {
  await run(
    "INSERT INTO attendance (userId,campaignId,type,photo,lat,lng,time) VALUES (?,?,?,?,?,?,?)",
    [
      req.user.id,
      req.body.campaignId,
      req.body.type,
      req.file?.filename || "",
      req.body.lat,
      req.body.lng,
      new Date().toLocaleString()
    ]
  );

  res.json({ message: "Saved ✔️" });
});

init().then(() => app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
}));