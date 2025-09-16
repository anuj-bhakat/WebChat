import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000');

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
  const typingTimeout = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    socket.on('roomUsers', users => setUsers(users));
    socket.on('roomsList', roomsWithCreators => setRooms(roomsWithCreators));
    socket.on('chatMessage', msg => setMessages(prev => [...prev, msg]));
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
      socket.off('roomUsers');
      socket.off('roomsList');
      socket.off('chatMessage');
      socket.off('notification');
      socket.off('typing');
      socket.off('stopTyping');
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
    socket.emit('chatMessage', { room: currentRoom, message: messageInput });
    setMessageInput('');
    socket.emit('stopTyping');
  };

  const handleTyping = () => {
    if (!username) return;
    socket.emit('typing');
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      socket.emit('stopTyping');
    }, 1000);
  };

  const handleRoomChange = (room) => {
    if (room === currentRoom) return;
    socket.emit('joinRoom', room, (res) => {
      if (res.success) {
        setCurrentRoom(room);
        setMessages([]);
      }
    });
  };

  const handleCreateRoom = (e) => {
    e.preventDefault();
    const newRoomName = newRoomInput.trim();
    if (!newRoomName) return;
    if (rooms.includes(newRoomName)) {
      alert('Room already exists');
      return;
    }
    socket.emit('joinRoom', newRoomName, (res) => {
      if (res.success) {
        setCurrentRoom(newRoomName);
        setMessages([]);
        setNewRoomInput('');
      }
    });
  };

  if (!username) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 px-4">
        <form onSubmit={handleUsernameSubmit} className="bg-white p-10 rounded-xl shadow-lg w-full max-w-md flex flex-col items-center gap-6">
          <h2 className="text-3xl font-extrabold text-indigo-700 mb-2">Enter Username</h2>
          {usernameError && <div className="text-red-600 text-sm font-semibold mb-1">{usernameError}</div>}
          <input
            className="border-2 border-indigo-300 focus:border-indigo-600 transition-colors rounded-lg px-4 py-3 w-full text-lg font-medium text-gray-700 placeholder-gray-400 focus:outline-none"
            placeholder="Username"
            value={usernameInput}
            onChange={e => setUsernameInput(e.target.value)}
            required
            autoFocus
          />
          <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 transition-colors text-white text-lg font-semibold rounded-lg px-6 py-3 w-full shadow-md">
            Join Chat
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-100 to-gray-200">
      <aside className="w-72 bg-white border-r border-gray-300 flex flex-col p-6 shadow-lg">
        <h2 className="text-2xl font-extrabold mb-6 text-indigo-700 border-b border-indigo-300 pb-2">Rooms</h2>
        <ul className="space-y-2 overflow-y-auto max-h-[20rem] mb-4">
          {rooms.map(room => (
            <li
              key={room.name}
              onClick={() => handleRoomChange(room.name)}
              className={`py-2 px-3 rounded-lg cursor-pointer transition-colors ${
                room.name === currentRoom ? 'bg-indigo-600 text-white' : 'hover:bg-indigo-100'
              }`}
            >
              {room.name}
            </li>
          ))}
        </ul>
        <form onSubmit={handleCreateRoom} className="flex gap-2">
          <input
            type="text"
            placeholder="New room name"
            value={newRoomInput}
            onChange={e => setNewRoomInput(e.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <button type="submit" className="bg-indigo-600 text-white px-4 rounded-lg hover:bg-indigo-700 transition-colors">
            +
          </button>
        </form>

        <h2 className="text-2xl font-extrabold mt-8 mb-4 text-indigo-700 border-b border-indigo-300 pb-2">Users in room</h2>
        <ul className="space-y-3 overflow-y-auto max-h-[calc(100vh-24rem)]">
          {users.map(u => (
            <li key={u.socketID} className="py-2 px-3 rounded-lg hover:bg-indigo-100 cursor-default transition-colors">
              <span className="font-semibold text-indigo-800">{u.userName}</span>
            </li>
          ))}
        </ul>
      </aside>

      <div className="flex-1 flex flex-col h-screen max-h-screen">
        <header className="bg-indigo-600 text-white px-8 py-5 shadow-md flex-shrink-0 flex justify-between items-center">
          <h1 className="text-3xl font-bold tracking-wide">Socket.io Chat</h1>
          <div className="text-indigo-100 text-sm italic font-semibold">
            Room: <span className="font-bold">{currentRoom}</span>
            <span className="ml-4 bg-indigo-500 px-3 py-1 rounded-full shadow-inner select-none">
              Created by: {rooms.find(r => r.name === currentRoom)?.creator || 'Unknown'}
            </span>
          </div>
        </header>

        {notification && (
          <div className="px-6 py-3 mx-8 mt-4 rounded bg-yellow-200 text-yellow-900 font-semibold shadow flex-shrink-0 transition-opacity duration-500 ease-in-out">
            {notification}
          </div>
        )}

        <main
          className="flex-1 px-8 py-6 overflow-y-auto scrollbar-thin scrollbar-thumb-indigo-400 scrollbar-track-indigo-200 transition-all duration-300 ease-in-out"
          style={{ scrollBehavior: 'smooth' }}
        >
          <div className="mx-auto flex flex-col gap-4">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex items-start transition-opacity duration-300 ease-in-out ${
                  msg.userName === username ? 'justify-end' : 'justify-start'
                }`}
                style={{ opacity: 1 }}
              >
                <div
                  className={`rounded-lg px-4 py-3 shadow select-text max-w-[60vw] leading-relaxed text-lg break-words overflow-wrap break-word transition-colors ${
                    msg.userName === username
                      ? 'bg-blue-400 text-white'
                      : 'bg-white text-gray-900 border border-gray-300 hover:bg-indigo-50 cursor-default'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1 text-xs font-semibold opacity-90 select-text">
                    <span className={msg.userName === username ? 'text-white truncate max-w-[70%]' : 'text-gray-800 truncate max-w-[70%]'}>
                      {msg.userName}
                    </span>
                    <span className={msg.userName === username ? 'text-blue-100 ml-4 flex-shrink-0' : 'text-gray-600 ml-4 flex-shrink-0'}>
                      {msg.time}
                    </span>
                  </div>
                  <div>{msg.text}</div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </main>

        <div className="px-8 pb-2 min-h-[1.5rem] text-indigo-700 font-medium italic flex-shrink-0">
          {typingUsers.length > 0 && (
            <span>
              {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
            </span>
          )}
        </div>

        <form
          className="flex items-center border-t border-gray-300 bg-white px-8 py-4 shadow-inner flex-shrink-0"
          onSubmit={handleSendMessage}
        >
          <input
            className="flex-1 border border-gray-300 rounded-2xl px-5 py-3 mr-4 text-lg transition placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
            placeholder="Type your message..."
            value={messageInput}
            onChange={e => {
              setMessageInput(e.target.value);
              handleTyping();
            }}
            disabled={!username}
          />
          <button
            type="submit"
            disabled={!messageInput.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 transition-colors text-white font-semibold rounded-2xl px-6 py-3 disabled:opacity-50 shadow-lg"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

export default Chat;
