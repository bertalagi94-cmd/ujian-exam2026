'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Eye, EyeOff, BookOpen, Lock, User, AlertCircle,
  X, ChevronDown, ChevronUp, Shield, GraduationCap, Users, UserCheck,
  BookMarked, LayoutDashboard, ClipboardList, BarChart2, Settings,
  HelpCircle, AlertTriangle, CheckCircle, Info, Monitor,
  Activity, Clock, CalendarDays, Trophy, Loader2, Radio,
  Maximize, Minimize,
} from 'lucide-react'

interface SiteInfo {
  namaSekolah: string
  kota: string
  logoUrl: string
}

interface UjianBerlangsung {
  id: string
  mapel: string
  kelas: string
  pengawas: string
  waktu_mulai: string
}

interface JadwalItem {
  id: string
  tanggal: string
  tanggal_raw: string
  jam: string
  mapel: string
  kelas: string
  status: string
  isToday: boolean
}

interface JuaraItem {
  kelas: string
  nama_siswa: string
  nilai_rata: number
}

// ─── DATA PANDUAN ────────────────────────────────────────────────────────────
const ROLES = [
  {
    id: 'admin',
    label: 'Admin',
    color: 'from-violet-500 to-purple-600',
    bgLight: 'bg-violet-50',
    border: 'border-violet-200',
    text: 'text-violet-700',
    icon: <Shield className="w-5 h-5" />,
    badge: 'bg-violet-100 text-violet-700',
    desc: 'Pengelola sistem secara keseluruhan. Memiliki akses penuh ke semua fitur.',
    steps: [
      {
        title: 'Login & Dashboard',
        icon: <LayoutDashboard className="w-4 h-4" />,
        detail: 'Login menggunakan username dan password admin. Dashboard menampilkan statistik total siswa, guru, soal, jadwal aktif, dan rata-rata nilai ujian.',
      },
      {
        title: 'Pengaturan Sistem',
        icon: <Settings className="w-4 h-4" />,
        detail: 'Isi nama sekolah, NPSN, nama kepala sekolah, alamat, dan upload logo di tab Informasi Sekolah. Atur batas pelanggaran dan jumlah opsi jawaban di tab Pengaturan Ujian.',
      },
      {
        title: 'Kelola Kelas & Mata Pelajaran',
        icon: <BookMarked className="w-4 h-4" />,
        detail: 'Buat kelas (contoh: VII-A, VIII-B) dan mata pelajaran terlebih dahulu sebelum menambahkan data lainnya. Ini menjadi fondasi data siswa dan jadwal ujian.',
      },
      {
        title: 'Kelola Siswa & User',
        icon: <GraduationCap className="w-4 h-4" />,
        detail: 'Tambah siswa satu per satu atau via import Excel. Buat akun guru dan kepala sekolah di menu Users. Password default bisa di-reset kapan saja.',
      },
      {
        title: 'Jadwal & Monitoring Ujian',
        icon: <ClipboardList className="w-4 h-4" />,
        detail: 'Buat jadwal ujian dan tentukan paket soal yang digunakan. Monitor sesi ujian berlangsung secara real-time. Lihat nilai dan analisis hasil ujian di menu Nilai & Analisis.',
      },
      {
        title: 'Backup & Reset',
        icon: <BarChart2 className="w-4 h-4" />,
        detail: 'Lakukan backup rutin sebelum tahun ajaran baru atau sebelum reset. Reset data bisa dilakukan per kategori (jawaban saja, siswa, jadwal, dll) atau semua sekaligus.',
      },
    ],
  },
  {
    id: 'kepsek',
    label: 'Kepala Sekolah',
    color: 'from-blue-500 to-cyan-600',
    bgLight: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-700',
    icon: <UserCheck className="w-5 h-5" />,
    badge: 'bg-blue-100 text-blue-700',
    desc: 'Akses monitoring dan laporan. Tidak dapat mengubah data operasional.',
    steps: [
      {
        title: 'Dashboard Kepala Sekolah',
        icon: <LayoutDashboard className="w-4 h-4" />,
        detail: 'Lihat ringkasan statistik ujian sekolah: jumlah ujian, rata-rata nilai, tingkat kelulusan, dan perkembangan per mata pelajaran.',
      },
      {
        title: 'Monitoring Ujian',
        icon: <ClipboardList className="w-4 h-4" />,
        detail: 'Pantau sesi ujian yang sedang berlangsung secara real-time — siapa yang sudah mengerjakan, siapa yang belum, dan siapa yang terkena pelanggaran.',
      },
      {
        title: 'Laporan Nilai',
        icon: <BarChart2 className="w-4 h-4" />,
        detail: 'Akses rekap nilai per kelas, per mata pelajaran, dan per siswa. Lihat analisis distribusi nilai dan persentase kelulusan untuk pengambilan keputusan.',
      },
      {
        title: 'Jadwal Ujian',
        icon: <BookMarked className="w-4 h-4" />,
        detail: 'Lihat daftar jadwal ujian yang telah dibuat — tanggal, mata pelajaran, kelas yang terlibat, dan status (belum dimulai / sedang berlangsung / selesai).',
      },
    ],
  },
  {
    id: 'guru',
    label: 'Guru',
    color: 'from-emerald-500 to-teal-600',
    bgLight: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-700',
    icon: <Users className="w-5 h-5" />,
    badge: 'bg-emerald-100 text-emerald-700',
    desc: 'Membuat soal, paket soal, dan memantau ujian mata pelajaran yang diampu.',
    steps: [
      {
        title: 'Bank Soal',
        icon: <BookMarked className="w-4 h-4" />,
        detail: 'Buat soal pilihan ganda untuk mata pelajaran yang Anda ampu. Soal bisa diisi teks, ditambah gambar, dan ditentukan kunci jawaban. Soal dapat digunakan ulang di banyak paket.',
      },
      {
        title: 'Paket Soal',
        icon: <ClipboardList className="w-4 h-4" />,
        detail: 'Kumpulkan soal menjadi satu paket ujian. Tentukan jumlah soal, urutan tampil (acak/berurutan), dan waktu pengerjaan. Paket perlu divalidasi admin sebelum bisa dipakai.',
      },
      {
        title: 'Kisi-Kisi',
        icon: <BarChart2 className="w-4 h-4" />,
        detail: 'Buat dan kelola kisi-kisi soal sebagai panduan pembuatan soal sesuai kompetensi dasar. Kisi-kisi juga bisa diakses siswa sebagai bahan belajar.',
      },
      {
        title: 'Mode Pengawas',
        icon: <Shield className="w-4 h-4" />,
        detail: 'Guru yang ditugaskan sebagai pengawas dapat membuka sesi ujian, memantau peserta secara real-time, mencatat pelanggaran, dan menutup sesi.',
      },
      {
        title: 'Nilai & Analisis',
        icon: <BarChart2 className="w-4 h-4" />,
        detail: 'Lihat nilai hasil ujian dan analisis butir soal — soal mana yang mudah atau sulit, dan distribusi pilihan jawaban siswa untuk evaluasi kualitas soal.',
      },
    ],
  },
  {
    id: 'siswa',
    label: 'Siswa',
    color: 'from-orange-500 to-amber-500',
    bgLight: 'bg-orange-50',
    border: 'border-orange-200',
    text: 'text-orange-700',
    icon: <GraduationCap className="w-5 h-5" />,
    badge: 'bg-orange-100 text-orange-700',
    desc: 'Mengikuti ujian online dan melihat nilai hasil ujian.',
    steps: [
      {
        title: 'Login Siswa',
        icon: <User className="w-4 h-4" />,
        detail: 'Gunakan NIS (Nomor Induk Siswa) sebagai username. Password default biasanya adalah NIS Anda. Hubungi admin/guru jika lupa password.',
      },
      {
        title: 'Dashboard & Jadwal',
        icon: <LayoutDashboard className="w-4 h-4" />,
        detail: 'Lihat jadwal ujian yang akan datang. Ujian hanya bisa diakses sesuai jadwal yang ditetapkan — tidak bisa dikerjakan sebelum atau sesudah waktu yang ditentukan.',
      },
      {
        title: 'Mengerjakan Ujian',
        icon: <ClipboardList className="w-4 h-4" />,
        detail: 'Klik "Mulai Ujian" saat jadwal aktif. Kerjakan semua soal dalam waktu yang tersedia. Jawaban tersimpan otomatis. Jangan menutup tab atau berpindah aplikasi karena bisa tercatat sebagai pelanggaran.',
      },
      {
        title: 'Melihat Nilai',
        icon: <BarChart2 className="w-4 h-4" />,
        detail: 'Setelah ujian selesai dan nilai diproses, Anda bisa melihat nilai dan status kelulusan di menu Nilai. Kisi-kisi soal juga tersedia sebagai panduan belajar.',
      },
    ],
  },
]

