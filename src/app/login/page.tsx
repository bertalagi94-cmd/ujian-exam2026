'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Eye, EyeOff, BookOpen, Lock, User, AlertCircle,
  X, ChevronDown, ChevronUp, Shield, GraduationCap, Users, UserCheck,
  BookMarked, LayoutDashboard, ClipboardList, BarChart2, Settings,
  HelpCircle, AlertTriangle, CheckCircle, Info,
} from 'lucide-react'

interface SiteInfo {
  namaSekolah: string
  kota: string
  logoUrl: string
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
        detail: 'Tambah siswa satu per satu atau via import Excel. Buat akun guru, pengawas, dan kepala sekolah di menu Users. Password default bisa di-reset kapan saja.',
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

function SchoolLogo({ size, siteInfo }: { size: 'sm' | 'lg'; siteInfo: SiteInfo }) {
  const dim = size === 'lg' ? 'w-14 h-14' : 'w-10 h-10'
  const iconDim = size === 'lg' ? 'w-7 h-7' : 'w-5 h-5'
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
    <div className={`${dim} bg-white/20 rounded-xl flex items-center justify-center backdrop-blur flex-shrink-0`}>
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

  // Modal state
  const [showGuide, setShowGuide] = useState(false)
  const [showQA, setShowQA] = useState(false)
  const [activeRole, setActiveRole] = useState('admin')
  const [openQA, setOpenQA] = useState<string | null>(null)

  // ── Drape animation state (desktop only) ──────────────────────────────────
  // 'closed' | 'opening' | 'open' | 'closing'
  const [drapeState, setDrapeState] = useState<'closed' | 'opening' | 'open' | 'closing'>('closed')
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const formAreaRef = useRef<HTMLDivElement>(null)
  const drapeAnimRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Maskot "Login Disini" (desktop only) ───────────────────────────────────
  // 'idle' = senyum santai · 'sad' = sedih sesaat saat kursor mendekat ·
  // 'wave' = melambai-lambai memanggil untuk login
  const [mascotMood, setMascotMood] = useState<'idle' | 'sad' | 'wave'>('idle')
  const mascotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mascotCycleRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mascotHoveredRef = useRef(false)

  // Mood cycle: idle(10s) → sad(10s) → wave(10s) → kembali idle, dst.
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
    idleTimerRef.current = setTimeout(() => {
      closeDrape()
    }, 10000)
  }

  const handleFormActivity = () => {
    resetIdleTimer()
  }

