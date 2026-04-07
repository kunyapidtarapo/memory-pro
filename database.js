const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

let db;

async function initDB() {
  const SQL = await initSqlJs();
  const dbPath = path.join(__dirname, 'game.db');
  
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    total_wins INTEGER DEFAULT 0,
    total_games INTEGER DEFAULT 0,
    best_score INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS game_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code TEXT NOT NULL,
    winner_name TEXT NOT NULL,
    score INTEGER NOT NULL,
    players_count INTEGER NOT NULL
  )`);

  saveDB();
}

function saveDB() {
  const dbPath = path.join(__dirname, 'game.db');
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

function getDB() { return db; }
function save() { saveDB(); }

module.exports = { initDB, getDB, save };
