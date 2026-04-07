const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

const rooms = {};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function generateCards() {
  const cards = [
    { suit: '♠', value: 'A' }, { suit: '♠', value: 'K' },
    { suit: '♠', value: 'Q' }, { suit: '♠', value: 'J' },
    { suit: '♥', value: 'A' }, { suit: '♥', value: 'K' },
    { suit: '♥', value: 'Q' }, { suit: '♥', value: 'J' },
    { suit: '♦', value: 'A' }, { suit: '♦', value: 'K' },
    { suit: '♦', value: 'Q' }, { suit: '♦', value: 'J' },
    { suit: '♣', value: 'A' }, { suit: '♣', value: 'K' },
    { suit: '♣', value: 'Q' }, { suit: '♣', value: 'J' },
  ];
  const pairs = [...cards, ...cards];
  return pairs.sort(() => Math.random() - 0.5).map((card, i) => ({
    id: i,
    emoji: card.suit + card.value,
    suit: card.suit,
    value: card.value,
    flipped: false,
    matched: false
  }));
}


app.get('/api/leaderboard', (req, res) => {
  const rows = db.prepare(`
    SELECT name, total_wins, total_games, best_score
    FROM players ORDER BY total_wins DESC, best_score DESC LIMIT 10
  `).all();
  res.json(rows);
});

io.on('connection', (socket) => {
  console.log('connected:', socket.id);

  socket.on('createRoom', ({ playerName }) => {
    const code = generateRoomCode();
    rooms[code] = {
      code,
      players: [{ id: socket.id, name: playerName, score: 0 }],
      cards: [],
      currentTurn: 0,
      flippedCards: [],
      started: false
    };
    socket.join(code);
    socket.roomCode = code;
    socket.playerName = playerName;
    socket.emit('roomCreated', { code, players: rooms[code].players });
  });

  socket.on('joinRoom', ({ roomCode, playerName }) => {
    const room = rooms[roomCode];
    if (!room) return socket.emit('error', 'ไม่พบห้องนี้');
    if (room.started) return socket.emit('error', 'เกมเริ่มไปแล้ว');
    if (room.players.length >= 4) return socket.emit('error', 'ห้องเต็มแล้ว');

    room.players.push({ id: socket.id, name: playerName, score: 0 });
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.playerName = playerName;
    io.to(roomCode).emit('playerJoined', { players: room.players });
  });

  socket.on('startGame', () => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    room.cards = generateCards();
    room.started = true;
    room.currentTurn = 0;

    const gameState = {
      cards: room.cards.map(c => ({ ...c, emoji: '🂠' })),
      currentPlayer: room.players[0].name,
      players: room.players
    };

    room.gameState = gameState;
    io.to(socket.roomCode).emit('gameStarted', gameState);
  });

  socket.on('flipCard', ({ cardId }) => {
    const room = rooms[socket.roomCode];
    if (!room || !room.started) return;

    const currentPlayer = room.players[room.currentTurn];
    if (currentPlayer.id !== socket.id) return;
    if (room.flippedCards.length >= 2) return;

    const card = room.cards[cardId];
    if (card.flipped || card.matched) return;

    card.flipped = true;
    room.flippedCards.push(card);
    io.to(socket.roomCode).emit('cardFlipped', { cardId, emoji: card.emoji });

    if (room.flippedCards.length === 2) {
      const [a, b] = room.flippedCards;
      setTimeout(() => {
        if (a.emoji === b.emoji) {
          a.matched = b.matched = true;
          currentPlayer.score += 10;
          io.to(socket.roomCode).emit('cardsMatched', {
            cardIds: [a.id, b.id],
            players: room.players
          });

          if (room.cards.every(c => c.matched)) {
            const winner = room.players.reduce((a, b) => a.score > b.score ? a : b);

            room.players.forEach(p => {
              const exists = db.prepare('SELECT id FROM players WHERE name = ?').get(p.name);
              if (exists) {
                db.prepare(`UPDATE players SET total_games = total_games + 1,
                  total_wins = total_wins + ?, best_score = MAX(best_score, ?) WHERE name = ?`)
                  .run(p.name === winner.name ? 1 : 0, p.score, p.name);
              } else {
                db.prepare(`INSERT INTO players (name, total_wins, total_games, best_score)
                  VALUES (?, ?, 1, ?)`)
                  .run(p.name, p.name === winner.name ? 1 : 0, p.score);
              }
            });

            db.prepare(`INSERT INTO game_history (room_code, winner_name, score, players_count)
              VALUES (?, ?, ?, ?)`)
              .run(room.code, winner.name, winner.score, room.players.length);

            io.to(socket.roomCode).emit('gameOver', { winner, players: room.players });
            delete rooms[socket.roomCode];
          }
        } else {
          a.flipped = b.flipped = false;
          room.currentTurn = (room.currentTurn + 1) % room.players.length;
          io.to(socket.roomCode).emit('cardsUnflipped', {
            cardIds: [a.id, b.id],
            currentPlayer: room.players[room.currentTurn].name
          });
        }
        room.flippedCards = [];
      }, 1000);
    }
  });

  socket.on('disconnect', () => {
    const room = rooms[socket.roomCode];
    if (room) {
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) delete rooms[socket.roomCode];
      else io.to(socket.roomCode).emit('playerLeft', { players: room.players });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
