import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

// Schema HARUS SAMA PERSIS dengan checkout.js
const OrderSchema = new mongoose.Schema({
  order_id: String,
  product_name: String,
  customer_contact: String,
  amount_original: Number,
  unique_code: Number,
  total_pay: Number,
  status: { type: String, default: 'UNPAID' },
  qris_string: String,
  created_at: { type: Date, default: Date.now }
});

const Order = mongoose.models.Order || mongoose.model('Order', OrderSchema);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const secretKey = process.env.SECRET_KEY;
  
  // Terima Data dari Macrodroid (Format Terpisah)
  const { package_name, title, text, big_text, secret } = req.body;

  if (secret !== secretKey) return res.status(401).json({ error: 'Salah Secret' });

  try {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(MONGODB_URI);
    }

    // Gabung semua teks notifikasi jadi satu string panjang
    const fullMessage = `${title || ''} ${text || ''} ${big_text || ''}`;
    
    // Ambil Angka Rupiah
    const nominalMatch = fullMessage.match(/Rp\s?[\d,.]+/i);
    let nominalReceived = nominalMatch ? parseInt(nominalMatch[0].replace(/[^0-9]/g, '')) : 0;

    // --- CARI ORDER YANG COCOK DI DATABASE ---
    // Syarat: Status belum bayar (UNPAID) DAN Nominalnya sama persis
    const paidOrder = await Order.findOne({ 
      status: 'UNPAID', 
      total_pay: nominalReceived 
    });

    let statusLaporan = "❌ Tidak ada tagihan yang cocok (Mungkin Topup Biasa)";
    
    if (paidOrder) {
      // KETEMU! Update jadi LUNAS
      paidOrder.status = 'PAID';
      await paidOrder.save();
      statusLaporan = `✅ LUNAS! Order ID: ${paidOrder.order_id}`;
    }

    // --- KIRIM LAPORAN KE TELEGRAM ---
    const textTelegram = `
💰 *UANG MASUK: Rp ${nominalReceived.toLocaleString()}*
-----------------------------
📦 Produk: ${paidOrder ? paidOrder.product_name : '-'}
👤 Pembeli: ${paidOrder ? paidOrder.customer_contact : '-'}
📝 Status: ${statusLaporan}
-----------------------------
_Pesan Asli: ${fullMessage.substring(0, 50)}..._
    `;

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: textTelegram, parse_mode: 'Markdown' })
    });

    return res.status(200).json({ status: 'success', match: !!paidOrder });

  } catch (error) {
    console.error("Webhook Error:", error);
    return res.status(500).json({ error: 'Server Error' });
  }
}
