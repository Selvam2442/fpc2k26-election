const mongoose = require('mongoose');

const pushSubscriptionSchema = new mongoose.Schema({
  endpoint: { type: String, required: true, unique: true, trim: true },
  keys: {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true }
  },
  rollNumber: { type: String, required: true, trim: true, uppercase: true, index: true },
  className: { type: String, required: true, trim: true, index: true },
  active: { type: Boolean, default: true, index: true }
}, { timestamps: true });

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
