// GET /api/siswa/ujian/health — denyut (heartbeat) untuk indikator jaringan.
//
// Definisi "ONLINE" bagi aplikasi ujian = browser BISA MENJANGKAU SERVER ujian,
// bukan sekadar navigator.onLine (yang tetap true saat Wi-Fi tersambung tapi
// internetnya mati). Endpoint ini sengaja SANGAT RINGAN:
//   - tanpa autentikasi & tanpa akses database (tidak membebani DB walau
//     ratusan siswa memanggil tiap beberapa detik, dan tetap menjawab walau
//     token bermasalah -- pertanyaannya hanya "server terjangkau?"),
//   - tidak pernah di-cache (no-store), supaya jawabannya selalu segar.
// Header `Date` bawaan HTTP ikut dipakai untuk mengkalibrasi jam tepercaya
// (src/lib/clock-offset.ts).
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const HEADERS = { 'Cache-Control': 'no-store, max-age=0' }

export async function GET() {
  return NextResponse.json({ ok: true }, { headers: HEADERS })
}

export async function HEAD() {
  return new NextResponse(null, { status: 200, headers: HEADERS })
}