  const draped = drapeState === 'open' || drapeState === 'opening'

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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      canvas.width = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
    }
    resize()
    window.addEventListener('resize', resize)

    type Bubble = {
      x: number; y: number; r: number
      vx: number; vy: number
      alpha: number; phase: 'alive' | 'popping'
      popFrame: number
    }

    const bubbles: Bubble[] = []
    const MAX = 18

    const spawn = (): Bubble => ({
      x: Math.random() * canvas.width,
      y: canvas.height + 40,
      r: 18 + Math.random() * 38,
      vx: (Math.random() - 0.5) * 0.6,
      vy: -(0.4 + Math.random() * 0.7),
      alpha: 0.12 + Math.random() * 0.18,
      phase: 'alive',
      popFrame: 0,
    })

    for (let i = 0; i < 10; i++) {
      const b = spawn()
      b.y = Math.random() * canvas.height
      bubbles.push(b)
    }

    let raf: number
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (bubbles.length < MAX && Math.random() < 0.02) bubbles.push(spawn())

      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i]
        if (b.phase === 'popping') {
          b.popFrame++
          const prog = b.popFrame / 12
          ctx.beginPath()
          ctx.arc(b.x, b.y, b.r * (1 + prog * 0.5), 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(255,255,255,${b.alpha * (1 - prog)})`
          ctx.lineWidth = 1.5
          ctx.stroke()
          if (b.popFrame >= 12) bubbles.splice(i, 1)
          continue
        }
        b.x += b.vx
        b.vy += 0.002
        b.y += b.vy
        for (let j = i - 1; j >= 0; j--) {
          const o = bubbles[j]
          if (o.phase === 'popping') continue
          const dx = b.x - o.x, dy = b.y - o.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < b.r + o.r) {
            b.phase = 'popping'; b.popFrame = 0
            o.phase = 'popping'; o.popFrame = 0
            break
          }
        }
        if (b.y + b.r < 0 || b.x + b.r < 0 || b.x - b.r > canvas.width) {
          bubbles.splice(i, 1); continue
        }
        const grad = ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.1, b.x, b.y, b.r)
        grad.addColorStop(0, `rgba(255,255,255,${b.alpha * 1.5})`)
        grad.addColorStop(0.5, `rgba(255,255,255,${b.alpha * 0.4})`)
        grad.addColorStop(1, `rgba(255,255,255,0)`)
        ctx.beginPath()
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
        ctx.fillStyle = grad
        ctx.fill()
        ctx.beginPath()
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(255,255,255,${b.alpha * 1.2})`
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(b.x - b.r * 0.28, b.y - b.r * 0.32, b.r * 0.18, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,255,255,${b.alpha * 1.8})`
        ctx.fill()
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
        if (json?.data) setSiteInfo({
          namaSekolah: json.data.namaSekolah ?? '',
          kota: json.data.kota ?? '',
          logoUrl: json.data.logoUrl ?? '',
        })
      })
      .catch(() => {})
  }, [])

  // Lock body scroll when modal open
  useEffect(() => {
    if (showGuide || showQA) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [showGuide, showQA])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!form.username || !form.password) { setError('Username dan password wajib diisi'); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Login gagal')
      localStorage.setItem('token', data.token)
      localStorage.setItem('user', JSON.stringify({
        username: data.username, nama: data.nama, role: data.role, nis: data.nis, kelas: data.kelas,
      }))
      const roleRoutes: Record<string, string> = {
        ADMIN: '/admin', GURU: '/guru', PENGAWAS: '/pengawas', KEPSEK: '/kepsek', SISWA: '/siswa',
      }
      router.push(roleRoutes[data.role] ?? '/login')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login gagal')
    } finally {
      setLoading(false)
    }
  }

  const displayName = siteInfo.namaSekolah || 'SmartExam'
  const year = new Date().getFullYear()

  const activeRoleData = ROLES.find(r => r.id === activeRole) ?? ROLES[0]

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-brand-950 via-brand-900 to-brand-800 relative overflow-hidden">
      {/* glow blobs */}
      <div className="absolute inset-0" style={{ pointerEvents: 'none', zIndex: 0 }}>
        <div className="absolute -top-40 -left-32 w-[560px] h-[560px] rounded-full opacity-40 blur-[110px]"
          style={{ background: 'radial-gradient(circle, #c026d3, transparent 70%)' }} />
        <div className="absolute top-1/3 -right-40 w-[640px] h-[640px] rounded-full opacity-30 blur-[120px]"
          style={{ background: 'radial-gradient(circle, #22d3ee, transparent 70%)' }} />
        <div className="absolute -bottom-48 left-1/4 w-[520px] h-[520px] rounded-full opacity-30 blur-[100px]"
          style={{ background: 'radial-gradient(circle, #6366f1, transparent 70%)' }} />
      </div>

      {/* mesh lines */}
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none', zIndex: 0 }}
        viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="lnViolet" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#e879f9" stopOpacity="0" />
            <stop offset="50%" stopColor="#e879f9" stopOpacity="0.65" />
            <stop offset="100%" stopColor="#e879f9" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="lnCyan" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0" />
            <stop offset="50%" stopColor="#67e8f9" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="lnIndigo" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#818cf8" stopOpacity="0" />
            <stop offset="50%" stopColor="#c7d2fe" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#818cf8" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="lnAmber" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0" />
            <stop offset="50%" stopColor="#fcd34d" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
          </linearGradient>
          <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <g filter="url(#softGlow)">
          <path d="M -80 140 L 360 60 L 720 190 L 1080 40" stroke="url(#lnViolet)" strokeWidth="2" fill="none" />
          <path d="M 360 60 L 420 320" stroke="url(#lnIndigo)" strokeWidth="1.5" fill="none" />
          <path d="M 720 190 L 660 430" stroke="url(#lnCyan)" strokeWidth="1.5" fill="none" />
          <path d="M -80 260 L 300 340 L 720 190" stroke="url(#lnIndigo)" strokeWidth="1.5" fill="none" />
        </g>
        <g filter="url(#softGlow)">
          <path d="M 1540 760 L 1140 860 L 760 700 L 380 840" stroke="url(#lnCyan)" strokeWidth="2" fill="none" />
          <path d="M 1140 860 L 1080 600" stroke="url(#lnViolet)" strokeWidth="1.5" fill="none" />
          <path d="M 760 700 L 820 470" stroke="url(#lnAmber)" strokeWidth="1.5" fill="none" />
          <path d="M 1540 600 L 1220 540 L 760 700" stroke="url(#lnViolet)" strokeWidth="1.5" fill="none" />
        </g>
        <path d="M -80 500 L 480 380 L 1000 560 L 1540 420" stroke="url(#lnIndigo)" strokeWidth="1.25" fill="none" />
        <path d="M 1180 -60 L 1380 340 L 1160 900" stroke="url(#lnCyan)" strokeWidth="1.25" fill="none" />
        <path d="M 260 -60 L 60 380 L 320 900" stroke="url(#lnViolet)" strokeWidth="1" fill="none" />
        <g filter="url(#softGlow)">
          <circle cx="360" cy="60" r="4" fill="#f0abfc" />
          <circle cx="720" cy="190" r="4.5" fill="#a5b4fc" />
          <circle cx="420" cy="320" r="3" fill="#c7d2fe" />
          <circle cx="660" cy="430" r="3.5" fill="#67e8f9" />
          <circle cx="1140" cy="860" r="4" fill="#67e8f9" />
          <circle cx="760" cy="700" r="4.5" fill="#f0abfc" />
          <circle cx="820" cy="470" r="3" fill="#fcd34d" />
          <circle cx="1220" cy="540" r="3.5" fill="#f0abfc" />
        </g>
      </svg>

      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none', zIndex: 0 }} />

      {/* Left — branding */}
      <div className="hidden lg:flex flex-col w-1/2 p-12 text-white relative">
        {/* Ilustrasi siswa — gambar statis di public/images, posisi & ukuran diatur via CSS */}
        <img
          src="/images/siswa-sekolah.webp"
          alt=""
          aria-hidden="true"
          className="absolute -bottom-6 left-0 w-[55vw] max-w-[700px] min-w-[380px] h-auto select-none transition-transform duration-500 ease-out hover:animate-float hover:scale-[1.03] hover:drop-shadow-2xl"
          style={{ zIndex: 1 }}
        />

        {/* Semua konten teks dikelompokkan & dikunci di area atas agar tidak tertutup ilustrasi */}
        <div className="relative z-10 space-y-7">
          <div className="flex items-center gap-3 cursor-default w-fit"
            style={{ transition: 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.14)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)' }}
          >
            <SchoolLogo size="lg" siteInfo={siteInfo} />
            <div className="min-w-0">
              <p className="font-bold text-xl leading-tight line-clamp-2">{displayName}</p>
              <p className="text-brand-300 text-sm">Sistem Ujian Digital Terpercaya</p>
            </div>
          </div>

          <div>
            <h1 className="text-4xl font-bold leading-tight mb-3 cursor-default w-fit"
              style={{ transition: 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)', display: 'inline-block', transformOrigin: 'left center' }}
              onMouseEnter={e => { (e.currentTarget as HTMLHeadingElement).style.transform = 'scale(1.08)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLHeadingElement).style.transform = 'scale(1)' }}
            >
              Ujian Digital<br />
              <span className="bg-gradient-to-r from-fuchsia-300 via-violet-300 to-cyan-300 bg-clip-text text-transparent">
                Lebih Mudah & Adil
              </span>
            </h1>
            <p className="text-brand-300 text-sm leading-relaxed max-w-xs">
              Sistem CBT modern{siteInfo.namaSekolah ? ` untuk ${siteInfo.namaSekolah}` : ''}{' '}
              dengan fitur anti-nyontek, penilaian otomatis, dan monitoring real-time.
            </p>
          </div>
        </div>

        <div className="relative z-10 text-brand-400 text-xs mt-auto">
          {siteInfo.namaSekolah ? <>{siteInfo.namaSekolah} &copy; {year}</> : <>SmartExam &copy; {year}</>}
        </div>
      </div>

      {/* Right — login form */}
      <div className="flex-1 flex items-center justify-center p-6 relative z-10">
        <div className="w-full max-w-sm">

          {/* ── MOBILE: tampilan biasa seperti semula ── */}
          <div className="lg:hidden">
            {/* Mobile: logo + nama sekolah */}
            <div className="flex items-center gap-3 mb-6 justify-center">
              <SchoolLogo size="sm" siteInfo={siteInfo} />
              <div className="min-w-0 text-left">
                <p className="font-bold text-white text-base leading-tight line-clamp-2">{displayName}</p>
                {!siteInfo.namaSekolah && <p className="text-brand-300 text-xs">Sistem Ujian Digital Terpercaya</p>}
              </div>
            </div>

            <div className="bg-white rounded-3xl shadow-card-lg p-8">
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-slate-900">Selamat Datang</h2>
                <p className="text-slate-500 text-sm mt-1">Masuk ke akun Anda untuk melanjutkan</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-5">
                {error && (
                  <div className="alert-error">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}
                <div>
                  <label className="label">Username / NIS</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input type="text" className="input pl-10" placeholder="Masukkan username atau NIS"
                      value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                      autoComplete="username" autoFocus
                    />
                  </div>
                </div>
                <div>
                  <label className="label">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input type={showPw ? 'text' : 'password'} className="input pl-10 pr-10"
                      placeholder="Masukkan password"
                      value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                      autoComplete="current-password"
                    />
                    <button type="button" onClick={() => setShowPw(v => !v)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-3 text-base mt-2">
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Masuk...
                    </span>
                  ) : 'Masuk'}
                </button>
              </form>

              <div className="mt-6 pt-5 border-t border-slate-100 space-y-3">
                <p className="text-xs text-slate-400 text-center">Lupa password? Hubungi administrator sekolah.</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowGuide(true)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-slate-200 text-slate-500 hover:text-brand-600 hover:border-brand-300 hover:bg-brand-50 text-xs font-medium transition-all"
                  >
                    <BookMarked className="w-3.5 h-3.5" /> Panduan
                  </button>
                  <button type="button" onClick={() => setShowQA(true)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-slate-200 text-slate-500 hover:text-brand-600 hover:border-brand-300 hover:bg-brand-50 text-xs font-medium transition-all"
                  >
                    <HelpCircle className="w-3.5 h-3.5" /> Q&amp;A / Bantuan
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1">
                  {[
                    { n: '🔒', l: 'Aman', from: 'from-fuchsia-50', to: 'to-violet-50', ring: 'ring-fuchsia-200', text: 'text-fuchsia-600' },
                    { n: '⚡', l: 'Cepat', from: 'from-amber-50', to: 'to-orange-50', ring: 'ring-amber-200', text: 'text-amber-600' },
                    { n: '📊', l: 'Akurat', from: 'from-cyan-50', to: 'to-sky-50', ring: 'ring-cyan-200', text: 'text-cyan-600' },
                  ].map(({ n, l, from, to, ring, text }) => (
                    <div key={l} className={`bg-gradient-to-br ${from} ${to} rounded-xl py-2.5 text-center ring-1 ${ring}`}>
                      <div className="text-lg">{n}</div>
                      <div className={`text-[11px] mt-0.5 font-semibold ${text}`}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── DESKTOP: efek kain terurai ── */}
          <div
            ref={formAreaRef}
            className="hidden lg:block"
            onMouseEnter={openDrape}
          >
            {/* Tombol "Login Disini" — lebih besar, gradient bergerak */}
            <div
              className="relative flex justify-center"
              style={{
                zIndex: 2,
                opacity: drapeState === 'closed' ? 1 : 0,
                pointerEvents: drapeState === 'closed' ? 'auto' : 'none',
                transition: 'opacity 0.3s ease',
              }}
              onMouseEnter={handleMascotEnter}
              onMouseLeave={handleMascotLeave}
            >
              {/* ── Maskot di atas tombol ── */}
              <div className="absolute -top-16 left-1/2 -translate-x-1/2" style={{ zIndex: 3 }}>
                <svg
                  width="64" height="64" viewBox="0 0 64 64"
                  className={mascotMood === 'idle' ? 'mascot-bounce' : ''}
                >
                  {/* Kepala */}
                  <circle cx="32" cy="32" r="26" fill="#fde68a" stroke="#f59e0b" strokeWidth="2" />

                  {/* Mata */}
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

                  {/* Mulut */}
                  {mascotMood === 'sad' ? (
                    <path d="M22 42 q10 -8 20 0" stroke="#7c2d12" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                  ) : (
                    <path d="M22 36 q10 8 20 0" stroke="#7c2d12" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                  )}

                  {/* Tangan melambai */}
                  <g
                    className={mascotMood === 'wave' ? 'mascot-wave' : ''}
                    style={{
                      transformOrigin: '50px 38px',
                      opacity: mascotMood === 'wave' ? 1 : 0,
                      transition: 'opacity 0.2s ease',
                    }}
                  >
                    <circle cx="50" cy="38" r="2" fill="#7c2d12" />
                    <path d="M50 38 L58 24" stroke="#f59e0b" strokeWidth="5" strokeLinecap="round" />
                    <circle cx="58" cy="24" r="4.5" fill="#fde68a" stroke="#f59e0b" strokeWidth="2" />
                  </g>
                </svg>
              </div>

              <button
                type="button"
                onClick={openDrape}
                className="btn-login-drape group flex items-center gap-3 px-10 py-4 rounded-2xl text-white font-bold text-base tracking-wide select-none cursor-pointer"
                style={{
                  boxShadow: '0 4px 24px rgba(139,92,246,0.4), 0 2px 8px rgba(0,0,0,0.2)',
                  letterSpacing: '0.04em',
                }}
              >
                <Lock className="w-5 h-5 opacity-90" />
                <span>Login Disini</span>
                <span
                  style={{
                    display: 'inline-block',
                    transform: draped ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1)',
                    fontSize: '18px',
                    lineHeight: 1,
                    opacity: 0.85,
                  }}
                >
                  ▾
                </span>
              </button>
            </div>

            {/* Kain yang terurai ke bawah — pakai clip-path animation */}
            {drapeState !== 'closed' && (
              <div
                key={drapeState === 'opening' ? 'open' : drapeState}
                className={drapeState === 'closing' ? 'drape-close' : 'drape-open'}
                style={{
                  transformOrigin: 'top center',
                  marginTop: '-1px',
                  position: 'relative',
                  zIndex: 1,
                }}
                onMouseEnter={resetIdleTimer}
                onMouseMove={handleFormActivity}
              >
                {/* Jahitan atas kain — gradient animasi */}
                <div style={{
                  height: '5px',
                  background: 'linear-gradient(90deg, #a855f7, #6366f1, #22d3ee, #6366f1, #a855f7)',
                  backgroundSize: '300% 100%',
                  animation: 'gradientShift 4s ease infinite',
                }} />

                <div
                  className="bg-white rounded-b-3xl p-8"
                  style={{ boxShadow: '0 32px 80px rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.04)' }}
                >
                  {/* Bar indikator idle + tutup */}
                  <div className="mb-4 flex items-center gap-2 justify-end">
                    <span className="text-[10px] text-slate-400">Auto-tutup dalam 10 detik tanpa aktivitas</span>
                    <button
                      type="button"
                      onClick={closeDrape}
                      className="w-5 h-5 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="mb-6">
                    <h2 className="text-2xl font-bold text-slate-900">Selamat Datang</h2>
                    <p className="text-slate-500 text-sm mt-1">Masuk ke akun Anda untuk melanjutkan</p>
                  </div>

                  <form onSubmit={handleLogin} className="space-y-5" onInput={handleFormActivity} onChange={handleFormActivity}>
                    {error && (
                      <div className="alert-error">
                        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span>{error}</span>
                      </div>
                    )}

                    <div>
                      <label className="label">Username / NIS</label>
                      <div className="relative"
                        style={{ transition: 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.03)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)' }}
                      >
                        <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input type="text" className="input pl-10" placeholder="Masukkan username atau NIS"
                          value={form.username}
                          onChange={e => { setForm(f => ({ ...f, username: e.target.value })); resetIdleTimer() }}
                          autoComplete="username"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="label">Password</label>
                      <div className="relative"
                        style={{ transition: 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.03)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)' }}
                      >
                        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input type={showPw ? 'text' : 'password'} className="input pl-10 pr-10"
                          placeholder="Masukkan password"
                          value={form.password}
                          onChange={e => { setForm(f => ({ ...f, password: e.target.value })); resetIdleTimer() }}
                          autoComplete="current-password"
                        />
                        <button type="button" onClick={() => { setShowPw(v => !v); resetIdleTimer() }}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        >
                          {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-3 text-base mt-2">
                      {loading ? (
                        <span className="flex items-center gap-2">
                          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Masuk...
                        </span>
                      ) : 'Masuk'}
                    </button>
                  </form>

                  <div className="mt-6 pt-5 border-t border-slate-100 space-y-3">
                    <p className="text-xs text-slate-400 text-center">Lupa password? Hubungi administrator sekolah.</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => { setShowGuide(true); resetIdleTimer() }}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-slate-200 text-slate-500 hover:text-brand-600 hover:border-brand-300 hover:bg-brand-50 text-xs font-medium transition-all"
                      >
                        <BookMarked className="w-3.5 h-3.5" /> Panduan
                      </button>
                      <button type="button" onClick={() => { setShowQA(true); resetIdleTimer() }}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-slate-200 text-slate-500 hover:text-brand-600 hover:border-brand-300 hover:bg-brand-50 text-xs font-medium transition-all"
                      >
                        <HelpCircle className="w-3.5 h-3.5" /> Q&amp;A / Bantuan
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-1">
                      {[
                        { n: '🔒', l: 'Aman', from: 'from-fuchsia-50', to: 'to-violet-50', ring: 'ring-fuchsia-200', text: 'text-fuchsia-600' },
                        { n: '⚡', l: 'Cepat', from: 'from-amber-50', to: 'to-orange-50', ring: 'ring-amber-200', text: 'text-amber-600' },
                        { n: '📊', l: 'Akurat', from: 'from-cyan-50', to: 'to-sky-50', ring: 'ring-cyan-200', text: 'text-cyan-600' },
                      ].map(({ n, l, from, to, ring, text }) => (
                        <div key={l} className={`bg-gradient-to-br ${from} ${to} rounded-xl py-2.5 text-center ring-1 ${ring}`}>
                          <div className="text-lg">{n}</div>
                          <div className={`text-[11px] mt-0.5 font-semibold ${text}`}>{l}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          {(siteInfo.namaSekolah || siteInfo.kota) && (
            <p className="text-center text-brand-300/60 text-xs mt-6 hidden lg:block">
              {[siteInfo.namaSekolah, siteInfo.kota].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </div>

      {/* ═══════════════ MODAL: PANDUAN PENGGUNAAN ═══════════════ */}
      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backdropFilter: 'blur(8px)', background: 'rgba(15,23,42,0.7)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowGuide(false) }}
        >
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center">
                  <BookMarked className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-900 text-lg">Panduan Penggunaan</h2>
                  <p className="text-xs text-slate-400">SmartExam — Sistem Ujian Digital</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowGuide(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-1 overflow-hidden">
              {/* Role sidebar */}
              <div className="w-44 flex-shrink-0 border-r border-slate-100 py-4 overflow-y-auto">
                {ROLES.map(role => (
                  <button key={role.id} type="button"
                    onClick={() => setActiveRole(role.id)}
                    className={`w-full flex items-center gap-2.5 px-4 py-3 text-left transition-all text-sm font-medium ${
                      activeRole === role.id
                        ? `${role.bgLight} ${role.text} border-r-2 ${role.border.replace('border-', 'border-r-')}`
                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                    }`}
                  >
                    <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      activeRole === role.id ? `bg-gradient-to-br ${role.color} text-white` : 'bg-slate-100 text-slate-400'
                    }`}>
                      {role.icon}
                    </span>
                    {role.label}
                  </button>
                ))}
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-6">
                {/* Role header */}
                <div className={`rounded-2xl p-5 mb-6 bg-gradient-to-br ${activeRoleData.color} text-white`}>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                      {activeRoleData.icon}
                    </div>
                    <div>
                      <h3 className="font-bold text-lg">{activeRoleData.label}</h3>
                      <p className="text-white/80 text-sm">{activeRoleData.desc}</p>
                    </div>
                  </div>
                </div>

                {/* Steps */}
                <div className="space-y-3">
                  {activeRoleData.steps.map((step, i) => (
                    <div key={i} className={`rounded-xl border ${activeRoleData.border} ${activeRoleData.bgLight} p-4`}>
                      <div className="flex items-start gap-3">
                        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${activeRoleData.color} text-white flex items-center justify-center flex-shrink-0 mt-0.5`}>
                          {step.icon}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${activeRoleData.badge}`}>
                              {i + 1}
                            </span>
                            <h4 className={`font-semibold text-sm ${activeRoleData.text}`}>{step.title}</h4>
                          </div>
                          <p className="text-sm text-slate-600 leading-relaxed">{step.detail}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Tips footer */}
                <div className="mt-5 p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-start gap-3">
                  <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Butuh bantuan lebih lanjut? Hubungi administrator sistem atau lihat section <strong>Q&A / Bantuan</strong> untuk pertanyaan yang sering diajukan.
                  </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between flex-shrink-0">
              <p className="text-xs text-slate-400">SmartExam &copy; {year}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => { setShowGuide(false); setShowQA(true) }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium transition-colors"
                >
                  <HelpCircle className="w-4 h-4" /> Buka Q&amp;A
                </button>
                <button type="button" onClick={() => setShowGuide(false)}
                  className="px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ MODAL: Q&A ═══════════════ */}
      {showQA && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backdropFilter: 'blur(8px)', background: 'rgba(15,23,42,0.7)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowQA(false) }}
        >
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                  <HelpCircle className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-900 text-lg">Q&A / Bantuan</h2>
                  <p className="text-xs text-slate-400">Pertanyaan yang sering diajukan & skenario darurat</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowQA(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {QA_ITEMS.map((section) => (
                <div key={section.category}>
                  {/* Section header */}
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
                          <button type="button"
                            onClick={() => setOpenQA(isOpen ? null : key)}
                            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                          >
                            <span className="text-sm font-medium text-slate-800">{item.q}</span>
                            {isOpen
                              ? <ChevronUp className="w-4 h-4 text-slate-400 flex-shrink-0" />
                              : <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
                            }
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

              {/* Contact admin */}
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-amber-800 text-sm mb-1">Masalah tidak terdaftar di sini?</h4>
                    <p className="text-amber-700 text-sm leading-relaxed">
                      Segera hubungi <strong>Administrator Sistem</strong> sekolah Anda. Untuk masalah teknis kritis seperti data hilang atau server tidak bisa diakses, administrator perlu menghubungi pengelola sistem untuk penanganan lebih lanjut.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between flex-shrink-0">
              <p className="text-xs text-slate-400">SmartExam &copy; {year}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => { setShowQA(false); setShowGuide(true) }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium transition-colors"
                >
                  <BookMarked className="w-4 h-4" /> Panduan
                </button>
                <button type="button" onClick={() => setShowQA(false)}
                  className="px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
