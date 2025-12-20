import mongoose from 'mongoose';
import QRCode from 'qrcode';

const MONGODB_URI = process.env.MONGODB_URI;

// UPDATE SCHEMA: Tambah ref_id
const OrderSchema = new mongoose.Schema({
  order_id: String,
  ref_id: String, // Kolom untuk menyimpan ID titipan
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

const Order = mongoose.models.Order || mongoose.model('Order', OrderSchema);

// Helper CRC16 (Wajib ada)
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

  // EDIT DATA REKENING DI SINI
  const DATA_PAYMENT = {
    qris: "00020101021126610014COM.GO-JEK.WWW01189360091438225844470210G8225844470303UMI51440014ID.CO.QRIS.WWW0215ID10243639137310303UMI5204721053033605802ID5925WAGO SHOESPA CUCI SEPATU 6006SLEMAN61055529462070703A016304EFA8", // Paste String QRIS Panjang Kamu
    seabank: "1234567890 a.n Rizky imam surya permana",
    bni: "1905467404 a.n Rizky imam surya permana",
    dana: "088221744129 a.n Wago ID",
    gopay: "085171592306 a.n Wago ID",
  };

  try {
    if (mongoose.connection.readyState !== 1) await mongoose.connect(MONGODB_URI);

    // Tangkap ref_id dari request
    const { product_name, price, customer_contact, customer_email, method, ref_id } = req.body;
    let selectedMethod = method || 'qris';
    const nominal = parseInt(price);

    if (nominal < 1000) return res.status(400).json({ error: "Minimal Rp 1.000" });
    if (nominal > 1000000) return res.status(400).json({ error: "Maksimal Rp 1.000.000" });
    if (nominal < 100000 && selectedMethod !== 'qris') return res.status(400).json({ error: "Transfer Bank minimal Rp 100.000" });

    const uniqueCode = Math.floor(Math.random() * 99) + 1;
    const totalPay = nominal + uniqueCode;

    let qrImage = null;
    let paymentInfo = "";

    if (selectedMethod === 'qris') {
      const dynamicQris = convertToDynamic(DATA_PAYMENT.qris, totalPay);
      qrImage = await QRCode.toDataURL(dynamicQris);
      paymentInfo = "Scan QRIS di atas";
    } else {
      if(DATA_PAYMENT[selectedMethod]) paymentInfo = DATA_PAYMENT[selectedMethod];
      else return res.status(400).json({ error: "Metode tidak tersedia" });
    }

    // SIMPAN ref_id KE DATABASE
    const newOrder = await Order.create({
      order_id: "ORD-" + Date.now(),
      ref_id: ref_id || "-", // Simpan ID Titipan
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

    return res.status(200).json({
      status: 'success',
      order_id: newOrder.order_id,
      total_pay: totalPay,
      qr_image: qrImage,
      payment_info: paymentInfo
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Server Error' });
  }
}
