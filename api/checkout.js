import mongoose from 'mongoose';
import QRCode from 'qrcode';

const MONGODB_URI = process.env.MONGODB_URI;

// --- UPDATE SCHEMA DATABASE ---
// Kita tambahkan kolom 'notify_url' agar database menyimpan link webhook toko pengirim
const OrderSchema = new mongoose.Schema({
  order_id: String,
  ref_id: String,
  notify_url: String, // <--- KOLOM BARU PENTING
  product_name: String,
  customer_contact: String,
  customer_email: String,
  amount_original: Number,
  unique_code: Number,
  total_pay: Number,
  method: String,
  status: { type: String, default: 'UNPAID' },
  qris_string: String,
  created_at: { type: Date, default: Date.now }
});

// Mencegah error "OverwriteModelError" saat hot-reload di Vercel
const Order = mongoose.models.Order || mongoose.model('Order', OrderSchema);

// --- HELPER QRIS DINAMIS (CRC16) ---
function crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) crc = (crc << 1) ^ 0x1021;
      else crc = crc << 1;
    }
  }
  let hex = (crc & 0xFFFF).toString(16).toUpperCase();
  return hex.padStart(4, '0');
}

function convertToDynamic(qrisRaw, amount) {
  let amountStr = amount.toString();
  let tag54 = "54" + amountStr.length.toString().padStart(2, '0') + amountStr;
  let cleanQris = qrisRaw.substring(0, qrisRaw.length - 4);
  let splitIndex = cleanQris.lastIndexOf("6304");
  if (splitIndex === -1) return qrisRaw;
  let beforeCRC = cleanQris.substring(0, splitIndex);
  let newString = beforeCRC + tag54 + "6304";
  return newString + crc16(newString);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // DATA REKENING (Pastikan String QRIS Benar)
  const DATA_PAYMENT = {
    qris: "00020101021126610014COM.GO-JEK.WWW01189360091438225844470210G8225844470303UMI51440014ID.CO.QRIS.WWW0215ID10243639137310303UMI5204721053033605802ID5925WAGO SHOESPA CUCI SEPATU 6006SLEMAN61055529462070703A016304EFA8", 
    bca: "1234567890 a.n Wago Payment", // Ganti dengan rek BCA asli jika ada
  };

  try {
    // 1. Koneksi Database
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(MONGODB_URI);
    }

    // 2. Tangkap Data dari Frontend (Termasuk notify_url)
    const { 
        product_name, 
        price, 
        customer_contact, 
        customer_email, 
        method, 
        ref_id, 
        notify_url // <--- Tangkap URL Webhook titipan
    } = req.body;

    let selectedMethod = method || 'qris';
    const nominal = parseInt(price);

    // 3. Validasi Nominal
    if (nominal < 1000) return res.status(400).json({ error: "Minimal Rp 1.000" });
    if (nominal > 1000000) return res.status(400).json({ error: "Maksimal Rp 1.000.000" });
    // Fitur Auto-Hide Bank di Frontend sudah ada, tapi validasi backend tetap perlu
    if (nominal < 100000 && selectedMethod !== 'qris') return res.status(400).json({ error: "Transfer Bank minimal Rp 100.000" });

    // 4. Hitung Total Bayar (Kode Unik)
    const uniqueCode = Math.floor(Math.random() * 99) + 1;
    const totalPay = nominal + uniqueCode;

    // 5. Generate Payment Info / QR Image
    let qrImage = null;
    let paymentInfo = "";

    if (selectedMethod === 'qris') {
      const dynamicQris = convertToDynamic(DATA_PAYMENT.qris, totalPay);
      qrImage = await QRCode.toDataURL(dynamicQris);
      paymentInfo = "Scan QRIS di atas";
    } else {
      // Logic Transfer Bank
      if(DATA_PAYMENT[selectedMethod]) {
          paymentInfo = `Silakan transfer Rp ${totalPay.toLocaleString('id-ID')} ke:\n${selectedMethod.toUpperCase()}: ${DATA_PAYMENT[selectedMethod]}\n\n(Pastikan nominal SAMA PERSIS 3 digit terakhir)`;
      } else {
          return res.status(400).json({ error: "Metode tidak tersedia" });
      }
    }

    // 6. Tentukan Webhook Target (Prioritas: URL dari Frontend > URL Default Env)
    const webhookTarget = notify_url || process.env.STORE_WEBHOOK_URL || "-";

    // 7. SIMPAN KE MONGODB
    const newOrder = await Order.create({
      order_id: "ORD-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
      ref_id: ref_id || "-",
      notify_url: webhookTarget, // <--- Simpan Webhook URL ke DB
      product_name: product_name,
      customer_contact: customer_contact,
      customer_email: customer_email,
      amount_original: nominal,
      unique_code: uniqueCode,
      total_pay: totalPay,
      method: selectedMethod,
      status: 'UNPAID',
      qris_string: selectedMethod === 'qris' ? qrImage : '-'
    });

    // 8. Response Sukses
    return res.status(200).json({
      status: 'success',
      order_id: newOrder.order_id,
      total_pay: totalPay,
      qr_image: qrImage,
      payment_info: paymentInfo
    });

  } catch (error) {
    console.error("Checkout Error:", error);
    return res.status(500).json({ error: 'Server Error: ' + error.message });
  }
}
