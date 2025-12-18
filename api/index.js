import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;
const STORE_WEBHOOK_URL = process.env.STORE_WEBHOOK_URL; 

const OrderSchema = new mongoose.Schema({
  order_id: String,
  product_name: String,
  customer_contact: String,
  customer_email: String,
  amount_original: Number,
  unique_code: Number,
  total_pay: Number,
  method: String,
  status: { type: String, default: 'UNPAID' },
  created_at: { type: Date, default: Date.now }
});

const Order = mongoose.models.Order || mongoose.model('Order', OrderSchema);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { secret, package_name, message, title, text, big_text } = req.body;
  const secretKey = process.env.SECRET_KEY;

  if (secret !== secretKey) return res.status(401).json({ error: 'Unauthorized' });

  try {
    if (mongoose.connection.readyState !== 1) await mongoose.connect(MONGODB_URI);

    const fullMessage = `${message || ''} ${title || ''} ${text || ''} ${big_text || ''}`;
    const msgLower = fullMessage.toLowerCase();
    const pkg = package_name ? package_name.toLowerCase() : "";

    // --- 1. FILTER APK (IKON & SOURCE) ---
    let source = "Unknown App";
    let icon = "📱";

    if (pkg.includes("orderkuota")) { source = "OrderKuota"; icon = "🏪"; }
    else if (pkg.includes("gobiz")) { source = "GoBiz / GoPay Merchant"; icon = "🏪"; } 
    else if (pkg.includes("dana")) { source = "DANA"; icon = "🔵"; }
    else if (pkg.includes("bca")) { source = "BCA Mobile"; icon = "🏦"; }
    else if (pkg.includes("gojek") || pkg.includes("gopay")) { source = "GoPay"; icon = "🟢"; }
    else if (pkg.includes("seabank")|| pkg.includes("bankbkemobile")) { source = "digitalbank"; icon = "🟧"; }
    // ... tambahkan filter apk lain di sini ...

    // --- 2. AMBIL NOMINAL ---
    const nominalMatch = fullMessage.match(/Rp[\s.]*([\d,.]+)/i);
    let nominalReceived = 0;
    if (nominalMatch) {
      nominalReceived = parseInt(nominalMatch[1].replace(/[,.]00$/g, '').replace(/[^0-9]/g, ''));
    }

    // --- 3. CEK DATABASE ---
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const paidOrder = await Order.findOne({ 
      status: 'UNPAID', 
      total_pay: nominalReceived,
      created_at: { $gte: oneHourAgo } 
    });

    if (paidOrder) {
      paidOrder.status = 'PAID';
      await paidOrder.save();

      // --- 4. LAPOR KE WEB STORE (UNTUK EMAIL) ---
      if (STORE_WEBHOOK_URL) {
          try {
              await fetch(STORE_WEBHOOK_URL, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'x-secret-key': secretKey },
                  body: JSON.stringify({
                      event: 'PAYMENT_SUCCESS',
                      order_id: paidOrder.order_id,
                      customer_email: paidOrder.customer_email,
                      product_name: paidOrder.product_name,
                      total_bayar: paidOrder.total_pay,
                      source_app: source
                  })
              });
          } catch (e) { console.error("Webhook Web Store Gagal"); }
      }
    }

    // --- 5. LAPOR KE TELEGRAM ---
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if(botToken && chatId) {
        const textTele = `${icon} *${source}*\n💰 *TERIMA: Rp ${nominalReceived.toLocaleString()}*\n📝 Status: ${paidOrder ? '✅ LUNAS' : '❌ TIDAK DIKENALI'}`;
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: textTele, parse_mode: 'Markdown' })
        });
    }

    return res.status(200).json({ status: 'success' });
  } catch (error) {
    return res.status(500).json({ error: 'Internal Error' });
  }
}
