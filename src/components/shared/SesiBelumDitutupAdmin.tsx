'use client'

// Kartu "Sesi Belum Ditutup" di Dashboard Admin (dipasang di src/app/admin/page.tsx).
//
// Menampilkan sesi yang SUDAH MELEWATI waktunya tapi belum ditutup pengawas
// (dari hari kemarin, atau waktu ujian + toleransi 30 menit sudah lewat),
// lengkap dengan nama pengawas dan tombol WhatsApp untuk menghubunginya
// (nomor HP dari data guru). Admin juga bisa menutup paksa langsung dari sini.
//
// Tidak tampil sama sekali jika tidak ada sesi yang perlu perhatian, jadi
// dashboard tetap bersih. Menyegarkan diri tiap 60 detik.
//
// Tutup paksa memakai endpoint yang SUDAH ada (POST /api/admin/sesi/[id]/tutup-paksa,
// logika sama persis dengan tombol "Tutup Paksa" di panel pemantauan). Tidak
// ada logika penutupan baru di sini.

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle, MessageCircle, RefreshCw, Square, User } from 'lucide-react'
import { apiRequest } from '@/lib/utils'
import { linkWhatsApp, pesanWhatsAppPengawas, type SesiPengingat } from '@/lib/pengingat-tutup-sesi'

const INTERVAL_MS = 60_000

export function SesiBelumDitutupAdmin() {
  const [daftar, setDaftar] = useState<SesiPengingat[]>([])
  const [konfirmasiId, setKonfirmasiId] = useState<string | null>(null)
  const [prosesId, setProsesId] = useState<string | null>(null)
  // Sesi yang baru saja ditutup dari sini: disembunyikan walau respons polling
  // yang masih "terbang" sempat membawanya kembali.
  const [ditutup, setDitutup] = useState<Set<string>>(new Set())
  const [pesan, setPesan] = useState<{ teks: string; galat: boolean } | null>(null)

  const muat = useCallback(async () => {
    try {
      const res = await apiRequest<{ data: SesiPengingat[] }>('/api/admin/sesi-belum-ditutup')
      setDaftar(res.data ?? [])
    } catch {
      // Gagal/offline: pertahankan data terakhir, jangan ganggu dashboard.
    }
  }, [])

  useEffect(() => {
    void muat()
    const timer = setInterval(() => { if (!document.hidden) void muat() }, INTERVAL_MS)
    return () => clearInterval(timer)
  }, [muat])

  async function tutupPaksa(s: SesiPengingat) {
    setProsesId(s.sesiId)
    setPesan(null)
    try {
      const res = await apiRequest<{ jumlahSiswaDinilaiOtomatis?: number }>(
        `/api/admin/sesi/${s.sesiId}/tutup-paksa`,
        { method: 'POST' }
      )
      const n = res?.jumlahSiswaDinilaiOtomatis ?? 0
      setPesan({
        teks: n > 0
          ? `Sesi ditutup. ${n} siswa dinilai otomatis dari jawaban tersinkron.`
          : 'Sesi berhasil ditutup.',
        galat: false,
      })
      setDitutup(prev => new Set(prev).add(s.sesiId))
      setDaftar(prev => prev.filter(x => x.sesiId !== s.sesiId))
      void muat()
    } catch (e) {
      setPesan({ teks: e instanceof Error ? e.message : 'Gagal menutup sesi', galat: true })
    } finally {
      setProsesId(null)
      setKonfirmasiId(null)
      setTimeout(() => setPesan(null), 7000)
    }
  }

  const tampil = daftar.filter(s => !ditutup.has(s.sesiId))
  if (tampil.length === 0 && !pesan) return null

  return (
    <div className="rounded-2xl border border-red-200 bg-white shadow-sm">
      <div className="flex items-start gap-3 border-b border-red-100 bg-red-50 px-4 py-3 rounded-t-2xl">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-red-800">
            Sesi Belum Ditutup{tampil.length > 0 ? ` (${tampil.length})` : ''}
          </h2>
          <p className="text-xs text-red-700">
            Sesi berikut sudah melewati waktunya tetapi belum ditutup pengawas. Hubungi pengawasnya, atau tutup paksa jika tidak bisa dihubungi.
          </p>
        </div>
      </div>

      {pesan && (
        <div
          className={`mx-4 mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
            pesan.galat ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'
          }`}
        >
          {!pesan.galat && <CheckCircle className="h-4 w-4 flex-shrink-0" />} {pesan.teks}
        </div>
      )}

      <ul className="divide-y divide-slate-100">
        {tampil.map(s => {
          const wa = linkWhatsApp(
            s.pengawas.noHp,
            pesanWhatsAppPengawas({
              namaPengawas: s.pengawas.nama,
              namaMapel: s.namaMapel,
              namaKelas: s.namaKelas,
              labelTanggal: s.labelTanggal,
            })
          )
          const sedangMengerjakan = s.peserta.aktif + s.peserta.reset
          const konfirmasi = konfirmasiId === s.sesiId
          const proses = prosesId === s.sesiId

          return (
            <li key={s.sesiId} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{s.namaMapel}</span>
                    <span className="text-xs text-slate-500">Kelas {s.namaKelas}</span>
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
                        s.kemarin ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {s.kemarin ? 'Hari kemarin' : 'Waktu lewat'}
                    </span>
                    {s.semuaSelesai && (
                      <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                        Semua peserta selesai
                      </span>
                    )}
                    {s.isSusulan && (
                      <span className="rounded-md bg-purple-50 px-1.5 py-0.5 text-[11px] font-semibold text-purple-700">
                        Susulan
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {s.labelTanggal}, mulai {s.labelJamMulai} ·{' '}
                    {sedangMengerjakan > 0 ? `${sedangMengerjakan} masih mengerjakan, ` : ''}
                    {s.peserta.selesai} selesai
                  </div>
                  <div className="mt-1 inline-flex items-center gap-1.5 text-xs text-slate-700">
                    <User className="h-3 w-3 text-slate-400" />
                    Pengawas: <strong>{s.pengawas.nama}</strong>
                    {s.pengawas.noHp && <span className="text-slate-500">({s.pengawas.noHp})</span>}
                  </div>
                </div>

                <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
                  {wa ? (
                    <a
                      href={wa}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700"
                    >
                      <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                    </a>
                  ) : (
                    <span className="text-[11px] text-slate-400">
                      {s.pengawas.noHp ? 'Nomor HP tidak valid' : 'Nomor HP belum diisi'}
                    </span>
                  )}
                  {!konfirmasi && (
                    <button
                      type="button"
                      onClick={() => setKonfirmasiId(s.sesiId)}
                      disabled={proses}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                    >
                      <Square className="h-3 w-3" /> Tutup Paksa
                    </button>
                  )}
                </div>
              </div>

              {konfirmasi && (
                <div className="mt-2.5 rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-xs text-red-800">
                    Yakin menutup paksa sesi ini?
                    {sedangMengerjakan > 0 &&
                      ` ${sedangMengerjakan} siswa yang masih berstatus mengerjakan akan dinilai otomatis dari jawaban yang sempat tersinkron.`}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => { void tutupPaksa(s) }}
                      disabled={proses}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                    >
                      {proses && <RefreshCw className="h-3 w-3 animate-spin" />}
                      {proses ? 'Menutup...' : 'Ya, Tutup Paksa'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setKonfirmasiId(null)}
                      disabled={proses}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Batal
                    </button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
