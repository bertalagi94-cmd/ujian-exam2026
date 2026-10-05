// POST /api/guru/soal/impor — impor banyak soal PILIHAN GANDA sekaligus
// (hasil baca template Word di browser guru, lihat src/lib/impor-soal/).
//
// body: {
//   mapel_id, kelas_id,
//   paket_id?,          // kosong → paket baru dibuat di sini (paket "pending" di UI)
//   acak?,              // 'YA' | 'TIDAK' — hanya dipakai untuk paket baru
//   jumlah_opsi,        // 4 | 5
//   soal: [{ teks, gambar_pertanyaan?, opsi_a..e, gambar_opsi_a..e?, kunci, pembahasan? }]
// }
//
// PRINSIP (selaras README "DO NOT REVERT"): validasi dan otorisasi memakai
// fungsi yang SAMA dengan POST /api/guru/soal (guru-scope, validasi-soal,
// sesi-kelas) — endpoint ini tidak membuka jalur baru yang lebih longgar.
// Semua soal ditulis dengan SATU perintah INSERT (atomik: semua masuk atau
// tidak ada yang masuk). Jika paket dibuat di sini dan INSERT soal gagal,
// paket yang baru dibuat dihapus lagi supaya tidak tertinggal draft kosong.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId, stripHtmlTags } from '@/lib/utils'
import { cekSesiMapelKelasSudahMulai, pesanBankSoalTerkunci } from '@/lib/sesi-kelas'
import { catatAktivitas } from '@/lib/aktivitas'
import { validasiKunciOpsi } from '@/lib/validasi-soal'
import { tandaPgDariDb } from '@/lib/impor-soal/duplikat'
import { verifikasiKepemilikanMapelKelas, verifikasiKepemilikanPaketSoal } from '@/lib/guru-scope'

const MAKS_SOAL = 200
const HURUF = ['a', 'b', 'c', 'd', 'e'] as const

