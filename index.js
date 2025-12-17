// api/index.js

export default async function handler(req, res) {
  // 1. Cek Method (Harus POST)
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 2. Ambil Variable dari Environment Vercel
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const secretKey = process.env.SECRET_KEY;

  // 3. Ambil data yang dikirim Macrodroid
  const { package_name, message, secret } = req.body;

  // 4. Validasi Keamanan
  if (secret !== secretKey) {
    return res.status(401).json({ error: 'Unauthorized: Salah Secret Key' });
  }

  try {
    // 5. Logic Deteksi Sumber Aplikasi & QRIS
    let source = "Unknown App";
    let icon = "💵";
    
    // Normalisasi teks agar pencarian lebih mudah (huruf kecil semua)
    const pkg = package_name ? package_name.toLowerCase() : "";
    const msg = message ? message.toLowerCase() : "";

    // --- LOGIC DETEKSI DI SINI ---

    // 1. ORDERQUOTA (Settingan Baru)
    if (pkg.includes("orderquota")) {
      source = "OrderQuota QRIS";
      icon = "🏪";
    }
    // 2. GOPAY MERCHANT / GOBIZ
    else if (pkg.includes("gobiz")) {
      source = "GoPay Merchant (GoBiz)";
      icon = "🏪";
    } 
    // 3. GOPAY QRIS (Via App Gojek Biasa)
    else if ((pkg.includes("gojek") || pkg.includes("gopay")) && (msg.includes("qris") || msg.includes("merchant"))) {
      source = "GoPay QRIS";
      icon = "🏪";
    }
    // 4. GOPAY PERSONAL
    else if (pkg.includes("gojek") || pkg.includes("gopay")) {
      source = "GOPAY Personal";
      icon = "🟢";
    }
    // 5. E-WALLET & BANK LAIN
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
      icon = "ye";
    }
    else if (pkg.includes("brimo")) {
      source = "BRImo";
      icon = "🏦";
    }
    else if (pkg.includes("seabank")) {
      source = "SeaBank";
      icon = "🟧";
    }
    else {
      source = package_name; // Jika tidak dikenal
    }

    // 6. Logic Parsing Nominal (Mengambil angka Rupiah)
    const nominalMatch = message.match(/Rp\s?[\d,.]+/i);
    let nominal = nominalMatch ? nominalMatch[0] : "Cek Manual";

    // 7. Format Pesan untuk Telegram
    const textTelegram = `
${icon} *MUTASI MASUK: ${source}*
-----------------------------
💰 *Nominal:* ${nominal}
📦 *Aplikasi:* ${package_name}
📩 *Pesan Asli:*
_${message}_
-----------------------------
⏰ ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}
    `;

    // 8. Kirim ke Telegram API
    const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    
    await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: textTelegram,
        parse_mode: 'Markdown'
      })
    });

    // 9. Response Sukses
    return res.status(200).json({ status: 'success', source: source });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: 'error', message: 'Gagal memproses data' });
  }
}
