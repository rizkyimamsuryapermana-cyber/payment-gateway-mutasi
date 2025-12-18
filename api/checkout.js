import mongoose from 'mongoose';
import QRCode from 'qrcode';

const MONGODB_URI = process.env.MONGODB_URI;

// Schema Order
const OrderSchema = new mongoose.Schema({
  order_id: String,
  product_name: String,
  customer_contact: String,
  amount_original: Number,
  unique_code: Number,
  total_pay: Number,
  status: { type: String, default: 'UNPAID' },
  qris_string: String,
  created_at: { type: Date, default: Date.now } // Waktu order dibuat
});

const Order = mongoose.models.Order || mongoose.model('Order', OrderSchema);

// Helper CRC16 untuk QRIS
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

  // --- GANTI DENGAN STRING QRIS ASLI KAMU ---
  const MY_QRIS = "00020101021126670016COM.NOBUBANK.WWW01189360050300000879140214504244849705970303UMI51440014ID.CO.QRIS.WWW0215ID20232921381120303UMI5204541153033605802ID5907WAGO ID6006JEPARA61055941162070703A0154064990056304C57B"; 

  try {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(MONGODB_URI);
    }

    const { product_name, price, customer_contact } = req.body;

    // --- LOGIC KODE UNIK 1 DIGIT (1 - 9) ---
    const uniqueCode = Math.floor(Math.random() * 9) + 1;
    const totalPay = parseInt(price) + uniqueCode;

    // Generate QRIS
    const dynamicQris = convertToDynamic(MY_QRIS, totalPay);
    const qrImage = await QRCode.toDataURL(dynamicQris);

    // Simpan ke Database
    const newOrder = await Order.create({
      order_id: "ORD-" + Date.now(),
      product_name: product_name,
      customer_contact: customer_contact,
      amount_original: price,
      unique_code: uniqueCode,
      total_pay: totalPay,
      status: 'UNPAID',
      qris_string: dynamicQris
    });

    return res.status(200).json({
      status: 'success',
      order_id: newOrder.order_id,
      total_pay: totalPay,
      qr_image: qrImage,
      expired_in: "1 Jam"
    });

  } catch (error) {
    console.error("Checkout Error:", error);
    return res.status(500).json({ error: 'Gagal membuat tagihan' });
  }
}
