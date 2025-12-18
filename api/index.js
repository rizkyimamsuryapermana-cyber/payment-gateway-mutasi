import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

const OrderSchema = new mongoose.Schema({
  order_id: String,
  product_name: String,
  customer_contact: String,
  amount_original: Number,
  unique_code: Number,
  total_pay: Number,
  status: { type: String, default: 'UNPAID' },
  created_at: { type: Date, default: Date.now }
});

const Order = mongoose.models.Order || mongoose.model('Order', OrderSchema);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const secretKey = process.env.SECRET_KEY;
  
  // Ambil semua data dari Macrodroid
  const { secret, package_name, message, title, text, big_text } = req.body;

  // 1. Validasi Password
  if (secret !== secretKey) {
    return res.status(401).json({ error: 'Unauthorized: Salah Secret Key' });
  }

  try {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(MONGODB_URI);
    }

    // Gabungkan teks pesan untuk analisa
    const fullMessage = `${message || ''} ${title || ''} ${text || ''} ${big_text || ''}`;
    const msgLower = fullMessage.toLowerCase();
    const pkg = package_name ? package_name.toLowerCase() : "";

    // --- 2. LOGIC DETEKSI SUMBER APLIKASI (YANG KAMU CARI) ---
    let source = "Unknown App";
    let icon = "📱";

    if (pkg.includes("orderquota")) {
      source = "OrderQuota QRIS";
      icon = "🏪";
    }
    else if (pkg.includes("gobiz")) {
      source = "GoBiz / GoPay Merchant";
      icon = "🏪";
    } 
    else if ((pkg.includes("gojek") || pkg.includes("gopay")) && (msgLower.includes("qris") || msgLower.includes("merchant"))) {
      source = "GoPay QRIS";
      icon = "🏪";
    }
    else if (pkg.includes("gojek") || pkg.includes("gopay")) {
      source = "GOPAY Personal";
      icon = "🟢";
    }
    else if (pkg.includes("dana")) {
      source = "DANA";
      icon = "🔵";
    }
    else if (pkg.includes("ovo")) {
      source = "OVO";
      icon = "🟣";
    }
    else if (pkg.includes("bca")) {
      source = "BCA Mobile";
      icon = "🏦";
    }
    else if (pkg.includes("livin") || pkg.includes("mandiri")) {
      source = "Livin Mandiri";
      icon = "🏦";
    }
    else if (pkg.includes("brimo")) {
      source = "BRImo";
      icon = "🏦";
    }
    else if (pkg.includes("seabank")) {
      source = "SeaBank";
      icon = "🟧";
    }
    else if (pkg.includes("neo")) {
      source = "Neo Bank";
      icon = "🦁";
    }
    else {
      source = package_name || "Unknown"; 
    }

    // --- 3. LOGIC PARSING NOMINAL CANGGIH (PEMBERSIH KOMA) ---
    // Mencari "Rp" diikuti angka, mengabaikan spasi/titik error
    const nominalMatch = fullMessage.match(/Rp[\s.]*([\d,.]+)/i);
    let nominalReceived = 0;
    
    if (nominalMatch) {
      let rawString = nominalMatch[1];
      // Buang ,00 di belakang
      rawString = rawString.replace(/[,.]00$/g, ''); 
      // Ambil angka saja
      let cleanString = rawString.replace(/[^0-9]/g, '');
      nominalReceived = parseInt(cleanString);
    }

    // --- 4. CEK DATABASE (MATCHING) ---
    // Mundur 1 jam ke belakang
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const paidOrder = await Order.findOne({ 
      status: 'UNPAID', 
      total_pay: nominalReceived,
      created_at: { $gte: oneHourAgo } 
    });

    let statusLaporan = "❌ UNPAID / Expired / Nominal Salah";
    
    if (paidOrder) {
      paidOrder.status = 'PAID';
      await paidOrder.save();
      statusLaporan = `✅ LUNAS! (ID: ${paidOrder.order_id})`;
    }

    // --- 5. KIRIM TELEGRAM (DENGAN IKON & SOURCE) ---
    const textTelegram = `
${icon} *${source}*
💰 *TERIMA: Rp ${nominalReceived.toLocaleString()}*
-----------------------------
📦 Order: ${paidOrder ? paidOrder.product_name : '-'}
👤 Kontak: ${paidOrder ? paidOrder.customer_contact : '-'}
📝 Status: ${statusLaporan}
-----------------------------
🔍 _Raw: ${fullMessage.substring(0, 100)}_
    `;

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: textTelegram, parse_mode: 'Markdown' })
    });

    return res.status(200).json({ 
      status: 'success', 
      source: source,
      nominal: nominalReceived,
      match: !!paidOrder 
    });

  } catch (error) {
    console.error("Webhook Error:", error);
    return res.status(500).json({ error: 'Server Error' });
  }
}
