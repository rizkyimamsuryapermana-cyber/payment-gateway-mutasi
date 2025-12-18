import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

const OrderSchema = new mongoose.Schema({
  order_id: String,
  status: String,
});

const Order = mongoose.models.Order || mongoose.model('Order', OrderSchema);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { order_id } = req.query;

  if (!order_id) return res.status(400).json({ error: 'Butuh Order ID' });

  try {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(MONGODB_URI);
    }

    const order = await Order.findOne({ order_id: order_id });

    if (!order) return res.status(404).json({ status: 'NOT_FOUND' });

    return res.status(200).json({ status: order.status });

  } catch (error) {
    return res.status(500).json({ error: 'Server Error' });
  }
}
