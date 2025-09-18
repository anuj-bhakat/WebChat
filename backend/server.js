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
const typingUsers = {}; // Track who is typing to whom in DMs
const unreadCounts = {}; // Track unread message counts {userA: {userB: count}}

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

// Get unread count for a user from another user
function getUnreadCount(forUser, fromUser) {
  return unreadCounts[forUser]?.[fromUser] || 0;
}

// Increment unread count
function incrementUnreadCount(forUser, fromUser) {
  if (!unreadCounts[forUser]) unreadCounts[forUser] = {};
  unreadCounts[forUser][fromUser] = (unreadCounts[forUser][fromUser] || 0) + 1;
}

// Clear unread count when user opens DM
function clearUnreadCount(forUser, fromUser) {
  if (unreadCounts[forUser] && unreadCounts[forUser][fromUser]) {
    unreadCounts[forUser][fromUser] = 0;
  }
}

// Check if user is typing to another user in DM
function isTypingInDM(fromUser, toUser) {
  return typingUsers[fromUser] === toUser;
}

// Set typing status for DM
function setTypingInDM(fromUser, toUser) {
  typingUsers[fromUser] = toUser;
}

// Clear typing status for DM
function clearTypingInDM(fromUser) {
  delete typingUsers[fromUser];
}

// Cleanup when no one is left in a room
function cleanupRoomMessages(room) {
  const usersInRoom = getUsersInRoom(room);
  if (usersInRoom.length === 0) {
    delete roomMessages[room];
  }
}

function isPublicRoom(room) {
  return !room.startsWith('pm:');
}

io.on('connection', socket => {
  // Join "general" by default
  socket.join('general');

  socket.on('getRoomMessages', (room, cb) => {
    const messages = getRoomMessages(room) || [];
    cb && cb(messages);
  });

  socket.on('newUser', ({ userName }, cb) => {
    const taken = users.some(u => u.userName === userName);
    if (taken) {
      cb({ success: false, message: 'Username is already taken.' });
      return;
    }
    users.push({ userName, socketID: socket.id, currentRoom: 'general' });

    // Emit full users list to all clients (with currentRoom info)
    io.emit('allUsers', getAllUsers());
    
    // Send user states (typing and unread counts)
    socket.emit('userStates', {
      typingUsers,
      unreadCounts: unreadCounts[userName] || {}
    });

    io.emit('roomsList', rooms.map(room => ({
      name: room,
      creator: roomCreators[room] || 'Unknown'
    })));
    
    if (isPublicRoom('general')) {
      io.to('general').emit('notification', `${userName} joined the general room`);
    }
    
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

    // Send notifications only for public rooms
    if (isPublicRoom(oldRoom)) {
      io.to(oldRoom).emit('notification', `${user.userName} left the room`);
    }
    if (isPublicRoom(newRoom)) {
      io.to(newRoom).emit('notification', `${user.userName} joined the room`);
    }

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

    // Increment unread count for recipient (only if they're not currently in this DM)
    const recipientUser = users.find(u => u.userName === recipient);
    if (recipientUser && recipientUser.currentRoom !== pmRoom) {
      incrementUnreadCount(recipient, sender.userName);
      
      // Send updated unread count to recipient
      if (recipientSocketID) {
        io.to(recipientSocketID).emit('unreadCountUpdate', {
          fromUser: sender.userName,
          count: getUnreadCount(recipient, sender.userName)
        });
      }
    }

    // Emit message to both via room
    io.to(pmRoom).emit('privateMessage', msg);
    cb && cb({ success: true });
  });

  socket.on('getPrivateMessages', ({ withUser }, cb) => {
    const user = users.find(u => u.socketID === socket.id);
    if (!user) return;
    
    // Clear unread count when opening DM
    clearUnreadCount(user.userName, withUser);
    
    // Notify client to update unread count
    socket.emit('unreadCountUpdate', {
      fromUser: withUser,
      count: 0
    });
    
    const convos = userDMs[user.userName]?.conversations || {};
    const messages = convos[withUser] || [];
    cb && cb(messages);
  });

  socket.on('chatMessage', ({ room, message }) => {
    const user = users.find(u => u.socketID === socket.id);
    if (!user || user.currentRoom !== room) return;
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
    
    setTypingInDM(sender.userName, recipient);
    
    // Notify the recipient that sender is typing to them
    const recipientSocketID = getSocketIdByUsername(recipient);
    if (recipientSocketID) {
      io.to(recipientSocketID).emit('dmTypingUpdate', {
        fromUser: sender.userName,
        isTyping: true
      });
    }
  });

  socket.on('stopTypingPrivate', ({ recipient }) => {
    const sender = users.find(u => u.socketID === socket.id);
    if (!sender) return;
    
    clearTypingInDM(sender.userName);
    
    // Notify the recipient that sender stopped typing
    const recipientSocketID = getSocketIdByUsername(recipient);
    if (recipientSocketID) {
      io.to(recipientSocketID).emit('dmTypingUpdate', {
        fromUser: sender.userName,
        isTyping: false
      });
    }
  });

  socket.on('disconnect', () => {
    const user = users.find(u => u.socketID === socket.id);
    if (user) {
      // Clear typing status on disconnect
      clearTypingInDM(user.userName);
      
      users = users.filter(u => u.socketID !== socket.id);
      
      // Send notifications only for public rooms
      if (isPublicRoom(user.currentRoom)) {
        io.to(user.currentRoom).emit('notification', `${user.userName} left the room`);
      }
      
      io.emit('allUsers', getAllUsers());
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