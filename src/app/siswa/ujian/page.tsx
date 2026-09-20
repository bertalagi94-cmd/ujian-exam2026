'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { BookOpen, Clock, AlertTriangle, CheckCircle, ChevronLeft, ChevronRight, Send, Maximize, KeyRound, LogOut, RefreshCw, Calendar, CheckCircle2 } from 'lucide-react'
import { apiRequest } from '@/lib/utils'
import { startExamLock, endExamLock } from '@/lib/exam-lock'
import { Soal } from '@/types'
import { Confirm, Spinner } from '@/components/ui'
import {
  simpanAmplop, ambilAmplop, bukaAmplop,
  ambilStatusOffline, simpanStatusOffline, hapusStatusOffline,
  EnkripsiTidakDidukungError,
} from '@/lib/essay-amplop-client'
import { PANJANG_KODE_DARURAT, type EssayAmplop } from '@/lib/essay-amplop-shared'
import { mergeJawabanRevisi, nextRevisi, type EntriServer, type EntriLokal } from '@/lib/jawaban-merge'
import {
  simpanKlaimPgSelesaiOffline, ambilKlaimPgSelesaiOffline, hapusKlaimPgSelesaiOffline,
} from '@/lib/pg-offline-client'

type Phase = 'CEK_JADWAL' | 'PERSIAPAN' | 'KODE' | 'UJIAN' | 'ESSAY_INFO' | 'ESSAY_KERJAKAN' | 'SELESAI' | 'RESET_KODE'

interface JadwalHariIni {
  id: string
  nama_mapel: string
  tanggal: string
  jam_mulai: string
  jam_selesai: string
  durasi: number
  sesi: number
  status: string
  sudah_ikut: boolean
  // FIX BUG (siswa yang sudah selesai ujian hari ini melihat "Tidak Ada
  // Ujian Hari Ini" tanpa keterangan): dipakai untuk menampilkan mapel yang
  // sudah dikerjakan + link ke menu Nilai. Field ini sudah lama dikirim
  // oleh /api/siswa/jadwal/route.ts, tapi sebelumnya tidak pernah dibaca
  // sama sekali di halaman ini.
  nilai_id?: string | null
  // FIX (fitur essay): lihat komentar di src/app/api/siswa/jadwal/route.ts —
  // dipakai untuk mengarahkan siswa langsung ke fase essay setelah refresh
  // browser, tanpa perlu memasukkan kode ujian lagi.
  essayPending?: boolean
  sesiIdEssayPending?: string | null
}

interface SesiInfo {
  sesiId: string
  mapelId: string
  namaMapel: string
  kelas: string
  durasi: number
  waktu_mulai: string
  soalList: SoalUjian[]
  minSubmitMenit: number  // 0 = tidak ada batas
}

interface SoalUjian extends Soal {
  nomor: number
}

interface JawabanMap { [soalId: string]: string }

// ── Tipe untuk fase essay (fitur essay) ───────────────────────────────────
interface EssayInfo {
  namaMapel: string
  namaGuru: string | null
  jumlahSoal: number
  durasiMenit: number
  modeJawaban: 'DIGITAL' | 'KERTAS'
  instruksi: string | null
  statusEssay: string
  // Toggle global per sesi (lihat 11_akses_mulai_essay.sql) — selama false,
  // tombol "Mulai" di halaman ini harus nonaktif menunggu pengawas.
  aksesMulaiDibuka?: boolean
}

interface SoalEssay {
  id: string
  teks: string
  gambar_url: string | null
  urutan: number
}

interface JawabanEssayMap { [soalEssayId: string]: string }

interface HasilAkhir { id?: string; nilai: number; benar: number; total: number; grade: string; lulus: boolean; kkm: number }

// ── Fullscreen helpers ────────────────────────────────────────────────────────
function requestFullscreen(el: Element) {
  if (el.requestFullscreen) return el.requestFullscreen()
  const anyEl = el as unknown as Record<string, () => Promise<void>>
  if (anyEl.webkitRequestFullscreen) return anyEl.webkitRequestFullscreen()
  if (anyEl.mozRequestFullScreen) return anyEl.mozRequestFullScreen()
  if (anyEl.msRequestFullscreen) return anyEl.msRequestFullscreen()
  return Promise.resolve()
}

function exitFullscreen() {
  if (document.exitFullscreen) return document.exitFullscreen()
  const anyDoc = document as unknown as Record<string, () => Promise<void>>
  if (anyDoc.webkitExitFullscreen) return anyDoc.webkitExitFullscreen()
  if (anyDoc.mozCancelFullScreen) return anyDoc.mozCancelFullScreen()
  if (anyDoc.msExitFullscreen) return anyDoc.msExitFullscreen()
  return Promise.resolve()
}

function isFullscreen() {
  const anyDoc = document as unknown as Record<string, Element | null>
  return !!(
    document.fullscreenElement ||
    anyDoc.webkitFullscreenElement ||
    anyDoc.mozFullScreenElement ||
    anyDoc.msFullscreenElement
  )
}

// FIX: browser/device tertentu (paling umum: Safari di iPhone/iPad) tidak
// mendukung Fullscreen API untuk elemen sembarang sama sekali — requestFullscreen()
// akan selalu gagal diam-diam di sana (semua pemanggilnya dibungkus .catch(() => {})).
// Dipakai untuk membedakan dua pesan ke siswa: "coba lagi" (kalau device mendukung
// tapi izinnya belum diberikan/gagal sesaat) vs "device Anda memang tidak
// mendukung" (kalau API-nya tidak ada sama sekali) — supaya siswa tidak diberi
// tombol "coba lagi" yang percuma di device yang memang tidak akan pernah berhasil.
function isFullscreenSupported() {
  const el = document.documentElement as unknown as Record<string, unknown>
  const doc = document as unknown as Record<string, unknown>
  return !!(
    el.requestFullscreen || el.webkitRequestFullscreen ||
    el.mozRequestFullScreen || el.msRequestFullscreen
  ) && (
    doc.fullscreenEnabled !== false // beberapa browser expose flag ini; kalau eksplisit false, jangan izinkan
  )
}

// ── Backup lokal jawaban ──────────────────────────────────────────────────
// Cadangan di localStorage (selain di server) supaya kalau tab/browser ter-reload
// tiba-tiba di tengah ujian, jawaban yang BELUM sempat sync ke server tidak hilang
// total dari sisi siswa — bisa direkonsiliasi ulang saat sesi dibuka kembali.
//
// FIX BUG (P1-01 — backup lokal SELALU menang saat resume, walau sudah basi):
// sebelumnya backup ini cuma menyimpan {soal_id: jawaban} TANPA jam berapa
// jawaban itu terakhir diubah. resumeJawaban() lalu selalu melakukan
// `{...dariServer, ...dariBackupLokal}` — backup lokal MENANG mutlak untuk
// setiap soal yang ada di dalamnya, apa pun isinya. Ini benar untuk kasus
// "reload di device yang sama" (backup memang representasi pilihan TERAKHIR
// siswa yang belum sempat ke server), tapi SALAH untuk kasus lintas-device:
//   1. Device A jawab No.10 = A, sudah ter-sync ke server.
//   2. Device A idle/mati >2 menit → device lain (B) diizinkan mengambil alih
//      (lihat DEVICE_STALE_MS di validasi/route.ts).
//   3. Di Device B, siswa ubah No.10 jadi C, ter-sync (server sekarang = C).
//   4. Siswa balik pakai Device A. localStorage Device A MASIH menyimpan
//      backup lama (No.10 = A) — tidak pernah tahu server sudah berubah.
//   5. resumeJawaban() di Device A: {...server(C), ...backupLama(A)} → hasil
//      A, MENIMPA BALIK jawaban C yang sebenarnya paling baru & sudah benar.
//
// FIX: backup sekarang menyimpan JAM setiap jawaban terakhir diubah DI
// DEVICE INI (`t`), bukan cuma nilainya (`v`). Server juga sudah punya
// `updated_at` per baris jawaban (kolom yang sudah ada, sekarang ikut
// dikembalikan oleh GET /api/siswa/ujian/sync — lihat route.ts). Saat resume,
// untuk tiap soal yang backup DAN server sama-sama punya, yang dipakai
// adalah yang REVISINYA LEBIH TINGGI (lihat mergeJawabanRevisi di
// src/lib/jawaban-merge.ts — FIX BUG P1), bukan otomatis backup lokal, dan
// bukan lagi jam sebagai pembanding utama (lihat komentar FIX BUG P1 di
// dekat jawabanRevisiRef). Jam (`t`) tetap disimpan sebagai fallback untuk
// data lama yang belum punya revisi (`r`). Format lama (flat map tanpa `t`)
// tetap bisa dibaca (dianggap jam 0, revisi 0) supaya backup yang sudah
// lebih dulu tersimpan di browser siswa (dari sebelum fix ini) tidak hilang
// percuma.
interface BackupJawaban<T extends Record<string, string> = JawabanMap> {
  v: T
  t: Record<string, number>
  r?: Record<string, number>
}
function backupKey(sesiId: string, nis: string) {
  return `ujian_backup_${sesiId}_${nis}`
}
function saveBackup(sesiId: string, nis: string, jawaban: JawabanMap, ts: Record<string, number>, revisi?: Record<string, number>) {
  try {
    const payload: BackupJawaban = { v: jawaban, t: ts, r: revisi }
    localStorage.setItem(backupKey(sesiId, nis), JSON.stringify(payload))
  } catch { /* abaikan */ }
}
function loadBackup(sesiId: string, nis: string): BackupJawaban {
  try {
    const raw = localStorage.getItem(backupKey(sesiId, nis))
    if (!raw) return { v: {}, t: {}, r: {} }
    const parsed = JSON.parse(raw)
    // Backward-compat: format lama adalah flat map {soal_id: jawaban} tanpa
    // pembungkus {v, t}. Kalau field `v` tidak ada, anggap seluruh objek itu
    // sendiri adalah peta jawaban lama, dengan jam 0 (paling lama, supaya
    // versi manapun dari server yang punya jam asli akan menang).
    if (parsed && typeof parsed === 'object' && 'v' in parsed) {
      return { v: parsed.v ?? {}, t: parsed.t ?? {}, r: parsed.r ?? {} }
    }
    return { v: parsed ?? {}, t: {}, r: {} }
  } catch { return { v: {}, t: {}, r: {} } }
}
function clearBackup(sesiId: string, nis: string) {
  try { localStorage.removeItem(backupKey(sesiId, nis)) } catch { /* abaikan */ }
}

// ── Merge jawaban server vs lokal berdasarkan JAM — HANYA dipakai untuk ESSAY ──
// FIX BUG P1 (PG): untuk PG, fungsi ini SUDAH DIGANTI oleh mergeJawabanRevisi()
// di src/lib/jawaban-merge.ts (lihat resumeJawaban di bawah) karena
// perbandingan jam client-vs-server-menerima-request terbukti bisa salah —
// lihat komentar lengkap FIX BUG P1 di dekat jawabanRevisiRef. Essay masih
// memakai fungsi jam ini apa adanya karena jawaban_essay belum punya kolom
// revisi di server (lihat 07_essay.sql) — risiko yang sama secara teori
// masih ada untuk essay, tapi di luar cakupan temuan audit P1 ini yang
// spesifik membahas src/app/api/siswa/ujian/sync/route.ts untuk PG.
function mergeJawabanDenganWaktu<T extends Record<string, string>>(
  server: T,
  serverTs: Record<string, number>,
  lokal: T,
  lokalTs: Record<string, number>,
): { merged: T; ts: Record<string, number> } {
  const merged = {} as T
  const ts: Record<string, number> = {}
  const semuaKey = new Set([...Object.keys(server), ...Object.keys(lokal)])
  semuaKey.forEach(k => {
    const adaServer = Object.prototype.hasOwnProperty.call(server, k)
    const adaLokal = Object.prototype.hasOwnProperty.call(lokal, k)
    if (adaServer && adaLokal) {
      const tServer = serverTs[k] ?? 0
      const tLokal = lokalTs[k] ?? 0
      if (tLokal > tServer) {
        ;(merged as Record<string, string>)[k] = lokal[k]
        ts[k] = tLokal
      } else {
        ;(merged as Record<string, string>)[k] = server[k]
        ts[k] = tServer
      }
    } else if (adaLokal) {
      ;(merged as Record<string, string>)[k] = lokal[k]
      ts[k] = lokalTs[k] ?? Date.now()
    } else {
      ;(merged as Record<string, string>)[k] = server[k]
      ts[k] = serverTs[k] ?? 0
    }
  })
  return { merged, ts }
}

// ── Device ID — identitas unik per browser/device ────────────────────────
// Dibuat sekali, disimpan di localStorage, dipakai konsisten sepanjang sesi.
// Digunakan server untuk mendeteksi login ganda dari device berbeda.
function getDeviceId(): string {
  try {
    const stored = localStorage.getItem('ujian_device_id')
    if (stored) return stored
    const id = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    localStorage.setItem('ujian_device_id', id)
    return id
  } catch {
    return `dev_fallback_${Math.random().toString(36).slice(2, 9)}`
  }
}