// Gambar hanya boleh berasal dari endpoint upload soal (bucket assets/soal/).
function urlGambar(v: unknown): { ok: true; nilai: string | null } | { ok: false } {
  if (v === null || v === undefined || v === '') return { ok: true, nilai: null }
  if (typeof v !== 'string' || v.length > 1000 || !/^https?:\/\//.test(v) || !v.includes('/assets/soal/')) {
    return { ok: false }
  }
  return { ok: true, nilai: v }
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const db = createAdminClient()

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 400 })
  }

  const daftar = body.soal
  if (!Array.isArray(daftar) || daftar.length === 0) {
    return NextResponse.json({ error: 'Tidak ada soal untuk diimpor' }, { status: 400 })
  }
  if (daftar.length > MAKS_SOAL) {
    return NextResponse.json({ error: `Maksimal ${MAKS_SOAL} soal per sekali impor` }, { status: 400 })
  }
  const jumlahOpsi = Number(body.jumlah_opsi)
  if (jumlahOpsi !== 4 && jumlahOpsi !== 5) {
    return NextResponse.json({ error: 'Jumlah opsi harus 4 atau 5' }, { status: 400 })
  }
  const mapelId = body.mapel_id as string
  const kelasId = body.kelas_id as string

  const verifikasi = await verifikasiKepemilikanMapelKelas(db, user.username, mapelId, kelasId)
  if (!verifikasi.ok) {
    return NextResponse.json({ error: verifikasi.error }, { status: verifikasi.status })
  }

  const paketIdBody = typeof body.paket_id === 'string' && body.paket_id ? body.paket_id : null
  let acakPaket: 'YA' | 'TIDAK' = body.acak === 'TIDAK' ? 'TIDAK' : 'YA'

  if (paketIdBody) {
    const vp = await verifikasiKepemilikanPaketSoal(db, user.username, paketIdBody, mapelId, kelasId)
    if (!vp.ok) return NextResponse.json({ error: vp.error }, { status: vp.status })

    const { data: paket, error: errPaket } = await db
      .from('paket_soal')
      .select('status, acak')
      .eq('id', paketIdBody)
      .maybeSingle()
    if (errPaket) return NextResponse.json({ error: errPaket.message }, { status: 500 })
    if (!paket) return NextResponse.json({ error: 'Paket tidak ditemukan' }, { status: 404 })
    if (!['DRAFT', 'DITOLAK'].includes(paket.status)) {
      return NextResponse.json({ error: 'Paket sudah dikirim/disetujui dan terkunci — soal tidak bisa ditambah' }, { status: 400 })
    }
    acakPaket = paket.acak === 'TIDAK' ? 'TIDAK' : 'YA'

    // Semua soal dalam satu paket wajib punya jumlah opsi yang sama.
    const { data: soalAda, error: errAda } = await db
      .from('soal')
      .select('jumlah_opsi')
      .eq('paket_id', paketIdBody)
      .limit(1)
    if (errAda) return NextResponse.json({ error: errAda.message }, { status: 500 })
    const opsiAda = Number(soalAda?.[0]?.jumlah_opsi)
    if ((opsiAda === 4 || opsiAda === 5) && opsiAda !== jumlahOpsi) {
      return NextResponse.json({
        error: `Paket ini sudah berisi soal dengan ${opsiAda} opsi, sedangkan file Word memakai ${jumlahOpsi} opsi. Samakan jumlah opsinya.`,
      }, { status: 400 })
    }
  } else {
    // Sama dengan POST /api/guru/paket: satu paket per guru+mapel+kelas.
    const { data: ada, error: errCek } = await db
      .from('paket_soal')
      .select('id')
      .eq('guru_id', user.username)
      .eq('mapel_id', mapelId)
      .eq('kelas_id', kelasId)
      .limit(1)
    if (errCek) return NextResponse.json({ error: errCek.message }, { status: 500 })
    if (ada && ada.length > 0) {
      return NextResponse.json(
        { error: 'Paket soal untuk mapel dan kelas ini sudah ada. Buka paket tersebut lalu impor dari sana.' },
        { status: 409 }
      )
    }
  }

  const sesiSudahMulai = await cekSesiMapelKelasSudahMulai(db, mapelId, kelasId)
  if (sesiSudahMulai) {
    return NextResponse.json({ error: pesanBankSoalTerkunci('PG', sesiSudahMulai, 'menambah') }, { status: 409 })
  }

  // ── Validasi seluruh soal SEBELUM menulis apa pun ──
  const opsiWajib = HURUF.slice(0, jumlahOpsi)
  const galat: string[] = []
  const baris: Record<string, unknown>[] = []
  const waktuDasar = Date.now()

  daftar.forEach((raw, i) => {
    const s = (raw ?? {}) as Record<string, unknown>
    const label = `Soal ke-${i + 1}`
    const teks = stripHtmlTags(s.teks)
    const gSoal = urlGambar(s.gambar_pertanyaan)
    if (!gSoal.ok) { galat.push(`${label}: URL gambar soal tidak valid`); return }
    if (!teks && !gSoal.nilai) { galat.push(`${label}: soal belum diisi (teks atau gambar)`); return }

    const opsiTeks: Record<string, string> = {}
    const opsiGambar: Record<string, string | null> = {}
    const kurang: string[] = []
    for (const h of HURUF) {
      const t = stripHtmlTags(s[`opsi_${h}`])
      const g = urlGambar(s[`gambar_opsi_${h}`])
      if (!g.ok) { galat.push(`${label}: URL gambar opsi ${h.toUpperCase()} tidak valid`); return }
      const dipakai = (opsiWajib as readonly string[]).includes(h)
      opsiTeks[h] = dipakai ? t : ''
      opsiGambar[h] = dipakai ? g.nilai : null
      if (dipakai && !t && !g.nilai) kurang.push(h.toUpperCase())
    }
    if (kurang.length > 0) { galat.push(`${label}: opsi ${kurang.join(', ')} harus diisi teks atau gambar`); return }

    const errKunci = validasiKunciOpsi(s.kunci, jumlahOpsi)
    if (errKunci) { galat.push(`${label}: ${errKunci}`); return }

    baris.push({
      id: generateId('SL'),
      mapel_id: mapelId,
      kelas_id: kelasId,
      guru_id: user.username,
      teks,
      gambar_pertanyaan: gSoal.nilai,
      opsi_a: opsiTeks.a,
      opsi_b: opsiTeks.b,
      opsi_c: opsiTeks.c,
      opsi_d: opsiTeks.d || null,
      opsi_e: opsiTeks.e || null,
      gambar_opsi_a: opsiGambar.a,
      gambar_opsi_b: opsiGambar.b,
      gambar_opsi_c: opsiGambar.c,
      gambar_opsi_d: opsiGambar.d,
      gambar_opsi_e: opsiGambar.e,
      kunci: String(s.kunci).trim().toUpperCase(),
      pembahasan: s.pembahasan ? stripHtmlTags(s.pembahasan) || null : null,
      tingkat: 'Sedang',
      jumlah_opsi: jumlahOpsi,
      status: 'DRAFT',
      acak: acakPaket,
      // created_at dibedakan 1 ms per soal: daftar soal paket diurutkan
      // berdasarkan created_at, dan satu INSERT massal akan memberi semua
      // baris NOW() yang sama (urutan jadi acak) kalau tidak dibedakan.
      created_at: new Date(waktuDasar + i).toISOString(),
    })
  })

  if (galat.length > 0) {
    const tampil = galat.slice(0, 5).join('; ')
    const sisa = galat.length > 5 ? ` (+${galat.length - 5} kesalahan lain)` : ''
    return NextResponse.json({ error: `${tampil}${sisa}` }, { status: 400 })
  }

  // ── Pengaman duplikat: buang soal yang SAMA dengan soal yang sudah ada di
  //    paket (atau kembar di dalam file ini). Pratinjau di browser sudah
  //    menandainya; ini jaring pengaman untuk klik ganda / dua tab. ──
  let dilewati = 0
  if (paketIdBody) {
    const { data: ada, error: errDup } = await db
      .from('soal')
      .select('teks, opsi_a, opsi_b, opsi_c, opsi_d, opsi_e, kunci, gambar_pertanyaan, gambar_opsi_a, gambar_opsi_b, gambar_opsi_c, gambar_opsi_d, gambar_opsi_e')
      .eq('paket_id', paketIdBody)
    if (errDup) return NextResponse.json({ error: errDup.message }, { status: 500 })
    const sudahAda = new Set<string>()
    for (const r of ada ?? []) {
      const t = tandaPgDariDb(r as Record<string, unknown>, jumlahOpsi)
      if (t) sudahAda.add(t)
    }
    const unik: Record<string, unknown>[] = []
    for (const b of baris) {
      const t = tandaPgDariDb(b, jumlahOpsi)
      if (t && sudahAda.has(t)) { dilewati++; continue }
      if (t) sudahAda.add(t)
      unik.push(b)
    }
    if (unik.length === 0) {
      return NextResponse.json(
        { error: `Semua ${baris.length} soal dalam file ini sudah ada di paket (isinya sama persis), jadi tidak ada yang diimpor lagi.` },
        { status: 409 }
      )
    }
    baris.length = 0
    baris.push(...unik)
  }

  // ── Tulis: paket (jika baru) lalu semua soal dalam satu INSERT ──
  let paketId = paketIdBody
  let paketBaru = false
  if (!paketId) {
    paketId = generateId('PKT')
    // Cek-duplikat + insert paket sebagai satu langkah atomik di database
    // (migrasi 37: buat_paket_soal_atomik) supaya klik ganda / dua tab tidak
    // bisa membuat dua paket untuk guru+mapel+kelas yang sama.
    const { data: dibuat, error: errBuat } = await db.rpc('buat_paket_soal_atomik', {
      p_id: paketId,
      p_mapel_id: mapelId,
      p_kelas_id: kelasId,
      p_guru_id: user.username,
      p_acak: acakPaket,
      p_mode_jawaban: 'DIGITAL',
    })
    if (errBuat) return NextResponse.json({ error: errBuat.message }, { status: 500 })
    if (dibuat === false) {
      return NextResponse.json(
        { error: 'Paket soal untuk mapel dan kelas ini sudah ada. Buka paket tersebut lalu impor dari sana.' },
        { status: 409 }
      )
    }
    paketBaru = true
  }

  const { error: errSoal } = await db.from('soal').insert(baris.map(b => ({ ...b, paket_id: paketId })))
  if (errSoal) {
    if (paketBaru) await db.from('paket_soal').delete().eq('id', paketId)
    return NextResponse.json({ error: errSoal.message }, { status: 500 })
  }

  // jumlah_soal: dihitung ulang dari tabel soal (bukan ditambah buta) supaya benar.
  const { count } = await db.from('soal').select('id', { count: 'exact', head: true }).eq('paket_id', paketId)
  if (typeof count === 'number') {
    await db.from('paket_soal').update({ jumlah_soal: count }).eq('id', paketId)
  }

  catatAktivitas(db, user.username, 'BUAT_SOAL', `Guru ${user.username} mengimpor ${baris.length} soal PG dari file Word`)

  return NextResponse.json(
    { message: `${baris.length} soal berhasil diimpor`, paket_id: paketId, jumlah: baris.length, dilewati },
    { status: 201 }
  )
}
