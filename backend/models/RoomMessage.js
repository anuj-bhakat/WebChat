import mongoose from 'mongoose';

const roomMessageSchema = new mongoose.Schema({
  room: { type: String, required: true },
  userName: { type: String, required: true },
  text: { type: String, required: true },
  time: { type: String, required: true },
});

const RoomMessage = mongoose.model('RoomMessage', roomMessageSchema);
export default RoomMessage;