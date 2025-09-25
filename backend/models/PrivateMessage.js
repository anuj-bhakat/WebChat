import mongoose from 'mongoose';

const privateMessageSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  recipient: { type: String, required: true },
  text: { type: String, required: true },
  time: { type: String, required: true },
});

const PrivateMessage = mongoose.model('PrivateMessage', privateMessageSchema);
export default PrivateMessage;