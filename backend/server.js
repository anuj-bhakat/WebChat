import express from 'express';
import http from 'http';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  }
});

// Track users with userName, socketID, and currentRoom
let users = [];
// Track rooms (minimum has "general" by default)
let rooms = ['general'];
const roomCreators = { general: 'System' };

function getUsersInRoom(room) {
  return users.filter(u => u.currentRoom === room);
}

io.on('connection', socket => {
  // By default join "general" room
  socket.join('general');

  socket.on('newUser', ({ userName }, cb) => {
    const taken = users.some(u => u.userName === userName);
    if (taken) {
      cb({ success: false, message: 'Username is already taken.' });
      return;
    }

    // Add user with default room "general"
    users.push({ userName, socketID: socket.id, currentRoom: 'general' });
    io.to('general').emit('roomUsers', getUsersInRoom('general'));
    io.emit('roomsList', rooms.map(room => ({
      name: room,
      creator: roomCreators[room] || 'Unknown'
    })));
    io.to('general').emit('notification', `${userName} joined the general room`);
    cb({ success: true, room: 'general' });
  });

  socket.on('joinRoom', (newRoom, cb) => {
    // Find user
    const user = users.find(u => u.socketID === socket.id);
    if (!user) return;

    const oldRoom = user.currentRoom;
    if (oldRoom === newRoom) {
      cb && cb({ success: false, message: `Already in room ${newRoom}` });
      return;
    }

    // Leave old room and join new room
    socket.leave(oldRoom);
    socket.join(newRoom);

    // Update user's currentRoom, add room if new
    if (!rooms.includes(newRoom)) {
      rooms.push(newRoom);
      roomCreators[newRoom] = user.userName || 'Unknown';
      io.emit('roomsList', rooms.map(room => ({
        name: room,
        creator: roomCreators[room] || 'Unknown'
      })));
    }
    user.currentRoom = newRoom;

    // Emit updated user lists for both rooms
    io.to(oldRoom).emit('roomUsers', getUsersInRoom(oldRoom));
    io.to(newRoom).emit('roomUsers', getUsersInRoom(newRoom));

    // Notifications
    io.to(oldRoom).emit('notification', `${user.userName} left the room`);
    io.to(newRoom).emit('notification', `${user.userName} joined the room`);

    cb && cb({ success: true, room: newRoom });
  });

  socket.on('chatMessage', ({ room, message }) => {
    const user = users.find(u => u.socketID === socket.id);
    if (!user || user.currentRoom !== room) return; // Validate user room

    const msg = {
      userName: user.userName,
      text: message.trim(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    io.to(room).emit('chatMessage', msg);
  });

  socket.on('typing', () => {
    const user = users.find(u => u.socketID === socket.id);
    if (user) socket.to(user.currentRoom).emit('typing', user.userName);
  });

  socket.on('stopTyping', () => {
    const user = users.find(u => u.socketID === socket.id);
    if (user) socket.to(user.currentRoom).emit('stopTyping', user.userName);
  });

  socket.on('disconnect', () => {
    const user = users.find(u => u.socketID === socket.id);
    if (user) {
      users = users.filter(u => u.socketID !== socket.id);
      io.to(user.currentRoom).emit('notification', `${user.userName} left the room`);
      io.to(user.currentRoom).emit('roomUsers', getUsersInRoom(user.currentRoom));
    }
  });
});



const PORT = process.env.PORT || 3000;


server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// import { networkInterfaces } from 'os';
// function getLocalIP() {
//   const nets = networkInterfaces();
//   let localIP = 'localhost';

//   for (const name of Object.keys(nets)) {
//     for (const net of nets[name]) {
//       if (net.family === 'IPv4' && !net.internal) {
//         localIP = net.address;
//         break;
//       }
//     }
//   }

//   return localIP;
// }

// console.log(getLocalIP());
// const HOST = '0.0.0.0'
// server.listen(PORT, HOST, () => {
//   console.log(`Server running on port ${PORT}`);
// });