export default function SiswaUjianPage() {
  const [phase, setPhase] = useState<Phase>('CEK_JADWAL')
  const [jadwalHariIni, setJadwalHariIni] = useState<JadwalHariIni[]>([])
  const [jadwalTerpilih, setJadwalTerpilih] = useState<JadwalHariIni | null>(null)
  const [loadingJadwal, setLoadingJadwal] = useState(true)
  const [jadwalTerdekat, setJadwalTerdekat] = useState<JadwalHariIni | null>(null)
  const [sesiSudahTutup, setSesiSudahTutup] = useState<JadwalHariIni[]>([])
  // FIX BUG (siswa yang sudah selesai ujian hari ini melihat "Tidak Ada
  // Ujian Hari Ini" tanpa keterangan relevan): sebelumnya jadwal yang
  // `sudah_ikut === true` dibuang begitu saja dari SEMUA daftar (baik
  // `jadwalHariIni` maupun `sesiSudahTutup`), jadi begitu siswa sudah
  // menyelesaikan satu-satunya ujian hari itu, dia tidak masuk kategori
  // manapun dan halaman jatuh ke pesan generik seolah memang tidak ada
  // jadwal sama sekali — padahal jadwalnya ADA, cuma sudah dikerjakan.
  // State ini menampung jadwal hari ini yang sudah diikuti siswa, supaya
  // bisa ditampilkan dengan keterangan yang relevan (lihat cekJadwal() &
  // handleRefreshJadwal()).
  const [sudahDiselesaikanHariIni, setSudahDiselesaikanHariIni] = useState<JadwalHariIni[]>([])
  const [kode, setKode] = useState('')
  const [sesiInfo, setSesiInfo] = useState<SesiInfo | null>(null)
  const [jawaban, setJawaban] = useState<JawabanMap>({})
  const [currentIdx, setCurrentIdx] = useState(0)
  const [sisaWaktu, setSisaWaktu] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmSelesai, setConfirmSelesai] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [hasilNilai, setHasilNilai] = useState<HasilAkhir | null>(null)

  // ── State fase ESSAY (fitur essay) ────────────────────────────────────────
  // KKM dibawa dari response /selesai (lanjutEssay:true) supaya bisa dipakai
  // lagi saat menampilkan hasil PG di layar SELESAI setelah essay dikirim.
  const [kkmAwal, setKkmAwal] = useState<number>(75)
  const [essayInfo, setEssayInfo] = useState<EssayInfo | null>(null)
  const [loadingEssayInfo, setLoadingEssayInfo] = useState(false)
  const [errorEssay, setErrorEssay] = useState('')
  const [essayList, setEssayList] = useState<SoalEssay[]>([])
  const [loadingEssaySoal, setLoadingEssaySoal] = useState(false)
  const [jawabanEssay, setJawabanEssay] = useState<JawabanEssayMap>({})
  const [essayCurrentIdx, setEssayCurrentIdx] = useState(0)
  const [sisaWaktuEssay, setSisaWaktuEssay] = useState(0)
  const [essaySyncStatus, setEssaySyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle')
  // Mode KERTAS
  const [essayWaktuHabisPopup, setEssayWaktuHabisPopup] = useState(false) // mode KERTAS: waktu habis, TIDAK auto-lock, hanya beri tahu + bunyi
  // Kirim essay
  const [confirmKirimEssay, setConfirmKirimEssay] = useState(false)
  const [submittingEssay, setSubmittingEssay] = useState(false)
  const [nilaiPgSetelahEssay, setNilaiPgSetelahEssay] = useState<{ id?: string; benar: number; total: number; kkm: number } | null>(null)
  // true = siswa baru saja mengirim essay — halaman SELESAI harus menampilkan
  // tampilan "menunggu koreksi guru" (bukan lulus/grade seperti ujian biasa,
  // karena nilai_total memang belum ada sampai guru mengoreksi & merilis).
  const [essaySelesaiDikirim, setEssaySelesaiDikirim] = useState(false)
  // FIX BUG P1 (jawaban essay bisa hilang saat "Kirim"): dipakai untuk
  // menampilkan peringatan di layar "Ujian Selesai" khusus kasus auto-submit
  // karena waktu habis SEKALIGUS autosave terakhir gagal — lihat
  // handleKirimEssay(). Kasus non-timeout tidak butuh ini karena sudah
  // dihentikan lebih dulu (siswa diminta coba kirim ulang, belum SELESAI).
  const [essaySyncGagalSaatTimeout, setEssaySyncGagalSaatTimeout] = useState(false)

  // ── Jalur essay OFFLINE (amplop terenkripsi + kode darurat dari pengawas) ──
  // Lihat src/lib/essay-amplop-client.ts. Gerbang izin essay TETAP dipertahankan:
  // kode darurat hanya berlaku kalau internet benar-benar bermasalah, dan
  // hanya bisa membuka soal yang sudah terkirim (terenkripsi) sebelumnya.
  const [jaringanBermasalah, setJaringanBermasalah] = useState(false)
  const [amplopTersedia, setAmplopTersedia] = useState(false)
  // Ref padanan amplopTersedia: handleSelesai() dipanggil dari closure lama
  // (timer auto-submit via setTimeout) sehingga membaca state langsung bisa
  // basi. Ref ini selalu terkini.
  const amplopTersediaRef = useRef(false)
  useEffect(() => { amplopTersediaRef.current = amplopTersedia }, [amplopTersedia])
  const [kodeDarurat, setKodeDarurat] = useState('')
  const [kodeDaruratError, setKodeDaruratError] = useState('')
  const [kodeDaruratLoading, setKodeDaruratLoading] = useState(false)
  // Kunci UI sementara setelah beberapa kali salah — hanya kosmetik (anti
  // salah pencet), BUKAN pengaman: penyerang yang tahu cara memanggil
  // fungsi dekripsi langsung tidak melewati UI ini. Pengaman sebenarnya ada
  // di kelambatan PBKDF2 + panjang kode (lihat essay-amplop-shared.ts).
  const [kodeDaruratKunciSampai, setKodeDaruratKunciSampai] = useState(0)

  // ── Status sinkronisasi jawaban ke server ─────────────────────────────────
  // 'idle' = belum ada perubahan yang perlu disinkron
  // 'syncing' = sedang mencoba kirim ke server
  // 'synced' = percobaan sync terakhir berhasil dikonfirmasi server
  // 'error' = sudah dicoba berulang kali (dengan backoff) tapi tetap gagal
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle')
  const [syncErrorMsg, setSyncErrorMsg] = useState('')
  // Modal pemblokir saat siswa klik "Selesai" tapi verifikasi jumlah jawaban
  // tersimpan di server TIDAK cocok dengan jumlah yang dijawab di lokal.
  // Ujian TIDAK akan dinilai sampai ini terverifikasi cocok (atau siswa retry manual berhasil).
  const [showSyncFailModal, setShowSyncFailModal] = useState(false)
  const [syncFailInfo, setSyncFailInfo] = useState<{ expected: number; synced: number }>({ expected: 0, synced: 0 })
  // FIX BUG P0 (offline PG -> Essay): true kalau semua jawaban PG SUDAH
  // terverifikasi tersimpan di server tapi panggilan finalisasi (POST
  // /selesai) sendiri gagal murni karena jaringan. Lihat pg-offline-client.ts
  // dan komentar di handleSelesai/renderSyncFailModal di bawah.
  const [pgSelesaiOfflinePending, setPgSelesaiOfflinePending] = useState(false)
  // FIX (offline PG -> Essay, jalur "Selesai" saat internet SUDAH mati): true =
  // semua jawaban PG sudah dikonfirmasi server (kasus lama: hanya finalisasi
  // yang gagal). false = jawaban PG baru DIAMANKAN DI PERANGKAT dan belum
  // pernah dikonfirmasi server — UI TIDAK BOLEH bilang "sudah tersimpan di
  // server" pada kondisi ini. Di-set true lagi oleh retry background begitu
  // syncJawaban() terverifikasi.
  const [pgOfflineTerkonfirmasi, setPgOfflineTerkonfirmasi] = useState(true)
  // FIX (celah "terjebak di PG setelah reload"): true kalau server MENOLAK
  // finalisasi PG secara permanen (409: waktu PG sudah lewat / sesi tidak
  // berjalan; 404) padahal siswa punya klaim PG-selesai offline. Loop retry
  // berhenti, tapi klaim & kotak kode darurat TETAP ditampilkan supaya siswa
  // masih bisa lanjut ke Essay — /essay/mulai (jalur darurat) tidak
  // bergantung pada /selesai.
  const [pgFinalisasiDitolak, setPgFinalisasiDitolak] = useState(false)
  // Mencegah dua pemicu (timer auto-submit & retry background) sama-sama
  // melompat ke Essay dengan kode tersimpan pada saat yang sama.
  const lanjutEssayBerjalanRef = useRef(false)
  const [manualRetrying, setManualRetrying] = useState(false)

  // FIX: sebelumnya saat pengawas menutup sesi mendadak, siswa tidak mendapat
  // pemberitahuan apa pun — tombol "Selesai" hanya diam-diam jadi nonaktif
  // (karena terjebak loop verifikasi sync yang pasti gagal terus, sebab server
  // menolak sync setelah sesi ditutup) sehingga aplikasi terlihat "hang".
  // Sekarang ditampilkan notifikasi jelas begitu sesi ditutup paksa.
  const [sesiDitutupPaksa, setSesiDitutupPaksa] = useState(false)

  // Fullscreen & anti-cheat state
  const [isFS, setIsFS] = useState(false)
  // FIX: sebelumnya isFS dilacak tapi tidak pernah dipakai di UI, dan kalau
  // requestFullscreen() gagal (device tidak didukung / permintaan ditolak
  // browser), kegagalan itu dibuang diam-diam tanpa jejak apapun ke siswa.
  // Sekarang dipakai untuk menampilkan banner + tombol retry manual.
  const [fsSupported] = useState(() => (typeof document !== 'undefined' ? isFullscreenSupported() : true))
  const [warningMsg, setWarningMsg] = useState('')
  const [showWarningOverlay, setShowWarningOverlay] = useState(false)

  // Reset kode state (siswa harus masukkan kode dari pengawas)
  const [kodeReset, setKodeReset] = useState('')
  const [kodeResetError, setKodeResetError] = useState('')
  const [kodeResetLoading, setKodeResetLoading] = useState(false)
  const [pendingResetSesiId, setPendingResetSesiId] = useState<string | null>(null)

  // Logout paksa karena pelanggaran melebihi batas
  const [diambilAlihDevice, setDiambilAlihDevice] = useState(false)
  const [dikeluarkan, setDikeluarkan] = useState(false)
  const [batasPelanggaran, setBatasPelanggaran] = useState(3)
  // FIX BUG (layar "Ujian Dihentikan" selalu bunyi "melanggar {batas} kali"
  // walau siswa baru melanggar 1x): simpan jumlah pelanggaran ASLI siswa
  // (dari server) di sini, dipakai sebagai pengganti batasPelanggaran saat
  // menampilkan pesan di layar dikeluarkan. null berarti belum diketahui —
  // fallback ke batasPelanggaran seperti perilaku lama.
  const [jumlahPelanggaran, setJumlahPelanggaran] = useState<number | null>(null)

  // Waktu terpakai (detik) — diupdate tiap detik bersama countdown,
  // digunakan untuk menegakkan batas minimal waktu sebelum submit.
  const [waktuTerpakai, setWaktuTerpakai] = useState(0)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const syncRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sesiPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pelanggRef = useRef(0)
  const pelanggaranActiveRef = useRef(false)
  const jawabanRef = useRef<JawabanMap>({})
  // FIX BUG (P1-01): jam (ms epoch) terakhir tiap soal_id diubah DI DEVICE
  // INI. Diisi lewat setJawabanDenganWaktu() di bawah — lihat penjelasan
  // lengkap di komentar BackupJawaban/mergeJawabanDenganWaktu di atas.
  const jawabanTsRef = useRef<Record<string, number>>({})
  // FIX BUG P1 (merge timestamp client vs server tidak setara — lihat audit
  // "mergeJawabanDenganWaktu"): nomor revisi per soal_id, naik monoton di
  // device ini setiap kali siswa mengubah jawaban. Dipakai menggantikan
  // jawabanTsRef sebagai sumber kebenaran utama untuk resolusi konflik
  // (lihat src/lib/jawaban-merge.ts) — jawabanTsRef tetap dipertahankan
  // hanya sebagai fallback untuk data lama yang belum punya revisi.
  const jawabanRevisiRef = useRef<Record<string, number>>({})
  const sesiInfoRef = useRef<SesiInfo | null>(null)
  const phaseRef = useRef<Phase>('CEK_JADWAL')

  // ── Refs fase ESSAY ────────────────────────────────────────────────────────
  const essayInfoRef = useRef<EssayInfo | null>(null)
  const jawabanEssayRef = useRef<JawabanEssayMap>({})
  // FIX BUG (P1-01, padanan essay): sama seperti jawabanTsRef untuk PG.
  const jawabanEssayTsRef = useRef<Record<string, number>>({})
  const essayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const essaySyncRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const essayAksesMulaiPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // FIX (timer Essay masih basis lokal, rentan drift saat tab di-throttle):
  // referensi waktu mulai essay ABSOLUT dari server (sama seperti
  // sesiInfoRef.waktu_mulai untuk PG) — diisi sekali di masukKeHalamanEssay()
  // dari waktuMulaiEssay yang dikembalikan /essay/mulai (idempotent: baik
  // saat baru menekan "Mulai" maupun saat resume setelah refresh, nilainya
  // selalu waktu_mulai_essay yang tersimpan di server, tidak pernah berubah).
  // Dipakai timer di bawah untuk menghitung ULANG sisa waktu tiap tick dari
  // referensi absolut ini — TIDAK mengubah kapan auto-submit terpicu atau
  // logika penilaian; server (sudahLewatBatasWaktuEssay) tetap sumber
  // kebenaran akhir seperti sebelumnya, ini murni memperbaiki akurasi
  // tampilan & ketepatan waktu pemicu auto-submit di client.
  const waktuMulaiEssayRef = useRef<string | null>(null)
  const rekonsiliasiBerjalanRef = useRef(false)

  useEffect(() => { jawabanRef.current = jawaban }, [jawaban])
  useEffect(() => { sesiInfoRef.current = sesiInfo }, [sesiInfo])
  useEffect(() => { phaseRef.current = phase }, [phase])
  useEffect(() => { essayInfoRef.current = essayInfo }, [essayInfo])
  useEffect(() => { jawabanEssayRef.current = jawabanEssay }, [jawabanEssay])

  // ── Status jaringan untuk gerbang essay offline ───────────────────────────
  // navigator.onLine hanya petunjuk awal (bisa true walau internet mati di
  // belakang Wi-Fi). Sumber kebenaran utama: gagal/berhasilnya request ke
  // server (lihat fetchEssayInfo & polling akses essay).
  useEffect(() => {
    const off = () => setJaringanBermasalah(true)
    const on = () => setJaringanBermasalah(false)
    window.addEventListener('offline', off)
    window.addEventListener('online', on)
    return () => { window.removeEventListener('offline', off); window.removeEventListener('online', on) }
  }, [])

  // ── Ambil "amplop" soal essay terenkripsi SEDINI mungkin ──────────────────
  // Begitu siswa mulai PG (phase UJIAN) — jauh sebelum internet sempat mati di
  // fase essay. Isinya tidak terbaca tanpa kode darurat, jadi aman ada di
  // perangkat. Diulang tiap 20 dtk sampai berhasil (atau server bilang tidak
  // perlu), karena siswa bisa saja baru online belakangan.
  useEffect(() => {
    const sesiId = sesiInfo?.sesiId
    if (!sesiId || (phase !== 'UJIAN' && phase !== 'ESSAY_INFO')) return
    let nis: string | undefined
    try { nis = JSON.parse(localStorage.getItem('user') ?? '{}').nis } catch { /* abaikan */ }
    if (!nis) return
    if (ambilAmplop(sesiId, nis)) { setAmplopTersedia(true); return }

    let batal = false
    const ambil = async () => {
      try {
        const res = await apiRequest<{ ada: boolean; alasan?: string; amplop?: EssayAmplop }>(
          `/api/siswa/ujian/essay/amplop?sesiId=${sesiId}&deviceId=${encodeURIComponent(getDeviceId())}`
        )
        if (batal) return
        if (res.ada && res.amplop) {
          simpanAmplop(sesiId, nis!, res.amplop)
          setAmplopTersedia(true)
          clearInterval(id)
        } else if (res.alasan === 'TANPA_ESSAY' || res.alasan === 'SUDAH_LEWAT') {
          clearInterval(id)
        }
      } catch (e) {
        const status = (e as { status?: number } | undefined)?.status
        if (status === 403 || status === 404 || status === 409) clearInterval(id) // terkunci/ganti perangkat/sesi tutup: tidak ada gunanya mengulang
      }
    }
    const id = setInterval(ambil, 20000)
    void ambil()
    return () => { batal = true; clearInterval(id) }
  }, [sesiInfo?.sesiId, phase])

  // ── Pulihkan klaim "PG selesai offline" setelah tab di-reload ─────────────
  // Kalau siswa me-refresh halaman TEPAT setelah handleSelesai() gagal
  // menghubungi server (lihat pgSelesaiOfflinePending di atas) tapi SEBELUM
  // retry background sempat berhasil, state React-nya hilang (fresh mount)
  // walau klaimnya sendiri sudah tersimpan di localStorage. Tanpa ini siswa
  // kembali terjebak di halaman UJIAN biasa tanpa jalur essay offline.
  // CATATAN: klaim sekarang bisa dibuat SEBELUM server mengonfirmasi jawaban
  // (lihat amankanPgOffline), jadi setelah reload status konfirmasi tidak
  // diketahui — dianggap BELUM terkonfirmasi (wording konservatif).
  useEffect(() => {
    const sesiId = sesiInfo?.sesiId
    if (!sesiId || phase !== 'UJIAN') return
    let nis: string | undefined
    try { nis = JSON.parse(localStorage.getItem('user') ?? '{}').nis } catch { /* abaikan */ }
    if (!nis) return
    if (ambilKlaimPgSelesaiOffline(sesiId, nis)) {
      const jumlah = Object.keys(jawabanRef.current).length
      setPgOfflineTerkonfirmasi(false)
      setPgSelesaiOfflinePending(true)
      setJaringanBermasalah(true)
      setSyncFailInfo({ expected: jumlah, synced: jumlah })
      setShowSyncFailModal(true)
    }
  }, [sesiInfo?.sesiId, phase])

  // ── Backup lokal jawaban essay (mode DIGITAL) ─────────────────────────────
  // Sama seperti backup jawaban PG — jaga-jaga kalau tab reload di tengah
  // fase essay sebelum sempat sync ke server.
  // FIX BUG (P1-01, padanan essay): sekarang ikut menyimpan jam per-soal
  // (`t`) dalam format {v, t} yang sama seperti saveBackup() PG, supaya
  // masukKeHalamanEssay() bisa membandingkan dengan updated_at server alih-
  // alih backup lokal selalu menang mutlak. loadEssayBackup() di bawah tetap
  // bisa membaca format lama (flat map) untuk kompatibilitas mundur.
  useEffect(() => {
    if (phase !== 'ESSAY_KERJAKAN' || essayInfo?.modeJawaban !== 'DIGITAL') return
    const currentSesi = sesiInfoRef.current
    if (!currentSesi) return
    const user = JSON.parse(localStorage.getItem('user') ?? '{}')
    if (user?.nis) {
      try {
        const payload: BackupJawaban<JawabanEssayMap> = { v: jawabanEssay, t: jawabanEssayTsRef.current }
        localStorage.setItem(`ujian_essay_backup_${currentSesi.sesiId}_${user.nis}`, JSON.stringify(payload))
      } catch { /* abaikan */ }
    }
  }, [jawabanEssay, phase, essayInfo])

  // Baca backup essay dari localStorage, kompatibel dengan format lama
  // (flat map) maupun format baru ({v, t}) — lihat catatan di atas.
  function loadEssayBackup(sesiId: string, nis: string): BackupJawaban<JawabanEssayMap> {
    try {
      const raw = localStorage.getItem(`ujian_essay_backup_${sesiId}_${nis}`)
      if (!raw) return { v: {}, t: {} }
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && 'v' in parsed) {
        return { v: parsed.v ?? {}, t: parsed.t ?? {} }
      }
      return { v: parsed ?? {}, t: {} }
    } catch { return { v: {}, t: {} } }
  }

  // ── Backup tiap kali jawaban berubah (lihat catatan di backupKey/saveBackup) ──
  useEffect(() => {
    if (phase !== 'UJIAN' || !sesiInfo) return
    const user = JSON.parse(localStorage.getItem('user') ?? '{}')
    if (user?.nis) saveBackup(sesiInfo.sesiId, user.nis, jawaban, jawabanTsRef.current, jawabanRevisiRef.current)
  }, [jawaban, phase, sesiInfo])

  // ── Peringatkan siswa jika mencoba menutup/refresh tab saat masih ada
  // jawaban yang belum terkonfirmasi tersimpan di server ──────────────────
  useEffect(() => {
    if (phase !== 'UJIAN' && phase !== 'ESSAY_INFO' && phase !== 'ESSAY_KERJAKAN') return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (syncStatus === 'error' || syncStatus === 'syncing' || essaySyncStatus === 'error' || essaySyncStatus === 'syncing') {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [phase, syncStatus, essaySyncStatus])

  // ── Ambil batasPelanggaran dari pengaturan saat mount ─────────────────────
  useEffect(() => {
    fetch(`/api/public/pengaturan?t=${Date.now()}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(json => {
        const batas = parseInt(json?.data?.batasPelanggaran ?? '3', 10)
        if (!isNaN(batas) && batas > 0) setBatasPelanggaran(batas)
      })
      .catch(() => {})
  }, [])

  // ── Cek jadwal hari ini saat pertama kali masuk halaman ─────────────────
  useEffect(() => {
    async function cekJadwal() {
      setLoadingJadwal(true)
      try {
        const res = await apiRequest<{ data: JadwalHariIni[]; zonaWaktu?: { utcOffsetJam: number } }>('/api/siswa/jadwal')

        // FIX (fitur essay): kalau siswa sempat me-refresh browser di tengah
        // fase essay (submit PG sudah tapi essay belum dikirim), lompat
        // langsung ke halaman essay — JANGAN masuk alur KODE lagi karena
        // /api/siswa/ujian/validasi akan menolak (nilai PG sudah ada).
        const essayPendingEntry = (res.data ?? []).find(j => j.essayPending && j.sesiIdEssayPending)
        if (essayPendingEntry?.sesiIdEssayPending) {
          setSesiInfo({
            sesiId: essayPendingEntry.sesiIdEssayPending,
            mapelId: '',
            namaMapel: essayPendingEntry.nama_mapel,
            kelas: '',
            durasi: 0,
            waktu_mulai: '',
            soalList: [],
            minSubmitMenit: 0,
          })
          setPhase('ESSAY_INFO')
          setLoadingJadwal(false)
          // FIX BUG (halaman putih kosong): oper sesiId secara eksplisit —
          // lihat catatan panjang di definisi fetchEssayInfo() untuk alasan
          // kenapa mengandalkan sesiInfoRef.current di titik ini tidak aman.
          fetchEssayInfo(essayPendingEntry.sesiIdEssayPending)
          return
        }

        const zona = res.zonaWaktu?.utcOffsetJam ?? 7
        const shifted = new Date(Date.now() + zona * 60 * 60 * 1000)
        const today = shifted.toISOString().slice(0, 10)

        // BUG FIX (ujian susulan dibuka admin/pengawas tidak muncul di "Mulai
        // Ujian"): sebelumnya filter "hari ini" HANYA mengandalkan
        // `j.tanggal` (tanggal jadwal ASLI). Saat admin membuka sesi susulan
        // untuk jadwal yang tanggal aslinya sudah lewat (lihat
        // /api/admin/susulan — hanya `jadwal.status` yang di-set 'BERJALAN',
        // `jadwal.tanggal` SENGAJA tidak diubah supaya riwayat jadwal asli
        // tetap utuh), jadwal itu tidak pernah lolos filter `tanggal ===
        // today` walau sesinya benar-benar sedang berjalan sekarang — siswa
        // melihat "Tidak Ada Ujian Hari Ini" padahal menu Jadwal Ujian
        // menunjukkan status "Sedang Berlangsung". Sekarang jadwal dengan
        // status BERJALAN ikut disertakan APAPUN tanggalnya, karena status
        // itu sendiri sudah jadi sinyal real-time "ada sesi yang bisa
        // diikuti sekarang" — sama seperti cara /siswa/jadwal menampilkannya.
        const semuaHariIni = (res.data ?? []).filter(j => j.tanggal?.slice(0, 10) === today || j.status === 'BERJALAN')
        // Yang belum diikuti dan belum selesai — ini yang aktif ditangani
        const hariIni = semuaHariIni.filter(j => !j.sudah_ikut && j.status !== 'SELESAI')
        // Yang sudah ditutup tapi siswa belum sempat ikut
        const sudahTutup = semuaHariIni.filter(j => !j.sudah_ikut && j.status === 'SELESAI')
        // FIX BUG: sebelumnya jadwal dengan sudah_ikut === true tidak pernah
        // ditangkap ke state manapun — lihat catatan panjang di deklarasi
        // sudahDiselesaikanHariIni di atas.
        const sudahSelesaiDikerjakan = semuaHariIni.filter(j => j.sudah_ikut)
        setJadwalHariIni(hariIni)
        setSudahDiselesaikanHariIni(sudahSelesaiDikerjakan)
        if (sudahTutup.length > 0 && hariIni.length === 0) {
          // Semua jadwal hari ini sudah tutup dan siswa belum ikut satupun
          setSesiSudahTutup(sudahTutup)
        } else {
          setSesiSudahTutup([])
        }

        // Cari jadwal terdekat (mendatang) untuk ditampilkan kalau tidak ada hari ini
        if (hariIni.length === 0) {
          const nowStr = shifted.toISOString().slice(0, 10)
          const mendatang = (res.data ?? [])
            .filter(j => j.tanggal?.slice(0, 10) > nowStr && !j.sudah_ikut)
            .sort((a, b) => a.tanggal.localeCompare(b.tanggal))
          setJadwalTerdekat(mendatang[0] ?? null)
        }

        // Kalau ada sesi BERJALAN, langsung ke persiapan
        const sesiAktif = hariIni.filter(j => j.status === 'BERJALAN')
        if (sesiAktif.length === 1) {
          setJadwalTerpilih(sesiAktif[0])
          setPhase('PERSIAPAN')
        } else if (sesiAktif.length > 1) {
          // Lebih dari 1 sesi berjalan — tampilkan pilihan
          setPhase('PERSIAPAN')
        } else {
          setPhase('CEK_JADWAL')
        }
      } catch (e) {
        // FIX (Essay offline tidak bisa dilanjutkan setelah halaman dimuat
        // ulang): kalau request jadwal gagal murni karena jaringan (tanpa
        // status HTTP) dan perangkat ini punya essay yang SUDAH dibuka offline
        // (kode darurat tersimpan), pulihkan langsung ke halaman Essay dari
        // amplop lokal — alih-alih layar "tidak ada ujian" tanpa jalan kembali.
        const statusHttp = (e as { status?: number } | undefined)?.status
        if (!statusHttp) {
          let dipulihkan = false
          try { dipulihkan = await pulihkanEssayOffline() } catch { /* abaikan */ }
          if (dipulihkan) return
        }
        setPhase('CEK_JADWAL')
      } finally {
        setLoadingJadwal(false)
      }
    }
    cekJadwal()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Minta izin blokir notifikasi saat ujian dimulai ───────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN' && phase !== 'ESSAY_INFO' && phase !== 'ESSAY_KERJAKAN') return
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [phase])

  // ── Masuk fullscreen saat phase UJIAN ─────────────────────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN' && phase !== 'ESSAY_INFO' && phase !== 'ESSAY_KERJAKAN') return
    const el = document.documentElement
    requestFullscreen(el).catch(() => {
      // FIX: sebelumnya kegagalan di sini dibuang total tanpa jejak apapun.
      // Tidak perlu state terpisah untuk menandai kegagalan — `isFS` (state
      // yang sudah ada, diupdate lewat listener fullscreenchange di bawah)
      // otomatis tetap false kalau requestFullscreen tidak pernah berhasil,
      // dan itulah yang dipakai banner peringatan di render phase UJIAN.
    })

    // FIX (APK Android): Fullscreen API web di atas TIDAK bisa diandalkan di
    // dalam WebView Android (WebView tidak otomatis mendukungnya tanpa
    // WebChromeClient khusus, dan biarpun berhasil, tombol Home/Recent Apps
    // tetap bisa dipencet siswa kapan pun — beda dengan proteksi native).
    // startExamLock() adalah no-op total kalau ini dibuka lewat browser
    // biasa (bukan APK), jadi baris ini aman ditambahkan di sini tanpa
    // memengaruhi pengguna web sama sekali. Lihat src/lib/exam-lock.ts.
    startExamLock()

    function onFSChange() {
      setIsFS(isFullscreen())
    }
    document.addEventListener('fullscreenchange', onFSChange)
    document.addEventListener('webkitfullscreenchange', onFSChange)
    document.addEventListener('mozfullscreenchange', onFSChange)
    document.addEventListener('MSFullscreenChange', onFSChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFSChange)
      document.removeEventListener('webkitfullscreenchange', onFSChange)
      document.removeEventListener('mozfullscreenchange', onFSChange)
      document.removeEventListener('MSFullscreenChange', onFSChange)
    }
  }, [phase])

  // ── Deteksi keluar fullscreen saat ujian ─────────────────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN' && phase !== 'ESSAY_INFO' && phase !== 'ESSAY_KERJAKAN') return
    let fsCooldown: ReturnType<typeof setTimeout> | null = null
    function onFSChange() {
      if (!isFullscreen()) {
        if (pelanggaranActiveRef.current) return
        if (fsCooldown) return
        pelanggaranActiveRef.current = true
        pelanggRef.current++
        laporPelanggaran('EXIT_FULLSCREEN', `Keluar layar penuh ke-${pelanggRef.current}`)
        setWarningMsg('⚠ Anda keluar dari mode layar penuh!')
        setShowWarningOverlay(true)
        fsCooldown = setTimeout(() => { fsCooldown = null }, 2000)
      }
    }

    document.addEventListener('fullscreenchange', onFSChange)
    document.addEventListener('webkitfullscreenchange', onFSChange)
    document.addEventListener('mozfullscreenchange', onFSChange)
    document.addEventListener('MSFullscreenChange', onFSChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFSChange)
      document.removeEventListener('webkitfullscreenchange', onFSChange)
      document.removeEventListener('mozfullscreenchange', onFSChange)
      document.removeEventListener('MSFullscreenChange', onFSChange)
      if (fsCooldown) clearTimeout(fsCooldown)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ── Anti-cheat: tab switch / visibilitychange ─────────────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN' && phase !== 'ESSAY_INFO' && phase !== 'ESSAY_KERJAKAN') return
    // Cooldown mencegah event ganda (visibilitychange + blur keduanya fire sekaligus)
    let visCooldown: ReturnType<typeof setTimeout> | null = null
    function onVisibilityChange() {
      if (!document.hidden) return
      if (pelanggaranActiveRef.current) return
      if (visCooldown) return
      pelanggaranActiveRef.current = true
      pelanggRef.current++
      laporPelanggaran('TAB_SWITCH', `Berpindah tab/aplikasi ke-${pelanggRef.current}`)
      setWarningMsg('⚠ Berpindah tab atau aplikasi terdeteksi!')
      setShowWarningOverlay(true)
      visCooldown = setTimeout(() => { visCooldown = null }, 2000)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (visCooldown) clearTimeout(visCooldown)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ── Anti-cheat: blokir klik kanan ────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN' && phase !== 'ESSAY_INFO' && phase !== 'ESSAY_KERJAKAN') return
    function block(e: MouseEvent) { e.preventDefault() }
    document.addEventListener('contextmenu', block)
    return () => document.removeEventListener('contextmenu', block)
  }, [phase])

  // ── Anti-cheat: blokir shortcut keyboard berbahaya ───────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN' && phase !== 'ESSAY_INFO' && phase !== 'ESSAY_KERJAKAN') return
    function onKeyDown(e: KeyboardEvent) {
      const blockedKeys = [
        e.ctrlKey && e.key === 'c',
        e.ctrlKey && e.key === 'v',
        e.ctrlKey && e.key === 'a',
        e.ctrlKey && e.key === 'u',
        e.ctrlKey && e.key === 'p',
        e.ctrlKey && e.shiftKey && e.key === 'I',
        e.ctrlKey && e.shiftKey && e.key === 'J',
        e.ctrlKey && e.shiftKey && e.key === 'C',
        e.key === 'F12',
        e.key === 'PrintScreen',
        e.altKey && e.key === 'Tab',
        e.metaKey,
      ]
      if (blockedKeys.some(Boolean)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [phase])

  // ── Anti-cheat: blokir copy/paste/cut ────────────────────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN' && phase !== 'ESSAY_INFO' && phase !== 'ESSAY_KERJAKAN') return
    function block(e: ClipboardEvent) { e.preventDefault() }
    document.addEventListener('copy', block)
    document.addEventListener('cut', block)
    document.addEventListener('paste', block)
    return () => {
      document.removeEventListener('copy', block)
      document.removeEventListener('cut', block)
      document.removeEventListener('paste', block)
    }
  }, [phase])

  // ── Anti-cheat: blokir drag & drop ───────────────────────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN' && phase !== 'ESSAY_INFO' && phase !== 'ESSAY_KERJAKAN') return
    function block(e: DragEvent) { e.preventDefault() }
    document.addEventListener('dragstart', block)
    document.addEventListener('drop', block)
    return () => {
      document.removeEventListener('dragstart', block)
      document.removeEventListener('drop', block)
    }
  }, [phase])

  // ── Anti-cheat: blokir window blur (pindah aplikasi di HP) ───────────────
  useEffect(() => {
    if (phase !== 'UJIAN' && phase !== 'ESSAY_INFO' && phase !== 'ESSAY_KERJAKAN') return
    // Cooldown timer untuk mencegah event blur/visibilitychange terpicu berganda
    let blurCooldown: ReturnType<typeof setTimeout> | null = null
    function onBlur() {
      if (pelanggaranActiveRef.current) return
      if (blurCooldown) return // masih dalam cooldown 2 detik
      pelanggaranActiveRef.current = true
      pelanggRef.current++
      laporPelanggaran('WINDOW_BLUR', `Keluar dari aplikasi ujian ke-${pelanggRef.current}`)
      setWarningMsg('⚠ Anda keluar dari aplikasi ujian!')
      setShowWarningOverlay(true)
      blurCooldown = setTimeout(() => { blurCooldown = null }, 2000)
    }
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('blur', onBlur)
      if (blurCooldown) clearTimeout(blurCooldown)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ── Keluar fullscreen saat ujian selesai ──────────────────────────────────
  useEffect(() => {
    // BUG FIX: sebelumnya kondisi ini HANYA memeriksa `phase`. Saat siswa
    // dikunci permanen (TERKUNCI) atau sesinya diambil alih device lain
    // SAAT SEDANG MENGERJAKAN (phase 'UJIAN'/'ESSAY_INFO'/'ESSAY_KERJAKAN')
    // atau sedang di layar tunggu kode reset (phase 'RESET_KODE'), yang
    // berubah cuma flag `dikeluarkan`/`diambilAlihDevice` — `phase` itu
    // sendiri TIDAK PERNAH di-set balik, jadi baris ini tidak pernah jalan
    // dan siswa tetap terjebak di fullscreen web + screen pinning APK
    // Android tanpa henti (layar kosong/terkunci walau kartu "Ujian
    // Dihentikan" sudah semestinya tampil di baliknya). Sekarang flag itu
    // ikut memicu pelepasan lock, disamping daftar phase yang sudah ada.
    const harusLepasLock =
      dikeluarkan || diambilAlihDevice ||
      phase === 'SELESAI' || phase === 'RESET_KODE' || phase === 'CEK_JADWAL' || phase === 'PERSIAPAN'

    if (harusLepasLock && isFullscreen()) {
      exitFullscreen().catch(() => {})
    }
    // FIX (APK Android): lepas screen pinning + immersive mode begitu ujian
    // benar-benar selesai/keluar dari fase mengerjakan soal, ATAU begitu
    // siswa dipaksa keluar (dikunci permanen / device takeover). Sama
    // seperti startExamLock(), ini no-op aman kalau bukan APK Android.
    if (harusLepasLock) {
      endExamLock()
    }
  }, [phase, dikeluarkan, diambilAlihDevice])

  // ── Polling status sesi setiap 10 detik — jika SELESAI, paksa submit ─────
  const cekStatusSesi = useCallback(async () => {
    const currentSesi = sesiInfoRef.current
    const currentPhase = phaseRef.current
    if (!currentSesi || (currentPhase !== 'UJIAN' && currentPhase !== 'ESSAY_INFO' && currentPhase !== 'ESSAY_KERJAKAN')) return
    try {
      const res = await apiRequest<{ sesi_status?: string; siswa_status?: string; diambil_alih_device_lain?: boolean } | null>(
        `/api/siswa/ujian/cek-sesi?sesiId=${currentSesi.sesiId}&deviceId=${getDeviceId()}`
      )
      if (!res) return

      // Teruskan status "sedang dipantau admin" ke DipantauBanner (layout siswa)
      // tanpa request tambahan — datanya ikut di respons cek-sesi ini.
      window.dispatchEvent(new CustomEvent('dipantau-status', {
        detail: {
          dipantau: !!(res as { dipantau?: boolean }).dipantau,
          sid: (res as { dipantau_sid?: string }).dipantau_sid,
        },
      }))

      // Deteksi takeover oleh device lain — hentikan semua interval, tampilkan overlay
      if ((res as { diambil_alih_device_lain?: boolean }).diambil_alih_device_lain) {
        clearInterval(timerRef.current!)
        clearInterval(syncRef.current!)
        clearInterval(sesiPollRef.current!)
        clearInterval(essayTimerRef.current!)
        clearInterval(essaySyncRef.current!)
        clearInterval(essayAksesMulaiPollRef.current!)
        setDiambilAlihDevice(true)
        return
      }

      // FIX BUG A+B: cek status SISWA (TERKUNCI) selain status SESI (SELESAI).
      // Sebelumnya polling hanya bereaksi kalau sesi ditutup pengawas — kalau
      // admin mengunci siswa secara individual (status TERKUNCI), siswa tidak
      // mendapat notifikasi apapun dan baru tahu saat coba submit (ditolak 403).
      if ((res as { siswa_status?: string }).siswa_status === 'TERKUNCI') {
        clearInterval(timerRef.current!)
        clearInterval(syncRef.current!)
        clearInterval(sesiPollRef.current!)
        clearInterval(essayTimerRef.current!)
        clearInterval(essaySyncRef.current!)
        clearInterval(essayAksesMulaiPollRef.current!)
        // FIX BUG (jumlah pelanggaran ASLI, bukan angka batas): server
        // sekarang menyertakan jumlah pelanggaran sungguhan saat TERKUNCI —
        // pakai ini di layar "Ujian Dihentikan" alih-alih batasPelanggaran.
        const jp = (res as { jumlah_pelanggaran?: number }).jumlah_pelanggaran
        if (typeof jp === 'number') setJumlahPelanggaran(jp)
        setDikeluarkan(true)
        return
      }

      // FIX Bug #3: handle siswa_status RESET dari polling.
      // Jika pengawas me-reset siswa dari mode pengawas saat siswa sedang
      // mengerjakan, siswa_ujian.status berubah ke RESET tapi polling tidak
      // bereaksi — overlay pelanggaran tidak muncul, sync jawaban diam-diam
      // ditolak 403, dan siswa bingung kenapa jawaban tidak tersimpan.
      // Sekarang: munculkan overlay warning agar siswa tahu dan menghubungi pengawas.
      if ((res as { siswa_status?: string }).siswa_status === 'RESET' && !showWarningOverlay) {
        pelanggaranActiveRef.current = true
        setWarningMsg('⚠ Pengawas telah me-reset akun Anda karena pelanggaran terdeteksi.')
        setShowWarningOverlay(true)
        return
      }

      if ((res as { sesi_status?: string }).sesi_status === 'SELESAI') {
        clearInterval(timerRef.current!)
        clearInterval(syncRef.current!)
        clearInterval(sesiPollRef.current!)
        clearInterval(essayTimerRef.current!)
        clearInterval(essaySyncRef.current!)
        clearInterval(essayAksesMulaiPollRef.current!)
        setSesiDitutupPaksa(true)
        // FIX (fitur essay): kalau pengawas menutup sesi SAAT siswa sudah
        // mulai mengerjakan essay, jalur penutupannya adalah endpoint
        // .../essay/kirim (BUKAN .../selesai lagi — itu sudah dipakai untuk
        // PG). Kalau siswa baru di halaman info essay (belum tekan "Mulai"),
        // tidak ada yang perlu dikirim — cukup tampilkan notifikasi sesi
        // ditutup, guru nanti menandai TIDAK_MENGERJAKAN lewat panel koreksi.
        if (currentPhase === 'ESSAY_KERJAKAN') {
          await handleKirimEssay(true)
        } else if (currentPhase !== 'ESSAY_INFO') {
          await handleSelesai(true, true)
        }
      }
    } catch { /* silent */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (phase !== 'UJIAN' && phase !== 'ESSAY_INFO' && phase !== 'ESSAY_KERJAKAN') return
    sesiPollRef.current = setInterval(cekStatusSesi, 10000)
    return () => clearInterval(sesiPollRef.current!)
  }, [phase, cekStatusSesi])

  // FIX: sebelumnya, begitu siswa masuk fase RESET_KODE (layar "minta kode
  // 7 digit ke pengawas"), TIDAK ADA polling status sama sekali — cekStatusSesi
  // di atas cuma jalan kalau phase === 'UJIAN'. Akibatnya kalau pengawas
  // memutuskan mengunci PERMANEN (status TERKUNCI) alih-alih memberi kode,
  // siswa tetap terpaku di layar "menunggu kode reset" tanpa batas waktu —
  // form isi kode itu tidak akan pernah berhasil lagi, tapi tidak ada yang
  // memberi tahu siswa selain kalau mereka coba masukkan sesuatu sendiri.
  // Polling ringan di bawah mengecek status setiap 10 detik SELAMA di
  // layar ini, dan begitu terdeteksi TERKUNCI, langsung alihkan ke layar
  // "Ujian Dihentikan" (dikeluarkan) alih-alih membiarkan form kode
  // menggantung percuma.
  useEffect(() => {
    if (phase !== 'RESET_KODE' || !pendingResetSesiId) return
    const cekStatusResetKode = async () => {
      try {
        const res = await apiRequest<{ siswa_status?: string; jumlah_pelanggaran?: number }>(
          `/api/siswa/ujian/cek-sesi?sesiId=${pendingResetSesiId}&deviceId=${getDeviceId()}`
        )
        if (res?.siswa_status === 'TERKUNCI') {
          if (typeof res.jumlah_pelanggaran === 'number') setJumlahPelanggaran(res.jumlah_pelanggaran)
          setDikeluarkan(true)
        }
      } catch { /* silent — dicoba lagi 10 detik berikutnya */ }
    }
    const interval = setInterval(cekStatusResetKode, 10000)
    return () => clearInterval(interval)
  }, [phase, pendingResetSesiId])

  // ── Timer ─────────────────────────────────────────────────────────────────
  const sisaWaktuRef = useRef(0)
  useEffect(() => { sisaWaktuRef.current = sisaWaktu }, [sisaWaktu])

  useEffect(() => {
    if (phase !== 'UJIAN') return
    timerRef.current = setInterval(() => {
      // FIX BUG #1 (timer lokal tidak resync ke server): sebelumnya tick ini
      // hanya mengurangi counter lokal (`prev - 1`) setiap 1 detik dan TIDAK
      // PERNAH dihitung ulang dari referensi waktu server selama ujian
      // berjalan. Kalau tab di-throttle / laptop sleep (browser modern bisa
      // menahan setInterval di background tab selama beberapa menit), detik
      // yang "hilang" itu tidak pernah dikoreksi — tampilan sisa waktu siswa
      // jadi lebih besar dari kenyataan, sementara server (yang menghitung
      // dari waktu_mulai_awal + durasi, lihat /api/siswa/ujian/selesai)
      // sudah menganggap waktu habis duluan → auto-submit ditolak 409.
      //
      // FIX: setiap tick, hitung ULANG sisa waktu dari referensi absolut
      // sesiInfo.waktu_mulai (= waktu_mulai_awal dari server, nilai yang
      // sama dipakai saat ujian pertama dibuka di baris ~648 dan tidak
      // pernah berubah walau siswa di-reset). setInterval jadi cuma pemicu
      // "kapan render ulang", BUKAN sumber kebenaran sisa waktu — jadi walau
      // tab di-throttle dan beberapa tick terlewat/telat, begitu tab aktif
      // lagi angkanya langsung benar tanpa perlu menunggu resync jaringan,
      // dan tidak akan pernah menyimpang dari perhitungan server.
      const currentSesi = sesiInfoRef.current
      if (currentSesi?.waktu_mulai && currentSesi.durasi) {
        const terpakaiDetik = Math.floor((Date.now() - new Date(currentSesi.waktu_mulai).getTime()) / 1000)
        const sisaBaru = Math.max(0, currentSesi.durasi * 60 - terpakaiDetik)
        setSisaWaktu(sisaBaru)
        setWaktuTerpakai(terpakaiDetik)
        if (sisaBaru <= 0) {
          clearInterval(timerRef.current!)
          setTimeout(() => handleSelesai(true), 0)
        }
      } else {
        // Fallback (seharusnya tidak terjadi selama phase UJIAN, tapi
        // dijaga supaya UI tidak macet total kalau sesiInfo belum terisi).
        setSisaWaktu(prev => {
          if (prev <= 1) {
            clearInterval(timerRef.current!)
            setTimeout(() => handleSelesai(true), 0)
            return 0
          }
          return prev - 1
        })
        setWaktuTerpakai(prev => prev + 1)
      }
    }, 1000)
    return () => clearInterval(timerRef.current!)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ── Auto sync ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN') return
    syncRef.current = setInterval(() => syncJawaban(), 30000)
    return () => clearInterval(syncRef.current!)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ── Sync jawaban ke server, dengan retry otomatis ─────────────────────────
  // PENTING: berbeda dari versi sebelumnya, fungsi ini TIDAK diam-diam menyerah
  // saat request gagal. Ia mencoba ulang beberapa kali dengan jeda yang makin
  // panjang (exponential backoff), dan selalu mengembalikan `totalSynced` yang
  // diambil langsung dari hitungan baris di database (ground truth dari server),
  // bukan asumsi "fetch tidak error = semua tersimpan". Pemanggil (terutama
  // handleSelesai) WAJIB memeriksa nilai ini sebelum menganggap ujian selesai.
  // ── Ronde ACK terakhir per soal (revisi & status diterima/tidak) ─────────
  // Dipakai handleSelesai() untuk verifikasi yang BENAR-BENAR akurat: bukan
  // cuma "jumlah baris di server >= jumlah yang dijawab lokal" (totalSynced),
  // yang bisa salah kalau ada soal yang ditolak validasi paket tapi ada
  // baris lain yang kebetulan menutupi selisihnya — tapi "setiap soal yang
  // PUNYA jawaban lokal saat ini sudah dikonfirmasi tersimpan PERSIS dengan
  // revisi yang sama di server".
  const ackTerakhirRef = useRef<Record<string, { revisi: number; accepted: boolean }>>({})

  // FIX BUG P1 (verifikasi submit berbasis COUNT saja bisa lolos padahal isi
  // salah/basi): totalSynced (jumlah baris) tidak peduli apakah ISI baris itu
  // benar-benar revisi TERBARU dari device ini. Helper ini mengecek per-soal:
  // apakah revisi yang sedang kita punya di device ini SUDAH dikonfirmasi
  // (accepted ATAU sudah diadopsi dari server — lihat syncJawabanInternal)
  // sebagai revisi yang tersimpan di server. Kalau belum pernah dapat `acked`
  // sama sekali (DB lama, migrasi 20_... belum jalan), fungsi ini tidak bisa
  // memutuskan apa-apa — pemanggil harus jatuh kembali ke perilaku lama
  // (count saja) supaya deploy sebelum migrasi tidak mengunci submit siswa.
  function semuaSoalTerkonfirmasiRevisi(): boolean {
    const soalIds = Object.keys(jawabanRef.current)
    if (soalIds.length === 0) return true
    return soalIds.every(soalId => {
      const ack = ackTerakhirRef.current[soalId]
      if (!ack) return false
      const revisiKita = jawabanRevisiRef.current[soalId] ?? 1
      return ack.revisi === revisiKita
    })
  }

  const MAX_SYNC_RETRY = 4
  const syncJawabanInternal = useCallback(async (): Promise<{ ok: boolean; totalSynced: number; sesiClosed?: boolean; locked?: boolean; networkError?: boolean }> => {
    const currentSesi = sesiInfoRef.current
    const currentJawaban = jawabanRef.current
    if (!currentSesi) return { ok: true, totalSynced: 0 }
    const entries = Object.entries(currentJawaban)

    setSyncStatus('syncing')
    // true kalau kegagalan TERAKHIR murni karena server tidak terjangkau
    // (tanpa status HTTP = jaringan mati/timeout, atau 5xx) — BUKAN penolakan
    // sah 4xx. Dipakai handleSelesai() untuk memutuskan apakah jalur PG-selesai
    // offline boleh dipakai.
    let gagalJaringan = false
    for (let attempt = 1; attempt <= MAX_SYNC_RETRY; attempt++) {
      try {
        const res = await apiRequest<{
          message: string
          totalSynced: number
          acked?: { soal_id: string; jawaban: string; revisi: number; accepted: boolean }[]
        }>('/api/siswa/ujian/sync', {
          method: 'POST',
          body: JSON.stringify({
            sesiId: currentSesi.sesiId,
            // FIX BUG P1: sertakan `revisi` per soal — sumber kebenaran untuk
            // resolusi konflik di server (sync_jawaban_revisi), menggantikan
            // perbandingan jam client vs server yang tidak setara. Kalau
            // suatu soal belum pernah dicatat revisinya (mis. hasil merge
            // dari resume yang belum pernah diubah lagi di device ini),
            // pakai 1 supaya tetap dianggap "perubahan pertama" dan bukan 0
            // yang berarti "tidak ada perubahan" bagi server.
            jawaban: entries.map(([soal_id, jwb]) => ({
              soal_id,
              jawaban: jwb,
              revisi: jawabanRevisiRef.current[soal_id] ?? 1,
            })),
            deviceId: getDeviceId(),
          }),
        })
        setSyncStatus('synced')
        setSyncErrorMsg('')

        // FIX BUG P1 (konsistensi lintas-device): kalau server menolak
        // revisi kita (accepted=false) karena device LAIN sudah menulis
        // revisi yang lebih tinggi untuk soal yang sama, jangan diam-diam
        // terus mengirim ulang revisi basi kita selamanya — adopsi nilai
        // server sebagai yang benar di device ini juga, supaya device ini
        // ikut konsisten dan verifikasi submit tidak macet menunggu revisi
        // yang memang tidak akan pernah "menang".
        if (res.acked) {
          const next: Record<string, { revisi: number; accepted: boolean }> = { ...ackTerakhirRef.current }
          let adaAdopsiServer = false
          const jawabanTeradopsi: JawabanMap = {}
          res.acked.forEach(a => {
            next[a.soal_id] = { revisi: a.revisi, accepted: a.accepted }
            const revisiLokalKita = jawabanRevisiRef.current[a.soal_id] ?? 0
            if (!a.accepted && a.revisi > revisiLokalKita) {
              jawabanRevisiRef.current[a.soal_id] = a.revisi
              jawabanTeradopsi[a.soal_id] = a.jawaban
              adaAdopsiServer = true
            }
          })
          ackTerakhirRef.current = next
          if (adaAdopsiServer) {
            setJawaban(prev => ({ ...prev, ...jawabanTeradopsi }))
          }
        }

        return { ok: true, totalSynced: res.totalSynced ?? 0 }
      } catch (e) {
        console.warn(`Sync percobaan ke-${attempt} gagal:`, e)
        // FIX: jika server menolak karena sesi sudah ditutup pengawas (409),
        // ini bukan masalah koneksi — mengulang 4x dengan backoff hanya
        // membuang waktu karena pasti gagal terus. Hentikan segera dan
        // beri tahu pemanggil agar bisa menampilkan pesan yang tepat.
        const status = (e as { status?: number } | undefined)?.status
        if (status === 409) {
          const msg = (e as { data?: { error?: string } } | undefined)?.data?.error ?? ''
          const isTakeover = msg.includes('perangkat lain')
          setSyncStatus('error')
          setSyncErrorMsg(isTakeover
            ? 'Sesi Anda diambil alih perangkat lain.'
            : 'Sesi ujian sudah ditutup oleh pengawas.')
          return { ok: false, totalSynced: 0, sesiClosed: !isTakeover }
        }
        // FIX BUG #2 (modal sync-fail menimpa input kode reset): server
        // mengembalikan 403 saat siswa_ujian.status = RESET/TERKUNCI (lihat
        // /api/siswa/ujian/sync). Sebelumnya status ini TIDAK ditangani
        // khusus di sini, jadi kode di bawah mengulang percobaan 3x tanpa
        // guna (403 tidak akan pernah berhasil selama status belum berubah)
        // lalu jatuh ke pesan generik "Koneksi tidak stabil" — yang di
        // pemanggil (handleSelesai) memicu showSyncFailModal menimpa overlay
        // RESET yang sedang menampilkan input kode 7 digit. Sekarang
        // dikenali secara eksplisit dan langsung dihentikan tanpa retry.
        if (status === 403) {
          setSyncStatus('error')
          setSyncErrorMsg('Akses ujian Anda sedang dikunci/menunggu kode reset dari pengawas.')
          return { ok: false, totalSynced: 0, locked: true }
        }
        gagalJaringan = !status || status >= 500
        if (attempt < MAX_SYNC_RETRY) {
          // Backoff bertahap: 1.5s, 3s, 4.5s — beri waktu jaringan/server pulih
          await new Promise(r => setTimeout(r, attempt * 1500))
        }
      }
    }
    setSyncStatus('error')
    setSyncErrorMsg('Koneksi tidak stabil — sebagian jawaban gagal tersimpan ke server.')
    return { ok: false, totalSynced: 0, networkError: gagalJaringan }
  }, [])

  // FIX BUG (P1-02 — autosync & submit manual bisa berjalan BERSAMAAN, race
  // condition): sebelumnya autosync (setInterval 30 detik) dan verifikasi
  // submit (handleSelesai, yang memanggil syncJawaban() sampai 4x) sama-sama
  // memanggil fungsi sync yang sama tanpa penguncian apa pun. Skenario nyata:
  //   1. Autosync mulai mengirim, membawa snapshot jawaban SAAT ITU (mis.
  //      No.10 masih = A).
  //   2. Sepersekian detik kemudian siswa ubah No.10 jadi C, lalu langsung
  //      klik "Selesai" — memicu syncJawaban() KEDUA (membawa No.10 = C).
  //   3. Kalau request KEDUA (isi C, lebih baru) selesai & ter-commit ke DB
  //      LEBIH DULU, lalu request PERTAMA (isi A, snapshot lebih lama)
  //      baru selesai belakangan (jaringan tidak menjamin urutan selesai =
  //      urutan mulai) → request pertama MENIMPA BALIK C menjadi A lagi,
  //      tanpa ada error apa pun yang terlihat siswa. Ini sangat berbahaya
  //      karena terjadi tepat di detik-detik terakhir sebelum submit.
  //
  // FIX: serialisasi semua pemanggilan lewat satu antrean (`syncChainRef`).
  // Setiap panggilan syncJawaban() BARU dijalankan setelah panggilan
  // sebelumnya (dari sumber manapun — autosync, retry manual, atau
  // handleSelesai) benar-benar SELESAI, dan setiap eksekusi selalu membaca
  // jawabanRef.current TERBARU saat itu (bukan snapshot lama) — jadi tidak
  // akan pernah ada dua request jawaban PG untuk sesi yang sama diproses
  // tumpang-tindih, dan urutan selesai selalu sama dengan urutan dipanggil.
  const syncChainRef = useRef<Promise<unknown>>(Promise.resolve())
  const syncJawaban = useCallback((): Promise<{ ok: boolean; totalSynced: number; sesiClosed?: boolean; locked?: boolean; networkError?: boolean }> => {
    const next = syncChainRef.current.then(syncJawabanInternal, syncJawabanInternal)
    // .catch(() => {}) di sini HANYA supaya rantai promise tidak "macet"
    // kalau satu panggilan reject — syncJawabanInternal sendiri praktis
    // tidak pernah reject (semua kegagalan ditangkap & dikembalikan sebagai
    // {ok:false}), ini murni jaga-jaga.
    syncChainRef.current = next.catch(() => {})
    return next
  }, [syncJawabanInternal])

  // Ubah satu jawaban PG + catat REVISI (sumber kebenaran utama untuk merge —
  // lihat FIX BUG P1 di jawaban-merge.ts) dan JAM (fallback untuk data lama)
  // perubahan ini di device ini.
  function pilihJawaban(soalId: string, label: string) {
    jawabanTsRef.current = { ...jawabanTsRef.current, [soalId]: Date.now() }
    jawabanRevisiRef.current = { ...jawabanRevisiRef.current, [soalId]: nextRevisi(jawabanRevisiRef.current, soalId) }
    setJawaban(prev => ({ ...prev, [soalId]: label }))
  }

  // Padanan pilihJawaban() untuk essay mode DIGITAL.
  function tulisJawabanEssay(soalEssayId: string, teks: string) {
    jawabanEssayTsRef.current = { ...jawabanEssayTsRef.current, [soalEssayId]: Date.now() }
    setJawabanEssay(prev => ({ ...prev, [soalEssayId]: teks }))
  }

  // ── Pulihkan jawaban saat masuk/membuka ulang ujian ───────────────────────
  // FIX BUG (P1-01 — lihat penjelasan lengkap di komentar BackupJawaban /
  // mergeJawabanDenganWaktu di atas file ini): SEBELUMNYA backup lokal
  // selalu menang mutlak (`{...server, ...backup}`) tanpa peduli mana yang
  // sebenarnya lebih baru — berbahaya khusus di skenario lintas-device
  // (device lama yang sempat idle/mati lalu dipakai lagi bisa menimpa balik
  // jawaban yang sudah diperbarui dari device lain). Sekarang jawaban server
  // (dengan `updated_at` aslinya) dan backup lokal (dengan jam `t` per soal)
  // dibandingkan PER SOAL — yang jamnya lebih baru yang dipakai.
  const resumeJawaban = useCallback(async (sesiId: string, nis: string) => {
    const backup = loadBackup(sesiId, nis)
    let serverEntri: Record<string, EntriServer> = {}
    try {
      // FIX BUG #9: sertakan deviceId supaya backend bisa menolak device yang
      // sudah diambil alih saat memulihkan jawaban (lihat guard di
      // src/app/api/siswa/ujian/sync/route.ts GET).
      const res = await apiRequest<{ jawaban: { soal_id: string; jawaban: string; updated_at?: string; revisi?: number }[] }>(
        `/api/siswa/ujian/sync?sesiId=${sesiId}&deviceId=${getDeviceId()}`
      )
      serverEntri = Object.fromEntries((res.jawaban ?? []).map(j => [
        j.soal_id,
        { jawaban: j.jawaban, revisi: j.revisi, updatedAtMs: j.updated_at ? new Date(j.updated_at).getTime() : 0 } as EntriServer,
      ]))
    } catch (e) {
      console.warn('Gagal mengambil jawaban tersimpan dari server, pakai backup lokal saja:', e)
    }
    const lokalEntri: Record<string, EntriLokal> = Object.fromEntries(
      Object.entries(backup.v).map(([soalId, jwb]) => [
        soalId,
        { jawaban: jwb, revisi: backup.r?.[soalId] ?? 0, tsMs: backup.t?.[soalId] ?? 0 } as EntriLokal,
      ])
    )
    const { merged, revisi, detail } = mergeJawabanRevisi(serverEntri, lokalEntri)
    // Log ringan untuk memantau seberapa sering fallback jam masih terpakai
    // (seharusnya makin jarang setelah migrasi 20_... berjalan di semua
    // client) — bukan error, murni observability.
    const viaFallback = Object.values(detail).filter(d => d.viaFallbackJam).length
    if (viaFallback > 0) console.info(`[resumeJawaban] ${viaFallback} soal di-merge lewat fallback jam (belum punya revisi).`)
    if (Object.keys(merged).length > 0) {
      jawabanRef.current = merged
      jawabanRevisiRef.current = revisi
      // jawabanTsRef tidak lagi sumber kebenaran utama, tapi tetap
      // dipertahankan (nilai lama dari backup, atau 0) untuk kompatibilitas
      // kode lain yang masih membacanya.
      jawabanTsRef.current = { ...backup.t }
      setJawaban(merged)
    }
  }, [])

  async function laporPelanggaran(jenis: string, detail: string) {
    const currentSesi = sesiInfoRef.current
    if (!currentSesi) return
    try {
      const res = await apiRequest<{ perlu_reset?: boolean; level?: number; batasPelanggaran?: number }>('/api/siswa/ujian/pelanggaran', {
        method: 'POST',
        body: JSON.stringify({ sesiId: currentSesi.sesiId, jenis, detail }),
      })
      // FIX BUG A: simpan batasPelanggaran dari response supaya halaman
      // "Ujian Dihentikan" menampilkan angka yang benar.
      if (res?.batasPelanggaran) setBatasPelanggaran(res.batasPelanggaran)
      // FIX BUG (jumlah pelanggaran ASLI, bukan angka batas): simpan level
      // pelanggaran sungguhan yang baru saja dicatat server, supaya kalau
      // siswa ini nanti benar-benar dikunci, layar "Ujian Dihentikan" bisa
      // menampilkan angka yang sesuai riwayat asli, bukan sekadar batas.
      if (typeof res?.level === 'number') setJumlahPelanggaran(res.level)

      // Catatan: setDikeluarkan(true) TIDAK dipanggil di sini karena endpoint
      // pelanggaran siswa hanya mencatat kejadian — keputusan kunci/dikeluarkan
      // ada di tangan pengawas/admin. Polling cekStatusSesi (tiap 10 detik) yang
      // akan mendeteksi status TERKUNCI dan memanggil setDikeluarkan(true).
    } catch (e) { console.warn(e) }
  }

  async function handleMasukUjian() {
    if (!kode.trim()) { setError('Masukkan kode sesi terlebih dahulu'); return }
    setLoading(true); setError('')
    try {
      const user = JSON.parse(localStorage.getItem('user') ?? '{}')
      const res = await apiRequest<{ 
        valid: boolean
        message?: string
        perlu_kode_reset?: boolean
        sesiId?: string
        terkunci_permanen?: boolean
        jumlah_pelanggaran?: number
      } & SesiInfo>('/api/siswa/ujian/validasi', {
        method: 'POST',
        body: JSON.stringify({ kodeSesi: kode.trim().toUpperCase(), nis: user.nis, deviceId: getDeviceId() }),
      })

      // Siswa dalam status RESET — perlu kode 7 digit dari pengawas
      if (!res.valid && res.perlu_kode_reset && res.sesiId) {
        setPendingResetSesiId(res.sesiId)
        setPhase('RESET_KODE')
        return
      }

      // FIX BUG (tidak ada tombol "Kembali ke Beranda" setelah terkunci
      // permanen): sebelumnya kasus ini jatuh ke `setError(...)` di bawah
      // dan siswa tetap di layar input kode (phase 'KODE') yang cuma
      // punya tombol "Kembali" ke phase 'PERSIAPAN' — dan 'PERSIAPAN'
      // sendiri tidak punya link ke halaman beranda sama sekali, jadi
      // siswa terjebak bolak-balik tanpa jalan keluar. Sekarang: arahkan
      // langsung ke layar "Ujian Dihentikan" yang sudah punya tombol
      // Kembali ke Beranda, sama seperti jalur deteksi lewat polling.
      if (!res.valid && res.terkunci_permanen) {
        if (typeof res.jumlah_pelanggaran === 'number') setJumlahPelanggaran(res.jumlah_pelanggaran)
        setDikeluarkan(true)
        return
      }

      if (!res.valid) { setError(res.message ?? 'Kode tidak valid'); return }
      setSesiInfo(res)
      await resumeJawaban(res.sesiId, user.nis)
      const terpakai1 = Math.floor((Date.now() - new Date(res.waktu_mulai).getTime()) / 1000)
      setSisaWaktu(Math.max(0, res.durasi * 60 - terpakai1))
      setWaktuTerpakai(terpakai1)
      setPhase('UJIAN')
      setTimeout(() => {
        requestFullscreen(document.documentElement).catch(() => {})
      }, 100)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memvalidasi kode')
    } finally { setLoading(false) }
  }

  async function handleRefreshJadwal() {
    setLoadingJadwal(true)
    try {
      const res = await apiRequest<{ data: JadwalHariIni[]; zonaWaktu?: { utcOffsetJam: number } }>('/api/siswa/jadwal')

      // FIX (fitur essay): sama seperti di cekJadwal() — lihat komentar di sana.
      const essayPendingEntry = (res.data ?? []).find(j => j.essayPending && j.sesiIdEssayPending)
      if (essayPendingEntry?.sesiIdEssayPending) {
        setSesiInfo({
          sesiId: essayPendingEntry.sesiIdEssayPending,
          mapelId: '',
          namaMapel: essayPendingEntry.nama_mapel,
          kelas: '',
          durasi: 0,
          waktu_mulai: '',
          soalList: [],
          minSubmitMenit: 0,
        })
        setPhase('ESSAY_INFO')
        setLoadingJadwal(false)
        // FIX BUG (halaman putih kosong): sama seperti di cekJadwal() di
        // atas — oper sesiId secara eksplisit, jangan andalkan
        // sesiInfoRef.current yang belum tentu tersinkron di titik ini.
        fetchEssayInfo(essayPendingEntry.sesiIdEssayPending)
        return
      }

      const zona = res.zonaWaktu?.utcOffsetJam ?? 7
      const shifted = new Date(Date.now() + zona * 60 * 60 * 1000)
      const today = shifted.toISOString().slice(0, 10)
      // BUG FIX (sama seperti di cekJadwal() di atas — lihat komentar di sana):
      // ikutkan jadwal berstatus BERJALAN apapun tanggalnya, supaya sesi
      // susulan yang dibuka admin/pengawas untuk jadwal lama tetap terdeteksi
      // saat siswa menekan "Cek Ulang Sesi"/"Refresh".
      const semuaHariIni2 = (res.data ?? []).filter(j => j.tanggal?.slice(0, 10) === today || j.status === 'BERJALAN')
      const hariIni = semuaHariIni2.filter(j => !j.sudah_ikut && j.status !== 'SELESAI')
      const sudahTutup2 = semuaHariIni2.filter(j => !j.sudah_ikut && j.status === 'SELESAI')
      // FIX BUG: sama seperti di cekJadwal() — lihat catatan panjang di
      // deklarasi sudahDiselesaikanHariIni.
      const sudahSelesaiDikerjakan2 = semuaHariIni2.filter(j => j.sudah_ikut)
      setJadwalHariIni(hariIni)
      setSudahDiselesaikanHariIni(sudahSelesaiDikerjakan2)
      if (sudahTutup2.length > 0 && hariIni.length === 0) {
        setSesiSudahTutup(sudahTutup2)
      } else {
        setSesiSudahTutup([])
      }
      const sesiAktif = hariIni.filter(j => j.status === 'BERJALAN')
      if (sesiAktif.length === 1) {
        setJadwalTerpilih(sesiAktif[0])
        setPhase('PERSIAPAN')
      } else if (sesiAktif.length > 1) {
        setJadwalTerpilih(null)
        setPhase('PERSIAPAN')
      } else {
        setPhase('CEK_JADWAL')
      }
    } catch { /* silent */ }
    finally { setLoadingJadwal(false) }
  }

  async function handleVerifikasiReset() {
    if (!kodeReset.trim()) { setKodeResetError('Masukkan kode reset dari pengawas'); return }
    if (!pendingResetSesiId) return
    setKodeResetLoading(true); setKodeResetError('')
    try {
      // FIX Bug #1: tambahkan waktu_mulai ke type agar sisa waktu dihitung
      // dari waktu_mulai_awal yang dikembalikan server, bukan dari /validasi
      // berikutnya yang mungkin memberi waktu berbeda.
      const res = await apiRequest<{ valid: boolean; message?: string; waktu_mulai?: string; terkunci_permanen?: boolean; jumlah_pelanggaran?: number }>('/api/siswa/ujian/verifikasi-reset', {
        method: 'POST',
        body: JSON.stringify({ sesiId: pendingResetSesiId, kodeReset: kodeReset.trim().toUpperCase() }),
      })

      // FIX BUG (siswa terjebak di layar RESET_KODE tanpa jalan keluar):
      // sebelumnya kasus ini jatuh ke `setKodeResetError(...)` di bawah dan
      // siswa tetap di layar ini yang tidak punya tombol Kembali ke Beranda
      // sama sekali — hanya mengandalkan polling terpisah (tiap 10 detik)
      // untuk akhirnya memaksa pindah ke layar "Ujian Dihentikan". Sekarang
      // pindah SEKETIKA begitu server bilang terkunci permanen, tidak perlu
      // menunggu poll berikutnya.
      if (!res.valid && res.terkunci_permanen) {
        if (typeof res.jumlah_pelanggaran === 'number') setJumlahPelanggaran(res.jumlah_pelanggaran)
        setDikeluarkan(true)
        return
      }

      if (!res.valid) { setKodeResetError(res.message ?? 'Kode tidak valid'); return }

      setKodeReset('')
      setPhase('KODE')
      setKode(kode)
      setLoading(true)
      try {
        const user = JSON.parse(localStorage.getItem('user') ?? '{}')
        const sesiRes = await apiRequest<{ valid: boolean; message?: string } & SesiInfo>('/api/siswa/ujian/validasi', {
          method: 'POST',
          body: JSON.stringify({ kodeSesi: kode.trim().toUpperCase(), nis: user.nis, deviceId: getDeviceId() }),
        })
        if (!sesiRes.valid) { setError(sesiRes.message ?? 'Gagal masuk ujian'); setPhase('KODE'); return }
        setSesiInfo(sesiRes)
        await resumeJawaban(sesiRes.sesiId, user.nis)

        // FIX Bug #1: pakai waktu_mulai dari response verifikasi reset (waktu_mulai_awal)
        // jika tersedia, karena itulah ground truth dari server. Fallback ke sesiRes
        // hanya jika tidak ada (misalnya versi API lama).
        const waktuAcuan = res.waktu_mulai ?? sesiRes.waktu_mulai
        const terpakai2 = Math.floor((Date.now() - new Date(waktuAcuan).getTime()) / 1000)
        setSisaWaktu(Math.max(0, sesiRes.durasi * 60 - terpakai2))
        setWaktuTerpakai(terpakai2)

        // FIX Bug #2: reset pelanggaranActiveRef agar event anti-cheat
        // berikutnya (keluar fullscreen, ganti tab, blur) kembali aktif.
        // Tanpa ini, semua pelanggaran setelah reset tidak akan terdeteksi.
        pelanggaranActiveRef.current = false

        setPhase('UJIAN')
        setTimeout(() => requestFullscreen(document.documentElement).catch(() => {}), 100)
      } finally { setLoading(false) }
    } catch (err: unknown) {
      setKodeResetError(err instanceof Error ? err.message : 'Gagal memverifikasi kode')
    } finally { setKodeResetLoading(false) }
  }

  // ── Pulihkan Essay yang sudah dibuka OFFLINE setelah halaman dimuat ulang ─
  // Dipanggil dari cekJadwal() saat server tidak terjangkau. Mencari status
  // "essay dibuka offline" di localStorage (kunci essay_offline_<sesi>_<nis>,
  // lihat essay-amplop-client.ts) yang masih punya kode & waktu mulai, membuka
  // amplop dengan kode TERSIMPAN itu (kode sudah pernah diverifikasi lewat
  // dekripsi berhasil), lalu masuk ke ESSAY_KERJAKAN tanpa request server.
  // Kalau klaim PG-selesai offline masih ada, jawaban PG dipulihkan dari
  // backup lokal dan retry background (sync → /selesai) dinyalakan lagi —
  // tanpa ini jawaban PG yang belum tersinkron tidak pernah terkirim, karena
  // auto-sync PG hanya berjalan di fase UJIAN.
  // Status yang lebih tua dari 6 jam diabaikan supaya sisa ujian hari lain
  // tidak pernah "dibangkitkan" secara keliru.
  async function pulihkanEssayOffline(): Promise<boolean> {
    const PREFIX = 'essay_offline_'
    const BATAS_USIA_MS = 6 * 60 * 60 * 1000
    let nis: string | undefined
    try { nis = JSON.parse(localStorage.getItem('user') ?? '{}').nis } catch { return false }
    if (!nis) return false
    const akhiran = `_${nis}`

    let terpilih: { sesiId: string; waktuMulai: string; kode: string; ms: number } | null = null
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (!k || !k.startsWith(PREFIX) || !k.endsWith(akhiran)) continue
        const sesiId = k.slice(PREFIX.length, k.length - akhiran.length)
        if (!sesiId) continue
        const st = ambilStatusOffline(sesiId, nis)
        if (!st.kode || !st.waktuMulaiClient) continue
        const ms = Date.parse(st.waktuMulaiClient)
        if (Number.isNaN(ms) || Date.now() - ms > BATAS_USIA_MS) continue
        if (!terpilih || ms > terpilih.ms) terpilih = { sesiId, waktuMulai: st.waktuMulaiClient, kode: st.kode, ms }
      }
    } catch { return false }
    if (!terpilih) return false

    const amplop = ambilAmplop(terpilih.sesiId, nis)
    if (!amplop) return false
    const isi = await bukaAmplop(amplop, terpilih.sesiId, terpilih.kode).catch(() => null)
    if (!isi) return false

    const minimal: SesiInfo = {
      sesiId: terpilih.sesiId,
      mapelId: '',
      namaMapel: isi.info.namaMapel,
      kelas: '',
      durasi: 0,
      waktu_mulai: '',
      soalList: [],
      minSubmitMenit: 0,
    }
    // Ref diisi langsung (bukan menunggu effect) — effect retry PG & rekonsiliasi
    // Essay membacanya begitu fase berubah.
    sesiInfoRef.current = minimal
    setSesiInfo(minimal)
    setAmplopTersedia(true)

    if (ambilKlaimPgSelesaiOffline(terpilih.sesiId, nis)) {
      const backup = loadBackup(terpilih.sesiId, nis)
      if (Object.keys(backup.v).length > 0) {
        jawabanRef.current = backup.v
        jawabanRevisiRef.current = backup.r ?? {}
        jawabanTsRef.current = { ...backup.t }
        setJawaban(backup.v)
        setPgOfflineTerkonfirmasi(false)
        setPgSelesaiOfflinePending(true)
      }
    }

    setJaringanBermasalah(true)
    await masukKeHalamanEssayOffline(
      isi as unknown as Parameters<typeof masukKeHalamanEssayOffline>[0],
      terpilih.sesiId,
      terpilih.waktuMulai
    )
    return true
  }

  // ── Lompat ke Essay memakai kode darurat yang SUDAH tersimpan ────────────
  // Dipakai saat /selesai ditolak permanen (mis. 409 waktu PG sudah lewat)
  // untuk siswa yang sebelumnya sudah membuka essay offline. Melapor ke
  // /essay/mulai (tidak bergantung pada /selesai), lalu masuk Essay lewat
  // jalur normal. Return true = sudah ditangani (atau sedang ditangani pemicu
  // lain); false = tidak ada kode tersimpan / server belum terjangkau /
  // ditolak — pemanggil harus menampilkan kotak kode darurat.
  async function lanjutkanEssayDariKodeTersimpan(sesiId: string): Promise<boolean> {
    if (lanjutEssayBerjalanRef.current) return true
    let nis: string | undefined
    try { nis = JSON.parse(localStorage.getItem('user') ?? '{}').nis } catch { /* abaikan */ }
    if (!nis || !ambilStatusOffline(sesiId, nis).kode) return false
    lanjutEssayBerjalanRef.current = true
    try {
      const hasil = await laporkanBukaOffline(sesiId)
      if (hasil !== 'ok') return false
      hapusKlaimPgSelesaiOffline(sesiId, nis)
      setPgSelesaiOfflinePending(false)
      setPgFinalisasiDitolak(false)
      setShowSyncFailModal(false)
      if (phaseRef.current === 'UJIAN') {
        setPhase('ESSAY_INFO')
        void fetchEssayInfo(sesiId)
      }
      return true
    } finally {
      lanjutEssayBerjalanRef.current = false
    }
  }

  // ── Amankan jawaban PG di perangkat & buka jalur essay darurat ───────────
  // Dipanggil saat "Selesai" ditekan tapi server TIDAK terjangkau.
  //   terkonfirmasiServer=true  → semua jawaban sudah diverifikasi server,
  //                               hanya finalisasi (POST /selesai) yang gagal.
  //   terkonfirmasiServer=false → server tidak terjangkau SEBELUM verifikasi
  //                               selesai; jawaban baru aman di localStorage.
  // Klaim waktu selesai TIDAK ditimpa kalau sudah ada (auto-submit timer atau
  // "Coba Lagi" bisa memanggil ini berkali-kali) — waktu pertama yang dipakai.
  // Backup lokal JANGAN dihapus di sini: baru boleh dihapus setelah /selesai
  // benar-benar sukses (lihat retry background di bawah).
  function amankanPgOffline(expected: number, synced: number, terkonfirmasiServer: boolean) {
    let nis: string | undefined
    try { nis = JSON.parse(localStorage.getItem('user') ?? '{}').nis } catch { /* abaikan */ }
    const currentSesi = sesiInfoRef.current
    if (currentSesi && nis) {
      // Pastikan snapshot lokal paling baru sebelum bergantung padanya.
      saveBackup(currentSesi.sesiId, nis, jawabanRef.current, jawabanTsRef.current, jawabanRevisiRef.current)
      if (!ambilKlaimPgSelesaiOffline(currentSesi.sesiId, nis)) {
        simpanKlaimPgSelesaiOffline(currentSesi.sesiId, nis, new Date().toISOString())
      }
    }
    setPgOfflineTerkonfirmasi(terkonfirmasiServer)
    setPgFinalisasiDitolak(false)
    setPgSelesaiOfflinePending(true)
    setJaringanBermasalah(true)
    setSyncFailInfo({ expected, synced })
    setShowSyncFailModal(true)
  }

  function currentSesiPunyaKlaimOffline(): boolean {
    const sid = sesiInfoRef.current?.sesiId
    if (!sid) return false
    try {
      const nis = JSON.parse(localStorage.getItem('user') ?? '{}').nis as string | undefined
      return !!nis && !!ambilKlaimPgSelesaiOffline(sid, nis)
    } catch { return false }
  }

  async function handleSelesai(isTimeout = false, dipaksaPengawas = false) {
    if (submitting) return
    setConfirmSelesai(false)
    setSubmitting(true)
    // CATATAN: interval auto-sync/timer/polling SENGAJA TIDAK dihentikan di sini.
    // Kalau verifikasi di bawah gagal, biarkan auto-sync 30 detik dan retry manual
    // tetap punya kesempatan jalan di background selama modal kegagalan tampil —
    // baru dihentikan saat benar-benar terkonfirmasi selesai (lihat di bawah).

    const expectedCount = Object.keys(jawabanRef.current).length

    // ── Verifikasi sebelum finalisasi ──────────────────────────────────────
    // Ini adalah inti perbaikan: JANGAN PERNAH memanggil endpoint penilaian
    // hanya berdasarkan "sync tidak melempar error". Kita ulangi sync + cek
    // beberapa ronde, dan baru lanjut menilai kalau jumlah jawaban yang
    // dikonfirmasi SERVER (totalSynced, dari hitungan baris di DB) sudah
    // sama dengan jumlah yang dijawab siswa secara lokal.
    //
    // FIX: pengecualian untuk kasus sesi ditutup paksa oleh pengawas
    // (dipaksaPengawas=true) — di sini server SUDAH PASTI menolak setiap
    // percobaan sync (sesi tidak BERJALAN lagi), jadi loop verifikasi ini
    // tidak akan pernah berhasil walau diulang berapa kali pun. Sebelumnya
    // ini membuat siswa terjebak di modal "coba lagi" selamanya tanpa
    // penjelasan. Sekarang: coba sync sekali (best-effort, untuk menyimpan
    // jawaban terakhir jika masih memungkinkan), lalu langsung lanjut ke
    // penilaian dengan jawaban yang sudah tersimpan di server sejauh ini.
    const MAX_VERIFY_ROUNDS = 4
    let verified = false
    let totalSynced = 0
    let sesiClosedDuringSync = false
    let lockedDuringSync = false
    let serverTidakTerjangkau = false
    for (let round = 1; round <= MAX_VERIFY_ROUNDS; round++) {
      const result = await syncJawaban()
      totalSynced = result.totalSynced
      serverTidakTerjangkau = !!result.networkError
      // FIX BUG P1: tambahan syarat cocokAck di bawah — lihat komentar
      // lengkap di semuaSoalTerkonfirmasiRevisi(). Kalau server belum pernah
      // mengembalikan `acked` sama sekali di percobaan manapun sejauh ini
      // (migrasi revisi belum jalan di DB ini), jatuh ke perilaku lama:
      // count saja sudah cukup, supaya tidak mengunci submit siswa.
      const pernahDapatAck = Object.keys(ackTerakhirRef.current).length > 0
      const cocokAck = pernahDapatAck ? semuaSoalTerkonfirmasiRevisi() : true
      if (result.ok && totalSynced >= expectedCount && cocokAck) { verified = true; break }
      if (result.sesiClosed) { sesiClosedDuringSync = true; setSesiDitutupPaksa(true); break }
      if (result.locked) { lockedDuringSync = true; break } // FIX BUG #2 — lihat catatan di bawah
      if (dipaksaPengawas) break // jangan ulangi percobaan yang sudah pasti gagal
      if (round < MAX_VERIFY_ROUNDS) await new Promise(r => setTimeout(r, 2000))
    }

    // FIX BUG #2 (modal sync-fail menimpa input kode reset): kalau siswa
    // sedang RESET/TERKUNCI, overlay pelanggaran (showWarningOverlay, atau
    // layar `dikeluarkan` untuk TERKUNCI) SUDAH tampil dan sudah menjelaskan
    // situasi + menyediakan input kode reset. JANGAN panggil
    // setShowSyncFailModal di sini — dulu ini menimpa overlay tsb (sama-sama
    // z-[9999], keduanya dirender bersamaan) sehingga input kode reset tidak
    // bisa diakses sama sekali. Cukup hentikan percobaan submit untuk saat
    // ini; timer tetap jalan (tidak di-clear) dan tick berikutnya akan
    // otomatis mencoba lagi — begitu siswa memasukkan kode reset yang valid,
    // percobaan submit berikutnya akan berhasil seperti biasa.
    if (lockedDuringSync) {
      setShowSyncFailModal(false)
      setSubmitting(false)
      return
    }

    // FIX BUG P0 (offline PG -> Essay, skenario: internet MATI SEBELUM siswa
    // menekan "Selesai"). Sebelumnya jalur ini selalu jatuh ke modal "Jawaban
    // Belum Semua Tersimpan" + return, TANPA membuat klaim pgSelesaiOffline —
    // padahal klaim itulah yang membuka kotak kode darurat & jalur essay
    // offline. Akibatnya siswa hanya bisa menekan "Coba Lagi" tanpa ujung.
    //
    // Sekarang: kalau server memang tidak terjangkau (bukan penolakan sah
    // 4xx) DAN soal essay terenkripsi sudah ada di perangkat (amplop), jawaban
    // PG diamankan di perangkat dan siswa dialihkan ke kode darurat. Nilai PG
    // TETAP baru dibuat server setelah jawaban tersinkron (lihat retry
    // background: sync dulu, baru /selesai).
    if (!verified && !dipaksaPengawas && !sesiClosedDuringSync && serverTidakTerjangkau && amplopTersediaRef.current && expectedCount > 0) {
      amankanPgOffline(expectedCount, totalSynced, false)
      setSubmitting(false)
      return
    }

    if (!verified && !dipaksaPengawas && !sesiClosedDuringSync) {
      // Jangan diam-diam lanjut menilai dengan data yang belum lengkap.
      // Tampilkan ke siswa secara jelas + beri opsi coba lagi manual atau
      // kembali menjawab dulu sambil menunggu koneksi pulih.
      setSyncFailInfo({ expected: expectedCount, synced: totalSynced })
      setShowSyncFailModal(true)
      setSubmitting(false)
      return
    }

    clearInterval(timerRef.current!)
    clearInterval(syncRef.current!)
    clearInterval(sesiPollRef.current!)

    try {
      const user = JSON.parse(localStorage.getItem('user') ?? '{}')
      const currentSesi = sesiInfoRef.current
      // Kalau ada klaim offline dari percobaan sebelumnya, ikut kirim supaya
      // jejak audit "kapan siswa menekan Selesai" di server tetap akurat.
      const klaimTersimpan = currentSesi && user?.nis ? ambilKlaimPgSelesaiOffline(currentSesi.sesiId, user.nis) : null
      const res = await apiRequest<{ id?: string; lanjutEssay?: boolean; kkm?: number } & Partial<HasilAkhir>>('/api/siswa/ujian/selesai', {
        method: 'POST',
        body: JSON.stringify({
          sesiId: currentSesi!.sesiId,
          nis: user.nis,
          isTimeout,
          ...(klaimTersimpan ? { waktuSelesaiClient: klaimTersimpan } : {}),
        }),
      })

      // Server sudah memfinalisasi PG — klaim offline (kalau ada) tidak
      // diperlukan lagi, dan modal kegagalan (kalau sedang tampil dari
      // percobaan sebelumnya) harus ditutup.
      if (currentSesi && user?.nis) hapusKlaimPgSelesaiOffline(currentSesi.sesiId, user.nis)
      setPgSelesaiOfflinePending(false)
      setShowSyncFailModal(false)

      // FIX (fitur essay): sesi ini punya essay — JANGAN tampilkan halaman
      // hasil dan JANGAN lepas fullscreen. Nilai PG sudah dihitung & tersimpan
      // di server tapi baru dibuka ke siswa setelah essay dikirim (lihat
      // .../essay/kirim/route.ts). Backup jawaban PG boleh dibersihkan karena
      // jawaban PG sudah final di titik ini.
      if (res.lanjutEssay) {
        if (currentSesi && user?.nis) clearBackup(currentSesi.sesiId, user.nis)
        setKkmAwal(res.kkm ?? 75)
        setPhase('ESSAY_INFO')
        fetchEssayInfo()
        return
      }

      setHasilNilai(res as HasilAkhir)
      setPhase('SELESAI')
      if (currentSesi && user?.nis) clearBackup(currentSesi.sesiId, user.nis)
    } catch (err: unknown) {
      console.error(err)
      // err.status hanya ada kalau server SEMPAT merespons (401/403/409/dst —
      // penolakan sah, mis. sesi ditutup atau waktu habis). Tanpa err.status
      // berarti request tidak pernah sampai ke server sama sekali (jaringan
      // mati/timeout) — lihat pola yang sama di fetchEssayInfo/masukKeHalamanEssay.
      const status = (err as { status?: number } | undefined)?.status
      if (dipaksaPengawas || sesiClosedDuringSync) {
        // Sesi sudah ditutup pengawas dan endpoint penilaian pun gagal
        // (kemungkinan masalah jaringan saat itu) — biarkan siswa lihat
        // notifikasi penutupan sesi dan beri opsi coba lagi yang relevan,
        // bukan modal generik "koneksi tidak stabil".
        setSyncFailInfo({ expected: expectedCount, synced: totalSynced })
        setShowSyncFailModal(true)
      } else if (status === 409 && verified && amplopTersediaRef.current && currentSesiPunyaKlaimOffline()) {
        // FIX (terjebak di PG setelah reload): siswa yang sudah punya klaim
        // PG-selesai offline ditolak 409 (jendela waktu PG sudah lewat,
        // dihitung dengan jam server). Semua jawaban SUDAH terverifikasi
        // tersimpan (verified). Jangan biarkan siswa berputar di "Coba
        // Lagi": kalau kode darurat sudah tersimpan langsung lanjut ke Essay,
        // kalau belum tampilkan kotak kode darurat.
        const sid = sesiInfoRef.current?.sesiId
        const lanjut = sid ? await lanjutkanEssayDariKodeTersimpan(sid) : false
        if (!lanjut) {
          amankanPgOffline(expectedCount, totalSynced, true)
          setPgFinalisasiDitolak(true)
        }
      } else if (!status && verified) {
        // FIX BUG P0 (offline PG -> Essay, laporan simulasi: siswa mati
        // koneksi tepat saat submit PG, tidak pernah sampai ke essay/jalur
        // darurat). `verified` di sini SUDAH true — artinya loop di atas
        // sudah mengonfirmasi SEMUA jawaban tersimpan di server dengan
        // revisi yang cocok. Yang gagal murni panggilan FINALISASI-nya
        // (hitung nilai + tandai status), karena koneksi putus tepat di
        // titik ini. Sebelumnya siswa jatuh ke modal generik di bawah dan
        // TIDAK PERNAH punya jalan keluar selain "Coba Lagi" tanpa henti —
        // tidak pernah diarahkan ke essay ataupun ditawari jalur darurat,
        // walau jawabannya sendiri sudah 100% aman.
        //
        // Sekarang: simpan klaim waktu selesai (dipakai server murni untuk
        // audit — lihat klaimkanWaktu()), tandai pending supaya effect
        // terpisah mencoba lagi endpoint ini di background sampai berhasil,
        // dan (kalau sesi ini memang punya essay & amplopnya sudah terunduh
        // ke device — lihat amplopTersedia) izinkan modal di bawah
        // menampilkan kotak kode darurat SEKARANG JUGA, tanpa menunggu
        // koneksi pulih.
        amankanPgOffline(expectedCount, totalSynced, true)
      } else {
        // Gagal memanggil endpoint penilaian (bukan sekadar sync jawaban) —
        // beri kesempatan retry juga, jangan tampilkan layar kosong/diam.
        setSyncFailInfo({ expected: expectedCount, synced: totalSynced })
        setShowSyncFailModal(true)
      }
    } finally { setSubmitting(false) }
  }

  // ── Retry finalisasi PG di background (jalur offline -> essay) ───────────
  // Selama pgSelesaiOfflinePending true, setiap 15 detik:
  //   1) syncJawaban() — kirim SEMUA jawaban PG ke server dan tunggu ACK.
  //      WAJIB sebelum langkah 2: /api/siswa/ujian/selesai menghitung nilai
  //      dari baris `jawaban` di DATABASE, bukan dari localStorage browser.
  //      Kalau /selesai dipanggil sebelum jawaban tersinkron, nilai PG dihitung
  //      dari data kosong/sebagian. Auto-sync 30 detik di fase UJIAN juga
  //      sudah berhenti begitu siswa masuk ESSAY_KERJAKAN, jadi effect INI
  //      satu-satunya yang mengirim jawaban PG pada jalur offline.
  //   2) POST /selesai dengan `waktuSelesaiClient` = klaim yang tersimpan.
  // TANPA menghalangi siswa mengerjakan essay lewat jalur darurat. Berhenti
  // otomatis begitu server berhasil, atau menolak secara permanen.
  useEffect(() => {
    if (!pgSelesaiOfflinePending || pgFinalisasiDitolak) return
    const currentSesi = sesiInfoRef.current
    if (!currentSesi) return
    let selesai = false
    let sedangCoba = false
    const berhenti = (nis: string) => {
      selesai = true
      hapusKlaimPgSelesaiOffline(currentSesi.sesiId, nis)
      setPgSelesaiOfflinePending(false)
      clearInterval(id)
    }
    const cobaFinalisasi = async () => {
      if (selesai || sedangCoba) return
      sedangCoba = true
      try {
        let nis: string | undefined
        try { nis = JSON.parse(localStorage.getItem('user') ?? '{}').nis } catch { /* abaikan */ }
        if (!nis) return
        const klaim = ambilKlaimPgSelesaiOffline(currentSesi.sesiId, nis)
        if (!klaim) { selesai = true; setPgSelesaiOfflinePending(false); return }

        // 1) Sync dulu, pastikan server sudah punya semua jawaban PG.
        const expected = Object.keys(jawabanRef.current).length
        const sync = await syncJawaban()
        if (selesai) return
        if (sync.sesiClosed) {
          // Sesi sudah ditutup pengawas: sync/selesai pasti ditolak terus.
          // Nilai dihitung server dari jawaban yang sempat tersimpan (lihat
          // finalisasiNilaiPaksa); status essay ditangani cekStatusSesi.
          berhenti(nis)
          return
        }
        if (sync.locked) return // RESET/TERKUNCI: tunggu tick berikutnya
        const pernahDapatAck = Object.keys(ackTerakhirRef.current).length > 0
        const cocokAck = pernahDapatAck ? semuaSoalTerkonfirmasiRevisi() : true
        if (!(sync.ok && sync.totalSynced >= expected && cocokAck)) return // belum lengkap, coba lagi nanti
        setPgOfflineTerkonfirmasi(true)

        // 2) Finalisasi.
        const res = await apiRequest<{ id?: string; lanjutEssay?: boolean; kkm?: number } & Partial<HasilAkhir>>(
          '/api/siswa/ujian/selesai',
          {
            method: 'POST',
            body: JSON.stringify({ sesiId: currentSesi.sesiId, nis, isTimeout: false, waktuSelesaiClient: klaim }),
          }
        )
        if (selesai) return
        berhenti(nis)
        // Kalau siswa SUDAH terlanjur masuk essay lewat kode darurat
        // (phase ESSAY_KERJAKAN), jangan ganggu — server sekarang sudah
        // tahu PG selesai, biarkan siswa lanjut mengerjakan essay seperti
        // biasa. Rekonsiliasi status_essay-nya sendiri ditangani terpisah
        // oleh laporkanBukaOffline().
        // Semua jawaban PG sudah terverifikasi di server (cek sync di atas),
        // backup lokalnya boleh dihapus — juga saat siswa sedang di Essay.
        clearBackup(currentSesi.sesiId, nis)
        if (phaseRef.current === 'ESSAY_KERJAKAN') return
        setShowSyncFailModal(false)
        setJaringanBermasalah(false)
        if (res.lanjutEssay) {
          setKkmAwal(res.kkm ?? 75)
          setPhase('ESSAY_INFO')
          fetchEssayInfo()
        } else {
          setHasilNilai(res as HasilAkhir)
          setPhase('SELESAI')
        }
      } catch (e) {
        // Server SEMPAT merespons dengan penolakan permanen (409: waktu PG
        // habis / sesi tidak berjalan; 404): mengulang tiap 15 detik tidak
        // akan pernah berhasil — dulu loop ini diam-diam berputar selamanya.
        // Berhenti mengulang, tapi klaim DIPERTAHANKAN: kalau siswa masih di
        // fase UJIAN, lompat ke Essay dengan kode tersimpan atau tampilkan
        // kotak kode darurat. Nilai PG dihitung server dari jawaban yang sudah
        // tersinkron saat sesi ditutup. Tanpa status (jaringan) atau 403
        // (RESET/TERKUNCI, sementara): coba lagi di tick berikutnya.
        const status = (e as { status?: number } | undefined)?.status
        if ((status === 409 || status === 404) && !selesai) {
          selesai = true
          clearInterval(id)
          if (phaseRef.current === 'UJIAN') {
            const lanjut = await lanjutkanEssayDariKodeTersimpan(currentSesi.sesiId)
            if (!lanjut) setPgFinalisasiDitolak(true)
          } else {
            setPgFinalisasiDitolak(true)
          }
        }
      } finally {
        sedangCoba = false
      }
    }
    const id = setInterval(cobaFinalisasi, 15000)
    void cobaFinalisasi()
    return () => { selesai = true; clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pgSelesaiOfflinePending, pgFinalisasiDitolak])

  // Dipanggil dari tombol "Coba Lagi" di modal kegagalan sync.
  async function handleRetrySelesai() {
    setManualRetrying(true)
    try {
      await handleSelesai(false, sesiDitutupPaksa)
    } finally {
      // JANGAN menutup modal di sini: kalau percobaan ini gagal lagi,
      // handleSelesai() sudah menampilkannya kembali, dan `finally` ini
      // (berjalan SETELAH itu) dulu langsung menyembunyikannya — modal
      // "hilang" begitu saja setelah "Coba Lagi" gagal. Penutupan modal saat
      // BERHASIL sudah dilakukan di dalam handleSelesai().
      setManualRetrying(false)
    }
  }

  // Dipanggil dari tombol "Kembali ke Ujian" — siswa boleh menjawab/menunggu
  // koneksi pulih dulu, auto-sync di background tetap berjalan seperti biasa.
  function handleKembaliDariSyncFail() {
    setShowSyncFailModal(false)
  }

  // FIX: sebelumnya fungsi ini (dulu bernama handleKembaliFullscreen) tidak
  // pernah dipanggil dari UI manapun — sisa kode lama yang tidak
  // tersambung, padahal ikon Maximize & state isFS sudah disiapkan untuk ini
  // tapi tidak pernah dipakai. Sekarang dihubungkan ke tombol retry manual
  // di banner peringatan (lihat render phase UJIAN di bawah). Dipanggil dari
  // klik tombol → dalam gesture pengguna, jadi permintaan fullscreen browser
  // (yang butuh user-activation) punya peluang berhasil lebih tinggi
  // dibanding percobaan otomatis yang terjadi setelah await/setTimeout.
  function handleRetryFullscreen() {
    requestFullscreen(document.documentElement).catch(() => {})
    // FIX (APK Android): phase sudah 'UJIAN' di titik ini sehingga useEffect
    // berbasis [phase] tidak akan terpicu ulang — panggil eksplisit di sini
    // supaya tombol retry manual juga mencoba lagi lock native (screen
    // pinning), bukan cuma Fullscreen API web. No-op aman di luar APK.
    startExamLock()
  }

  async function handleVerifikasiResetDariOverlay() {
    if (!kodeReset.trim()) { setKodeResetError('Masukkan kode reset dari pengawas'); return }
    const currentSesi = sesiInfoRef.current
    if (!currentSesi) return
    setKodeResetLoading(true); setKodeResetError('')
    try {
      const res = await apiRequest<{ valid: boolean; waktu_mulai?: string; message?: string; terkunci_permanen?: boolean; jumlah_pelanggaran?: number }>('/api/siswa/ujian/verifikasi-reset', {
        method: 'POST',
        body: JSON.stringify({ sesiId: currentSesi.sesiId, kodeReset: kodeReset.trim().toUpperCase() }),
      })

      // FIX BUG (siswa terjebak di balik overlay pelanggaran tanpa jalan
      // keluar): popup ini sendiri tidak punya tombol apa pun selain kirim
      // kode reset, dan sebelumnya kasus terkunci permanen di sini hanya
      // menampilkan `kodeResetError` — siswa tetap tertutup overlay
      // fullscreen sampai polling terpisah (tiap 10 detik) akhirnya
      // memaksa pindah ke layar "Ujian Dihentikan". Sekarang tutup overlay
      // dan pindah SEKETIKA begitu server mengonfirmasi terkunci permanen.
      if (!res.valid && res.terkunci_permanen) {
        if (typeof res.jumlah_pelanggaran === 'number') setJumlahPelanggaran(res.jumlah_pelanggaran)
        setShowWarningOverlay(false)
        setKodeResetError('')
        setDikeluarkan(true)
        return
      }

      if (!res.valid) { setKodeResetError(res.message ?? 'Kode tidak valid'); return }
      // FIX: hitung sisa waktu dari waktu_mulai_awal (bukan dari sekarang)
      let sisaSetelahReset = currentSesi.durasi * 60
      if (res.waktu_mulai) {
        const terpakai = Math.floor((Date.now() - new Date(res.waktu_mulai).getTime()) / 1000)
        sisaSetelahReset = Math.max(0, currentSesi.durasi * 60 - terpakai)
        setSisaWaktu(sisaSetelahReset)
      }
      setKodeReset('')
      setKodeResetError('')
      setShowWarningOverlay(false)
      setWarningMsg('')
      pelanggaranActiveRef.current = false
      requestFullscreen(document.documentElement).catch(() => {})
      // FIX (APK Android): momen paling penting untuk re-lock — ini titik di
      // mana siswa baru saja diverifikasi pengawas setelah pelanggaran
      // (mis. sempat keluar app / screen pinning terlepas). phase tetap
      // 'UJIAN' sepanjang alur ini jadi useEffect [phase] tidak refire,
      // sehingga perlu dipanggil eksplisit di sini. No-op aman di luar APK.
      startExamLock()

      // FIX BUG #2 (lanjutan): begitu waktu habis, timer 1-detik menghentikan
      // dirinya sendiri (lihat efek timer di atas) dan tidak akan pernah tick
      // lagi hanya karena overlay ini ditutup — jadi kalau siswa BARU selesai
      // memasukkan kode reset SETELAH deadline lewat (skenario yang memicu
      // bug ini: waktu habis saat overlay RESET masih menutupi layar),
      // percobaan submit yang tadinya diblokir (lihat handleSelesai/`locked`)
      // tidak akan pernah diulang otomatis. Picu ulang di sini secara eksplisit.
      if (sisaSetelahReset <= 0) {
        setTimeout(() => handleSelesai(true), 0)
      }
    } catch (err: unknown) {
      setKodeResetError(err instanceof Error ? err.message : 'Gagal memverifikasi kode')
    } finally { setKodeResetLoading(false) }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ── FASE ESSAY (fitur essay) ──────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════

  // ── Ambil info essay (halaman sebelum tombol "Mulai") ─────────────────────
  // FIX BUG (halaman putih kosong): parameter `sesiIdOverride` opsional
  // ditambahkan karena fungsi ini kadang dipanggil TEPAT SETELAH
  // `setSesiInfo(...)` di pemanggilnya, dalam sinkronisasi JS yang sama
  // (lihat cekJadwal() dan handleRefreshJadwal()). `sesiInfoRef.current`
  // baru di-update oleh useEffect terpisah SETELAH React commit render
  // berikutnya — jadi kalau fungsi ini langsung membaca `sesiInfoRef.current`
  // di titik itu, yang terbaca masih nilai LAMA (null, pada mount pertama),
  // bukan sesiId yang baru saja di-set. Akibatnya `if (!currentSesi) return`
  // langsung memutus eksekusi tanpa mengisi `essayInfo`/`errorEssay` sama
  // sekali, sementara `phase` sudah terlanjur 'ESSAY_INFO' — hasilnya kartu
  // ESSAY_INFO jatuh ke cabang `: null` di JSX (loadingEssayInfo=false,
  // errorEssay='', essayInfo=null) dan tampil kosong/putih tanpa tombol
  // apa pun untuk keluar, PERSIS skenario siswa yang dikunci pengawas di
  // tengah fase essay lalu membuka ulang aplikasi. Sekarang pemanggil yang
  // baru saja punya sesiId segar (belum tentu tersinkron ke ref) WAJIB
  // mengoper sesiId itu secara eksplisit lewat parameter ini, alih-alih
  // mengandalkan ref yang bisa basi.
  async function fetchEssayInfo(sesiIdOverride?: string) {
    const currentSesiId = sesiIdOverride ?? sesiInfoRef.current?.sesiId
    if (!currentSesiId) return
    setLoadingEssayInfo(true)
    setErrorEssay('')
    try {
      const res = await apiRequest<EssayInfo>(`/api/siswa/ujian/essay/info?sesiId=${currentSesiId}`)
      setJaringanBermasalah(false)
      setEssayInfo(res)
      essayInfoRef.current = res
      // Idempotent: kalau siswa sudah pernah menekan "Mulai" sebelumnya (mis.
      // refresh halaman di tengah mengerjakan essay), langsung lanjut ke
      // halaman soal — jangan tampilkan lagi halaman info + tombol "Mulai".
      if (res.statusEssay === 'MENGERJAKAN') {
        await masukKeHalamanEssay(currentSesiId)
      } else {
        // Siswa sempat membuka essay OFFLINE (kode darurat) lalu halaman
        // di-refresh sebelum sempat melapor ke server. Internet sudah pulih
        // (request info berhasil) → laporkan sekarang, lalu lanjut seperti biasa.
        let nisUser: string | undefined
        try { nisUser = JSON.parse(localStorage.getItem('user') ?? '{}').nis } catch { /* abaikan */ }
        if (nisUser && ambilStatusOffline(currentSesiId, nisUser).kode) {
          const hasil = await laporkanBukaOffline(currentSesiId)
          if (hasil === 'ok') await masukKeHalamanEssay(currentSesiId)
        }
      }
    } catch (err: unknown) {
      // Catatan: kalau siswa TERKUNCI/RESET (lihat guard baru di
      // essay/info/route.ts), error ini tampil sebagai kartu "Coba Lagi" —
      // sama seperti perlakuan error dari essay/mulai & essay/soal yang
      // sudah lebih dulu memakai guard yang sama (lihat masukKeHalamanEssay
      // di bawah). Ini memang tidak sebagus layar "Ujian Dihentikan" yang
      // dipakai phase UJIAN, tapi setidaknya siswa melihat PESAN yang jelas
      // alih-alih halaman kosong — perbaikan intinya ada di parameter
      // sesiIdOverride di atas, bukan di sini.
      if (!(err as { status?: number } | undefined)?.status) setJaringanBermasalah(true)
      setErrorEssay(err instanceof Error ? err.message : 'Gagal memuat info essay')
    } finally {
      setLoadingEssayInfo(false)
    }
  }

  // ── Mulai timer essay + ambil soal + pulihkan draft jawaban, lalu pindah
  // ke phase ESSAY_KERJAKAN. Dipakai baik dari tombol "Mulai" (entry baru)
  // maupun dari resume otomatis (refresh halaman saat status sudah MENGERJAKAN).
  async function masukKeHalamanEssay(sesiId: string) {
    setLoadingEssaySoal(true)
    setErrorEssay('')
    try {
      // FIX BUG (race condition "Sesi essay belum dimulai" walau baru tekan
      // Mulai): sebelumnya /mulai (POST — mengubah status_essay siswa di DB
      // dari BELUM_MULAI ke MENGERJAKAN) dan /soal (GET — MENSYARATKAN
      // status_essay sudah MENGERJAKAN, lihat guard di essay/soal/route.ts)
      // ditembak BERSAMAAN lewat Promise.all. Kalau request /soal sempat
      // sampai & dicek server SEBELUM update status dari /mulai selesai
      // tersimpan, /soal menolak dengan error "belum dimulai" walau siswa
      // baru saja menekan tombol Mulai — persis skenario yang dilaporkan.
      // (Tombol "Coba Lagi" biasanya berhasil di percobaan kedua karena
      // /mulai di percobaan pertama itu SUDAH terlanjur berhasil mengubah
      // status di DB, walau /soal-nya gagal.)
      //
      // FIX: panggil /mulai dan TUNGGU sampai selesai lebih dulu — baru
      // panggil /soal setelahnya. Ini menghilangkan race-nya sepenuhnya
      // karena status_essay dijamin sudah MENGERJAKAN di DB sebelum /soal
      // sempat dicek server.
      // FIX BUG (essay/mulai tidak memeriksa deviceId): sertakan deviceId,
      // sama seperti syncJawaban()/essay/jawab/essay/kirim, supaya backend
      // bisa menegakkan kebijakan satu siswa satu perangkat sejak titik
      // masuk fase essay, bukan baru mulai dari autosave.
      const mulaiRes = await apiRequest<{ waktuMulaiEssay: string }>('/api/siswa/ujian/essay/mulai', {
        method: 'POST',
        body: JSON.stringify({ sesiId, deviceId: getDeviceId() }),
      })
      const soalRes = await apiRequest<{ data: SoalEssay[] }>(`/api/siswa/ujian/essay/soal?sesiId=${sesiId}`)
      setEssayList(soalRes.data ?? [])

      const info = essayInfoRef.current
      const durasiDetik = (info?.durasiMenit ?? 0) * 60
      // FIX (timer Essay basis absolut): simpan referensi waktu mulai essay
      // dari server ke ref — dipakai timer di bawah untuk menghitung ulang
      // sisa waktu tiap tick, sama seperti sesiInfoRef.waktu_mulai untuk PG.
      waktuMulaiEssayRef.current = mulaiRes.waktuMulaiEssay
      const terpakai = Math.floor((Date.now() - new Date(mulaiRes.waktuMulaiEssay).getTime()) / 1000)
      setSisaWaktuEssay(Math.max(0, durasiDetik - terpakai))

      // Pulihkan draft jawaban (mode DIGITAL): dari server dulu, digabung
      // dengan backup lokal berdasarkan JAM masing-masing — pola sama seperti
      // resumeJawaban() untuk PG (lihat FIX BUG P1-01 di komentar atas file).
      if (info?.modeJawaban === 'DIGITAL') {
        const user = JSON.parse(localStorage.getItem('user') ?? '{}')
        let serverJawaban: JawabanEssayMap = {}
        let serverTs: Record<string, number> = {}
        try {
          // FIX BUG #10: sertakan deviceId supaya backend bisa menegakkan
          // guard anti multi-device di fase essay (lihat essay/jawab/route.ts GET).
          const jr = await apiRequest<{ jawaban: { soal_essay_id: string; jawaban_teks: string; updated_at?: string }[] }>(
            `/api/siswa/ujian/essay/jawab?sesiId=${sesiId}&deviceId=${getDeviceId()}`
          )
          serverJawaban = Object.fromEntries((jr.jawaban ?? []).map(j => [j.soal_essay_id, j.jawaban_teks]))
          serverTs = Object.fromEntries(
            (jr.jawaban ?? []).map(j => [j.soal_essay_id, j.updated_at ? new Date(j.updated_at).getTime() : 0])
          )
        } catch { /* pakai backup lokal saja kalau gagal */ }
        const backup = loadEssayBackup(sesiId, user.nis)
        const { merged, ts } = mergeJawabanDenganWaktu(serverJawaban, serverTs, backup.v, backup.t)
        jawabanEssayRef.current = merged
        jawabanEssayTsRef.current = ts
        setJawabanEssay(merged)
      }

      setPhase('ESSAY_KERJAKAN')
      setTimeout(() => requestFullscreen(document.documentElement).catch(() => {}), 100)
    } catch (err: unknown) {
      if (!(err as { status?: number } | undefined)?.status) setJaringanBermasalah(true)
      setErrorEssay(err instanceof Error ? err.message : 'Gagal memulai essay')
    } finally {
      setLoadingEssaySoal(false)
    }
  }

  // ── Jalur OFFLINE: buka essay dari amplop yang sudah didekripsi ───────────
  // Padanan masukKeHalamanEssay() tapi TANPA request ke server: soal & info
  // datang dari dalam amplop, waktu mulai dari jam perangkat. Server baru
  // diberi tahu belakangan lewat laporkanBukaOffline() (rekonsiliasi).
  async function masukKeHalamanEssayOffline(
    isi: { info: Omit<EssayInfo, 'statusEssay' | 'aksesMulaiDibuka'>; soal: SoalEssay[] },
    sesiId: string,
    waktuMulaiIso: string
  ) {
    const info: EssayInfo = { ...isi.info, statusEssay: 'MENGERJAKAN', aksesMulaiDibuka: true }
    setEssayInfo(info)
    essayInfoRef.current = info
    setEssayList([...isi.soal].sort((a, b) => a.urutan - b.urutan))

    waktuMulaiEssayRef.current = waktuMulaiIso
    const terpakai = Math.floor((Date.now() - new Date(waktuMulaiIso).getTime()) / 1000)
    setSisaWaktuEssay(Math.max(0, info.durasiMenit * 60 - terpakai))

    // Draft jawaban: hanya backup lokal (server tidak terjangkau).
    if (info.modeJawaban === 'DIGITAL') {
      const user = JSON.parse(localStorage.getItem('user') ?? '{}')
      const backup = loadEssayBackup(sesiId, user.nis)
      jawabanEssayRef.current = backup.v
      jawabanEssayTsRef.current = backup.t
      setJawabanEssay(backup.v)
    }

    setErrorEssay('')
    setPhase('ESSAY_KERJAKAN')
    setTimeout(() => requestFullscreen(document.documentElement).catch(() => {}), 100)
  }

  // Dipanggil dari tombol "Buka Soal Essay" di kotak kode darurat.
  async function handleBukaKodeDarurat() {
    const currentSesi = sesiInfoRef.current
    if (!currentSesi) return
    const kodeBersih = kodeDarurat.trim()
    if (kodeBersih.length !== PANJANG_KODE_DARURAT) {
      setKodeDaruratError(`Kode darurat terdiri dari ${PANJANG_KODE_DARURAT} angka.`)
      return
    }
    const sisaKunci = Math.ceil((kodeDaruratKunciSampai - Date.now()) / 1000)
    if (sisaKunci > 0) {
      setKodeDaruratError(`Terlalu banyak salah. Tunggu ${sisaKunci} detik.`)
      return
    }
    let nis: string | undefined
    try { nis = JSON.parse(localStorage.getItem('user') ?? '{}').nis } catch { /* abaikan */ }
    if (!nis) { setKodeDaruratError('Data siswa tidak ditemukan. Login ulang.'); return }
    const amplop = ambilAmplop(currentSesi.sesiId, nis)
    if (!amplop) {
      setKodeDaruratError('Soal essay terenkripsi belum ada di perangkat ini. Hubungi pengawas.')
      return
    }

    setKodeDaruratLoading(true)
    setKodeDaruratError('')
    try {
      const isi = await bukaAmplop(amplop, currentSesi.sesiId, kodeBersih)
      const status = ambilStatusOffline(currentSesi.sesiId, nis)
      if (!isi) {
        const salah = status.salah + 1
        simpanStatusOffline(currentSesi.sesiId, nis, { ...status, salah })
        if (salah % 5 === 0) setKodeDaruratKunciSampai(Date.now() + 30_000)
        setKodeDaruratError('Kode salah. Periksa kembali kode dari pengawas.')
        return
      }
      // Kalau siswa sudah pernah membuka offline sebelumnya (mis. refresh
      // halaman), PERTAHANKAN waktu mulai pertama — jangan diulang dari nol.
      const waktuMulai = status.waktuMulaiClient ?? new Date().toISOString()
      simpanStatusOffline(currentSesi.sesiId, nis, { ...status, waktuMulaiClient: waktuMulai, kode: kodeBersih })
      setKodeDarurat('')
      await masukKeHalamanEssayOffline(
        isi as unknown as Parameters<typeof masukKeHalamanEssayOffline>[0],
        currentSesi.sesiId,
        waktuMulai
      )
    } catch (err) {
      setKodeDaruratError(
        err instanceof EnkripsiTidakDidukungError
          ? err.message
          : 'Gagal membuka soal. Coba lagi atau hubungi pengawas.'
      )
    } finally {
      setKodeDaruratLoading(false)
    }
  }

  // Rekonsiliasi: beri tahu server bahwa essay sudah dibuka offline. Server
  // memverifikasi kode (yang hanya diketahui siswa yang benar-benar diberi
  // pengawas), lalu mengunci status_essay=MENGERJAKAN + waktu_mulai_essay.
  //   'ok'      → tercatat di server, status lokal dihapus
  //   'retry'   → masalah jaringan/server sementara, coba lagi nanti
  //   'ditolak' → server menolak permanen (kode/perangkat/sesi) — berhenti
  //               mencoba supaya tidak menghabiskan jatah percobaan
  async function laporkanBukaOffline(sesiId: string): Promise<'ok' | 'retry' | 'ditolak'> {
    let nis: string | undefined
    try { nis = JSON.parse(localStorage.getItem('user') ?? '{}').nis } catch { /* abaikan */ }
    if (!nis) return 'ditolak'
    const status = ambilStatusOffline(sesiId, nis)
    if (!status.kode) return 'ok'
    try {
      const res = await apiRequest<{ waktuMulaiEssay: string }>('/api/siswa/ujian/essay/mulai', {
        method: 'POST',
        body: JSON.stringify({
          sesiId,
          deviceId: getDeviceId(),
          kodeDarurat: status.kode,
          waktuMulaiClient: status.waktuMulaiClient,
          percobaanSalah: status.salah,
        }),
      })
      // Server adalah sumber kebenaran waktu mulai (sudah di-clamp).
      waktuMulaiEssayRef.current = res.waktuMulaiEssay
      hapusStatusOffline(sesiId, nis)
      setJaringanBermasalah(false)
      return 'ok'
    } catch (e) {
      const err = e as { status?: number; data?: { sementara?: boolean } } | undefined
      const st = err?.status
      // FIX: TERKUNCI/RESET bersifat sementara (recoverable) — JANGAN hapus
      // bukti offline, cukup coba lagi nanti (loop 10 detik yang sudah ada
      // akan otomatis mengulang begitu status siswa pulih).
      if (st === 403 && err?.data?.sementara) {
        setErrorEssay(e instanceof Error ? e.message : 'Akses ujian Anda sedang dikunci/menunggu reset.')
        return 'retry'
      }
      if (st === 403 || st === 409 || st === 429) {
        hapusStatusOffline(sesiId, nis)
        setErrorEssay(e instanceof Error ? e.message : 'Server menolak pembukaan essay offline.')
        return 'ditolak'
      }
      return 'retry'
    }
  }

  // Kotak input kode darurat — tampil hanya saat jaringan bermasalah.
  function renderGerbangKodeDarurat() {
    if (!jaringanBermasalah) return null
    return (
      <div className="border border-amber-200 bg-amber-50 rounded-xl px-4 py-3 mt-4 text-left">
        <div className="flex items-center gap-2 mb-1">
          <KeyRound className="w-4 h-4 text-amber-700 flex-shrink-0" />
          <p className="text-sm font-semibold text-amber-800">Koneksi internet terputus?</p>
        </div>
        {amplopTersedia ? (
          <>
            <p className="text-xs text-amber-700 mb-3">
              Minta kode darurat kepada pengawas, lalu masukkan di bawah untuk membuka soal essay tanpa internet.
            </p>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className={`input text-center text-xl font-mono tracking-widest mb-2 ${kodeDaruratError ? 'input-error' : ''}`}
              placeholder={'•'.repeat(PANJANG_KODE_DARURAT)}
              maxLength={PANJANG_KODE_DARURAT}
              value={kodeDarurat}
              onChange={e => { setKodeDarurat(e.target.value.replace(/\D/g, '')); setKodeDaruratError('') }}
              onKeyDown={e => e.key === 'Enter' && handleBukaKodeDarurat()}
            />
            {kodeDaruratError && (
              <div className="alert-error mb-2 text-left">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{kodeDaruratError}</span>
              </div>
            )}
            <button
              onClick={handleBukaKodeDarurat}
              disabled={kodeDaruratLoading || kodeDarurat.length !== PANJANG_KODE_DARURAT}
              className="btn-primary w-full justify-center py-2.5"
            >
              {kodeDaruratLoading ? <Spinner size="sm" /> : 'Buka Soal Essay'}
            </button>
          </>
        ) : (
          <p className="text-xs text-amber-700">
            Soal essay terenkripsi belum sempat tersimpan di perangkat ini (perangkat belum terhubung
            ke internet saat ujian dimulai), sehingga kode darurat tidak dapat dipakai. Beri tahu pengawas.
          </p>
        )}
      </div>
    )
  }

  async function handleMulaiEssay() {
    const currentSesi = sesiInfoRef.current
    if (!currentSesi) return
    await masukKeHalamanEssay(currentSesi.sesiId)
  }

  // ── Autosave jawaban essay (mode DIGITAL), dengan retry pola sama seperti
  // syncJawaban() untuk PG. ─────────────────────────────────────────────────
  const MAX_ESSAY_SYNC_RETRY = 4
  const syncJawabanEssayInternal = useCallback(async (): Promise<{ ok: boolean }> => {
    const currentSesi = sesiInfoRef.current
    const currentJawaban = jawabanEssayRef.current
    if (!currentSesi) return { ok: true }
    const entries = Object.entries(currentJawaban)
    if (entries.length === 0) return { ok: true }

    setEssaySyncStatus('syncing')
    for (let attempt = 1; attempt <= MAX_ESSAY_SYNC_RETRY; attempt++) {
      try {
        // FIX BUG #10: sertakan deviceId, sama seperti syncJawaban() untuk PG,
        // supaya guard anti multi-device juga berlaku di autosave essay.
        await apiRequest('/api/siswa/ujian/essay/jawab', {
          method: 'POST',
          body: JSON.stringify({
            sesiId: currentSesi.sesiId,
            jawaban: entries.map(([soal_essay_id, teks]) => ({ soal_essay_id, jawaban_teks: teks })),
            deviceId: getDeviceId(),
          }),
        })
        setEssaySyncStatus('synced')
        return { ok: true }
      } catch (e) {
        console.warn(`Sync essay percobaan ke-${attempt} gagal:`, e)
        const status = (e as { status?: number } | undefined)?.status
        if (status === 409 || status === 403) {
          // Sesi ditutup / akses dikunci — tidak ada gunanya mengulang.
          setEssaySyncStatus('error')
          return { ok: false }
        }
        if (attempt < MAX_ESSAY_SYNC_RETRY) {
          await new Promise(r => setTimeout(r, attempt * 1500))
        }
      }
    }
    setEssaySyncStatus('error')
    return { ok: false }
  }, [])

  // FIX BUG (P1-02, padanan essay): sama seperti syncJawaban() untuk PG —
  // serialisasi autosave essay (interval 30 detik) dengan panggilan manual
  // dari handleKirimEssay(), supaya ketikan terakhir siswa tidak pernah
  // ditimpa balik oleh request autosave lama yang kebetulan selesai belakangan.
  const essaySyncChainRef = useRef<Promise<unknown>>(Promise.resolve())
  const syncJawabanEssay = useCallback((): Promise<{ ok: boolean }> => {
    const next = essaySyncChainRef.current.then(syncJawabanEssayInternal, syncJawabanEssayInternal)
    essaySyncChainRef.current = next.catch(() => {})
    return next
  }, [syncJawabanEssayInternal])

  // ── Timer fase essay — SEKARANG benar-benar dihitung ulang tiap tick dari
  // referensi absolut (waktuMulaiEssayRef), sama seperti timer PG. ─────────
  useEffect(() => {
    if (phase !== 'ESSAY_KERJAKAN') return
    essayTimerRef.current = setInterval(() => {
      const info = essayInfoRef.current
      if (!info) return
      // FIX (timer Essay masih basis lokal — rentan drift saat tab
      // di-throttle browser): SEBELUMNYA tick ini hanya mengurangi
      // `sisaWaktuEssay` lokal (`prev - 1`) setiap 1 detik, TIDAK PERNAH
      // dihitung ulang dari referensi waktu server selama essay berjalan —
      // sama persis masalah yang sudah lebih dulu diperbaiki untuk timer PG
      // (lihat komentar FIX BUG #1 di timer PG, useEffect [phase] lain di
      // atas). Kalau tab di-throttle/laptop sleep, detik yang "hilang" tidak
      // pernah dikoreksi — tampilan sisa waktu jadi lebih besar dari
      // kenyataan sampai tab aktif lagi.
      //
      // FIX: setiap tick, hitung ULANG sisa waktu dari waktuMulaiEssayRef
      // (waktu_mulai_essay dari server, diisi sekali di masukKeHalamanEssay
      // dan tidak pernah berubah selama fase essay ini). setInterval jadi
      // cuma pemicu "kapan render ulang", BUKAN sumber kebenaran sisa waktu.
      //
      // TIDAK ADA PERUBAHAN LOGIKA BISNIS: kondisi & aksi saat waktu habis
      // (auto-submit untuk mode DIGITAL, popup+bunyi tanpa auto-submit untuk
      // mode KERTAS) persis sama seperti sebelumnya — hanya SUMBER angka
      // sisa waktunya yang diperbaiki. Validasi akhir tetap di server
      // (sudahLewatBatasWaktuEssay, dipanggil essay/jawab & essay/kirim),
      // jadi drift kecil yang mungkin masih tersisa (mis. belum sempat
      // menerima waktuMulaiEssayRef) tetap tidak berdampak ke penilaian.
      if (waktuMulaiEssayRef.current && info.durasiMenit) {
        const durasiDetik = info.durasiMenit * 60
        const terpakaiDetik = Math.floor((Date.now() - new Date(waktuMulaiEssayRef.current).getTime()) / 1000)
        const sisaBaru = Math.max(0, durasiDetik - terpakaiDetik)
        setSisaWaktuEssay(sisaBaru)
        if (sisaBaru <= 0) {
          clearInterval(essayTimerRef.current!)
          if (info.modeJawaban === 'DIGITAL') {
            setTimeout(() => handleKirimEssay(true), 0)
          } else {
            // Mode KERTAS: JANGAN auto-submit — cukup beri tahu siswa +
            // bunyi, siswa tetap menunggu pengawas membuka akses kirim.
            setEssayWaktuHabisPopup(true)
            try {
              const audio = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=')
              audio.play().catch(() => {})
            } catch { /* abaikan kalau browser blokir autoplay */ }
          }
        }
        return
      }
      // Fallback (seharusnya tidak terjadi — waktuMulaiEssayRef selalu diisi
      // di masukKeHalamanEssay sebelum phase berubah jadi ESSAY_KERJAKAN,
      // sama seperti fallback pada timer PG): tetap jaga UI tidak macet
      // total kalau referensi absolut kebetulan belum terisi.
      setSisaWaktuEssay(prev => {
        if (prev <= 1) {
          clearInterval(essayTimerRef.current!)
          if (info.modeJawaban === 'DIGITAL') {
            setTimeout(() => handleKirimEssay(true), 0)
          } else {
            setEssayWaktuHabisPopup(true)
            try {
              const audio = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=')
              audio.play().catch(() => {})
            } catch { /* abaikan kalau browser blokir autoplay */ }
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(essayTimerRef.current!)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ── Auto sync jawaban essay tiap 30 detik (mode DIGITAL saja) ────────────
  useEffect(() => {
    if (phase !== 'ESSAY_KERJAKAN' || essayInfo?.modeJawaban !== 'DIGITAL') return
    essaySyncRef.current = setInterval(() => syncJawabanEssay(), 30000)
    return () => clearInterval(essaySyncRef.current!)
  }, [phase, essayInfo, syncJawabanEssay])

  // ── Poll akses "Mulai Essay" (toggle global per sesi, lihat
  // 11_akses_mulai_essay.sql) — selama siswa di halaman info essay (belum
  // menekan "Mulai"), tombolnya harus otomatis aktif begitu pengawas
  // menyalakan toggle, tanpa siswa perlu refresh manual. Berlaku untuk
  // KEDUA mode jawaban (beda dari poll akses kirim di atas yang KERTAS-only).
  useEffect(() => {
    if (phase !== 'ESSAY_INFO') return
    const currentSesi = sesiInfoRef.current
    if (!currentSesi) return
    const cek = async () => {
      try {
        const res = await apiRequest<EssayInfo>(`/api/siswa/ujian/essay/info?sesiId=${currentSesi.sesiId}`)
        // Idempotent-guard sama seperti fetchEssayInfo: kalau ternyata sudah
        // MENGERJAKAN (mis. tab lain sudah menekan "Mulai" duluan), jangan
        // timpa info dengan data stale — cukup diamkan, biar fetchEssayInfo
        // yang sudah dipanggil sebelumnya yang menangani transisi phase.
        if (res.statusEssay === 'MENGERJAKAN') return
        setJaringanBermasalah(false)
        setEssayInfo(res)
        essayInfoRef.current = res
      } catch (e) {
        // Tidak ada status HTTP = request tidak sampai ke server (internet
        // mati/timeout) → munculkan jalur kode darurat. Error dengan status
        // (403/409/dst) berarti server terjangkau, bukan masalah jaringan.
        if (!(e as { status?: number } | undefined)?.status) setJaringanBermasalah(true)
      }
    }
    essayAksesMulaiPollRef.current = setInterval(cek, 8000)
    return () => clearInterval(essayAksesMulaiPollRef.current!)
  }, [phase])

  // ── Rekonsiliasi essay yang dibuka OFFLINE (kode darurat) ─────────────────
  // Selama siswa mengerjakan essay dari amplop, server belum tahu apa-apa
  // (status_essay masih BELUM_MULAI). Coba lapor tiap 10 dtk sampai berhasil;
  // baru setelah itu autosave/kirim (yang mensyaratkan status MENGERJAKAN di
  // server) bisa berjalan normal.
  useEffect(() => {
    if (phase !== 'ESSAY_KERJAKAN') return
    const sesi = sesiInfoRef.current
    if (!sesi) return
    let selesai = false
    const coba = async () => {
      if (selesai || rekonsiliasiBerjalanRef.current) return
      rekonsiliasiBerjalanRef.current = true
      try {
        const hasil = await laporkanBukaOffline(sesi.sesiId)
        if (hasil !== 'retry') {
          selesai = true
          clearInterval(id)
          if (hasil === 'ok') void syncJawabanEssay()
        }
      } finally {
        rekonsiliasiBerjalanRef.current = false
      }
    }
    const id = setInterval(coba, 10000)
    void coba()
    return () => { selesai = true; clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, syncJawabanEssay])

  // ── Kirim essay (titik akhir alur) — membuka nilai PG & melepas fullscreen ─
  async function handleKirimEssay(isTimeout = false) {
    if (submittingEssay) return
    setConfirmKirimEssay(false)
    setSubmittingEssay(true)
    const currentSesi = sesiInfoRef.current
    if (!currentSesi) { setSubmittingEssay(false); return }

    // FIX BUG P1 (jawaban essay bisa hilang saat "Kirim"): sebelumnya hasil
    // syncJawabanEssay() di sini TIDAK PERNAH diperiksa — kalau autosave
    // terakhir ini gagal (mis. koneksi jelek tepat sebelum siswa menekan
    // Kirim), proses tetap lanjut ke essay/kirim, dan server langsung
    // menandai status SUDAH_KIRIM/SELESAI seolah semua beres — padahal
    // ketikan TERAKHIR siswa belum tentu tersimpan di server. Siswa tidak
    // pernah diberi tahu ada kemungkinan jawabannya hilang.
    // FIX: kalau sync gagal, HENTIKAN proses kirim di sini — beri pesan
    // eksplisit ke siswa & biarkan dia mencoba lagi (bukan diam-diam
    // melanjutkan ke status selesai). Auto-submit karena waktu habis
    // (isTimeout=true) TETAP dilanjutkan walau sync gagal — waktunya sudah
    // resmi habis di server, essay harus ditutup, jawaban yang SEMPAT
    // ter-autosave sebelumnya tetap tersimpan dan bisa dinilai guru — hanya
    // pesan ke siswa yang dibedakan supaya dia tahu ada kemungkinan
    // ketikan terakhirnya tidak ikut tersimpan.
    if (essayInfoRef.current?.modeJawaban === 'DIGITAL') {
      const syncTerakhir = await syncJawabanEssay()
      if (!syncTerakhir.ok) {
        if (!isTimeout) {
          setSubmittingEssay(false)
          setErrorEssay(
            'Jawaban terakhir Anda GAGAL disimpan ke server (periksa koneksi internet Anda). ' +
            'Essay BELUM dikirim — silakan coba tekan tombol "Kirim Jawaban Essay" lagi setelah koneksi stabil.'
          )
          return
        }
        setEssaySyncGagalSaatTimeout(true)
      }
    }

    clearInterval(essayTimerRef.current!)
    clearInterval(essaySyncRef.current!)

    try {
      const res = await apiRequest<{ sudahDikirim: boolean; nilaiPg: { id?: string; benar: number; total: number; kkm: number } | null }>(
        '/api/siswa/ujian/essay/kirim',
        // FIX BUG (essay/kirim tidak memeriksa deviceId): sertakan deviceId,
        // sama seperti syncJawaban()/essay/jawab, supaya backend bisa menolak
        // pengiriman dari perangkat yang bukan device aktif siswa ini.
        { method: 'POST', body: JSON.stringify({ sesiId: currentSesi.sesiId, deviceId: getDeviceId() }) }
      )
      // Tampilkan halaman hasil KHUSUS essay (nilai_total masih menunggu
      // koreksi guru, jadi TIDAK memakai layout lulus/grade biasa) — BARU DI
      // SINI lepas fullscreen (ditangani oleh efek [phase] yang sudah ada,
      // karena 'SELESAI' termasuk dalam daftar fase yang melepas fullscreen).
      setNilaiPgSetelahEssay(res.nilaiPg)
      setEssaySelesaiDikirim(true)
      setPhase('SELESAI')
    } catch (err: unknown) {
      console.error(err)
      setErrorEssay(err instanceof Error ? err.message : 'Gagal mengirim essay. Periksa koneksi dan coba lagi.')
    } finally {
      setSubmittingEssay(false)
      void isTimeout
    }
  }

  const formatWaktu = (detik: number) => {
    const m = Math.floor(detik / 60)
    const s = detik % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  const soalList = sesiInfo?.soalList ?? []
  const soalCurrent = soalList[currentIdx]
  const totalDijawab = Object.values(jawaban).filter(Boolean).length
  const opsiLabels = ['A', 'B', 'C', 'D', 'E']

  // ── Helper: jam sekarang vs jam_mulai ────────────────────────────────────
  function hitungSelisihMenit(jam_mulai: string): number {
    const now = new Date()
    const [h, m] = jam_mulai.split(':').map(Number)
    const mulai = new Date(now)
    mulai.setHours(h, m, 0, 0)
    return Math.floor((mulai.getTime() - now.getTime()) / 60000)
  }

  // ── Overlay yang dipakai bersama di fase UJIAN, ESSAY_INFO, ESSAY_KERJAKAN ─
  // (diekstrak supaya siswa mendapat proteksi anti-kecurangan yang SAMA
  // persis selama fase essay seperti selama fase PG — bukan cuma di UJIAN).
  const pelanggaranOverlayJSX = showWarningOverlay && (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
      style={{ background: 'rgba(15,23,42,0.97)' }}
    >
      <div className="max-w-sm w-full mx-4 bg-white rounded-2xl p-8 text-center shadow-2xl">
        <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-8 h-8 text-red-600" />
        </div>
        <h2 className="text-lg font-bold text-slate-900 mb-2">Pelanggaran Terdeteksi!</h2>
        <p className="text-sm text-slate-600 mb-1">{warningMsg}</p>
        <p className="text-xs text-red-500 font-medium mb-4">
          Pelanggaran ke-{pelanggRef.current} — Aktivitas ini dilaporkan ke pengawas
        </p>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 text-left">
          <p className="text-xs text-amber-700 font-semibold mb-1">⚠ Diperlukan Kode dari Pengawas</p>
          <p className="text-xs text-amber-600">Hubungi pengawas dan minta kode 7 digit untuk melanjutkan ujian.</p>
        </div>
        {kodeResetError && (
          <div className="alert-error mb-3 text-left text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>{kodeResetError}</span>
          </div>
        )}
        <input
          type="text"
          className="input text-center text-xl font-mono tracking-widest uppercase mb-3"
          placeholder="KODE RESET"
          maxLength={7}
          value={kodeReset}
          onChange={e => { setKodeReset(e.target.value.toUpperCase()); setKodeResetError('') }}
          onKeyDown={e => e.key === 'Enter' && handleVerifikasiResetDariOverlay()}
        />
        <button
          onClick={handleVerifikasiResetDariOverlay}
          disabled={kodeResetLoading}
          className="btn-primary w-full justify-center py-3 text-base"
        >
          {kodeResetLoading ? <Spinner size="sm" /> : (
            <>
              <KeyRound className="w-4 h-4" />
              Masukkan Kode &amp; Lanjutkan Ujian
            </>
          )}
        </button>
      </div>
    </div>
  )

  const sesiDitutupOverlayJSX = sesiDitutupPaksa && (phase === 'UJIAN' || phase === 'ESSAY_INFO' || phase === 'ESSAY_KERJAKAN') && (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 text-center animate-fade-in">
        <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-6 h-6 text-amber-600" />
        </div>
        <h3 className="text-lg font-bold text-slate-900 mb-2">Sesi Ditutup Pengawas</h3>
        <p className="text-sm text-slate-500">
          Pengawas telah menutup sesi ujian ini. Jawaban Anda yang sudah tersimpan sedang dinilai, mohon tunggu sebentar...
        </p>
      </div>
    </div>
  )

  // Banner peringatan fullscreen belum aktif — dipakai bersama juga.
  const fsWarningBannerJSX = !isFS && (
    <div className="card py-3 bg-amber-50 border border-amber-200">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-amber-700 font-medium">
            {fsSupported
              ? 'Mode layar penuh belum aktif. Ujian tetap bisa dikerjakan, tapi sebagian proteksi anti-kecurangan tidak berjalan sampai layar penuh aktif.'
              : 'Perangkat/browser Anda tidak mendukung mode layar penuh otomatis. Tetap fokus di halaman ujian — pengawas dapat memantau Anda secara manual.'}
          </p>
        </div>
        {fsSupported && (
          <button
            onClick={handleRetryFullscreen}
            className="btn-sm bg-amber-600 text-white hover:bg-amber-700 font-semibold flex-shrink-0"
          >
            <Maximize className="w-3.5 h-3.5" />
            Coba Lagi
          </button>
        )}
      </div>
    </div>
  )

  // ── BUG FIX: diambilAlihDevice/dikeluarkan HARUS dicek SEBELUM phase apa
  // pun (termasuk RESET_KODE). Sebelumnya dua blok ini ditaruh di bagian
  // BAWAH rantai `if (phase === ...)`, jadi kalau siswa sedang di phase
  // RESET_KODE ("masukkan kode 7 digit") saat polling mendeteksi ia baru
  // saja dikunci permanen (TERKUNCI), `dikeluarkan` jadi true tapi `phase`
  // tidak pernah berubah dari 'RESET_KODE' — render jatuh ke blok
  // `if (phase === 'RESET_KODE')` yang datang duluan, dan layar "masukkan
  // kode reset" itu MENANG dan terus tampil selamanya, padahal siswa
  // sebenarnya sudah dikunci permanen dan tidak akan pernah dapat kode.
  // Efek pelepasan fullscreen/screen-pinning native (lihat useEffect
  // "Keluar fullscreen saat ujian selesai" di atas) juga cuma dipicu oleh
  // perubahan `phase` — karena phase tidak berubah, layar tetap terkunci
  // penuh (fullscreen web + screen pinning APK Android) sehingga yang
  // terlihat cuma layar kosong/terkunci tanpa pesan apa pun, sampai
  // pengawas memaksa keluar lewat tombol Home (yang mematahkan screen
  // pinning tapi TIDAK me-reset state React) — begitu itu terjadi, DOM yang
  // sempat "membeku" akhirnya sempat repaint dan yang kelihatan adalah
  // sisa layar RESET_KODE yang salah itu. Memindahkan kedua pengecekan ini
  // ke paling atas memastikan siswa yang sudah di-takeover perangkat lain
  // atau dikunci permanen SELALU melihat pesan yang benar, dari phase
  // manapun mereka berada.
  if (diambilAlihDevice) {
    return (
      <div className="max-w-md mx-auto animate-fade-in">
        <div className="card text-center">
          <div className="w-20 h-20 bg-amber-100 rounded-3xl flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-10 h-10 text-amber-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Sesi Diambil Alih Perangkat Lain</h2>
          <p className="text-sm text-slate-500 mb-4">
            Akun Anda login dari perangkat lain. Browser ini tidak lagi bisa menyimpan jawaban.
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6">
            <p className="text-xs text-amber-700">Jika ini kesalahan, tutup browser di perangkat lain dan masuk kembali dari sini. Hubungi pengawas jika butuh bantuan.</p>
          </div>
          <button onClick={() => window.location.reload()} className="btn-secondary w-full justify-center">
            Coba Masuk Lagi
          </button>
        </div>
      </div>
    )
  }

  // ── Phase: DIKELUARKAN (3x pelanggaran → nilai 0) ─────────────────────────
  if (dikeluarkan) {
    return (
      <div className="max-w-md mx-auto animate-fade-in">
        <div className="card text-center">
          <div className="w-20 h-20 bg-red-100 rounded-3xl flex items-center justify-center mx-auto mb-4">
            <LogOut className="w-10 h-10 text-red-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Ujian Dihentikan</h2>
          <p className="text-sm text-slate-500 mb-4">
            {/* FIX BUG: sebelumnya selalu menampilkan batasPelanggaran (angka
                setting), bukan jumlah pelanggaran ASLI siswa — sehingga
                siswa yang dikunci setelah 1x pelanggaran (mis. dikunci
                manual oleh admin) tetap melihat "melanggar 3 kali". Sekarang
                pakai jumlahPelanggaran (dari server) kalau tersedia, dan
                baru jatuh ke batasPelanggaran sebagai fallback. */}
            Anda telah melanggar aturan ujian sebanyak {jumlahPelanggaran ?? batasPelanggaran} kali. Sistem secara otomatis menghentikan ujian Anda.
          </p>
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-6">
            <p className="text-sm font-semibold text-red-700">Nilai Anda: 0</p>
            <p className="text-xs text-red-500 mt-1">Hubungi pengawas atau guru untuk informasi lebih lanjut.</p>
          </div>
          <button onClick={() => window.location.href = '/siswa'} className="btn-secondary w-full justify-center">
            Kembali ke Beranda
          </button>
        </div>
      </div>
    )
  }

  // ── Phase: ESSAY_INFO — halaman info sebelum tombol "Mulai" ──────────────
  if (phase === 'ESSAY_INFO') {
    return (
      <>
        {pelanggaranOverlayJSX}
        {sesiDitutupOverlayJSX}
        <div className="max-w-md mx-auto animate-fade-in space-y-4 select-none">
          {fsWarningBannerJSX}
          <div className="card">
            <div className="w-14 h-14 bg-brand-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <BookOpen className="w-7 h-7 text-brand-600" />
            </div>

            {loadingEssayInfo ? (
              <div className="flex flex-col items-center justify-center py-8 gap-3">
                <Spinner size="lg" />
                <p className="text-sm text-slate-400">Memuat info soal essay...</p>
              </div>
            ) : errorEssay ? (
              <>
                <div className="alert-error mb-4 text-left">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{errorEssay}</span>
                </div>
                <button onClick={() => fetchEssayInfo()} className="btn-primary w-full justify-center py-3">
                  <RefreshCw className="w-4 h-4" /> Coba Lagi
                </button>
                {renderGerbangKodeDarurat()}
              </>
            ) : essayInfo ? (
              <>
                <h1 className="text-xl font-bold text-slate-900 mb-1 text-center">Lanjut ke Soal Essay</h1>
                <p className="text-sm text-slate-500 mb-4 text-center">
                  Nilai pilihan ganda Anda sudah tersimpan. Selesaikan soal essay berikut untuk menyelesaikan ujian.
                </p>

                <div className="bg-brand-50 border border-brand-100 rounded-xl px-4 py-3 mb-4 space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-brand-600">Mata Pelajaran</span>
                    <span className="font-semibold text-brand-900">{essayInfo.namaMapel}</span>
                  </div>
                  {essayInfo.namaGuru && (
                    <div className="flex justify-between text-sm">
                      <span className="text-brand-600">Guru</span>
                      <span className="font-semibold text-brand-900">{essayInfo.namaGuru}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-brand-600">Jumlah Soal</span>
                    <span className="font-semibold text-brand-900">{essayInfo.jumlahSoal} soal</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-brand-600">Durasi</span>
                    <span className="font-semibold text-brand-900">{essayInfo.durasiMenit} menit</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-brand-600">Mode Jawaban</span>
                    <span className="font-semibold text-brand-900">
                      {essayInfo.modeJawaban === 'DIGITAL' ? 'Ketik langsung (Digital)' : 'Tulis di kertas (Kertas)'}
                    </span>
                  </div>
                </div>

                {essayInfo.instruksi && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 mb-4 text-left">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Instruksi dari Guru</p>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{essayInfo.instruksi}</p>
                  </div>
                )}

                {essayInfo.modeJawaban === 'KERTAS' && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 text-left">
                    <p className="text-xs text-amber-700">
                      Anda akan menuliskan jawaban di kertas. Halaman ini hanya menampilkan soal — tidak perlu
                      mengetik atau mengunggah apa pun. Setelah selesai menulis semua jawaban, tekan tombol
                      &quot;Selesai&quot; untuk mengakhiri ujian (halaman soal tidak bisa dibuka kembali setelah itu).
                    </p>
                  </div>
                )}

                {/* Gerbang akses "Mulai Essay" (toggle global per sesi) —
                    selama pengawas belum menyalakannya, tombol nonaktif dan
                    siswa cukup menunggu (halaman ini otomatis polling tiap
                    8 detik, lihat efek di atas, jadi tidak perlu refresh
                    manual). */}
                {!essayInfo.aksesMulaiDibuka && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 mb-4 text-left flex items-start gap-2">
                    <Spinner size="sm" />
                    <p className="text-xs text-slate-500">
                      Menunggu pengawas membuka akses mulai essay. Halaman ini akan aktif otomatis begitu akses dibuka.
                    </p>
                  </div>
                )}
                {!essayInfo.aksesMulaiDibuka && renderGerbangKodeDarurat()}

                <button
                  onClick={handleMulaiEssay}
                  disabled={loadingEssaySoal || !essayInfo.aksesMulaiDibuka}
                  className="btn-primary w-full justify-center py-3 text-base"
                >
                  {loadingEssaySoal ? <Spinner size="sm" /> : !essayInfo.aksesMulaiDibuka ? 'Menunggu Akses Pengawas' : 'Mulai Jawab Essay'}
                </button>
              </>
            ) : null}
          </div>
        </div>
      </>
    )
  }

  // ── Phase: ESSAY_KERJAKAN — mengerjakan soal essay ────────────────────────
  if (phase === 'ESSAY_KERJAKAN') {
    const soalEssayList = essayList
    const soalEssayCurrent = soalEssayList[essayCurrentIdx]
    const modeJawaban = essayInfo?.modeJawaban ?? 'DIGITAL'
    // FIX (UX kirim essay): nomor soal (1-based, sesuai urutan tampil) yang
    // jawabannya masih kosong/hanya spasi — dipakai untuk peringatan sebelum
    // kirim. Hanya relevan mode DIGITAL (mode KERTAS tidak punya jawaban per
    // soal di sisi klien, cuma satu foto lembar jawaban).
    const soalEssayBelumDijawab = modeJawaban === 'DIGITAL'
      ? soalEssayList.reduce<number[]>((acc, s, i) => {
          if (!jawabanEssay[s.id]?.trim()) acc.push(i + 1)
          return acc
        }, [])
      : []

    return (
      <>
        {pelanggaranOverlayJSX}
        {sesiDitutupOverlayJSX}

        {/* Popup waktu habis — MODE KERTAS SAJA. Sengaja BUKAN overlay pemblokir
            penuh (siswa masih boleh melihat soal sambil menunggu pengawas). */}
        {essayWaktuHabisPopup && modeJawaban === 'KERTAS' && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 text-center animate-fade-in">
              <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
                <Clock className="w-6 h-6 text-amber-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Waktu Essay Habis</h3>
              <p className="text-sm text-slate-500 mb-4">
                Waktu mengerjakan sudah habis. Segera selesaikan tulisan Anda di kertas, lalu tekan
                tombol &quot;Selesai&quot; di halaman ini untuk mengakhiri ujian.
              </p>
              <button onClick={() => setEssayWaktuHabisPopup(false)} className="btn-secondary w-full justify-center">
                Mengerti
              </button>
            </div>
          </div>
        )}

        <div className="max-w-3xl mx-auto space-y-4 animate-fade-in select-none">
          {/* Header */}
          <div className="card py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-900 text-sm truncate">{essayInfo?.namaMapel} — Essay</div>
                {modeJawaban === 'DIGITAL' && (
                  <div className="text-xs font-medium text-slate-400">
                    {Object.values(jawabanEssay).filter(v => v && v.trim().length > 0).length}/{soalEssayList.length} terjawab
                  </div>
                )}
              </div>
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono font-bold text-base flex-shrink-0 ${
                sisaWaktuEssay < 300 ? 'bg-red-50 text-red-600' :
                sisaWaktuEssay < 600 ? 'bg-amber-50 text-amber-600' :
                'bg-brand-50 text-brand-700'
              }`}>
                <Clock className="w-3.5 h-3.5" />
                {formatWaktu(sisaWaktuEssay)}
              </div>
            </div>
            {modeJawaban === 'DIGITAL' && (
              <div className={`text-[11px] mt-1.5 flex items-center gap-1 ${
                essaySyncStatus === 'error' ? 'text-red-600 font-semibold' :
                essaySyncStatus === 'syncing' ? 'text-amber-500' :
                essaySyncStatus === 'synced' ? 'text-emerald-600' : 'text-slate-400'
              }`}>
                {essaySyncStatus === 'error' && '⚠ Gagal menyimpan ke server, mencoba lagi...'}
                {essaySyncStatus === 'syncing' && 'Menyimpan ke server...'}
                {essaySyncStatus === 'synced' && '✓ Tersimpan di server'}
                {essaySyncStatus === 'idle' && 'Belum ada jawaban yang disimpan'}
              </div>
            )}
          </div>

          {fsWarningBannerJSX}

          {errorEssay && (
            <div className="alert-error">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{errorEssay}</span>
            </div>
          )}

          {/* Navigator soal essay */}
          {soalEssayList.length > 1 && (
            <div className="card py-3">
              <div className="flex flex-wrap gap-1.5">
                {soalEssayList.map((s, i) => (
                  <button
                    key={s.id}
                    onClick={() => setEssayCurrentIdx(i)}
                    className={`w-8 h-8 rounded-lg text-xs font-medium transition-all ${
                      i === essayCurrentIdx
                        ? 'bg-brand-600 text-white shadow-sm'
                        : (modeJawaban === 'DIGITAL' && jawabanEssay[s.id]?.trim())
                        ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Soal essay */}
          {soalEssayCurrent && (
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <span className="badge-blue font-semibold">Soal {essayCurrentIdx + 1}</span>
                <span className="text-slate-400 text-xs">dari {soalEssayList.length}</span>
              </div>
              <p className="text-slate-800 text-base leading-relaxed mb-4 whitespace-pre-wrap">{soalEssayCurrent.teks}</p>
              {soalEssayCurrent.gambar_url && (
                <div className="mb-6">
                  <img
                    src={soalEssayCurrent.gambar_url}
                    alt="Gambar soal"
                    className="w-full max-w-lg mx-auto rounded-lg border border-slate-200 object-contain block"
                    style={{ maxHeight: '320px' }}
                  />
                </div>
              )}

              {modeJawaban === 'DIGITAL' ? (
                <textarea
                  className="input w-full min-h-[220px] resize-y"
                  placeholder="Ketik jawaban Anda di sini..."
                  value={jawabanEssay[soalEssayCurrent.id] ?? ''}
                  onChange={e => tulisJawabanEssay(soalEssayCurrent.id, e.target.value)}
                />
              ) : (
                <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-500">
                  Tuliskan jawaban Anda di kertas yang disediakan. Tidak perlu diketik di sini.
                </div>
              )}

              {soalEssayList.length > 1 && (
                <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-100">
                  <button
                    onClick={() => setEssayCurrentIdx(prev => Math.max(0, prev - 1))}
                    disabled={essayCurrentIdx === 0}
                    className="btn-secondary btn-sm disabled:opacity-40"
                  >
                    <ChevronLeft className="w-4 h-4" /> Sebelumnya
                  </button>
                  <span className="text-sm text-slate-400">{essayCurrentIdx + 1} / {soalEssayList.length}</span>
                  <button
                    onClick={() => setEssayCurrentIdx(prev => Math.min(soalEssayList.length - 1, prev + 1))}
                    disabled={essayCurrentIdx === soalEssayList.length - 1}
                    className="btn-secondary btn-sm disabled:opacity-40"
                  >
                    Berikutnya <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Tombol aksi bawah — mode DIGITAL: kirim jawaban yang diketik.
              Mode KERTAS: TIDAK ada tombol kirim/unggah foto sama sekali —
              siswa hanya membaca soal & menulis di kertas. Kalau sudah
              selesai menjawab semua soal di kertas, siswa menekan "Selesai"
              untuk menutup halaman soal (irreversible, lihat dialog konfirmasi
              di bawah — TIDAK ada proses kirim/unggah data apapun ke server
              selain menandai status ujian selesai). */}
          {modeJawaban === 'DIGITAL' ? (
            <button
              onClick={() => setConfirmKirimEssay(true)}
              disabled={submittingEssay}
              className="btn-success w-full justify-center py-3 text-base disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
              {submittingEssay ? 'Mengirim...' : 'Kirim Jawaban Essay'}
            </button>
          ) : (
            <button
              onClick={() => setConfirmKirimEssay(true)}
              disabled={submittingEssay}
              className="btn-success w-full justify-center py-3 text-base disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <LogOut className="w-4 h-4" />
              {submittingEssay ? 'Memproses...' : 'Selesai'}
            </button>
          )}
        </div>

        {/* FIX (UX kirim essay): sebelumnya siswa bisa langsung kirim walau
            sebagian soal essay (mode DIGITAL) belum dijawab sama sekali —
            pesan konfirmasi generic "pastikan semua jawaban sudah benar"
            tidak benar-benar memberi tahu ada soal yang KOSONG. Sekarang
            dialognya dibuat dinamis: kalau ada soal kosong, judul & pesannya
            berubah jadi peringatan tegas dan menyebutkan nomor soalnya.
            Mode KERTAS memakai pesan yang berbeda sama sekali (bukan soal
            "kirim jawaban", tapi "tutup halaman soal", karena tidak ada
            data jawaban yang dikirim di mode ini). */}
        <Confirm
          open={confirmKirimEssay}
          onClose={() => setConfirmKirimEssay(false)}
          onConfirm={() => handleKirimEssay(false)}
          title={
            modeJawaban === 'KERTAS'
              ? 'Akhiri Ujian Essay?'
              : soalEssayBelumDijawab.length > 0 ? 'Masih Ada Soal Belum Dijawab!' : 'Kirim Jawaban Essay?'
          }
          message={
            modeJawaban === 'KERTAS'
              ? 'Halaman soal akan ditutup dan Anda TIDAK BISA membukanya kembali. Pastikan Anda sudah selesai menuliskan semua jawaban di kertas sebelum melanjutkan.'
              : soalEssayBelumDijawab.length > 0
              ? `Soal nomor ${soalEssayBelumDijawab.join(', ')} belum dijawab. Setelah dikirim, jawaban TIDAK BISA diubah lagi. Yakin ingin tetap mengirim?`
              : 'Setelah dikirim, jawaban essay tidak dapat diubah lagi. Pastikan semua jawaban sudah benar.'
          }
          confirmLabel={modeJawaban === 'KERTAS' ? 'Ya, Selesai' : soalEssayBelumDijawab.length > 0 ? 'Ya, Tetap Kirim' : 'Ya, Kirim'}
          variant={modeJawaban === 'KERTAS' || soalEssayBelumDijawab.length > 0 ? 'danger' : 'primary'}
          loading={submittingEssay}
        />
      </>
    )
  }

  // ── Phase: CEK_JADWAL ────────────────────────────────────────────────────
  if (phase === 'CEK_JADWAL') {
    if (loadingJadwal) {
      return (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <Spinner size="lg" />
          <p className="text-sm text-slate-400">Memeriksa jadwal ujian...</p>
        </div>
      )
    }

    const sesiAktif = jadwalHariIni.filter(j => j.status === 'BERJALAN')
    const belumDibuka = jadwalHariIni.filter(j => j.status === 'AKTIF')

    // Sesi sudah ditutup pengawas dan siswa belum sempat ikut
    if (sesiSudahTutup.length > 0 && jadwalHariIni.length === 0) {
      return (
        <div className="max-w-md mx-auto animate-fade-in space-y-4">
          {/* Banner peringatan sesi ditutup */}
          <div className="card">
            <div className="w-14 h-14 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-7 h-7 text-red-500" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 mb-1 text-center">Sesi Ujian Sudah Ditutup</h1>
            <p className="text-sm text-slate-500 mb-4 text-center">
              Kamu tidak sempat mengikuti ujian berikut karena sesi sudah ditutup oleh pengawas.
            </p>
            <div className="space-y-2 mb-5">
              {sesiSudahTutup.map(j => (
                <div key={j.id} className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                  <div className="font-semibold text-slate-800 text-sm">{j.nama_mapel}</div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                    <Clock className="w-3 h-3" />
                    {j.jam_mulai} – {j.jam_selesai} · {j.durasi} menit
                  </div>
                  <p className="text-xs text-red-500 font-medium mt-1.5">Sesi sudah ditutup</p>
                </div>
              ))}
            </div>
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-sm text-amber-700 mb-4">
              Anda tidak sempat ikut ujian ini. Minta Guru atau pengawas untuk mengikuti ujian susulan.
            </div>
            <div className="pt-2 border-t border-slate-100">
              <p className="text-xs text-slate-400 mb-3 text-center">
                Jika ada sesi susulan yang dibuka pengawas, tekan tombol di bawah untuk memperbarui.
              </p>
              <div className="flex gap-2">
                <button onClick={() => window.location.href = '/siswa'}
                  className="btn-secondary flex-1 justify-center gap-2">
                  Kembali ke Beranda
                </button>
                <button onClick={handleRefreshJadwal} disabled={loadingJadwal}
                  className="btn-primary flex-1 justify-center gap-2">
                  {loadingJadwal ? <Spinner size="sm" /> : <><RefreshCw className="w-4 h-4" /> Cek Ulang Sesi</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )
    }

    // FIX BUG (siswa yang sudah selesai ujian hari ini melihat "Tidak Ada
    // Ujian Hari Ini" tanpa keterangan relevan): sebelumnya, kalau satu-
    // satunya jadwal hari ini sudah dikerjakan siswa (`sudah_ikut === true`),
    // jadwal itu hilang begitu saja dari `jadwalHariIni` DAN `sesiSudahTutup`
    // (keduanya sama-sama mensyaratkan `!sudah_ikut`), sehingga kode jatuh
    // ke blok generik di bawah seolah memang tidak ada jadwal ujian sama
    // sekali. Sekarang, sebelum jatuh ke pesan generik, dicek dulu apakah
    // ada jadwal hari ini yang sebenarnya SUDAH diselesaikan siswa — kalau
    // ada, tampilkan mapelnya beserta keterangan bahwa ujian tsb sudah
    // dikerjakan, plus link ke menu Nilai, bukan pesan "tidak ada ujian".
    if (jadwalHariIni.length === 0 && sesiSudahTutup.length === 0 && sudahDiselesaikanHariIni.length > 0) {
      return (
        <div className="max-w-md mx-auto animate-fade-in">
          <div className="card text-center">
            <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 mb-2">
              {sudahDiselesaikanHariIni.length > 1 ? 'Semua Ujian Hari Ini Sudah Selesai' : 'Ujian Hari Ini Sudah Selesai'}
            </h1>
            <p className="text-sm text-slate-500 mb-4">
              {sudahDiselesaikanHariIni.length > 1
                ? 'Kamu sudah mengerjakan semua ujian yang dijadwalkan hari ini. Terima kasih!'
                : 'Kamu sudah mengerjakan ujian berikut hari ini. Terima kasih!'}
            </p>
            <div className="space-y-2 mb-5 text-left">
              {sudahDiselesaikanHariIni.map(j => (
                <div key={j.id} className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                    <div className="font-semibold text-slate-800 text-sm">{j.nama_mapel}</div>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1 ml-6">
                    <Clock className="w-3 h-3" />
                    {j.jam_mulai} – {j.jam_selesai} · {j.durasi} menit
                  </div>
                  <p className="text-xs text-emerald-600 font-medium mt-1.5 ml-6">Sudah dikerjakan</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => window.location.href = '/siswa'}
                className="btn-secondary flex-1 justify-center gap-2">
                Kembali ke Beranda
              </button>
              <button onClick={() => window.location.href = '/siswa/nilai'}
                className="btn-primary flex-1 justify-center gap-2">
                Lihat Nilai
              </button>
            </div>
          </div>
        </div>
      )
    }

    // Tidak ada jadwal hari ini
    if (jadwalHariIni.length === 0) {
      return (
        <div className="max-w-md mx-auto animate-fade-in">
          <div className="card text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Calendar className="w-8 h-8 text-slate-400" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 mb-2">Tidak Ada Ujian Hari Ini</h1>
            <p className="text-sm text-slate-500 mb-4">Kamu tidak memiliki jadwal ujian untuk hari ini.</p>
            {jadwalTerdekat && (
              <div className="bg-brand-50 border border-brand-100 rounded-xl px-4 py-3 text-left mb-4">
                <p className="text-xs text-brand-500 font-semibold mb-1">Ujian terdekat:</p>
                <p className="text-sm font-semibold text-brand-800">{jadwalTerdekat.nama_mapel}</p>
                <p className="text-xs text-brand-600 mt-0.5">
                  {new Date(jadwalTerdekat.tanggal).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })} · {jadwalTerdekat.jam_mulai}
                </p>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => window.location.href = '/siswa'}
                className="btn-secondary flex-1 justify-center gap-2">
                Kembali ke Beranda
              </button>
              <button onClick={handleRefreshJadwal} disabled={loadingJadwal}
                className="btn-primary flex-1 justify-center gap-2">
                {loadingJadwal ? <Spinner size="sm" /> : <><RefreshCw className="w-4 h-4" /> Refresh</>}
              </button>
            </div>
          </div>
        </div>
      )
    }

    // Ada jadwal hari ini tapi semua masih AKTIF (belum dibuka pengawas)
    if (sesiAktif.length === 0 && belumDibuka.length > 0) {
      return (
        <div className="max-w-md mx-auto animate-fade-in space-y-3">
          {/* FIX BUG (mapel yang sudah dikerjakan tidak terlihat sama sekali
              kalau hari itu ada mapel lain yang belum dikerjakan): sebelumnya
              hanya `belumDibuka` yang ditampilkan di sini — mapel yang sudah
              selesai (sudahDiselesaikanHariIni) tidak disebut sama sekali,
              jadi siswa tidak tahu apakah mapel itu memang belum ada
              jadwalnya atau sudah pernah dia kerjakan. Ditampilkan sebagai
              kartu terpisah di atas, ringkas, supaya kartu utama (yang masih
              perlu ditunggu/dikerjakan) tetap jadi fokus utama halaman. */}
          {sudahDiselesaikanHariIni.length > 0 && (
            <div className="card">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Sudah Dikerjakan Hari Ini</h2>
                  <p className="text-xs text-slate-400">Nilai bisa dilihat di menu Nilai</p>
                </div>
              </div>
              <div className="space-y-2">
                {sudahDiselesaikanHariIni.map(j => (
                  <div key={j.id} className="flex items-center justify-between bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                      <span className="font-medium text-slate-800 text-sm">{j.nama_mapel}</span>
                    </div>
                    <span className="text-xs text-emerald-600 font-medium">Selesai</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <Clock className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h1 className="text-base font-bold text-slate-900">Jadwal Ujian Hari Ini</h1>
                <p className="text-xs text-slate-400">Menunggu pengawas membuka sesi</p>
              </div>
            </div>

            <div className="space-y-3">
              {belumDibuka.map(j => {
                const selisih = hitungSelisihMenit(j.jam_mulai)
                const sudahWaktunya = selisih <= 0
                return (
                  <div key={j.id} className={`rounded-xl border px-4 py-3 ${sudahWaktunya ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="font-semibold text-slate-900 text-sm">{j.nama_mapel}</div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                      <Clock className="w-3 h-3" />
                      {j.jam_mulai} – {j.jam_selesai} · {j.durasi} menit
                    </div>
                    {sudahWaktunya ? (
                      <p className="text-xs text-amber-700 font-medium mt-2">
                        Waktu ujian sudah tiba, pengawas belum membuka sesi.
                      </p>
                    ) : (
                      <p className="text-xs text-slate-500 mt-2">
                        Dimulai dalam {selisih >= 60
                          ? `${Math.floor(selisih / 60)} jam ${selisih % 60} menit`
                          : `${selisih} menit`}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-xs text-slate-400 mb-3 text-center">
                Tekan tombol di bawah jika kamu rasa sesi ujian sudah dibuka pengawas.
              </p>
              <div className="flex gap-2">
                <button onClick={() => window.location.href = '/siswa'}
                  className="btn-secondary flex-1 justify-center gap-2">
                  Kembali ke Beranda
                </button>
                <button onClick={handleRefreshJadwal} disabled={loadingJadwal}
                  className="btn-primary flex-1 justify-center gap-2">
                  {loadingJadwal ? <Spinner size="sm" /> : <><RefreshCw className="w-4 h-4" /> Cek Ulang Sesi</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )
    }

    // Fallback (tidak seharusnya terjadi — sesi aktif sudah ditangani di useEffect)
    return <div className="flex justify-center py-20"><Spinner size="lg" /></div>
  }

  // ── Phase: PERSIAPAN ─────────────────────────────────────────────────────
  if (phase === 'PERSIAPAN') {
    const sesiAktif = jadwalHariIni.filter(j => j.status === 'BERJALAN')

    // Lebih dari 1 sesi berjalan — siswa pilih dulu
    if (sesiAktif.length > 1 && !jadwalTerpilih) {
      return (
        <div className="max-w-md mx-auto animate-fade-in">
          <div className="card">
            <div className="w-12 h-12 bg-brand-100 rounded-xl flex items-center justify-center mb-4">
              <BookOpen className="w-6 h-6 text-brand-600" />
            </div>
            <h1 className="text-lg font-bold text-slate-900 mb-1">Pilih Ujian</h1>
            <p className="text-sm text-slate-500 mb-4">Ada beberapa sesi ujian yang sedang berjalan. Pilih ujian yang akan kamu kerjakan.</p>
            <div className="space-y-2">
              {sesiAktif.map(j => (
                <button key={j.id} onClick={() => setJadwalTerpilih(j)}
                  className="w-full text-left border border-slate-200 hover:border-brand-400 hover:bg-brand-50 rounded-xl px-4 py-3 transition-colors">
                  <div className="font-semibold text-slate-900 text-sm">{j.nama_mapel}</div>
                  <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {j.jam_mulai} – {j.jam_selesai} · {j.durasi} menit
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )
    }

    const ujian = jadwalTerpilih ?? sesiAktif[0]
    const checklist = [
      'Pastikan koneksi internet kamu stabil',
      'Pastikan baterai HP/laptop cukup atau sudah terhubung charger',
      'Layar akan otomatis masuk mode fullscreen saat ujian dimulai',
      'Jangan berpindah tab atau aplikasi selama ujian berlangsung',
      'Jawaban tersimpan otomatis setiap 30 detik',
    ]

    return (
      <div className="max-w-md mx-auto animate-fade-in">
        <div className="card">
          <div className="w-14 h-14 bg-brand-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <BookOpen className="w-7 h-7 text-brand-600" />
          </div>

          {/* Info ujian */}
          <div className="bg-brand-50 border border-brand-100 rounded-xl px-4 py-3 mb-5 text-center">
            <p className="text-xs text-brand-500 font-medium mb-0.5">Ujian yang akan dikerjakan</p>
            <p className="text-base font-bold text-brand-900">{ujian?.nama_mapel}</p>
            <p className="text-xs text-brand-600 mt-0.5 flex items-center justify-center gap-1">
              <Clock className="w-3 h-3" />
              {ujian?.jam_mulai} – {ujian?.jam_selesai} · {ujian?.durasi} menit
            </p>
          </div>

          {/* FIX BUG (mapel yang sudah dikerjakan tidak terlihat sama sekali
              kalau hari itu ada mapel lain yang sesinya langsung BERJALAN):
              sesi BERJALAN membuat siswa langsung dilempar ke layar ini
              (lihat useEffect di cekJadwal/handleRefreshJadwal), jadi kartu
              "Sudah Dikerjakan Hari Ini" di CEK_JADWAL tidak sempat terlihat.
              Ditampilkan ringkas di sini juga supaya siswa tetap tahu mapel
              lain hari itu sudah selesai, bukan cuma diam-diam terlewat. */}
          {sudahDiselesaikanHariIni.length > 0 && (
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 mb-5">
              <p className="text-xs text-emerald-600 font-semibold mb-1.5">Sudah kamu kerjakan hari ini:</p>
              <div className="space-y-1">
                {sudahDiselesaikanHariIni.map(j => (
                  <div key={j.id} className="flex items-center gap-1.5 text-sm text-emerald-800">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    {j.nama_mapel}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Checklist persiapan */}
          <div className="mb-5">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Sebelum Mulai</p>
            <div className="space-y-2">
              {checklist.map((item, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-slate-600">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={() => setPhase('KODE')}
            className="btn-primary w-full justify-center py-3 text-base"
          >
            Saya Siap, Masukkan Kode Ujian
          </button>
          {sesiAktif.length > 1 && (
            <button onClick={() => setJadwalTerpilih(null)}
              className="btn-ghost w-full justify-center mt-2 text-sm text-slate-400">
              ← Pilih ujian lain
            </button>
          )}
          {/* FIX BUG (tidak ada jalan ke beranda setelah terkunci permanen):
              layar ini sebelumnya tidak punya link apa pun ke '/siswa',
              jadi kalau ada siswa yang nyasar ke sini setelah dikunci
              (mis. lewat jalur yang belum tercakup fix di handleMasukUjian),
              tidak ada jalan keluar selain mengubah URL manual. */}
          <button onClick={() => window.location.href = '/siswa'}
            className="btn-ghost w-full justify-center mt-1 text-xs text-slate-300">
            Kembali ke Beranda
          </button>
        </div>
      </div>
    )
  }

  // ── Phase: KODE ──────────────────────────────────────────────────────────
  if (phase === 'KODE') {
    return (
      <div className="max-w-md mx-auto animate-fade-in">
        <div className="card text-center">
          <div className="w-16 h-16 bg-brand-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <BookOpen className="w-8 h-8 text-brand-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-1">Masukkan Kode Ujian</h1>
          <p className="text-sm text-slate-500 mb-4">Minta kode 7 digit kepada pengawas di ruangan</p>

          {jadwalTerpilih && (
            <div className="bg-slate-50 rounded-xl px-3 py-2 mb-4 flex items-center gap-2 text-left">
              <BookOpen className="w-4 h-4 text-brand-500 flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-slate-700">{jadwalTerpilih.nama_mapel}</p>
                <p className="text-xs text-slate-400">{jadwalTerpilih.jam_mulai} – {jadwalTerpilih.jam_selesai}</p>
              </div>
            </div>
          )}

          {error && (
            <div className="alert-error mb-4 text-left">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <input
            type="text"
            className="input text-center text-2xl font-mono tracking-widest uppercase mb-4"
            placeholder="XXXXXXX"
            maxLength={7}
            value={kode}
            onChange={e => setKode(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleMasukUjian()}
            autoFocus
          />

          <button onClick={handleMasukUjian} disabled={loading} className="btn-primary w-full justify-center py-3">
            {loading ? <Spinner size="sm" /> : 'Masuk Ujian'}
          </button>

          <button onClick={() => { setError(''); setKode(''); setPhase('PERSIAPAN') }}
            className="btn-ghost w-full justify-center mt-2 text-sm text-slate-400">
            ← Kembali
          </button>
          {/* FIX BUG (tidak ada jalan ke beranda setelah terkunci permanen):
              jalur utama sekarang mengarahkan langsung ke layar "Ujian
              Dihentikan" (lihat handleMasukUjian). Tombol ini sengaja tetap
              ditambahkan di sini sebagai jalan keluar cadangan untuk kasus
              error lain di layar ini, supaya siswa tidak pernah terjebak
              tanpa akses ke beranda. */}
          <button onClick={() => window.location.href = '/siswa'}
            className="btn-ghost w-full justify-center mt-1 text-xs text-slate-300">
            Kembali ke Beranda
          </button>
        </div>
      </div>
    )
  }

  // ── Phase: RESET_KODE — siswa harus masukkan kode 7 digit dari pengawas ──
  if (phase === 'RESET_KODE') {
    return (
      <div className="max-w-md mx-auto animate-fade-in">
        <div className="card text-center">
          <div className="w-16 h-16 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <KeyRound className="w-8 h-8 text-amber-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Akun Di-Reset Pengawas</h1>
          <p className="text-sm text-slate-500 mb-2">
            Akun Anda di-reset oleh pengawas karena terdeteksi pelanggaran.
          </p>
          <p className="text-sm font-semibold text-amber-700 mb-6">
            Minta kode 7 digit kepada pengawas untuk melanjutkan ujian.
          </p>

          {kodeResetError && (
            <div className="alert-error mb-4 text-left">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{kodeResetError}</span>
            </div>
          )}

          <input
            type="text"
            className="input text-center text-2xl font-mono tracking-widest uppercase mb-4"
            placeholder="XXXXXXX"
            maxLength={7}
            value={kodeReset}
            onChange={e => setKodeReset(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleVerifikasiReset()}
            autoFocus
          />

          <button onClick={handleVerifikasiReset} disabled={kodeResetLoading} className="btn-primary w-full justify-center py-3">
            {kodeResetLoading ? <Spinner size="sm" /> : 'Lanjutkan Ujian'}
          </button>

          <p className="mt-4 text-xs text-slate-400">
            Hubungi pengawas di ruangan untuk mendapatkan kode reset.
          </p>
        </div>
      </div>
    )
  }

  // ── Phase: SELESAI (setelah essay dikirim) ────────────────────────────────
  // Tampilan KHUSUS — TIDAK memakai layout lulus/grade biasa karena
  // nilai_total memang belum ada sampai guru mengoreksi essay & merilis
  // (lihat catatan arsitektur di HANDOFF.md: `nilai.dirilis` = false).
  if (phase === 'SELESAI' && essaySelesaiDikirim) {
    return (
      <div className="max-w-md mx-auto animate-fade-in">
        <div className="card text-center">
          <div className="w-20 h-20 bg-emerald-100 rounded-3xl flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-10 h-10 text-emerald-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-1">Ujian Selesai</h2>
          <p className="text-sm text-slate-500 mb-4">{essayInfo?.namaMapel}</p>

          <div className="bg-brand-50 border border-brand-100 rounded-xl p-3 mb-4 text-sm text-brand-700">
            Jawaban essay Anda sudah terkirim. Nilai akhir akan tersedia setelah guru mengoreksi
            dan merilis nilai essay Anda.
          </div>

          {essaySyncGagalSaatTimeout && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-sm text-amber-700 text-left">
              Waktu pengerjaan Anda habis dan sistem menutup essay secara otomatis, tetapi jawaban
              TERAKHIR Anda sempat gagal tersimpan karena masalah koneksi. Jawaban yang berhasil
              tersimpan sebelumnya tetap akan dinilai guru — segera hubungi guru/pengawas Anda
              untuk memastikan jawaban terakhir Anda tidak hilang.
            </div>
          )}

          {nilaiPgSetelahEssay && (
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="text-2xl font-bold text-slate-900">{nilaiPgSetelahEssay.benar}/{nilaiPgSetelahEssay.total}</div>
                <div className="text-xs text-slate-400 mt-1">Benar PG</div>
              </div>
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="text-2xl font-bold text-slate-600">{nilaiPgSetelahEssay.kkm}</div>
                <div className="text-xs text-slate-400 mt-1">KKM</div>
              </div>
              <div className="bg-amber-50 rounded-xl p-4">
                <div className="text-2xl font-bold text-amber-600">?</div>
                <div className="text-xs text-slate-400 mt-1">Nilai Total</div>
              </div>
            </div>
          )}

          <button onClick={() => window.location.href = '/siswa'} className="btn-primary w-full justify-center">
            Kembali ke Beranda
          </button>
        </div>
      </div>
    )
  }

  // ── Phase: SELESAI ────────────────────────────────────────────────────────
  if (phase === 'SELESAI' && hasilNilai) {
    return (
      <div className="max-w-md mx-auto animate-fade-in">
        <div className="card text-center">
          <div className={`w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-4 ${
            hasilNilai.lulus ? 'bg-emerald-100' : 'bg-red-100'
          }`}>
            {hasilNilai.lulus
              ? <CheckCircle className="w-10 h-10 text-emerald-600" />
              : <AlertTriangle className="w-10 h-10 text-red-500" />
            }
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-1">
            {hasilNilai.lulus ? 'Selamat! Anda Lulus' : 'Belum Mencapai KKM'}
          </h2>
          <p className="text-sm text-slate-500 mb-4">{sesiInfo?.namaMapel}</p>

          {/* FIX: sebelumnya kalau tidak lulus, satu-satunya penanda hanya warna
              merah pada ikon — tidak ada teks yang menjelaskan secara eksplisit
              bahwa siswa tidak lulus, dan KKM tidak ditampilkan sama sekali.
              Sekarang statusnya ditulis jelas + dibandingkan langsung dengan KKM. */}
          <div className={`rounded-xl p-3 mb-4 text-sm font-semibold ${
            hasilNilai.lulus
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {hasilNilai.lulus
              ? `Status: LULUS — Nilai ${hasilNilai.nilai} mencapai KKM ${hasilNilai.kkm}`
              : `Status: BELUM LULUS — Nilai ${hasilNilai.nilai} belum mencapai KKM ${hasilNilai.kkm}`}
          </div>

          {sesiDitutupPaksa && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-left flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">
                Sesi ujian ditutup oleh pengawas sebelum Anda menekan "Selesai". Jawaban yang sudah tersimpan otomatis dinilai.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div className="bg-slate-50 rounded-xl p-4">
              <div className="text-3xl font-bold text-slate-900">{hasilNilai.nilai}</div>
              <div className="text-xs text-slate-400 mt-1">Nilai</div>
            </div>
            <div className="bg-slate-50 rounded-xl p-4">
              <div className="text-3xl font-bold text-slate-600">{hasilNilai.kkm}</div>
              <div className="text-xs text-slate-400 mt-1">KKM</div>
            </div>
            <div className={`rounded-xl p-4 ${
              hasilNilai.grade === 'A' ? 'bg-emerald-50' :
              hasilNilai.grade === 'B' ? 'bg-blue-50' :
              hasilNilai.grade === 'C' ? 'bg-yellow-50' :
              'bg-red-50'
            }`}>
              <div className={`text-3xl font-bold ${
                hasilNilai.grade === 'A' ? 'text-emerald-700' :
                hasilNilai.grade === 'B' ? 'text-blue-700' :
                hasilNilai.grade === 'C' ? 'text-yellow-700' :
                'text-red-700'
              }`}>{hasilNilai.grade}</div>
              <div className="text-xs text-slate-400 mt-1">Grade</div>
            </div>
            <div className="bg-slate-50 rounded-xl p-4">
              <div className="text-3xl font-bold text-slate-900">{hasilNilai.benar}/{hasilNilai.total}</div>
              <div className="text-xs text-slate-400 mt-1">Benar</div>
            </div>
          </div>

          <button onClick={() => window.location.href = '/siswa'} className="btn-primary w-full justify-center">
            Kembali ke Beranda
          </button>

          {hasilNilai.id && (
            <button
              onClick={() => window.location.href = `/siswa/nilai/${hasilNilai.id}`}
              className="btn-secondary w-full justify-center mt-3"
            >
              Yuk, Lihat Rincian Per Soal 😊
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── Phase: UJIAN ──────────────────────────────────────────────────────────
  if (!soalCurrent) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>

  const opsiUjian = opsiLabels.slice(0, soalCurrent.jumlah_opsi)

  return (
    <>
      {/* Overlay peringatan saat keluar fullscreen / pindah tab */}
      {pelanggaranOverlayJSX}

      {sesiDitutupOverlayJSX}

      <div className="max-w-3xl mx-auto space-y-4 animate-fade-in select-none">
        {/* Header */}
        <div className="card py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-slate-900 text-sm truncate">{sesiInfo?.namaMapel}</div>
              <div className={`text-xs font-medium ${
                totalDijawab === soalList.length
                  ? 'text-emerald-600'
                  : totalDijawab === 0
                  ? 'text-slate-400'
                  : 'text-amber-500'
              }`}>
                {totalDijawab}/{soalList.length} terjawab
                {totalDijawab < soalList.length && (
                  <span className="ml-1">· {soalList.length - totalDijawab} belum</span>
                )}
              </div>
            </div>
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono font-bold text-base flex-shrink-0 ${
              sisaWaktu < 300 ? 'bg-red-50 text-red-600' :
              sisaWaktu < 600 ? 'bg-amber-50 text-amber-600' :
              'bg-brand-50 text-brand-700'
            }`}>
              <Clock className="w-3.5 h-3.5" />
              {formatWaktu(sisaWaktu)}
            </div>
            <button
              onClick={() => {
                const minDetik = (sesiInfo?.minSubmitMenit ?? 0) * 60
                const belumCukupWaktu = minDetik > 0 && waktuTerpakai < minDetik
                if (totalDijawab < soalList.length) {
                  // Arahkan ke soal pertama yang belum dijawab
                  const idxBelum = soalList.findIndex(s => !jawaban[s.id])
                  if (idxBelum !== -1) setCurrentIdx(idxBelum)
                } else if (!belumCukupWaktu) {
                  setConfirmSelesai(true)
                }
              }}
              className={`btn-sm flex items-center gap-1.5 font-semibold transition-all flex-shrink-0 ${
                (() => {
                  const minDetik = (sesiInfo?.minSubmitMenit ?? 0) * 60
                  const belumCukupWaktu = minDetik > 0 && waktuTerpakai < minDetik
                  return (totalDijawab < soalList.length || belumCukupWaktu)
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                    : 'btn-success'
                })()
              }`}
              disabled={submitting || ((sesiInfo?.minSubmitMenit ?? 0) > 0 && waktuTerpakai < (sesiInfo?.minSubmitMenit ?? 0) * 60)}
              title={
                totalDijawab < soalList.length
                  ? `${soalList.length - totalDijawab} soal belum dijawab`
                  : (() => {
                      const minDetik = (sesiInfo?.minSubmitMenit ?? 0) * 60
                      const sisa = minDetik - waktuTerpakai
                      if (sisa > 0) {
                        const m = Math.floor(sisa / 60), d = sisa % 60
                        return `Tunggu ${m}:${String(d).padStart(2,'0')} lagi sebelum bisa submit`
                      }
                      return 'Selesaikan ujian'
                    })()
              }
            >
              <Send className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">{submitting ? 'Menyimpan...' : 'Selesai'}</span>
              <span className="xs:hidden">{submitting ? '...' : 'Kirim'}</span>
            </button>
          </div>
          {/* Indikator countdown batas minimal submit */}
          {(() => {
            const minDetik = (sesiInfo?.minSubmitMenit ?? 0) * 60
            const sisa = minDetik - waktuTerpakai
            if (sisa <= 0) return null
            const m = Math.floor(sisa / 60), d = sisa % 60
            return (
              <div className="text-[11px] mt-1 flex items-center gap-1 text-amber-600 font-medium">
                <Clock className="w-3 h-3" />
                Tombol kirim akan aktif dalam {m}:{String(d).padStart(2, '0')} menit
              </div>
            )
          })()}
          <div className={`text-[11px] mt-1.5 flex items-center gap-1 ${
            syncStatus === 'error' ? 'text-red-600 font-semibold' :
            syncStatus === 'syncing' ? 'text-amber-500' :
            syncStatus === 'synced' ? 'text-emerald-600' : 'text-slate-400'
          }`}>
            {syncStatus === 'error' && '⚠ Gagal menyimpan ke server, mencoba lagi...'}
            {syncStatus === 'syncing' && 'Menyimpan ke server...'}
            {syncStatus === 'synced' && '✓ Tersimpan di server'}
            {syncStatus === 'idle' && 'Belum ada jawaban yang disimpan'}
          </div>
        </div>

        {/* FIX: banner peringatan mode layar penuh gagal aktif — sebelumnya
            kegagalan requestFullscreen() dibuang diam-diam tanpa jejak apapun
            ke siswa. Dua kasus dibedakan:
            - Device/browser TIDAK mendukung sama sekali (mis. Safari di
              iPhone/iPad) → beri tahu apa adanya, tombol retry tidak
              ditampilkan karena percuma dan hanya membingungkan siswa.
            - Device mendukung tapi permintaan otomatis gagal/ditolak →
              tombol "Coba Lagi" muncul, retry ini terjadi di dalam klik
              (user gesture) sehingga peluang berhasilnya lebih tinggi
              dibanding percobaan otomatis. */}
        {fsWarningBannerJSX}

        {/* Navigator */}
        <div className="card py-3">
          <div className="flex flex-wrap gap-1.5">
            {soalList.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setCurrentIdx(i)}
                className={`w-8 h-8 rounded-lg text-xs font-medium transition-all ${
                  i === currentIdx
                    ? 'bg-brand-600 text-white shadow-sm'
                    : jawaban[s.id]
                    ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>

        {/* Soal */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <span className="badge-blue font-semibold">Soal {currentIdx + 1}</span>
            <span className="text-slate-400 text-xs">dari {soalList.length}</span>
          </div>
          <p className="text-slate-800 text-base leading-relaxed mb-4">{soalCurrent.teks}</p>
          {(soalCurrent as any).gambar_pertanyaan && (
            <div className="mb-6">
              <img
                src={(soalCurrent as any).gambar_pertanyaan}
                alt="Gambar soal"
                className="w-full max-w-lg mx-auto rounded-lg border border-slate-200 object-contain block"
                style={{ maxHeight: '320px' }}
              />
            </div>
          )}

          <div className="space-y-2">
            {opsiUjian.map(label => {
              const opsiText = soalCurrent[`opsi_${label.toLowerCase()}` as keyof Soal] as string
              const isSelected = jawaban[soalCurrent.id] === label
              return (
                <button
                  key={label}
                  onClick={() => pilihJawaban(soalCurrent.id, label)}
                  className={`soal-opsi w-full text-left ${isSelected ? 'soal-opsi-selected' : 'soal-opsi-default'}`}
                >
                  <span className={`w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center flex-shrink-0 transition-colors ${
                    isSelected ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {label}
                  </span>
                  <span className="text-slate-800 flex flex-col gap-1">
                    {opsiText}
                    {(soalCurrent as any)[`gambar_opsi_${label.toLowerCase()}`] && (
                      <img
                        src={(soalCurrent as any)[`gambar_opsi_${label.toLowerCase()}`]}
                        alt={`Gambar opsi ${label}`}
                        className="w-full max-w-xs rounded-lg border border-slate-200 mt-1 object-contain"
                        style={{ maxHeight: '160px' }}
                      />
                    )}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-100">
            <button
              onClick={() => setCurrentIdx(prev => Math.max(0, prev - 1))}
              disabled={currentIdx === 0}
              className="btn-secondary btn-sm disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" /> Sebelumnya
            </button>
            <span className="text-sm text-slate-400">{currentIdx + 1} / {soalList.length}</span>
            <button
              onClick={() => setCurrentIdx(prev => Math.min(soalList.length - 1, prev + 1))}
              disabled={currentIdx === soalList.length - 1}
              className="btn-secondary btn-sm disabled:opacity-40"
            >
              Berikutnya <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <Confirm
          open={confirmSelesai}
          onClose={() => setConfirmSelesai(false)}
          onConfirm={() => handleSelesai(false)}
          title="Selesaikan Ujian?"
          message="Semua soal sudah dijawab. Apakah Anda yakin ingin menyelesaikan ujian? Jawaban tidak dapat diubah setelah diselesaikan."
          confirmLabel="Ya, Selesaikan"
          variant="primary"
          loading={submitting}
        />

        {/* ── Modal pemblokir: jumlah jawaban yang terkonfirmasi server tidak
            cocok dengan jumlah yang dijawab siswa secara lokal. Ujian TIDAK
            dinilai sampai ini terselesaikan — supaya kasus "sebagian jawaban
            tidak sampai ke server lalu terhitung salah" tidak terjadi lagi. */}
        {showSyncFailModal && !showWarningOverlay && (
          <div
            className="fixed inset-0 z-[9999] flex flex-col items-center justify-center p-4"
            style={{ background: 'rgba(15,23,42,0.97)' }}
          >
            <div className="max-w-sm w-full bg-white rounded-2xl p-8 text-center shadow-2xl">
              <div className="w-16 h-16 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-8 h-8 text-amber-600" />
              </div>
              {sesiDitutupPaksa ? (
                <>
                  <h2 className="text-lg font-bold text-slate-900 mb-2">Sesi Ditutup Pengawas</h2>
                  <p className="text-sm text-slate-600 mb-3">
                    Pengawas menutup sesi ujian ini, dan saat itu juga koneksi gagal mengirim hasil
                    akhir ke server. Baru <strong>{syncFailInfo.synced}</strong> dari{' '}
                    <strong>{syncFailInfo.expected}</strong> jawaban yang terkonfirmasi tersimpan.
                  </p>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-left">
                    <p className="text-xs text-amber-700">
                      Jawaban Anda tetap aman tersimpan sementara di perangkat ini. Tekan &quot;Coba Lagi&quot;
                      untuk mengirim ulang nilai akhir Anda. Jika masih gagal, segera hubungi pengawas atau guru.
                    </p>
                  </div>
                </>
              ) : pgSelesaiOfflinePending ? (
                <>
                  {/* FIX BUG P0 (offline PG -> Essay): semua jawaban SUDAH
                      terkonfirmasi tersimpan di server (verified true) — yang
                      gagal murni panggilan finalisasi karena koneksi. Beda
                      pesan & aksi dari kasus "jawaban belum semua tersimpan"
                      di bawah supaya siswa tidak salah paham jawabannya
                      terancam hilang, dan supaya (kalau essay ada & amplopnya
                      sudah terunduh) siswa bisa langsung lanjut lewat kode
                      darurat tanpa menunggu koneksi pulih sama sekali. */}
                  {pgFinalisasiDitolak ? (
                    <>
                      <h2 className="text-lg font-bold text-slate-900 mb-2">Waktu PG Sudah Berakhir</h2>
                      <p className="text-sm text-slate-600 mb-3">
                        Server menolak penyelesaian otomatis karena waktu pengerjaan PG sudah lewat saat
                        koneksi terputus. Jawaban PG yang sudah tersimpan di server tetap dinilai oleh sistem.
                        Anda tetap bisa melanjutkan ke essay.
                      </p>
                    </>
                  ) : pgOfflineTerkonfirmasi ? (
                    <>
                      <h2 className="text-lg font-bold text-slate-900 mb-2">Jawaban PG Sudah Lengkap Tersimpan</h2>
                      <p className="text-sm text-slate-600 mb-3">
                        Semua <strong>{syncFailInfo.expected}</strong> jawaban PG Anda sudah terkonfirmasi
                        tersimpan di server. Hanya proses penyelesaian akhir yang gagal terkirim karena
                        koneksi — sistem akan otomatis mencoba lagi di latar belakang, Anda tidak perlu
                        menunggu di sini.
                      </p>
                    </>
                  ) : (
                    <>
                      <h2 className="text-lg font-bold text-slate-900 mb-2">Jawaban PG Diamankan di Perangkat</h2>
                      <p className="text-sm text-slate-600 mb-3">
                        <strong>{syncFailInfo.expected}</strong> jawaban PG Anda tersimpan aman di perangkat ini,
                        tetapi <strong>belum terkonfirmasi diterima server</strong> karena koneksi terputus.
                        Jangan tutup atau muat ulang halaman ini. Begitu koneksi pulih, sistem akan
                        mengirim jawaban PG lebih dulu, lalu menyelesaikan penilaiannya secara otomatis.
                      </p>
                    </>
                  )}
                  {amplopTersedia ? (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-4 text-left">
                      <p className="text-xs text-emerald-700">
                        Anda bisa langsung lanjut mengerjakan essay tanpa menunggu internet pulih —
                        minta kode darurat ke pengawas.
                      </p>
                    </div>
                  ) : (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-left">
                      <p className="text-xs text-amber-700">
                        Sesi ini tidak punya jalur essay offline yang bisa diakses dari sini. Tekan
                        &quot;Coba Lagi&quot; sesekali, atau tunggu — sistem akan menyelesaikannya sendiri
                        begitu koneksi pulih. Jika terlalu lama, hubungi pengawas.
                      </p>
                    </div>
                  )}
                  {amplopTersedia && renderGerbangKodeDarurat()}
                </>
              ) : (
                <>
                  <h2 className="text-lg font-bold text-slate-900 mb-2">Jawaban Belum Semua Tersimpan</h2>
                  <p className="text-sm text-slate-600 mb-3">
                    Koneksi ke server tidak stabil. Baru <strong>{syncFailInfo.synced}</strong> dari{' '}
                    <strong>{syncFailInfo.expected}</strong> jawaban yang terkonfirmasi tersimpan.
                    Ujian <strong>belum akan dinilai</strong> sampai semua jawaban berhasil tersimpan,
                    supaya jawaban Anda tidak ada yang terhitung salah secara tidak adil.
                  </p>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-left">
                    <p className="text-xs text-amber-700">
                      Jawaban Anda tetap aman tersimpan sementara di perangkat ini. Coba periksa koneksi
                      internet, lalu tekan &quot;Coba Lagi&quot;. Anda juga bisa kembali menjawab dulu —
                      sistem akan terus mencoba menyimpan otomatis di latar belakang.
                    </p>
                  </div>
                </>
              )}
              <div className="flex gap-2">
                {!pgSelesaiOfflinePending && (
                  <button
                    onClick={handleKembaliDariSyncFail}
                    className="btn-secondary flex-1"
                    disabled={manualRetrying}
                  >
                    Kembali ke Ujian
                  </button>
                )}
                <button
                  onClick={handleRetrySelesai}
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                  disabled={manualRetrying}
                >
                  {manualRetrying ? <Spinner size="sm" /> : 'Coba Lagi'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
