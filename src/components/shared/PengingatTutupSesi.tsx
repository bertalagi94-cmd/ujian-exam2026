'use client'

// Pengingat menutup sesi untuk PENGAWAS (akun guru). Dipasang di
// src/app/guru/layout.tsx sehingga tampil di semua halaman guru.
//
// Ini banner TETAP (bukan popup) yang menyegarkan diri tiap 30 detik, jadi
// pengawas diingatkan di momen yang tepat, bukan hanya saat baru masuk.
// Melengkapi SesiTerlupaPopup (popup sekali saat masuk) tanpa mengubahnya.
//
// Tiga jenis pengingat (data dari GET /api/guru/pengingat-tutup-sesi):
//  - KEMARIN       (merah)  sesi hari kemarin belum ditutup. Terus tampil
//                           sampai ditutup.
//  - LEWAT_WAKTU   (merah)  waktu ujian + toleransi sudah lewat. Terus tampil
//                           sampai ditutup. Jika masih ada siswa mengerjakan,
//                           pengawas diarahkan memeriksa di Mode Pengawas dulu.
//  - SEMUA_SELESAI (hijau)  semua peserta yang sudah masuk telah selesai.
//                           Bisa ditunda 10 menit lewat tombol "Nanti".
//
// Menutup sesi memakai endpoint yang SUDAH ada (POST
// /api/guru/mode-pengawas/tutup { sesiId }), persis seperti SesiTerlupaPopup
// dan halaman Mode Pengawas. Tidak ada logika penutupan baru di sini.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle, Clock, Eye, RefreshCw, Square } from 'lucide-react'
import { apiRequest } from '@/lib/utils'
import type { SesiPengingat } from '@/lib/pengingat-tutup-sesi'

const INTERVAL_MS = 30_000
const TUNDA_MS = 10 * 60_000

function ringkasPeserta(s: SesiPengingat): string {
  const bagian = [`${s.peserta.selesai} selesai`]
  if (s.peserta.terkunci > 0) bagian.push(`${s.peserta.terkunci} terkunci`)
  return bagian.join(', ')
}

