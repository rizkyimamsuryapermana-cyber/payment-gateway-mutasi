import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;
const STORE_WEBHOOK_URL = process.env.STORE_WEBHOOK_URL; 

const OrderSchema = new mongoose.Schema({
  order_id: String, product_name: String, customer_email: String, customer_contact: String,
  total_pay: Number, status: { type: String, default: 'UNPAID' },
  created_at: { type: Date, default: Date.now }
});
const Order = mongoose.models.Order || mongoose.model('Order', OrderSchema);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Not Allowed');
  const { secret, package_name, message, title, text, big_text } = req.body;
  
  // Validasi Secret Key
  if (secret !== process.env.SECRET_KEY) return res.status(401).send('Unauthorized');

  try {
    if (mongoose.connection.readyState !== 1) await mongoose.connect(MONGODB_URI);
    
    // Gabung semua teks notifikasi
    const fullMsg = `${message||''} ${title||''} ${text||''} ${big_text||''}`;
    const pkg = package_name ? package_name.toLowerCase() : "";
    
    // --- 1. FILTER APK (DETEKSI SUMBER) ---
    let source = "Bank/E-Wallet";
    let icon = "📱";

    if (pkg.includes("orderkuota")) { source = "OrderKuota"; icon = "🏪"; }
    else if (pkg.includes("gobiz")) { source = "GoBiz / GoPay Merchant"; icon = "🏪"; } 
    else if (pkg.includes("dana")) { source = "DANA"; icon = "🔵"; }
    else if (pkg.includes("bca")) { source = "BCA Mobile"; icon = "🏦"; }
    else if (pkg.includes("gojek") || pkg.includes("gopay")) { source = "GoPay"; icon = "🟢"; }
    else if (pkg.includes("seabank") || pkg.includes("bankbkemobile")) { source = "Digital Bank"; icon = "🟧"; }

    // --- 2. AMBIL NOMINAL ---
    const match = fullMsg.match(/Rp[\s.]*([\d,.]+)/i);
    if (!match) return res.status(200).send('No Nominal Found');
    const nominal = parseInt(match[1].replace(/[^0-9]/g, '').replace(/00$/g, ''));

    // --- 3. CEK DATABASE ---
    // Cari tagihan UNPAID dengan nominal yang sama dalam 1 jam terakhir
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const paidOrder = await Order.findOne({ 
        status: 'UNPAID', 
        total_pay: nominal,
        created_at: { $gte: oneHourAgo }
    });
    
    let statusText = "❌ TIDAK DIKENALI / BELUM ADA TAGIHAN";
    
    if (paidOrder) {
      paidOrder.status = 'PAID';
      await paidOrder.save();
      statusText = `✅ LUNAS (ID: ${paidOrder.order_id})`;

      // --- 4. LAPOR KE WEB STORE (WEBHOOK) ---
      if (STORE_WEBHOOK_URL) {
        try {
            await fetch(STORE_WEBHOOK_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-secret-key': process.env.SECRET_KEY },
              body: JSON.stringify({ 
                event: 'PAYMENT_SUCCESS', 
                order_id: paidOrder.order_id, 
                customer_email: paidOrder.customer_email,
                customer_contact: paidOrder.customer_contact,
                product_name: paidOrder.product_name,
                amount: paidOrder.total_pay,
                source_app: source 
              })
            });
        } catch(e) { console.error("Webhook Error"); }
      }
    }

    // --- 5. LAPOR KE TELEGRAM (FORMAT LENGKAP) ---
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    
    if(botToken && chatId) {
        // Data untuk ditampilkan di chat
        const prodName = paidOrder ? paidOrder.product_name : '-';
        const contact = paidOrder ? paidOrder.customer_contact : '-';
        const email = paidOrder ? paidOrder.customer_email : '-';

        const textTele = `
${icon} *${source}*
💰 *TERIMA: Rp ${nominal.toLocaleString()}*
-----------------------------
📦 Order: ${prodName}
👤 Kontak: ${contact}
📧 Email: ${email}
📝 Status: ${statusText}
-----------------------------
🔍 _Pesan: ${fullMsg.substring(0, 50)}..._
        `;

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: textTele, parse_mode: 'Markdown' })
        });
    }

    return res.status(200).json({ status: 'success' });
  } catch (e) { return res.status(500).send('Error'); }
}