// ─── DATA Q&A ─────────────────────────────────────────────────────────────────
const QA_ITEMS = [
  {
    category: 'Umum',
    icon: <Info className="w-4 h-4" />,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    items: [
      {
        q: 'Apa itu SmartExam?',
        a: 'SmartExam adalah sistem ujian berbasis komputer (CBT) yang dirancang khusus untuk sekolah. Memungkinkan guru membuat soal, menjadwalkan ujian, dan siswa mengerjakan ujian secara online dengan pengawasan real-time.',
      },
      {
        q: 'Browser apa yang direkomendasikan?',
        a: 'Google Chrome atau Mozilla Firefox versi terbaru. Hindari menggunakan browser lama atau Internet Explorer. Pastikan JavaScript aktif dan koneksi internet stabil selama ujian.',
      },
      {
        q: 'Apakah bisa digunakan di HP?',
        a: 'Bisa, aplikasi sudah responsif untuk layar HP. Namun untuk pengalaman terbaik terutama saat mengerjakan ujian, disarankan menggunakan laptop atau komputer.',
      },
    ],
  },
  {
    category: 'Login & Akun',
    icon: <Lock className="w-4 h-4" />,
    color: 'text-violet-600',
    bg: 'bg-violet-50',
    items: [
      {
        q: 'Saya lupa password, bagaimana cara reset?',
        a: 'Siswa: minta guru atau admin untuk reset password. Guru/Pengawas/Kepala Sekolah: minta admin untuk reset di menu Users. Admin: hubungi pengelola sistem atau reset melalui database Supabase.',
      },
      {
        q: 'Username saya apa?',
        a: 'Siswa menggunakan NIS (Nomor Induk Siswa). Guru, Pengawas, dan Kepala Sekolah menggunakan username yang dibuat oleh Admin saat pembuatan akun.',
      },
      {
        q: 'Akun saya terkunci, apa yang harus dilakukan?',
        a: 'Akun siswa dapat terkunci jika melebihi batas pelanggaran saat ujian (berpindah tab, keluar layar, dll). Hubungi pengawas ruangan atau admin untuk membuka kunci akun.',
      },
    ],
  },
  {
    category: 'Saat Ujian',
    icon: <ClipboardList className="w-4 h-4" />,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    items: [
      {
        q: 'Apakah jawaban tersimpan otomatis?',
        a: 'Ya, setiap jawaban yang dipilih langsung tersimpan ke server secara otomatis. Tidak perlu khawatir jika tiba-tiba koneksi terputus sebentar — jawaban yang sudah dijawab tetap tersimpan.',
      },
      {
        q: 'Apa yang dimaksud dengan pelanggaran?',
        a: 'Sistem mendeteksi jika siswa berpindah tab, meminimalkan jendela browser, atau mencoba membuka aplikasi lain. Setiap deteksi dihitung sebagai satu pelanggaran. Jika melebihi batas yang ditentukan, akun dikunci otomatis.',
      },
      {
        q: 'Internet saya putus saat ujian, bagaimana?',
        a: 'Jangan panik. Hubungkan kembali internet secepat mungkin. Jawaban yang sudah dijawab tetap tersimpan. Jika waktu ujian belum habis, Anda bisa melanjutkan setelah koneksi kembali. Beritahu pengawas jika ada kendala teknis.',
      },
      {
        q: 'Saya tidak sengaja menutup tab saat ujian, bagaimana?',
        a: 'Buka kembali browser dan login ulang, lalu akses kembali halaman ujian. Jika sesi masih aktif, Anda bisa melanjutkan dari soal terakhir. Hal ini akan tercatat sebagai pelanggaran — beritahu pengawas untuk penjelasan.',
      },
    ],
  },
  {
    category: 'Skenario Darurat',
    icon: <AlertTriangle className="w-4 h-4" />,
    color: 'text-red-600',
    bg: 'bg-red-50',
    items: [
      {
        q: 'Listrik mati di tengah ujian, apa yang harus dilakukan?',
        a: 'Beritahu pengawas segera. Pengawas dapat mencatat kejadian dan melaporkan ke admin. Admin bisa memberikan ujian susulan melalui fitur Susulan di menu pengawas/guru. Jawaban sebelum listrik mati tetap tersimpan.',
      },
      {
        q: 'Server error / halaman tidak bisa diakses',
        a: 'Coba refresh halaman (F5). Jika masih error, tunggu beberapa menit dan coba lagi. Beritahu pengawas dan admin. Admin bisa cek status server di Supabase Dashboard. Pastikan tidak ada proses heavy seperti import data besar yang sedang berjalan.',
      },
      {
        q: 'Siswa tidak muncul di daftar sesi ujian',
        a: 'Kemungkinan penyebab: (1) siswa belum terdaftar di kelas yang dijadwalkan, (2) kelas siswa tidak sesuai dengan jadwal ujian, (3) siswa baru ditambahkan setelah sesi dibuat. Hubungi admin untuk memverifikasi data siswa dan kelas.',
      },
      {
        q: 'Nilai tidak muncul setelah ujian selesai',
        a: 'Pastikan siswa benar-benar mengklik "Selesai Ujian", bukan hanya menutup browser. Jika sudah selesai namun nilai belum muncul, coba refresh halaman. Admin atau guru bisa cek di menu Nilai apakah data sudah masuk.',
      },
      {
        q: 'Data sekolah hilang setelah reset',
        a: 'Jika reset "Semua Data" dilakukan, semua pengaturan termasuk nama sekolah dan logo akan terhapus. Isi kembali pengaturan di menu Pengaturan > tab Informasi Sekolah. Selalu lakukan backup sebelum melakukan reset apapun.',
      },
    ],
  },
  {
    category: 'Admin & Teknis',
    icon: <Settings className="w-4 h-4" />,
    color: 'text-slate-600',
    bg: 'bg-slate-50',
    items: [
      {
        q: 'Berapa banyak siswa yang bisa menggunakan sistem bersamaan?',
        a: 'Bergantung pada paket Supabase yang digunakan. Paket gratis mendukung hingga ratusan koneksi bersamaan. Untuk sekolah besar, pertimbangkan upgrade ke paket berbayar untuk performa optimal.',
      },
      {
        q: 'Bagaimana cara import data siswa massal?',
        a: 'Gunakan menu Admin > Import. Unduh template Excel yang tersedia, isi data siswa sesuai format (NIS, nama, kelas, dll), lalu upload kembali. Sistem akan memvalidasi dan memasukkan data secara otomatis.',
      },
      {
        q: 'Apakah soal bisa digunakan ulang untuk ujian berikutnya?',
        a: 'Ya, soal yang sudah dibuat di Bank Soal bisa digunakan di banyak paket ujian berbeda. Paket soal juga bisa diduplikasi untuk ujian susulan atau ujian semester berikutnya.',
      },
    ],
  },
]

function SchoolLogo({ size, siteInfo }: { size: 'sm' | 'lg' | 'xl'; siteInfo: SiteInfo }) {
  const dim = size === 'xl' ? 'w-16 h-16' : size === 'lg' ? 'w-14 h-14' : 'w-10 h-10'
  const iconDim = size === 'xl' ? 'w-8 h-8' : size === 'lg' ? 'w-7 h-7' : 'w-5 h-5'
  const displayName = siteInfo.namaSekolah || 'SmartExam'
  if (siteInfo.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={siteInfo.logoUrl} alt={displayName}
        className={`${dim} object-contain rounded-xl bg-white/10 p-1 backdrop-blur flex-shrink-0`}
      />
    )
  }
  return (
    <div className={`${dim} bg-gradient-to-br from-sky-500 to-teal-500 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md`}>
      <BookOpen className={`${iconDim} text-white`} />
    </div>
  )
}

