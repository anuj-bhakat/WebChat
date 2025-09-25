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
  const [privateRecipient, setPrivateRecipient] = useState(null);
  const [dmTypingUsers, setDmTypingUsers] = useState({}); // {fromUser: boolean}
  const [unreadCounts, setUnreadCounts] = useState({}); // {fromUser: count}
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
        setMessages(prev => Array.isArray(prev) ? [...prev, msg] : [msg])
      }
    });

    socket.on('privateMessage', msg => {
      const pmRoom = getPrivateRoomName(username, privateRecipient);
      if (msg.room === pmRoom) {
        // setMessages(prev => Array.isArray(prev) ? [...prev, msg] : [msg])
        const formattedMsg = {
          ...msg,
          userName: msg.sender || msg.userName,
          private: true,
        };
        setMessages(prev => Array.isArray(prev) ? [...prev, formattedMsg] : [formattedMsg]);
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

    // New event handlers for DM features
    socket.on('dmTypingUpdate', ({ fromUser, isTyping }) => {
      setDmTypingUsers(prev => ({
        ...prev,
        [fromUser]: isTyping
      }));
    });

    socket.on('unreadCountUpdate', ({ fromUser, count }) => {
      setUnreadCounts(prev => ({
        ...prev,
        [fromUser]: count
      }));
    });

    socket.on('userStates', ({ typingUsers, unreadCounts }) => {
      setDmTypingUsers(typingUsers || {});
      setUnreadCounts(unreadCounts || {});
    });

    return () => {
      socket.off('allUsers');
      socket.off('roomMessages');
      socket.off('roomsList');
      socket.off('chatMessage');
      socket.off('privateMessage');
      socket.off('notification');
      socket.off('typing');
      socket.off('stopTyping');
      socket.off('dmTypingUpdate');
      socket.off('unreadCountUpdate');
      socket.off('userStates');
    };
  }, [currentRoom, username, privateRecipient]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-load messages on login
  useEffect(() => {
    if (!username || !currentRoom) return;

    if (currentRoom.startsWith('pm:') && privateRecipient) {
      socket.emit('getPrivateMessages', { withUser: privateRecipient }, (msgs) => {
        const formattedMessages = (msgs || []).map(msg => ({
          userName: msg.sender,
          text: msg.text,
          time: msg.time,
          private: true,
        }));
        setMessages(formattedMessages);
      });
    } else {
      socket.emit('getRoomMessages', currentRoom, (msgs) => {
        setMessages(msgs || []);
      });
    }

    socket.on('privateMessagesCleared', ({ fromUser }) => {
    if (privateRecipient && fromUser === privateRecipient) {
      setMessages([]);
      // Optionally, show a notification: setNotification('Private chat cleared');
    }
    });
    return () => {
      socket.off('privateMessagesCleared');
    };
  }, [username, currentRoom, privateRecipient]);

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
      } else {
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

        socket.emit('getPrivateMessages', { withUser: userName }, (msgs) => {
          // console.log('Private messages loaded:', msgs);
          // setMessages(msgs || []);
          const formattedMessages = (msgs || []).map(msg => ({
            userName: msg.sender,
            text: msg.text,
            time: msg.time,
            private: true,
          }));
          setMessages(formattedMessages);
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

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-50 to-gray-200 overflow-hidden">
      <aside className="w-80 bg-white border-r border-gray-300 flex flex-col p-6 shadow-xl rounded-lg">
        {/* Rooms */}
        <h2 className="text-2xl font-semibold mb-6 text-indigo-700 border-b border-indigo-300 pb-3 select-none text-center sm:text-left">
          Rooms
        </h2>
        <ul className="space-y-3 overflow-y-auto max-h-[22rem] scrollbar-thin scrollbar-thumb-indigo-500 scrollbar-track-indigo-100 text-sm font-medium text-indigo-900">
          {rooms.map(room => (
            <li
              key={room.name}
              onClick={() => handleRoomChange(room.name)}
              className={`flex items-center gap-3 py-2 px-4 rounded-xl cursor-pointer transition-colors select-none
                ${room.name === currentRoom && !privateRecipient ? 'bg-indigo-600 text-white shadow-lg' : 'hover:bg-indigo-100'}
              `}
              title={`Created by ${room.creator}`}
            >
              <div className={`flex justify-center items-center w-8 h-8 rounded-full font-bold uppercase shadow 
                ${room.name === currentRoom && !privateRecipient ? 'bg-indigo-800 text-white' : 'bg-indigo-200 text-indigo-700'}
              `}>
                {room.name.charAt(0)}
              </div>
              <span className="truncate max-w-[120px]" title={room.name}>{room.name}</span>
            </li>
          ))}
        </ul>

        {/* Create room */}
        <form onSubmit={handleCreateRoom} className="flex gap-3 mt-6">
          <input
            type="text"
            placeholder="New room name"
            value={newRoomInput}
            onChange={e => setNewRoomInput(e.target.value)}
            className="flex-1 border border-gray-300 rounded-full px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow shadow-sm focus:shadow-md text-sm font-medium"
            spellCheck={false}
          />
          <button
            type="submit"
            className="bg-indigo-600 text-white px-6 rounded-full hover:bg-indigo-700 transition-colors shadow-lg"
            aria-label="Create new room"
          >
            +
          </button>
        </form>

        {/* Users */}
        <h2 className="text-2xl font-semibold mt-10 mb-4 text-indigo-700 border-b border-indigo-300 pb-3 select-none text-center sm:text-left">
          Users
        </h2>
        <ul className="space-y-3 overflow-y-auto max-h-[calc(100vh-28rem)] scrollbar-thin scrollbar-thumb-indigo-500 scrollbar-track-indigo-100 text-sm font-medium text-indigo-900">
          {users.map(u => {
            const isTypingToMe = dmTypingUsers[u.userName];
            const unreadCount = unreadCounts[u.userName] || 0;
            
            return (
              <li
                key={u.socketID}
                className={`flex items-center gap-3 py-2 px-4 rounded-xl transition-colors select-none
                  ${u.userName === username ? 'bg-indigo-200 text-indigo-800 font-semibold' : 'hover:bg-indigo-100'} 
                  ${privateRecipient === u.userName ? 'border-2 border-pink-400' : ''}`}
                title={`Direct message with ${u.userName}`}
              >
                {/* User Avatar */}
                <div className={`relative flex justify-center items-center w-8 h-8 rounded-full bg-indigo-300 text-indigo-900 font-semibold uppercase select-text text-sm
                  ${u.userName === username ? 'border-2 border-indigo-600 shadow-lg' : 'hover:scale-105 transition-transform'}`}>
                  {u.userName.charAt(0)}
                  {/* Online indicator for other users */}
                  {u.currentRoom === currentRoom && u.userName !== username && (
                    <span className="absolute -bottom-1 -right-1 block w-3 h-3 bg-green-500 rounded-full ring-2 ring-white shadow-lg"></span>
                  )}
                  {/* Unread count badge */}
                  {unreadCount > 0 && u.userName !== username && (
                    <div className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full min-w-[20px] h-5 flex items-center justify-center font-bold shadow-lg">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </div>
                  )}
                </div>

                {/* User Info Container */}
                <div className="flex flex-grow justify-between items-center gap-2">
                  <div className="flex flex-col flex-grow">
                    {/* Username with status */}
                    <span className={`font-semibold truncate max-w-[120px] select-text text-sm ${u.userName === username ? 'text-indigo-800' : 'text-indigo-700'}`} title={u.userName}>
                      {u.userName}
                      {/* Typing indicator */}
                      {isTypingToMe && u.userName !== username && (
                        <span className="ml-2 text-xs text-blue-500 animate-pulse">typing...</span>
                      )}
                    </span>
                    
                    {/* Active in Chat Status */}
                    {u.currentRoom === currentRoom && u.userName !== username && (
                      <span className="text-xs text-green-500 flex items-center gap-1 mt-1">
                        Active in Chat
                      </span>
                    )}
                    {u.userName === username && u.currentRoom === currentRoom && (
                      <span className="text-xs text-blue-500 flex items-center gap-1 mt-1">
                        <svg className="w-3 h-3 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                          <circle cx="10" cy="10" r="4" />
                        </svg>
                        You're connected!
                      </span>
                    )}
                  </div>

                  {/* DM Button */}
                  {u.userName !== username && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUserClick(u.userName);
                      }}
                      className="bg-pink-500 cursor-pointer hover:bg-pink-700 text-white rounded-full px-4 py-1 text-xs font-semibold flex items-center gap-2 transition-colors shadow-md relative"
                      aria-label={`Send direct message to ${u.userName}`}
                    >
                      DM
                    </button>
                  )}
                  
                </div>
              </li>
            );
          })}
        </ul>
      </aside>

      <div className="flex-1 flex flex-col h-screen max-h-screen">
        <header className="bg-gradient-to-r from-indigo-500 to-indigo-600 text-white px-10 py-4 shadow-xl flex-shrink-0 flex justify-between items-center select-none">
          <h1 className="text-3xl font-bold tracking-wider leading-tight">
            Socket.io Chat
          </h1>
          <div className="text-sm italic font-semibold flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
            {
              privateRecipient ? (
                <div className="flex items-center gap-3">
                  <i className="fas fa-user-circle text-lg text-pink-400"></i>
                  <span className="font-medium text-lg">
                    Private chat with :&nbsp;
                    <span className="font-bold decoration-pink-500 hover:text-pink-400 transition-colors">
                      {privateRecipient}
                    </span>
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-6">
                  <span className="flex items-center gap-2 text-lg font-medium">
                    <i className="fas fa-users text-indigo-300"></i>
                    Room: 
                    <span className="font-semibold">{currentRoom}</span>
                  </span>
                  <span className="bg-indigo-500 px-5 py-2 rounded-full shadow-inner text-white text-sm font-semibold whitespace-nowrap">
                    <span className="opacity-80">Created by: </span>
                    {rooms.find(r => r.name === currentRoom)?.creator || 'Unknown'}
                  </span>
                </div>
              )
            }
            {privateRecipient && (
              <button
                className="bg-pink-500 cursor-pointer text-white px-6 py-2 rounded-xl mt-4 ml-10 shadow-lg hover:bg-pink-700 font-semibold"
                onClick={() => {
                  if (window.confirm(`Clear all messages with ${privateRecipient}?`)) {
                    socket.emit('clearPrivateMessages', { withUser: privateRecipient }, (res) => {
                      if (res && res.success) setMessages([]);
                    });
                  }
                }}
              >
                Clear Chat
              </button>
            )}
          </div>
        </header>

        {notification && !privateRecipient && (
          <div className="mx-10 mt-6 rounded-xl bg-blue-400 text-white font-semibold shadow-lg px-8 py-4 select-none animate-fadeInOut transition-all duration-300 ease-in-out hover:scale-105 hover:shadow-xl">
            {notification}
          </div>
        )}

        <main
          className="flex-1 py-8 overflow-y-auto scrollbar-thin scrollbar-thumb-indigo-400 scrollbar-track-indigo-200"
          style={{ scrollBehavior: 'smooth' }}
        >
          <div className="mx-auto flex flex-col gap-6 w-full px-4">
            {Array.isArray(messages) && messages.map((msg, i) => {
              const isOwn = msg.userName === username;
              return (
                <div
                  key={i}
                  className={`w-full flex ${isOwn ? 'justify-end' : 'justify-start'} transition-opacity duration-300 ease-in-out`}
                  aria-live="polite"
                >
                  <div className={`flex items-end gap-3 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
                    {/* Avatar Circle */}
                    <div
                      className={`flex justify-center items-center w-10 h-10 rounded-full font-bold uppercase shadow 
                        ${isOwn ? 'bg-indigo-700 text-white' : 'bg-indigo-200 text-indigo-800'}
                      `}
                    >
                      {msg.userName ? msg.userName.charAt(0) : '?'}
                    </div>
                    {/* Message Bubble */}
                    <div
                      className={`relative rounded-2xl px-6 py-4 shadow-md
                        ${isOwn
                          ? 'bg-indigo-600 text-white shadow-lg'
                          : msg.private
                            ? 'bg-pink-100 text-pink-800 border border-pink-200'
                            : 'bg-white text-gray-900 border border-gray-300 hover:bg-indigo-50'}
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
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        </main>

        <div
          className={`
            px-10 pb-4 min-h-[1.5rem] text-indigo-700 font-medium italic flex-shrink-0 select-none flex items-center gap-2
            transition-all duration-300
            ${typingUsers.length > 0 ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'}
          `}
        >
          {typingUsers.length > 0 && (
            <span className="flex items-center gap-3 bg-indigo-100 px-5 py-2 rounded-full shadow-inner text-indigo-700 animate-pulse transition-all duration-300 max-w-xs whitespace-nowrap text-ellipsis">
              <span>
                {typingUsers.slice(0, 2).join(', ')}
                {typingUsers.length === 1 && ' is typing'}
                {typingUsers.length === 2 && ' are typing'}
                {typingUsers.length > 2 && (
                  <>
                    {` and ${typingUsers.length - 2} other${typingUsers.length - 2 > 1 ? 's' : ''} are typing`}
                  </>
                )}
              </span>
              {/* Animated dots */}
              <span className="flex gap-1 ml-1">
                <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '0s' }}></span>
                <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '0.16s' }}></span>
                <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '0.32s' }}></span>
              </span>
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
