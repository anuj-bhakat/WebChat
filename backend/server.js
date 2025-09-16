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

let users = []; // {userName, socketID, currentRoom}
let rooms = ['general'];
const roomCreators = { general: 'System' };
const userDMs = {};
const roomMessages = {};

function getUsersInRoom(room) {
  return users.filter(u => u.currentRoom === room);
}

function getAllUsers() {
  return users.map(u => ({
    userName: u.userName,
    socketID: u.socketID,
    currentRoom: u.currentRoom,
  }));
}

function getSocketIdByUsername(userName) {
  const user = users.find(u => u.userName === userName);
  return user ? user.socketID : null;
}

function getRoomMessages(room) {
  return roomMessages[room] || [];
}

function getPrivateMessages(userA, userB) {
  const messages = userDMs[userA]?.conversations?.[userB] || [];
  return messages;
}

// Save a new message to the room
function saveRoomMessage(room, message) {
  if (!roomMessages[room]) {
    roomMessages[room] = [];
  }
  roomMessages[room].push(message);
}

// Cleanup when no one is left in a room
function cleanupRoomMessages(room) {
  const usersInRoom = getUsersInRoom(room);
  if (usersInRoom.length === 0) {
    delete roomMessages[room]; // Remove messages for the room
  }
}

io.on('connection', socket => {
  // Join "general" by default
  socket.join('general');

  socket.on('newUser', ({ userName }, cb) => {
    const taken = users.some(u => u.userName === userName);
    if (taken) {
      cb({ success: false, message: 'Username is already taken.' });
      return;
    }
    users.push({ userName, socketID: socket.id, currentRoom: 'general' });

    // Emit full users list to all clients (with currentRoom info)
    io.emit('allUsers', getAllUsers());

    io.to('general').emit('roomUsers', getUsersInRoom('general'));
    io.emit('roomsList', rooms.map(room => ({
      name: room,
      creator: roomCreators[room] || 'Unknown'
    })));
    io.to('general').emit('notification', `${userName} joined the general room`);
    cb({ success: true, room: 'general' });
  });

  socket.on('joinRoom', (newRoom, cb) => {
    const user = users.find(u => u.socketID === socket.id);
    if (!user) return;

    const oldRoom = user.currentRoom;

    if (oldRoom === newRoom) {
      cb && cb({ success: false, message: `Already in room ${newRoom}` });
      return;
    }

    socket.leave(oldRoom);
    socket.join(newRoom);

    // If it's a new public room (not a private message), add it to the room list
    if (!rooms.includes(newRoom) && !newRoom.startsWith('pm:')) {
      rooms.push(newRoom);
      roomCreators[newRoom] = user.userName || 'Unknown';
      io.emit('roomsList', rooms.map(room => ({
        name: room,
        creator: roomCreators[room] || 'Unknown'
      })));
    }

    user.currentRoom = newRoom;
    io.emit('allUsers', getAllUsers());

    const previousMessages = getRoomMessages(newRoom) || [];
    socket.emit('roomMessages', previousMessages);

    io.to(oldRoom).emit('roomUsers', getUsersInRoom(oldRoom));
    io.to(newRoom).emit('roomUsers', getUsersInRoom(newRoom));

    // Send notifications to both rooms
    io.to(oldRoom).emit('notification', `${user.userName} left the room`);
    io.to(newRoom).emit('notification', `${user.userName} joined the room`);

    // Callback to notify the client that the room change was successful
    cb && cb({ success: true, room: newRoom });
  });

  socket.on('privateMessage', ({ recipient, message }, cb) => {
    const sender = users.find(u => u.socketID === socket.id);
    if (!sender) return;

    const pmRoom = getPrivateRoom(sender.userName, recipient);

    socket.join(pmRoom);
    const recipientSocketID = getSocketIdByUsername(recipient);
    if (recipientSocketID) {
      io.sockets.sockets.get(recipientSocketID)?.join(pmRoom);
    }

    const msg = {
      userName: sender.userName,
      text: message.trim(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      room: pmRoom,
      private: true,
    };

    saveRoomMessage(pmRoom, msg);

    // Store message for sender
    if (!userDMs[sender.userName]) userDMs[sender.userName] = { conversations: {} };
    if (!userDMs[sender.userName].conversations[recipient]) userDMs[sender.userName].conversations[recipient] = [];
    userDMs[sender.userName].conversations[recipient].push(msg);

    // Store message for recipient
    if (!userDMs[recipient]) userDMs[recipient] = { conversations: {} };
    if (!userDMs[recipient].conversations[sender.userName]) userDMs[recipient].conversations[sender.userName] = [];
    userDMs[recipient].conversations[sender.userName].push(msg);

    // Emit message to both via room
    io.to(pmRoom).emit('privateMessage', msg);
    cb && cb({ success: true });
  });

  socket.on('getPrivateMessages', ({ withUser }, cb) => {
    const user = users.find(u => u.socketID === socket.id);
    if (!user) return;
    const convos = userDMs[user.userName]?.conversations || {};
    const messages = convos[withUser] || [];
    cb && cb(messages);
  });


  socket.on('chatMessage', ({ room, message }) => {
    const user = users.find(u => u.socketID === socket.id);
    if (!user || user.currentRoom !== room) return; // Validate user room
    const msg = {
      userName: user.userName,
      text: message.trim(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      room,
      private: false
    };
    saveRoomMessage(room, msg);
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

  socket.on('typingPrivate', ({ recipient }) => {
    const sender = users.find(u => u.socketID === socket.id);
    if (!sender) return;
    const pmRoom = getPrivateRoom(sender.userName, recipient);
    socket.to(pmRoom).emit('typing', sender.userName);
  });

  socket.on('stopTypingPrivate', ({ recipient }) => {
    const sender = users.find(u => u.socketID === socket.id);
    if (!sender) return;
    const pmRoom = getPrivateRoom(sender.userName, recipient);
    socket.to(pmRoom).emit('stopTyping', sender.userName);
  });

  socket.on('disconnect', () => {
    const user = users.find(u => u.socketID === socket.id);
    if (user) {
      users = users.filter(u => u.socketID !== socket.id);
      io.to(user.currentRoom).emit('notification', `${user.userName} left the room`);
      io.emit('allUsers', getAllUsers());
      io.to(user.currentRoom).emit('roomUsers', getUsersInRoom(user.currentRoom));
      cleanupRoomMessages(user.currentRoom);
    }
  });
});

// Helper for deterministic private room string
function getPrivateRoom(userA, userB) {
  return `pm:${[userA, userB].sort().join(',')}`;
}

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
