// Helper kirim pesan WhatsApp via Fonnte (https://fonnte.com)
//
// Cara setup:
// 1. Daftar di https://fonnte.com, scan QR untuk hubungkan nomor WA pengirim (device).
// 2. Ambil "Token" device dari dashboard Fonnte.
// 3. Set environment variable FONNTE_TOKEN di Vercel/.env.local dengan token tersebut.
//
// Dokumentasi API: https://docs.fonnte.com/

export interface KirimWaResult {
  target: string
  success: boolean
  message?: string
}

export async function kirimWa(target: string, pesan: string): Promise<KirimWaResult> {
  const token = process.env.FONNTE_TOKEN
  if (!token) {
    return { target, success: false, message: 'FONNTE_TOKEN belum dikonfigurasi di environment variable' }
  }

  // Normalisasi nomor: hapus karakter non-digit, ubah awalan 0 menjadi 62
  let nomor = target.replace(/\D/g, '')
  if (nomor.startsWith('0')) nomor = '62' + nomor.slice(1)

  if (!nomor || nomor.length < 9) {
    return { target, success: false, message: 'Nomor tidak valid' }
  }

  try {
    const res = await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        target: nomor,
        message: pesan,
        countryCode: '62',
      }),
    })

    const data = await res.json().catch(() => null)
    if (!res.ok || data?.status === false) {
      return { target: nomor, success: false, message: data?.reason ?? `HTTP ${res.status}` }
    }

    return { target: nomor, success: true }
  } catch (err) {
    return { target: nomor, success: false, message: err instanceof Error ? err.message : 'Gagal mengirim' }
  }
}

// Kirim ke banyak nomor sekaligus (sekuensial agar tidak melebihi rate limit Fonnte)
export async function kirimWaBanyak(items: { target: string; pesan: string }[]): Promise<KirimWaResult[]> {
  const hasil: KirimWaResult[] = []
  for (const item of items) {
    hasil.push(await kirimWa(item.target, item.pesan))
    // jeda kecil antar pengiriman supaya tidak terkena rate limit
    await new Promise(r => setTimeout(r, 600))
  }
  return hasil
}