export default function LoginPage() {
  const router = useRouter()
  const [form, setForm] = useState({ username: '', password: '' })
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [siteInfo, setSiteInfo] = useState<SiteInfo>({ namaSekolah: '', kota: '', logoUrl: '' })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const spotlightRef = useRef<HTMLDivElement>(null)

  // Modal state
  const [showGuide, setShowGuide] = useState(false)
  const [showQA, setShowQA] = useState(false)
  const [showAktivitas, setShowAktivitas] = useState(false)
  const [activeRole, setActiveRole] = useState('admin')
  const [openQA, setOpenQA] = useState<string | null>(null)

  // Aktivitas state
  const [aktivitasLoading, setAktivitasLoading] = useState(false)
  const [ujianBerlangsung, setUjianBerlangsung] = useState<UjianBerlangsung[]>([])
  const [jadwalList, setJadwalList] = useState<JadwalItem[]>([])
  const [juaraList, setJuaraList] = useState<JuaraItem[]>([])
  const [aktivitasTab, setAktivitasTab] = useState<'ujian' | 'jadwal' | 'juara'>('ujian')

  async function loadAktivitas() {
    setAktivitasLoading(true)
    try {
      const res = await fetch('/api/public/aktivitas?t=' + Date.now(), { cache: 'no-store' })
      const json = await res.json()
      setUjianBerlangsung(json.ujianBerlangsung || [])
      setJadwalList(json.jadwal || [])
      setJuaraList(json.juaraPerKelas || [])
    } catch { /* ignore */ } finally {
      setAktivitasLoading(false)
    }
  }

  // ── Fullscreen ────────────────────────────────────────────────────────────
  const [isFs, setIsFs] = useState(false)
  useEffect(() => {
    function onFsChange() {
      const anyDoc = document as unknown as Record<string, Element | null>
      setIsFs(!!(document.fullscreenElement || anyDoc.webkitFullscreenElement || anyDoc.mozFullScreenElement || anyDoc.msFullscreenElement))
    }
    document.addEventListener('fullscreenchange', onFsChange)
    document.addEventListener('webkitfullscreenchange', onFsChange)
    document.addEventListener('mozfullscreenchange', onFsChange)
    document.addEventListener('MSFullscreenChange', onFsChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange)
      document.removeEventListener('webkitfullscreenchange', onFsChange)
      document.removeEventListener('mozfullscreenchange', onFsChange)
      document.removeEventListener('MSFullscreenChange', onFsChange)
    }
  }, [])
  function toggleFullscreen() {
    const anyDoc = document as unknown as Record<string, Element | null>
    const fsEl = document.fullscreenElement || anyDoc.webkitFullscreenElement || anyDoc.mozFullScreenElement || anyDoc.msFullscreenElement
    if (fsEl) {
      const d = document as unknown as Record<string, () => Promise<void>>
      ;(document.exitFullscreen || d.webkitExitFullscreen || d.mozCancelFullScreen || d.msExitFullscreen || (() => {})).call(document)
    } else {
      const el = document.documentElement as unknown as Record<string, () => Promise<void>>
      ;(el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen || (() => {})).call(document.documentElement)
    }
  }

  // ── Drape animation state (desktop only) ──────────────────────────────────
  const [drapeState, setDrapeState] = useState<'closed' | 'opening' | 'open' | 'closing'>('closed')
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const formAreaRef = useRef<HTMLDivElement>(null)
  const drapeAnimRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Maskot ───────────────────────────────────────────────────────────────
  const [mascotMood, setMascotMood] = useState<'idle' | 'sad' | 'wave'>('idle')
  const mascotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mascotCycleRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mascotHoveredRef = useRef(false)
  const MOOD_CYCLE: Array<'idle' | 'sad' | 'wave'> = ['idle', 'sad', 'wave']
  const mascotCycleIndexRef = useRef(0)

  const startMascotCycle = () => {
    if (mascotCycleRef.current) clearInterval(mascotCycleRef.current)
    mascotCycleIndexRef.current = 0
    setMascotMood('idle')
    mascotCycleRef.current = setInterval(() => {
      if (mascotHoveredRef.current) return
      mascotCycleIndexRef.current = (mascotCycleIndexRef.current + 1) % MOOD_CYCLE.length
      setMascotMood(MOOD_CYCLE[mascotCycleIndexRef.current])
    }, 10000)
  }
  const stopMascotCycle = () => {
    if (mascotCycleRef.current) { clearInterval(mascotCycleRef.current); mascotCycleRef.current = null }
  }
  const handleMascotEnter = () => {
    mascotHoveredRef.current = true
    if (mascotTimerRef.current) clearTimeout(mascotTimerRef.current)
    setMascotMood('sad')
    mascotTimerRef.current = setTimeout(() => setMascotMood('wave'), 550)
  }
  const handleMascotLeave = () => {
    mascotHoveredRef.current = false
    if (mascotTimerRef.current) clearTimeout(mascotTimerRef.current)
    setMascotMood('idle')
  }

  const isMobileCheck = () => typeof window !== 'undefined' && window.innerWidth < 1024

  const openDrape = () => {
    if (isMobileCheck()) return
    stopMascotCycle()
    setDrapeState(prev => {
      if (prev === 'open' || prev === 'opening') return prev
      if (drapeAnimRef.current) clearTimeout(drapeAnimRef.current)
      drapeAnimRef.current = setTimeout(() => setDrapeState('open'), 720)
      return 'opening'
    })
    resetIdleTimer()
  }
  const closeDrape = () => {
    if (isMobileCheck()) return
    setDrapeState(prev => {
      if (prev === 'closed' || prev === 'closing') return prev
      if (drapeAnimRef.current) clearTimeout(drapeAnimRef.current)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      drapeAnimRef.current = setTimeout(() => {
        setDrapeState('closed')
        startMascotCycle()
      }, 480)
      return 'closing'
    })
  }
  const resetIdleTimer = () => {
    if (isMobileCheck()) return
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => { closeDrape() }, 10000)
  }
  const handleFormActivity = () => { resetIdleTimer() }
  const draped = drapeState === 'open' || drapeState === 'opening'

  // ── Mouse spotlight (ultra lightweight — tidak memicu re-render) ──────────
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!spotlightRef.current) return
    const el = spotlightRef.current
    el.style.left = e.clientX + 'px'
    el.style.top = e.clientY + 'px'
  }

  useEffect(() => {
    startMascotCycle()
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      if (drapeAnimRef.current) clearTimeout(drapeAnimRef.current)
      if (mascotTimerRef.current) clearTimeout(mascotTimerRef.current)
      stopMascotCycle()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Canvas bubbles ────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight }
    resize()
    window.addEventListener('resize', resize)
    type Bubble = { x: number; y: number; r: number; vx: number; vy: number; alpha: number; phase: 'alive' | 'popping'; popFrame: number }
    const bubbles: Bubble[] = []
    const MAX = 18
    const spawn = (): Bubble => ({
      x: Math.random() * canvas.width, y: canvas.height + 40,
      r: 18 + Math.random() * 38, vx: (Math.random() - 0.5) * 0.6,
      vy: -(0.4 + Math.random() * 0.7), alpha: 0.12 + Math.random() * 0.18,
      phase: 'alive', popFrame: 0,
    })
    for (let i = 0; i < 10; i++) { const b = spawn(); b.y = Math.random() * canvas.height; bubbles.push(b) }
    let raf: number
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (bubbles.length < MAX && Math.random() < 0.02) bubbles.push(spawn())
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i]
        if (b.phase === 'popping') {
          b.popFrame++
          const prog = b.popFrame / 12
          ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (1 + prog * 0.5), 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(255,255,255,${b.alpha * (1 - prog)})`; ctx.lineWidth = 1.5; ctx.stroke()
          if (b.popFrame >= 12) bubbles.splice(i, 1)
          continue
        }
        b.x += b.vx; b.vy += 0.002; b.y += b.vy
        for (let j = i - 1; j >= 0; j--) {
          const o = bubbles[j]; if (o.phase === 'popping') continue
          const dx = b.x - o.x, dy = b.y - o.y, dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < b.r + o.r) { b.phase = 'popping'; b.popFrame = 0; o.phase = 'popping'; o.popFrame = 0; break }
        }
        if (b.y + b.r < 0 || b.x + b.r < 0 || b.x - b.r > canvas.width) { bubbles.splice(i, 1); continue }
        const grad = ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.1, b.x, b.y, b.r)
        grad.addColorStop(0, `rgba(255,255,255,${b.alpha * 1.5})`); grad.addColorStop(0.5, `rgba(255,255,255,${b.alpha * 0.4})`); grad.addColorStop(1, `rgba(255,255,255,0)`)
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill()
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.strokeStyle = `rgba(255,255,255,${b.alpha * 1.2})`; ctx.lineWidth = 1; ctx.stroke()
        ctx.beginPath(); ctx.arc(b.x - b.r * 0.28, b.y - b.r * 0.32, b.r * 0.18, 0, Math.PI * 2); ctx.fillStyle = `rgba(255,255,255,${b.alpha * 1.8})`; ctx.fill()
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [])

  useEffect(() => {
    fetch('/api/public/pengaturan?t=' + Date.now(), { cache: 'no-store' })
      .then(r => r.json())
      .then(json => {
        if (json?.data) setSiteInfo({ namaSekolah: json.data.namaSekolah ?? '', kota: json.data.kota ?? '', logoUrl: json.data.logoAplikasi || json.data.logoUrl || '' })
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (showGuide || showQA || showAktivitas) { document.body.style.overflow = 'hidden' }
    else { document.body.style.overflow = '' }
    return () => { document.body.style.overflow = '' }
  }, [showGuide, showQA, showAktivitas])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!form.username || !form.password) { setError('Username dan password wajib diisi'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Login gagal')
      localStorage.setItem('token', data.token)
      localStorage.setItem('user', JSON.stringify({ username: data.username, nama: data.nama, role: data.role, nis: data.nis, kelas: data.kelas }))
      const roleRoutes: Record<string, string> = { ADMIN: '/admin', GURU: '/guru', KEPSEK: '/kepsek', SISWA: '/siswa' }
      router.push(roleRoutes[data.role] ?? '/login')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login gagal')
    } finally { setLoading(false) }
  }

  const displayName = siteInfo.namaSekolah || 'SmartExam'
  const year = new Date().getFullYear()

  const [witaTime, setWitaTime] = useState<{ day: string; date: string; time: string }>({ day: '', date: '', time: '' })
  useEffect(() => {
    const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des']
    const tick = () => {
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Makassar' }))
      const h = String(now.getHours()).padStart(2, '0'), m = String(now.getMinutes()).padStart(2, '0'), s = String(now.getSeconds()).padStart(2, '0')
      setWitaTime({ day: DAYS[now.getDay()], date: `${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`, time: `${h}:${m}:${s}` })
    }
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id)
  }, [])

  const activeRoleData = ROLES.find(r => r.id === activeRole) ?? ROLES[0]

  // 4 fitur untuk grid card
  const FITUR = [
    { icon: <Shield className="w-5 h-5" />, label: 'Anti-Nyontek', color: '#a855f7', bg: 'rgba(168,85,247,0.15)' },
    { icon: <BarChart2 className="w-5 h-5" />, label: 'Penilaian Otomatis', color: '#f97316', bg: 'rgba(249,115,22,0.15)' },
    { icon: <Monitor className="w-5 h-5" />, label: 'Monitoring Real-time', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
    { icon: <CheckCircle className="w-5 h-5" />, label: 'Hasil Akurat', color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
  ]

  return (
    <div
      className="min-h-screen flex relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #eaf6fb 0%, #dbeefc 25%, #e3f2fb 50%, #d8edf9 75%, #e8f6fb 100%)' }}
      onMouseMove={handleMouseMove}
    >
      {/* ── Mouse spotlight ── */}
      <div
        ref={spotlightRef}
        style={{
          position: 'fixed', pointerEvents: 'none', zIndex: 0,
          width: '600px', height: '600px',
          background: 'radial-gradient(circle, rgba(56,189,248,0.10) 0%, transparent 70%)',
          borderRadius: '50%',
          transform: 'translate(-50%, -50%)',
          transition: 'left 0.1s ease-out, top 0.1s ease-out',
          left: '-300px', top: '-300px',
        }}
      />

      {/* ── Aurora glow blobs ── */}
      <div className="absolute inset-0 overflow-hidden" style={{ pointerEvents: 'none', zIndex: 0 }}>
        {/* Biru besar kiri atas */}
        <div className="aurora-1 absolute -top-48 -left-48 w-[700px] h-[700px] rounded-full opacity-50"
          style={{ background: 'radial-gradient(circle, rgba(56,189,248,0.35) 0%, rgba(14,165,233,0.18) 40%, transparent 70%)', filter: 'blur(60px)' }} />
        {/* Teal kanan tengah */}
        <div className="aurora-2 absolute top-1/3 -right-48 w-[600px] h-[600px] rounded-full opacity-40"
          style={{ background: 'radial-gradient(circle, rgba(45,212,191,0.30) 0%, rgba(20,184,166,0.15) 45%, transparent 70%)', filter: 'blur(70px)' }} />
        {/* Biru muda bawah kiri */}
        <div className="aurora-3 absolute -bottom-56 left-1/4 w-[550px] h-[550px] rounded-full opacity-40"
          style={{ background: 'radial-gradient(circle, rgba(96,165,250,0.30) 0%, rgba(59,130,246,0.12) 45%, transparent 70%)', filter: 'blur(65px)' }} />
        {/* Aksen putih kecil */}
        <div className="absolute bottom-1/4 right-1/3 w-[300px] h-[300px] rounded-full opacity-40"
          style={{ background: 'radial-gradient(circle, rgba(186,230,253,0.55) 0%, transparent 70%)', filter: 'blur(50px)', animation: 'aurora3 22s ease-in-out infinite' }} />
      </div>

      {/* ── Motif geometris transparan — SVG pattern ringan ── */}
      <svg
        className="absolute inset-0 w-full h-full batik-layer"
        style={{ pointerEvents: 'none', zIndex: 0, opacity: 0.18 }}
        viewBox="0 0 800 800" preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="batikPalem" width="160" height="160" patternUnits="userSpaceOnUse" patternTransform="rotate(12)">
            <g fill="none" stroke="#7dd3fc" strokeWidth="1.2">
              {/* Mega mendung / parang stilir */}
              <path d="M0 40 Q40 0 80 40 Q120 80 160 40" />
              <path d="M0 80 Q40 40 80 80 Q120 120 160 80" />
              <path d="M0 120 Q40 80 80 120 Q120 160 160 120" />
              <path d="M40 0 Q40 40 40 80" strokeWidth="0.8" stroke="#a5f3fc" />
              <path d="M80 0 Q80 40 80 80" strokeWidth="0.8" stroke="#a5f3fc" />
              <path d="M120 0 Q120 40 120 80" strokeWidth="0.8" stroke="#a5f3fc" />
              <circle cx="40" cy="40" r="5" stroke="#bae6fd" strokeWidth="1" />
              <circle cx="120" cy="120" r="5" stroke="#bae6fd" strokeWidth="1" />
              <circle cx="80" cy="80" r="3" stroke="#38bdf8" strokeWidth="1" />
              {/* Kawung accent */}
              <ellipse cx="40" cy="40" rx="14" ry="9" transform="rotate(45 40 40)" strokeWidth="0.9" stroke="#7dd3fc" />
              <ellipse cx="120" cy="120" rx="14" ry="9" transform="rotate(45 120 120)" strokeWidth="0.9" stroke="#7dd3fc" />
            </g>
          </pattern>
        </defs>
        <rect x="0" y="0" width="800" height="800" fill="url(#batikPalem)" />
      </svg>

      {/* ── Mesh lines dekoratif ── */}
      <svg
        className="absolute inset-0 w-full h-full"
        style={{ pointerEvents: 'none', zIndex: 0, opacity: 0.5 }}
        viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="lgPurple" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0" />
            <stop offset="50%" stopColor="#38bdf8" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="lgPink" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#14b8a6" stopOpacity="0" />
            <stop offset="50%" stopColor="#14b8a6" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#14b8a6" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="lgBlue" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0" />
            <stop offset="50%" stopColor="#60a5fa" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
          <filter id="softGlow2">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <g filter="url(#softGlow2)" opacity="0.8">
          <path d="M -80 140 L 360 60 L 720 190 L 1080 40" stroke="url(#lgPurple)" strokeWidth="1.8" fill="none" />
          <path d="M 360 60 L 420 320" stroke="url(#lgPink)" strokeWidth="1.4" fill="none" />
          <path d="M 720 190 L 660 430" stroke="url(#lgBlue)" strokeWidth="1.4" fill="none" />
          <path d="M -80 260 L 300 340 L 720 190" stroke="url(#lgBlue)" strokeWidth="1.2" fill="none" />
        </g>
        <g filter="url(#softGlow2)" opacity="0.7">
          <path d="M 1540 760 L 1140 860 L 760 700 L 380 840" stroke="url(#lgPink)" strokeWidth="1.8" fill="none" />
          <path d="M 1140 860 L 1080 600" stroke="url(#lgPurple)" strokeWidth="1.4" fill="none" />
          <path d="M 760 700 L 820 470" stroke="url(#lgBlue)" strokeWidth="1.4" fill="none" />
        </g>
        <path d="M -80 500 L 480 380 L 1000 560 L 1540 420" stroke="url(#lgPurple)" strokeWidth="1" fill="none" opacity="0.5" />
        <g filter="url(#softGlow2)">
          <circle cx="360" cy="60" r="3.5" fill="#7dd3fc" />
          <circle cx="720" cy="190" r="4" fill="#38bdf8" />
          <circle cx="420" cy="320" r="2.5" fill="#2dd4bf" />
          <circle cx="660" cy="430" r="3" fill="#60a5fa" />
          <circle cx="1140" cy="860" r="3.5" fill="#2dd4bf" />
          <circle cx="760" cy="700" r="4" fill="#38bdf8" />
        </g>
      </svg>

      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none', zIndex: 0 }} />

      {/* ── Tombol Fullscreen — sudut kanan atas ── */}
      <button
        type="button"
        onClick={toggleFullscreen}
        title={isFs ? 'Keluar dari layar penuh' : 'Tampilkan layar penuh'}
        className="absolute z-20 hidden lg:flex items-center gap-2 select-none transition-all"
        style={{
          top: '1rem',
          right: '1.25rem',
          background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          border: '1.5px solid rgba(56,189,248,0.35)', borderRadius: '12px',
          padding: '8px 14px',
          boxShadow: '0 4px 24px rgba(56,189,248,0.18), 0 0 0 1px rgba(255,255,255,0.5), inset 0 1px 0 rgba(255,255,255,0.6)',
          color: '#0c4a6e',
          fontSize: '12px',
          fontWeight: 600,
          letterSpacing: '0.02em',
        }}
      >
        {isFs
          ? <><Minimize className="w-3.5 h-3.5" style={{ color: '#0284c7' }} /><span>Keluar Fullscreen</span></>
          : <><Maximize className="w-3.5 h-3.5" style={{ color: '#0284c7' }} /><span>Layar Penuh</span></>
        }
      </button>

      {/* ── Jam WITA — sudut kanan atas, di kiri tombol fullscreen ── */}
      {witaTime.time && (
        <div
          className="absolute top-4 z-20 hidden lg:flex items-center gap-3 select-none"
          style={{
            right: isFs ? '11rem' : '12.5rem',
            background: 'rgba(255,255,255,0.85)',
            backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            border: '1.5px solid rgba(56,189,248,0.35)', borderRadius: '16px',
            padding: '10px 18px 10px 14px',
            boxShadow: '0 4px 24px rgba(56,189,248,0.18), 0 0 0 1px rgba(255,255,255,0.5), inset 0 1px 0 rgba(255,255,255,0.6)',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="9.5" stroke="#0ea5e9" strokeWidth="2" />
            <path d="M12 7v5.5l3.5 2" stroke="#0284c7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span style={{ fontSize: '14px', color: '#334155', fontWeight: 600, letterSpacing: '0.02em', lineHeight: 1 }}>
            {witaTime.day}, {witaTime.date}
          </span>
          <span style={{ width: '1.5px', height: '18px', background: 'rgba(56,189,248,0.3)', flexShrink: 0, borderRadius: '2px' }} />
          <span style={{ fontSize: '17px', fontWeight: 800, letterSpacing: '0.08em', color: '#0284c7', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
            {witaTime.time}
          </span>
          <span style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.1em', color: '#0c4a6e', background: 'linear-gradient(135deg, rgba(56,189,248,0.25), rgba(20,184,166,0.2))', borderRadius: '7px', padding: '3px 7px', lineHeight: 1.3, border: '1px solid rgba(56,189,248,0.3)' }}>
            WITA
          </span>
        </div>
      )}

      {/* ── LEFT — branding ── */}
      <div className="hidden lg:flex flex-col w-1/2 p-12 text-slate-900 relative">
        {/* Ilustrasi siswa */}
        <img
          src="/images/siswa-sekolah.webp"
          alt="" aria-hidden="true"
          className="absolute left-0 w-[52vw] max-w-[660px] min-w-[360px] h-auto select-none transition-transform duration-500 ease-out hover:animate-float hover:scale-[1.03] hover:drop-shadow-2xl"
          style={{ zIndex: 1, bottom: '-2%' }}
        />
        <div className="relative z-10 space-y-8">
          <div className="flex items-center gap-4 cursor-default w-fit"
            style={{ transition: 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.14)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)' }}
          >
            <SchoolLogo size="xl" siteInfo={siteInfo} />
            <div className="min-w-0">
              <p className="font-bold text-2xl leading-tight line-clamp-2 text-slate-900">{displayName}</p>
              <p className="text-slate-500 text-base">Sistem Ujian Digital Terpercaya</p>
            </div>
          </div>

          <div>
            <h1 className="text-5xl xl:text-6xl font-bold leading-tight mb-4 cursor-default w-fit text-slate-900"
              style={{ transition: 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)', display: 'inline-block', transformOrigin: 'left center' }}
              onMouseEnter={e => { (e.currentTarget as HTMLHeadingElement).style.transform = 'scale(1.08)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLHeadingElement).style.transform = 'scale(1)' }}
            >
              Ujian Digital<br />
              <span style={{
                background: 'linear-gradient(90deg, #2563eb, #0ea5e9, #14b8a6)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>
                Lebih Mudah & Adil
              </span>
            </h1>
            <p className="text-slate-500 text-base leading-relaxed max-w-sm">
              Sistem CBT modern{siteInfo.namaSekolah ? ` untuk ${siteInfo.namaSekolah}` : ''}{' '}
              dengan fitur anti-nyontek, penilaian otomatis, dan monitoring real-time.
            </p>
          </div>
        </div>
        <div className="relative z-10 text-slate-400 text-xs mt-auto">
          {siteInfo.namaSekolah ? <>{siteInfo.namaSekolah} &copy; {year}</> : <>SmartExam &copy; {year}</>}
        </div>
      </div>

      {/* ── RIGHT — login area ── */}
      <div className="flex-1 flex items-center justify-center p-6 relative z-10">
        <div className="w-full max-w-sm relative">

          {/* ── MOBILE ── */}
          <div className="lg:hidden">
            <div className="flex items-center gap-3 mb-6 justify-center">
              <SchoolLogo size="sm" siteInfo={siteInfo} />
              <div className="min-w-0 text-left">
                <p className="font-bold text-slate-900 text-base leading-tight line-clamp-2">{displayName}</p>
                {!siteInfo.namaSekolah && <p className="text-slate-500 text-xs">Sistem Ujian Digital Terpercaya</p>}
              </div>
            </div>

            {/* Welcome card mobile — glass */}
            <div className="login-glass-card rounded-3xl p-8 text-slate-900">
              {/* Avatar + heading */}
              <div className="flex flex-col items-center mb-6">
                <div className="w-16 h-16 rounded-full bg-sky-50 flex items-center justify-center mb-3">
                  <User className="w-7 h-7 text-sky-500" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900">Selamat Datang &#128075;</h2>
                <p className="text-slate-500 text-sm mt-1">Silakan login untuk melanjutkan</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                {error && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" /><span>{error}</span>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1.5">Username / NIS</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input type="text" placeholder="Masukkan username atau NIS"
                      className="w-full pl-10 pr-4 py-3 rounded-xl text-sm text-slate-900 placeholder-slate-400 bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-400/60 focus:border-sky-400/60 transition-all"
                      value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                      autoComplete="username" autoFocus
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1.5">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input type={showPw ? 'text' : 'password'} placeholder="Masukkan password"
                      className="w-full pl-10 pr-10 py-3 rounded-xl text-sm text-slate-900 placeholder-slate-400 bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-400/60 focus:border-sky-400/60 transition-all"
                      value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                      autoComplete="current-password"
                    />
                    <button type="button" onClick={() => setShowPw(v => !v)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={loading}
                  className="btn-login-drape w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-white font-bold text-base mt-2 disabled:opacity-60"
                >
                  {loading ? (
                    <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Masuk...</>
                  ) : (<><Lock className="w-4 h-4 opacity-90" /><span>Login Disini</span><span style={{ fontSize: '16px' }}>▾</span></>)}
                </button>
              </form>

              {/* Divider */}
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-slate-400 text-xs">atau</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>

              {/* Grid 4 fitur */}
              <div className="grid grid-cols-4 gap-2 mb-4">
                {FITUR.map(f => (
                  <div key={f.label} className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl"
                    style={{ background: f.bg, border: `1px solid ${f.color}30` }}>
                    <span style={{ color: f.color }}>{f.icon}</span>
                    <span className="text-[10px] text-center leading-tight font-medium" style={{ color: f.color }}>{f.label}</span>
                  </div>
                ))}
              </div>

              {/* Footer sekolah */}
              <div className="text-center border-t border-slate-100 pt-4">
                <p className="font-bold text-slate-700 text-sm">{displayName}</p>
                {siteInfo.kota && <p className="text-slate-400 text-xs mt-0.5">{siteInfo.kota}</p>}
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => setShowGuide(true)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-slate-500 hover:text-slate-800 bg-white/70 border border-slate-200 hover:border-slate-300 text-xs font-medium transition-all">
                <BookMarked className="w-3.5 h-3.5" /> Panduan
              </button>
              <button type="button" onClick={() => setShowQA(true)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-slate-500 hover:text-slate-800 bg-white/70 border border-slate-200 hover:border-slate-300 text-xs font-medium transition-all">
                <HelpCircle className="w-3.5 h-3.5" /> Q&amp;A
              </button>
            </div>

            {/* Tombol Lihat Aktivitas — mobile */}
            <button
              type="button"
              onClick={() => { setShowAktivitas(true); loadAktivitas() }}
              className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold transition-all"
              style={{
                background: 'linear-gradient(135deg, rgba(14,165,233,0.12) 0%, rgba(20,184,166,0.12) 100%)',
                border: '1px solid rgba(14,165,233,0.3)',
                color: '#0284c7',
              }}
            >
              <Activity className="w-3.5 h-3.5" />
              Lihat Aktivitas
            </button>
          </div>

          {/* ── DESKTOP: efek kain + welcome card premium ── */}
          <div ref={formAreaRef} className="hidden lg:block relative" onMouseEnter={openDrape}>

            {/* Tombol "Login Disini" — closed state (selalu render untuk jaga tinggi container) */}
            <div
              className="relative flex flex-col items-center gap-4"
              style={{
                zIndex: 2,
                opacity: drapeState === 'closed' ? 1 : 0,
                pointerEvents: drapeState === 'closed' ? 'auto' : 'none',
                transition: 'opacity 0.3s ease',
                visibility: drapeState === 'closed' ? 'visible' : 'hidden',
              }}
              onMouseEnter={handleMascotEnter}
              onMouseLeave={handleMascotLeave}
            >
              {/* Welcome card preview (closed state) — glass */}
              <div className="login-glass-card rounded-3xl w-full p-7 text-center">
                {/* Maskot emoji */}
                <div className="absolute -top-14 left-1/2 -translate-x-1/2" style={{ zIndex: 3 }}>
                  <svg width="64" height="64" viewBox="0 0 64 64" className={mascotMood === 'idle' ? 'mascot-bounce' : ''}>
                    <circle cx="32" cy="32" r="26" fill="#fde68a" stroke="#f59e0b" strokeWidth="2" />
                    {mascotMood === 'sad' ? (
                      <>
                        <path d="M19 26 q4 -5 9 0" stroke="#7c2d12" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                        <path d="M36 26 q4 -5 9 0" stroke="#7c2d12" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                      </>
                    ) : (
                      <>
                        <circle cx="23" cy="28" r="2.6" fill="#7c2d12" />
                        <circle cx="41" cy="28" r="2.6" fill="#7c2d12" />
                      </>
                    )}
                    {mascotMood === 'sad'
                      ? <path d="M22 42 q10 -8 20 0" stroke="#7c2d12" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                      : <path d="M22 36 q10 8 20 0" stroke="#7c2d12" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                    }
                    <g className={mascotMood === 'wave' ? 'mascot-wave' : ''} style={{ transformOrigin: '50px 38px', opacity: mascotMood === 'wave' ? 1 : 0, transition: 'opacity 0.2s ease' }}>
                      <circle cx="50" cy="38" r="2" fill="#7c2d12" />
                      <path d="M50 38 L58 24" stroke="#f59e0b" strokeWidth="5" strokeLinecap="round" />
                      <circle cx="58" cy="24" r="4.5" fill="#fde68a" stroke="#f59e0b" strokeWidth="2" />
                    </g>
                  </svg>
                </div>

                <div className="mt-6 mb-5">
                  <h2 className="text-2xl font-bold text-slate-900">Selamat Datang &#128075;</h2>
                  <p className="text-slate-500 text-sm mt-1">Silakan login untuk melanjutkan</p>
                </div>

                <button
                  type="button"
                  onClick={openDrape}
                  className="btn-login-drape w-full flex items-center justify-center gap-3 px-8 py-4 rounded-2xl text-white font-bold text-base tracking-wide select-none cursor-pointer"
                  style={{ boxShadow: '0 4px 32px rgba(37,99,235,0.35), 0 0 60px rgba(20,184,166,0.2), 0 2px 8px rgba(15,23,42,0.12)', letterSpacing: '0.04em' }}
                >
                  <Lock className="w-5 h-5 opacity-90" />
                  <span>Login Disini</span>
                  <span style={{ display: 'inline-block', transform: draped ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1)', fontSize: '18px', lineHeight: 1, opacity: 0.85 }}>▾</span>
                </button>

                {/* Divider */}
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-slate-200" />
                  <span className="text-slate-400 text-xs">atau</span>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>

                {/* Grid 4 fitur */}
                <div className="grid grid-cols-4 gap-2 mb-5">
                  {FITUR.map(f => (
                    <div key={f.label} className="flex flex-col items-center gap-1.5 p-3 rounded-xl"
                      style={{ background: f.bg, border: `1px solid ${f.color}30` }}>
                      <span style={{ color: f.color }}>{f.icon}</span>
                      <span className="text-[10px] text-center leading-tight font-medium" style={{ color: f.color }}>{f.label}</span>
                    </div>
                  ))}
                </div>

                {/* Tombol Lihat Aktivitas — closed state desktop */}
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setShowAktivitas(true); loadAktivitas() }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl mb-4 text-xs font-semibold transition-all"
                  style={{
                    background: 'linear-gradient(135deg, rgba(14,165,233,0.12) 0%, rgba(20,184,166,0.12) 100%)',
                    border: '1px solid rgba(14,165,233,0.3)',
                    color: '#0284c7',
                  }}
                >
                  <Activity className="w-3.5 h-3.5" />
                  Lihat Aktivitas
                </button>

                {/* Footer sekolah dalam card */}
                <div className="border-t border-slate-100 pt-4">
                  <p className="font-bold text-slate-700 text-sm">{displayName}</p>
                  {siteInfo.kota && <p className="text-slate-400 text-xs mt-0.5">{siteInfo.kota}</p>}
                </div>
              </div>
            </div>

            {/* ── Kain terurai — form login (absolute overlay, tidak geser layout) ── */}
            {drapeState !== 'closed' && (
              <div
                key={drapeState === 'opening' ? 'open' : drapeState}
                className={drapeState === 'closing' ? 'drape-close' : 'drape-open'}
                style={{ transformOrigin: 'top center', position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 }}
                onMouseEnter={resetIdleTimer}
                onMouseMove={handleFormActivity}
              >
                {/* Jahitan atas — gradient biru-teal */}
                <div style={{
                  height: '5px',
                  background: 'linear-gradient(90deg, #2563eb, #0ea5e9, #14b8a6, #0ea5e9, #2563eb)',
                  backgroundSize: '300% 100%',
                  animation: 'gradientShift 4s ease infinite',
                }} />

                <div
                  className="rounded-b-3xl p-8"
                  style={{
                    background: 'rgba(255, 255, 255, 0.95)',
                    backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
                    border: '1px solid rgba(226,232,240,0.9)',
                    borderTop: 'none',
                    boxShadow: '0 32px 80px rgba(15,23,42,0.16), 0 0 0 1px rgba(255,255,255,0.5)',
                  }}
                >
                  {/* Bar tutup */}
                  <div className="mb-4 flex items-center gap-2 justify-end">
                    <span className="text-[10px] text-slate-400">Auto-tutup dalam 10 detik tanpa aktivitas</span>
                    <button type="button" onClick={closeDrape}
                      className="w-5 h-5 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="mb-6">
                    <h2 className="text-2xl font-bold text-slate-900">Selamat Datang</h2>
                    <p className="text-slate-500 text-sm mt-1">Masuk ke akun Anda untuk melanjutkan</p>
                  </div>

                  <form onSubmit={handleLogin} className="space-y-5" onInput={handleFormActivity} onChange={handleFormActivity}>
                    {error && (
                      <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">
                        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{error}</span>
                      </div>
                    )}
                    <div>
                      <label className="block text-sm font-medium text-slate-600 mb-1.5">Username / NIS</label>
                      <div className="relative"
                        style={{ transition: 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.03)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)' }}
                      >
                        <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input type="text" placeholder="Masukkan username atau NIS"
                          className="w-full pl-10 pr-4 py-3 rounded-xl text-sm text-slate-900 placeholder-slate-400 bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-400/60 focus:border-sky-400/60 transition-all"
                          value={form.username}
                          onChange={e => { setForm(f => ({ ...f, username: e.target.value })); resetIdleTimer() }}
                          autoComplete="username"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-600 mb-1.5">Password</label>
                      <div className="relative"
                        style={{ transition: 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.03)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)' }}
                      >
                        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input type={showPw ? 'text' : 'password'} placeholder="Masukkan password"
                          className="w-full pl-10 pr-10 py-3 rounded-xl text-sm text-slate-900 placeholder-slate-400 bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-400/60 focus:border-sky-400/60 transition-all"
                          value={form.password}
                          onChange={e => { setForm(f => ({ ...f, password: e.target.value })); resetIdleTimer() }}
                          autoComplete="current-password"
                        />
                        <button type="button" onClick={() => { setShowPw(v => !v); resetIdleTimer() }}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                          {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <button type="submit" disabled={loading}
                      className="btn-login-drape w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-white font-bold text-base mt-2 disabled:opacity-60"
                      style={{ boxShadow: '0 4px 24px rgba(37,99,235,0.3), 0 0 40px rgba(20,184,166,0.18)' }}
                    >
                      {loading ? (
                        <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Masuk...</>
                      ) : 'Masuk'}
                    </button>
                  </form>

                  <div className="mt-5 pt-5 border-t border-slate-100 space-y-3">
                    <p className="text-xs text-slate-400 text-center">Lupa password? Hubungi administrator sekolah.</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => { setShowGuide(true); resetIdleTimer() }}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-slate-200 text-slate-500 hover:text-slate-800 hover:border-slate-300 text-xs font-medium transition-all">
                        <BookMarked className="w-3.5 h-3.5" /> Panduan
                      </button>
                      <button type="button" onClick={() => { setShowQA(true); resetIdleTimer() }}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-slate-200 text-slate-500 hover:text-slate-800 hover:border-slate-300 text-xs font-medium transition-all">
                        <HelpCircle className="w-3.5 h-3.5" /> Q&amp;A
                      </button>
                    </div>
                    {/* Tombol Lihat Aktivitas — desktop */}
                    <button
                      type="button"
                      onClick={() => { setShowAktivitas(true); loadAktivitas(); resetIdleTimer() }}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold transition-all"
                      style={{
                        background: 'linear-gradient(135deg, rgba(14,165,233,0.12) 0%, rgba(20,184,166,0.12) 100%)',
                        border: '1px solid rgba(14,165,233,0.3)',
                        color: '#0284c7',
                      }}
                    >
                      <Activity className="w-3.5 h-3.5" />
                      Lihat Aktivitas
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {(siteInfo.namaSekolah || siteInfo.kota) && (
            <p className="text-center text-slate-400 text-xs mt-4 hidden lg:block">
              {[siteInfo.namaSekolah, siteInfo.kota].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </div>

      {/* ══════════════════ MODAL: PANDUAN ══════════════════ */}
      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backdropFilter: 'blur(8px)', background: 'rgba(10,4,30,0.80)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowGuide(false) }}
        >
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                  <BookMarked className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-900 text-base sm:text-lg">Panduan Penggunaan</h2>
                  <p className="text-xs text-slate-400">SmartExam — Sistem Ujian Digital</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowGuide(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col sm:flex-row flex-1 overflow-hidden">
              <div className="sm:w-44 flex-shrink-0 sm:border-r border-b sm:border-b-0 border-slate-100 sm:py-4 overflow-x-auto sm:overflow-y-auto">
                <div className="flex sm:flex-col gap-1 p-2 sm:p-0 min-w-max sm:min-w-0">
                  {ROLES.map(role => (
                    <button key={role.id} type="button" onClick={() => setActiveRole(role.id)}
                      className={`flex items-center gap-2 sm:gap-2.5 px-3 sm:px-4 py-2 sm:py-3 rounded-xl sm:rounded-none text-left transition-all text-xs sm:text-sm font-medium whitespace-nowrap sm:whitespace-normal sm:w-full sm:border-r-2 ${
                        activeRole === role.id
                          ? `${role.bgLight} ${role.text} border ${role.border} sm:border-0 sm:border-r-2`
                          : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700 border border-transparent'
                      }`}
                    >
                      <span className={`w-6 h-6 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        activeRole === role.id ? `bg-gradient-to-br ${role.color} text-white` : 'bg-slate-100 text-slate-400'
                      }`}>{role.icon}</span>
                      {role.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                <div className={`rounded-2xl p-4 sm:p-5 mb-4 sm:mb-6 bg-gradient-to-br ${activeRoleData.color} text-white`}>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-9 h-9 sm:w-10 sm:h-10 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">{activeRoleData.icon}</div>
                    <div>
                      <h3 className="font-bold text-base sm:text-lg">{activeRoleData.label}</h3>
                      <p className="text-white/80 text-xs sm:text-sm">{activeRoleData.desc}</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  {activeRoleData.steps.map((step, i) => (
                    <div key={i} className={`rounded-xl border ${activeRoleData.border} ${activeRoleData.bgLight} p-3 sm:p-4`}>
                      <div className="flex items-start gap-3">
                        <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-gradient-to-br ${activeRoleData.color} text-white flex items-center justify-center flex-shrink-0 mt-0.5`}>{step.icon}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${activeRoleData.badge}`}>{i + 1}</span>
                            <h4 className={`font-semibold text-sm ${activeRoleData.text}`}>{step.title}</h4>
                          </div>
                          <p className="text-sm text-slate-600 leading-relaxed">{step.detail}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 sm:mt-5 p-3 sm:p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-start gap-3">
                  <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-slate-500 leading-relaxed">Butuh bantuan lebih lanjut? Hubungi administrator sistem atau lihat section <strong>Q&A / Bantuan</strong>.</p>
                </div>
              </div>
            </div>

            <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-100 flex items-center justify-between flex-shrink-0 gap-2">
              <p className="text-xs text-slate-400 hidden sm:block">SmartExam &copy; {year}</p>
              <div className="flex gap-2 w-full sm:w-auto">
                <button type="button" onClick={() => { setShowGuide(false); setShowQA(true) }}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium transition-colors">
                  <HelpCircle className="w-4 h-4" /> Q&amp;A
                </button>
                <button type="button" onClick={() => setShowGuide(false)}
                  className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors">Tutup</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════ MODAL: Q&A ══════════════════ */}
      {showQA && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backdropFilter: 'blur(8px)', background: 'rgba(10,4,30,0.80)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowQA(false) }}
        >
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center flex-shrink-0">
                  <HelpCircle className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-900 text-base sm:text-lg">Q&A / Bantuan</h2>
                  <p className="text-xs text-slate-400">Pertanyaan yang sering diajukan & skenario darurat</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowQA(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 sm:space-y-6">
              {QA_ITEMS.map((section) => (
                <div key={section.category}>
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${section.bg} mb-3`}>
                    <span className={section.color}>{section.icon}</span>
                    <h3 className={`font-semibold text-sm ${section.color}`}>{section.category}</h3>
                  </div>
                  <div className="space-y-2">
                    {section.items.map((item, i) => {
                      const key = `${section.category}-${i}`
                      const isOpen = openQA === key
                      return (
                        <div key={i} className="border border-slate-200 rounded-xl overflow-hidden">
                          <button type="button" onClick={() => setOpenQA(isOpen ? null : key)}
                            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors">
                            <span className="text-sm font-medium text-slate-800">{item.q}</span>
                            {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />}
                          </button>
                          {isOpen && (
                            <div className={`px-4 pb-4 pt-1 ${section.bg} border-t border-slate-100`}>
                              <p className="text-sm text-slate-600 leading-relaxed">{item.a}</p>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-amber-800 text-sm mb-1">Masalah tidak terdaftar di sini?</h4>
                    <p className="text-amber-700 text-sm leading-relaxed">Segera hubungi <strong>Administrator Sistem</strong> sekolah Anda. Untuk masalah teknis kritis, administrator perlu menghubungi pengelola sistem untuk penanganan lebih lanjut.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-100 flex items-center justify-between flex-shrink-0 gap-2">
              <p className="text-xs text-slate-400 hidden sm:block">SmartExam &copy; {year}</p>
              <div className="flex gap-2 w-full sm:w-auto">
                <button type="button" onClick={() => { setShowQA(false); setShowGuide(true) }}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium transition-colors">
                  <BookMarked className="w-4 h-4" /> Panduan
                </button>
                <button type="button" onClick={() => setShowQA(false)}
                  className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors">Tutup</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════ MODAL: AKTIVITAS ══════════════════ */}
      {showAktivitas && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backdropFilter: 'blur(8px)', background: 'rgba(10,4,30,0.82)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowAktivitas(false) }}
        >
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">

            {/* Header */}
            <div className="px-5 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
                  <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-900 text-base sm:text-lg">Aktivitas Ujian</h2>
                  <p className="text-xs text-slate-400">Informasi real-time sekolah</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowAktivitas(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tab bar */}
            <div className="flex gap-1 px-5 sm:px-6 pt-3 pb-0 flex-shrink-0 overflow-x-auto">
              {[
                { key: 'ujian', label: 'Ujian Berlangsung', icon: <Radio className="w-3.5 h-3.5" /> },
                { key: 'jadwal', label: 'Jadwal Hari Ini & Besok', icon: <CalendarDays className="w-3.5 h-3.5" /> },
                { key: 'juara', label: 'Juara Per Kelas', icon: <Trophy className="w-3.5 h-3.5" /> },
              ].map(tab => (
                <button key={tab.key} type="button"
                  onClick={() => setAktivitasTab(tab.key as typeof aktivitasTab)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-t-xl text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
                    aktivitasTab === tab.key
                      ? 'border-emerald-500 text-emerald-700 bg-emerald-50'
                      : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {tab.icon}
                  <span className="hidden sm:inline">{tab.label}</span>
                  <span className="sm:hidden">{tab.key === 'ujian' ? 'Live' : tab.key === 'jadwal' ? 'Jadwal' : 'Juara'}</span>
                </button>
              ))}
            </div>
            <div className="h-px bg-slate-100 flex-shrink-0 mx-5 sm:mx-6" />

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-6">
              {aktivitasLoading ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                  <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
                  <p className="text-sm">Memuat data...</p>
                </div>
              ) : (
                <>
                  {/* ── Tab: Ujian Berlangsung ── */}
                  {aktivitasTab === 'ujian' && (
                    <div>
                      {ujianBerlangsung.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-14 gap-3">
                          <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
                            <Radio className="w-7 h-7 text-slate-300" />
                          </div>
                          <p className="text-slate-400 text-sm font-medium">Tidak ada ujian yang sedang berlangsung</p>
                          <p className="text-slate-300 text-xs">Ujian aktif akan muncul di sini secara real-time</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 mb-3">
                            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 border border-red-200 text-red-600 text-xs font-semibold">
                              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                              {ujianBerlangsung.length} sesi aktif
                            </span>
                          </div>
                          {ujianBerlangsung.map(u => (
                            <div key={u.id} className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-4">
                              <div className="flex items-start gap-3">
                                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
                                  <ClipboardList className="w-4 h-4 text-white" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="font-bold text-slate-900 text-sm">{u.mapel}</p>
                                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                                    <span className="flex items-center gap-1 text-xs text-slate-500">
                                      <GraduationCap className="w-3 h-3" /> Kelas {u.kelas}
                                    </span>
                                    <span className="flex items-center gap-1 text-xs text-slate-500">
                                      <Users className="w-3 h-3" /> Pengawas: <span className="font-medium text-slate-700 ml-1">{u.pengawas}</span>
                                    </span>
                                    <span className="flex items-center gap-1 text-xs text-slate-400">
                                      <Clock className="w-3 h-3" /> Mulai: {new Date(u.waktu_mulai).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  </div>
                                </div>
                                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-600 text-[10px] font-bold flex-shrink-0">
                                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> LIVE
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Tab: Jadwal Hari Ini & Besok ── */}
                  {aktivitasTab === 'jadwal' && (
                    <div>
                      {jadwalList.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-14 gap-3">
                          <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
                            <CalendarDays className="w-7 h-7 text-slate-300" />
                          </div>
                          <p className="text-slate-400 text-sm font-medium">Tidak ada jadwal untuk hari ini dan besok</p>
                        </div>
                      ) : (
                        <div className="space-y-5">
                          {(['today', 'tomorrow'] as const).map(which => {
                            const items = jadwalList.filter(j => which === 'today' ? j.isToday : !j.isToday)
                            if (items.length === 0) return null
                            const tanggalLabel = items[0].tanggal
                            const label = which === 'today' ? 'Hari Ini' : 'Besok'
                            return (
                              <div key={which}>
                                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl mb-3 ${which === 'today' ? 'bg-blue-50' : 'bg-amber-50'}`}>
                                  <CalendarDays className={`w-4 h-4 ${which === 'today' ? 'text-blue-500' : 'text-amber-500'}`} />
                                  <span className={`font-semibold text-sm ${which === 'today' ? 'text-blue-700' : 'text-amber-700'}`}>{label}</span>
                                  <span className={`text-xs ${which === 'today' ? 'text-blue-400' : 'text-amber-400'}`}>— {tanggalLabel}</span>
                                </div>
                                <div className="space-y-2">
                                  {items.map(j => (
                                    <div key={j.id} className="rounded-xl border border-slate-200 bg-white p-3.5 flex items-center gap-3">
                                      <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${
                                        j.status === 'BERJALAN' ? 'bg-emerald-400' : j.status === 'SELESAI' ? 'bg-slate-300' : 'bg-blue-400'
                                      }`} />
                                      <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-slate-800 text-sm">{j.mapel}</p>
                                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                                          <span className="flex items-center gap-1 text-xs text-slate-500">
                                            <GraduationCap className="w-3 h-3" /> Kelas {j.kelas}
                                          </span>
                                          <span className="flex items-center gap-1 text-xs text-slate-500">
                                            <Clock className="w-3 h-3" /> {j.jam}
                                          </span>
                                        </div>
                                      </div>
                                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 ${
                                        j.status === 'BERJALAN' ? 'bg-emerald-100 text-emerald-700' :
                                        j.status === 'SELESAI' ? 'bg-slate-100 text-slate-500' :
                                        'bg-blue-100 text-blue-700'
                                      }`}>
                                        {j.status === 'BERJALAN' ? 'Berlangsung' : j.status === 'SELESAI' ? 'Selesai' : 'Terjadwal'}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Tab: Juara Per Kelas ── */}
                  {aktivitasTab === 'juara' && (
                    <div>
                      {juaraList.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-14 gap-3">
                          <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
                            <Trophy className="w-7 h-7 text-slate-300" />
                          </div>
                          <p className="text-slate-400 text-sm font-medium">Belum ada data nilai untuk ditampilkan</p>
                          <p className="text-slate-300 text-xs">Juara per kelas dihitung dari akumulasi semua mata pelajaran</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <p className="text-xs text-slate-400 mb-3">Berdasarkan rata-rata nilai akumulasi semua mata pelajaran</p>
                          {juaraList.map((j, idx) => (
                            <div key={j.kelas} className="rounded-2xl border border-slate-200 bg-white p-4 flex items-center gap-4">
                              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                                idx === 0 ? 'bg-gradient-to-br from-yellow-400 to-amber-500' :
                                idx === 1 ? 'bg-gradient-to-br from-slate-400 to-slate-500' :
                                idx === 2 ? 'bg-gradient-to-br from-orange-400 to-amber-600' :
                                'bg-gradient-to-br from-slate-100 to-slate-200'
                              }`}>
                                {idx < 3
                                  ? <Trophy className="w-5 h-5 text-white" />
                                  : <span className="text-xs font-bold text-slate-500">{idx + 1}</span>
                                }
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-bold text-slate-900 text-sm">{j.nama_siswa}</p>
                                <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                                  <GraduationCap className="w-3 h-3" /> Kelas {j.kelas}
                                </p>
                              </div>
                              <div className="text-right flex-shrink-0">
                                <p className={`text-2xl font-black ${
                                  j.nilai_rata >= 90 ? 'text-emerald-600' :
                                  j.nilai_rata >= 75 ? 'text-blue-600' :
                                  'text-orange-500'
                                }`}>{j.nilai_rata}</p>
                                <p className="text-[10px] text-slate-400">rata-rata</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 sm:px-6 py-3 sm:py-4 border-t border-slate-100 flex items-center justify-between flex-shrink-0 gap-2">
              <button type="button" onClick={loadAktivitas} disabled={aktivitasLoading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 text-xs font-medium transition-all disabled:opacity-50">
                <Loader2 className={`w-3.5 h-3.5 ${aktivitasLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button type="button" onClick={() => setShowAktivitas(false)}
                className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors">
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