export function PengingatTutupSesi() {
  const router = useRouter()
  const [daftar, setDaftar] = useState<SesiPengingat[]>([])
  const [tunda, setTunda] = useState<Record<string, number>>({})
  // Sesi yang baru saja ditutup dari sini: disembunyikan walau respons polling
  // yang masih "terbang" sempat membawanya kembali (hindari kartu berkedip).
  const [ditutup, setDitutup] = useState<Set<string>>(new Set())
  const [konfirmasi, setKonfirmasi] = useState<SesiPengingat | null>(null)
  const [menutup, setMenutup] = useState(false)
  const [galat, setGalat] = useState<string | null>(null)
  const [sukses, setSukses] = useState<string | null>(null)

  const muat = useCallback(async () => {
    try {
      const res = await apiRequest<{ data: SesiPengingat[] }>('/api/guru/pengingat-tutup-sesi')
      setDaftar(res.data ?? [])
    } catch {
      // Offline / gagal: pertahankan data terakhir, jangan ganggu pengawas dengan error.
    }
  }, [])

  useEffect(() => {
    void muat()
    const timer = setInterval(() => { if (!document.hidden) void muat() }, INTERVAL_MS)
    const saatTampil = () => { if (!document.hidden) void muat() }
    document.addEventListener('visibilitychange', saatTampil)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', saatTampil)
    }
  }, [muat])

  async function jalankanTutup() {
    if (!konfirmasi) return
    const s = konfirmasi
    setMenutup(true)
    setGalat(null)
    try {
      await apiRequest('/api/guru/mode-pengawas/tutup', {
        method: 'POST',
        body: JSON.stringify({ sesiId: s.sesiId }),
      })
      setDitutup(prev => new Set(prev).add(s.sesiId))
      setDaftar(prev => prev.filter(x => x.sesiId !== s.sesiId))
      setKonfirmasi(null)
      setSukses(`Sesi ${s.namaMapel} kelas ${s.namaKelas} berhasil ditutup.`)
      setTimeout(() => setSukses(null), 6000)
      void muat()
    } catch (e) {
      setGalat(e instanceof Error ? e.message : 'Gagal menutup sesi')
    } finally {
      setMenutup(false)
    }
  }

  const sekarang = Date.now()
  const tampil = daftar.filter(
    s => !ditutup.has(s.sesiId) && (s.jenis !== 'SEMUA_SELESAI' || (tunda[s.sesiId] ?? 0) <= sekarang)
  )

  if (tampil.length === 0 && !sukses) return null

  return (
    <div className="space-y-2 mb-4" role="status" aria-live="polite">
      {sukses && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          <CheckCircle className="w-4 h-4 flex-shrink-0" /> {sukses}
        </div>
      )}

      {tampil.map(s => {
        const merah = s.jenis !== 'SEMUA_SELESAI'
        const sedangMengerjakan = s.peserta.aktif + s.peserta.reset
        const judul =
          s.jenis === 'KEMARIN'
            ? `Sesi ${s.labelTanggal} belum ditutup`
            : s.jenis === 'LEWAT_WAKTU'
              ? 'Waktu ujian sudah lewat, sesi belum ditutup'
              : 'Semua peserta sudah selesai'

        let keterangan: string
        if (s.jenis === 'SEMUA_SELESAI') {
          keterangan = `${ringkasPeserta(s)}.${
            s.peserta.belumMasuk && s.peserta.belumMasuk > 0
              ? ` ${s.peserta.belumMasuk} siswa belum pernah masuk.`
              : ''
          } Tutup sesi sekarang?`
        } else if (s.jenis === 'KEMARIN') {
          keterangan = sedangMengerjakan > 0
            ? `${sedangMengerjakan} siswa masih berstatus mengerjakan. Karena sudah lewat hari, kemungkinan mereka tidak melanjutkan. Jika sesi ditutup, mereka dinilai otomatis dari jawaban yang sempat tersimpan.`
            : 'Semua peserta sudah selesai. Segera tutup agar nilai masuk ke rekap.'
        } else {
          keterangan = sedangMengerjakan > 0
            ? `Masih ada ${sedangMengerjakan} siswa berstatus mengerjakan. Periksa dulu di Mode Pengawas sebelum menutup sesi.`
            : 'Tidak ada siswa yang sedang mengerjakan. Segera tutup agar nilai masuk ke rekap.'
        }

        return (
          <div
            key={s.sesiId}
            className={`rounded-xl border px-4 py-3 ${
              merah ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'
            }`}
          >
            <div className="flex items-start gap-3">
              {merah
                ? <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                : <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />}
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-bold ${merah ? 'text-red-800' : 'text-emerald-800'}`}>{judul}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600">
                  <span className="font-semibold text-slate-800">{s.namaMapel}</span>
                  <span>Kelas {s.namaKelas}</span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" /> mulai {s.labelJamMulai}
                  </span>
                  {s.isSusulan && <span className="font-semibold text-purple-700">Susulan</span>}
                </div>
                <p className={`mt-1.5 text-xs ${merah ? 'text-red-700' : 'text-emerald-700'}`}>{keterangan}</p>

                <div className="mt-2.5 flex flex-wrap gap-2">
                  {s.bolehTutupLangsung ? (
                    <button
                      type="button"
                      onClick={() => { setGalat(null); setKonfirmasi(s) }}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors ${
                        merah ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
                      }`}
                    >
                      <Square className="w-3 h-3" /> Tutup Sesi
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => router.push('/guru/mode-pengawas')}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800"
                    >
                      <Eye className="w-3 h-3" /> Buka Mode Pengawas
                    </button>
                  )}
                  {s.jenis === 'SEMUA_SELESAI' && (
                    <button
                      type="button"
                      onClick={() => setTunda(prev => ({ ...prev, [s.sesiId]: Date.now() + TUNDA_MS }))}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
                    >
                      Nanti
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })}

      {konfirmasi && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle className="h-6 w-6 text-red-600" />
            </div>
            <h3 className="mb-2 text-center text-lg font-bold text-slate-900">Tutup Sesi Ujian?</h3>
            <p className="mb-3 text-center text-sm text-slate-500">
              <strong>{konfirmasi.namaMapel}</strong> — Kelas {konfirmasi.namaKelas}
            </p>
            <ul className="mb-4 space-y-1.5 text-xs text-slate-600">
              {konfirmasi.peserta.aktif + konfirmasi.peserta.reset > 0 && (
                <li className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
                  {konfirmasi.peserta.aktif + konfirmasi.peserta.reset} siswa masih berstatus mengerjakan dan akan
                  dinilai otomatis dari jawaban yang sempat tersimpan.
                </li>
              )}
              {konfirmasi.peserta.belumMasuk != null && konfirmasi.peserta.belumMasuk > 0 && (
                <li className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
                  {konfirmasi.peserta.belumMasuk} siswa belum pernah masuk dan tidak akan bisa mengikuti sesi ini
                  lagi setelah ditutup.
                </li>
              )}
              <li className="px-1">Nilai siswa akan diproses dan masuk ke rekap nilai.</li>
            </ul>
            {galat && (
              <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{galat}</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setKonfirmasi(null)}
                disabled={menutup}
                className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => { void jalankanTutup() }}
                disabled={menutup}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {menutup && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                {menutup ? 'Menutup...' : 'Ya, Tutup Sesi'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
