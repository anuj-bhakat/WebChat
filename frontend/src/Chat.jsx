import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000');

function getPrivateRoomName(a, b) {
  return `pm:${[a, b].sort().join(',')}`;
}

function Chat() {
  const [username, setUsername] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [users, setUsers] = useState([]);
  const [rooms, setRooms] = useState([{ name: 'general', creator: 'System' }]);
  const [currentRoom, setCurrentRoom] = useState('general');
  const [messageInput, setMessageInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [notification, setNotification] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [typingUsers, setTypingUsers] = useState([]);
  const [newRoomInput, setNewRoomInput] = useState('');
  const [privateRecipient, setPrivateRecipient] = useState(null); // New
  const typingTimeout = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    socket.on('allUsers', users => {
      setUsers(users);
    });
    socket.on('roomMessages', (msgs) => {
      setMessages(msgs || []);
    });
    socket.on('roomsList', roomsWithCreators => setRooms(roomsWithCreators));
    socket.on('chatMessage', msg => {
      if (!msg.private && msg.room === currentRoom) {
        setMessages(prev => [...prev, msg]);
      }
    });
    socket.on('privateMessage', msg => {
      // Match private room for either current user and private recipient
      const pmRoom = getPrivateRoomName(username, privateRecipient);
      if (msg.room === pmRoom) {
        setMessages(prev => [...prev, msg]);
      }
    });
    socket.on('notification', note => {
      setNotification(note);
      setTimeout(() => setNotification(''), 3000);
    });
    socket.on('typing', userName => {
      setTypingUsers(prev => (prev.includes(userName) ? prev : [...prev, userName]));
    });
    socket.on('stopTyping', userName => {
      setTypingUsers(prev => prev.filter(u => u !== userName));
    });
    return () => {
      socket.off('allUsers');
      // socket.off('roomUsers');
      socket.off('roomMessages');
      socket.off('roomsList');
      socket.off('chatMessage');
      socket.off('privateMessage');
      socket.off('notification');
      socket.off('typing');
      socket.off('stopTyping');
    };
    // eslint-disable-next-line
  }, [currentRoom, username, privateRecipient]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // === AUTH & ROOM JOIN ===
  const handleUsernameSubmit = (e) => {
    e.preventDefault();
    if (!usernameInput.trim()) return;
    socket.emit('newUser', { userName: usernameInput.trim() }, (res) => {
      if (res.success) {
        setUsername(usernameInput.trim());
        setCurrentRoom(res.room || 'general');
        setUsernameError('');
        setMessages([]);
      } else {
        setUsernameError(res.message || 'Name taken. Choose another.');
      }
    });
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!messageInput.trim() || !username) return;
    if (privateRecipient) {
      socket.emit('privateMessage', { recipient: privateRecipient, message: messageInput }, resp => {
        if (resp && resp.success) setMessageInput('');
      });
      socket.emit('stopTypingPrivate', { recipient: privateRecipient });
    } else {
      socket.emit('chatMessage', { room: currentRoom, message: messageInput });
      setMessageInput('');
      socket.emit('stopTyping');
    }
  };

  // === TYPING INDICATOR ===
  const handleTyping = () => {
    if (!username) return;
    if (privateRecipient) {
      socket.emit('typingPrivate', { recipient: privateRecipient });
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(() => {
        socket.emit('stopTypingPrivate', { recipient: privateRecipient });
      }, 1000);
    } else {
      socket.emit('typing');
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(() => {
        socket.emit('stopTyping');
      }, 1000);
    }
  };

  // === ROOM LOGIC ===
  const handleRoomChange = (room) => {
    if (room === currentRoom) return;

    if (!room.startsWith('pm:')) {
      setPrivateRecipient(null);
    }
    setMessages([]);

    socket.emit('joinRoom', room, (res) => {
      if (res.success) {
        setCurrentRoom(room);
        socket.emit('getRoomMessages', room, (msgs) => {
          setMessages(msgs || []);
        });
      }else{
        console.error('Failed to join room:', room);
      }
    });
  };

  const handleCreateRoom = (e) => {
    e.preventDefault();
    const newRoomName = newRoomInput.trim();
    if (!newRoomName) return;
    if (rooms.some(r => r.name === newRoomName)) {
      alert('Room already exists');
      return;
    }
    setPrivateRecipient(null);
    socket.emit('joinRoom', newRoomName, (res) => {
      if (res.success) {
        setCurrentRoom(newRoomName);
        setMessages([]);
        setNewRoomInput('');
      }
    });
  };

  const handleUserClick = (userName) => {
    if (userName === username) return;

    const pmRoom = getPrivateRoomName(username, userName);

    socket.emit('joinRoom', pmRoom, (res) => {
      if (res.success) {
        setPrivateRecipient(userName);
        setCurrentRoom(pmRoom);
        setMessages([]);

        // Fetch the DM history explicitly
        socket.emit('getPrivateMessages', { withUser: userName }, (msgs) => {
          setMessages(msgs || []);
        });
      } else {
        console.error('Failed to join DM room:', pmRoom);
      }
    });
  };

  if (!username) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 px-4">
        <form onSubmit={handleUsernameSubmit}
          className="bg-white p-12 rounded-2xl shadow-2xl w-full max-w-md flex flex-col items-center gap-8">
          <h2 className="text-4xl font-extrabold text-indigo-700 mb-4 tracking-tight">Welcome to Chat</h2>
          {usernameError && <div className="text-red-600 text-sm font-semibold mb-1">{usernameError}</div>}
          <input
            className="border-2 border-indigo-300 focus:border-indigo-600 rounded-xl px-5 py-4 w-full text-lg font-semibold text-gray-700 placeholder-gray-400 focus:outline-none transition-shadow shadow-sm focus:shadow-md"
            placeholder="Enter your username"
            value={usernameInput}
            onChange={e => setUsernameInput(e.target.value)}
            required
            autoFocus
            spellCheck={false}
          />
          <button
            type="submit"
            className="bg-indigo-600 hover:bg-indigo-700 transition-colors text-white text-lg font-semibold rounded-xl px-8 py-4 w-full shadow-lg shadow-indigo-400/50"
          >
            Join Chat
          </button>
        </form>
      </div>
    );
  }

  // === MAIN CHAT UI ===
  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-50 to-gray-200 overflow-hidden">
      <aside className="w-80 bg-white border-r border-gray-300 flex flex-col p-6 shadow-xl">
        {/* Rooms */}
        <h2 className="text-2xl font-semibold mb-6 text-indigo-700 border-b border-indigo-300 pb-3 select-none">Rooms</h2>
        <ul className="space-y-2 overflow-y-auto max-h-[22rem] scrollbar-thin scrollbar-thumb-indigo-400 scrollbar-track-indigo-100 text-sm font-medium text-indigo-900">
          {rooms.map(room => (
            <li
              key={room.name}
              onClick={() => handleRoomChange(room.name)}
              className={`flex items-center gap-3 py-3 px-4 rounded-xl cursor-pointer transition-colors select-none
                ${room.name === currentRoom && !privateRecipient ? 'bg-indigo-600 text-white shadow-lg' : 'hover:bg-indigo-100'}
                `}
              title={`Created by ${room.creator}`}
            >
              <div className={`flex justify-center items-center w-9 h-9 rounded-full font-bold
                ${room.name === currentRoom && !privateRecipient ? 'bg-indigo-800' : 'bg-indigo-200 text-indigo-700'}`}>
                {room.name.charAt(0).toUpperCase()}
              </div>
              <span className="truncate">{room.name}</span>
            </li>
          ))}
        </ul>
        {/* Create room */}
        <form onSubmit={handleCreateRoom} className="flex gap-3 mt-4">
          <input
            type="text"
            placeholder="New room name"
            value={newRoomInput}
            onChange={e => setNewRoomInput(e.target.value)}
            className="flex-1 border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-shadow shadow-sm focus:shadow-md text-sm font-medium"
            spellCheck={false}
          />
          <button
            type="submit"
            className="bg-indigo-600 text-white px-6 rounded-xl hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-400/40 cursor-pointer"
            aria-label="Create new room"
          >+</button>
        </form>
        {/* Users in room */}
        <h2 className="text-2xl font-semibold mt-10 mb-4 text-indigo-700 border-b border-indigo-300 pb-3 select-none">Users</h2>
        <ul className="space-y-3 overflow-y-auto max-h-[calc(100vh-28rem)] scrollbar-thin scrollbar-thumb-indigo-400 scrollbar-track-indigo-100 text-sm font-medium text-indigo-900">
          {users.map(u => (
            <li
              key={u.socketID}
              className={`flex items-center gap-3 py-2 px-4 rounded-xl transition-colors select-none
                ${u.userName === username ? 'bg-indigo-200' : 'hover:bg-indigo-100 cursor-pointer'}
                ${privateRecipient === u.userName ? 'border-2 border-pink-400' : ''}
                ${u.currentRoom === currentRoom ? 'bg-indigo-100 font-semibold' : ''}
              `}
              onClick={() => handleUserClick(u.userName)}
              title={`Direct message with ${u.userName}`}
            >
              <div className="flex justify-center items-center w-8 h-8 rounded-full bg-indigo-300 text-indigo-900 font-semibold uppercase select-text text-sm">
                {u.userName.charAt(0)}
              </div>
              <span className="font-semibold text-indigo-800 truncate select-text text-sm">{u.userName}</span>
              {u.userName !== username && <span className="ml-auto text-pink-500 rounded-full px-2 py-1 text-xs font-bold">DM</span>}
            </li>
          ))}
        </ul>
      </aside>

      <div className="flex-1 flex flex-col h-screen max-h-screen">
        <header className="bg-indigo-700 text-white px-10 py-6 shadow-md flex-shrink-0 flex justify-between items-center select-none">
          <h1 className="text-2xl font-semibold tracking-wide">Socket.io Chat</h1>
          <div className="text-indigo-200 text-sm italic font-semibold flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
            {
              privateRecipient
                ? (
                  <span>
                    Private chat with: <span className="font-bold underline decoration-pink-500">{privateRecipient}</span>
                  </span>
                )
                : (
                  <>
                    <span>
                      Room: <span className="font-bold">{currentRoom}</span>
                    </span>
                    <span className="bg-indigo-500 px-4 py-1 rounded-full shadow-inner select-none whitespace-nowrap">
                      Created by: {rooms.find(r => r.name === currentRoom)?.creator || 'Unknown'}
                    </span>
                  </>
                )
            }
          </div>
        </header>

        {notification && !privateRecipient && (
          <div className="mx-10 mt-6 rounded-xl bg-yellow-200 text-yellow-900 font-semibold shadow-md px-8 py-4 select-none animate-fadeInOut">
            {notification}
          </div>
        )}

        <main
          className="flex-1 py-8 overflow-y-auto scrollbar-thin scrollbar-thumb-indigo-400 scrollbar-track-indigo-200"
          style={{ scrollBehavior: 'smooth' }}
        >
          <div className="mx-auto flex flex-col gap-6 w-full px-4">
            {messages.map((msg, i) => {
              const isOwn = msg.userName === username;
              return (
                <div
                  key={i}
                  className={`w-full flex ${isOwn ? 'justify-end' : 'justify-start'} transition-opacity duration-300 ease-in-out`}
                  aria-live="polite"
                >
                  <div
                    className={`relative rounded-2xl px-6 py-4 shadow-md
                      ${isOwn
                        ? 'bg-indigo-600 text-white shadow-lg'
                        : msg.private ? 'bg-pink-100 text-pink-800 border border-pink-200' : 'bg-white text-gray-900 border border-gray-300 hover:bg-indigo-50'}
                      max-w-md break-words`}
                    style={{ maxWidth: '400px' }}
                  >
                    <div className="flex items-center justify-between mb-1 text-xs font-semibold opacity-90 select-text">
                      <span className={isOwn ? 'text-white truncate max-w-[75%]' : 'text-gray-800 truncate max-w-[75%]'}>
                        {msg.userName}
                        {msg.private && <span className="ml-2 text-xs font-bold text-pink-600">[DM]</span>}
                      </span>
                      <time
                        dateTime={msg.time}
                        className={isOwn ? 'text-indigo-200 ml-4 flex-shrink-0 select-text' : 'text-gray-500 ml-4 flex-shrink-0 select-text'}
                        title={new Date(msg.time).toLocaleString()}
                      >
                        {msg.time}
                      </time>
                    </div>
                    <div className="whitespace-pre-wrap">{msg.text}</div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        </main>

        <div className="px-10 pb-4 min-h-[1.5rem] text-indigo-700 font-medium italic flex-shrink-0 select-none flex items-center gap-2">
          {typingUsers.length > 0 && (
            <span className="flex items-center gap-2 bg-indigo-100 px-4 py-2 rounded-full shadow-inner text-indigo-700 animate-pulse max-w-xs overflow-hidden whitespace-nowrap text-ellipsis">
              <svg className="w-5 h-5 animate-bounce" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="5" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
              </svg>
              {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
            </span>
          )}
        </div>

        <form
          className="flex items-center border-t border-gray-300 bg-white px-10 py-5 shadow-inner flex-shrink-0"
          onSubmit={handleSendMessage}
        >
          <input
            className="flex-1 border border-gray-300 rounded-full px-6 py-3 mr-5 text-lg transition placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shadow-sm"
            placeholder={privateRecipient ? `Message @${privateRecipient}...` : "Type your message..."}
            value={messageInput}
            onChange={e => {
              setMessageInput(e.target.value);
              handleTyping();
            }}
            disabled={!username}
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={!messageInput.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 transition-colors text-white font-semibold rounded-full px-8 py-3 disabled:opacity-50 shadow-lg shadow-indigo-500/60"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

export default Chat;
