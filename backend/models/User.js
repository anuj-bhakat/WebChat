import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  userName: { type: String, required: true, unique: true },
  socketID: { type: String, required: true },
  currentRoom: { type: String, default: 'general' },
});

const User = mongoose.model('User', userSchema);
export default User;
