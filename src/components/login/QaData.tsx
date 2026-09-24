// PERF: data Q&A/FAQ diekstrak dari src/app/login/page.tsx agar
// file utama halaman login lebih ringkas dan bisa di-lazy-load lewat QAModal.
import type { ReactNode } from 'react'
import { Info, ClipboardList, Settings, Lock, AlertTriangle } from 'lucide-react'

export interface QaEntry {
  q: string
  a: string
}

export interface QaSection {
  category: string
  icon: ReactNode
  color: string
  bg: string
  items: QaEntry[]
}

export const QA_ITEMS: QaSection[] = [
  {
    category: 'Umum',
    icon: <Info className="w-4 h-4" />,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    items: [
      {
        q: 'Apa itu SmartExam?',
        a: 'SmartExam adalah sistem ujian berbasis komputer (CBT) yang dirancang khusus untuk sekolah — bisa dikerjakan lewat HP maupun laptop/komputer. Memungkinkan guru membuat soal, menjadwalkan ujian, dan siswa mengerjakan ujian secara online dengan pengawasan real-time.',
      },
      {
        q: 'Browser apa yang direkomendasikan?',
        a: 'Kebanyakan siswa mengerjakan ujian lewat HP, jadi gunakan Chrome versi terbaru di Android atau Safari versi terbaru di iPhone/iPad. Di laptop/komputer, gunakan Google Chrome atau Mozilla Firefox versi terbaru. Hindari browser lama, dan pastikan JavaScript aktif.',
      },
      {
        q: 'Apakah bisa digunakan di HP?',
        a: 'Bisa, dan justru inilah cara paling umum siswa mengerjakan ujian — tampilan dan sistem anti-kecurangan (layar penuh, deteksi pindah aplikasi, dll) sudah dirancang untuk HP, bukan cuma laptop. Pastikan baterai cukup, HP tidak dalam mode hemat baterai/data yang agresif, dan notifikasi lain di-silent dulu supaya tidak terpicu pindah aplikasi.',
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
        a: 'Siswa: kalau masih ingat password lama, ganti sendiri lewat menu "Profil Saya". Kalau benar-benar lupa (tidak tahu password lama), minta guru atau admin untuk reset. Guru dan Kepala Sekolah: minta admin untuk reset di menu Data Pengguna. Admin: hubungi pengelola sistem atau reset melalui database Supabase.',
      },
      {
        q: 'Username saya apa?',
        a: 'Siswa menggunakan NIS (Nomor Induk Siswa). Guru dan Kepala Sekolah menggunakan username yang dibuat oleh Admin saat pembuatan akun. Tidak ada peran "Pengawas" tersendiri — pengawas adalah guru yang ditugaskan menjaga sesi ujian tertentu.',
      },
      {
        q: 'Status ujian saya "RESET" / saya diminta kode, apa yang harus dilakukan?',
        a: 'Setiap pelanggaran (berpindah tab, keluar layar, dll) langsung menghentikan ujian sementara sampai Anda meminta kode 7 karakter ke pengawas ruangan. Kalau jumlah pelanggaran sudah melebihi batas yang ditentukan sekolah, pengawas bisa memilih mengunci akun secara permanen untuk sesi itu — hubungi pengawas atau admin jika ini terjadi.',
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
        a: 'Sistem mendeteksi jika siswa berpindah tab, meminimalkan jendela browser, atau mencoba membuka aplikasi lain. Setiap deteksi langsung menghentikan ujian Anda sementara (status RESET) — bukan menunggu sampai batas terlampaui. Untuk lanjut, Anda perlu kode 7 karakter dari pengawas. Batas jumlah pelanggaran yang ditentukan sekolah dipakai pengawas untuk memutuskan apakah akun perlu dikunci permanen.',
      },
      {
        q: 'Internet saya putus saat ujian, bagaimana?',
        a: 'Jangan panik, dan JANGAN keluar dari layar ujian untuk membuka pengaturan WiFi/data — itu justru akan terdeteksi sebagai pelanggaran (keluar dari mode layar penuh/pindah aplikasi). Cukup tetap diam di halaman ujian: jawaban yang sudah dijawab tetap tersimpan di HP/laptop Anda dan otomatis terkirim begitu koneksi kembali (misalnya WiFi menyambung ulang sendiri). Kalau koneksi tidak kunjung kembali sendiri dan Anda terpaksa harus membuka pengaturan HP secara manual, beri tahu pengawas ruangan DULU sebelum melakukannya — supaya pengawas paham situasinya dan bisa langsung memberi kode lanjut begitu Anda kembali ke layar ujian.',
      },
      {
        q: 'Saya tidak sengaja menutup tab saat ujian, bagaimana?',
        a: 'Buka kembali browser (di HP: buka lagi aplikasi/browsernya) dan login ulang, lalu akses kembali halaman ujian. Ini akan tercatat sebagai pelanggaran dan ujian Anda dihentikan sementara — minta kode 7 karakter ke pengawas untuk melanjutkan dari soal terakhir.',
      },
      {
        q: 'Kenapa ujian harus dalam mode layar penuh (fullscreen)?',
        a: 'Ini bagian dari sistem anti-kecurangan — keluar dari layar penuh dihitung sama seperti berpindah tab/aplikasi, yaitu sebagai pelanggaran. Di HP, ini juga berarti membuka Kontrol Cepat/Notifikasi, mengganti WiFi, membalas chat, atau menekan tombol Home akan langsung tercatat sebagai pelanggaran. Jika perangkat Anda tidak mendukung mode layar penuh sama sekali (beberapa browser di iPhone/iPad), beritahu pengawas sebelum ujian dimulai.',
      },
      {
        q: 'Bisakah saya mengerjakan ujian yang sama di HP dan laptop sekaligus?',
        a: 'Tidak. Satu sesi ujian hanya boleh aktif di satu perangkat. Kalau Anda login ke ujian yang sama di perangkat kedua, sesi di perangkat pertama otomatis terputus (diambil alih). Gunakan satu perangkat saja sampai ujian selesai.',
      },
      {
        q: 'Internet mati total dan soal essay belum sempat dibuka, apa yang harus dilakukan?',
        a: 'Tetap tenang, tetap di layar ujian (jangan keluar aplikasi). Minta "kode darurat" ke pengawas ruangan — kode ini dibacakan langsung/ditulis di papan, bukan dikirim lewat internet — lalu masukkan kode tersebut untuk membuka soal essay secara offline. Begitu internet pulih, jawaban dan waktu pengerjaan Anda otomatis disinkronkan ke server.',
      },
      {
        q: 'Ada menu "Pengiriman Tertunda", itu untuk apa?',
        a: 'Menu ini hanya muncul kalau ada jawaban/paket ujian Anda yang belum berhasil terkirim ke server (biasanya karena internet sempat putus). Sistem akan terus mencoba mengirim ulang secara otomatis; Anda juga bisa menekan "Kirim Sekarang" di menu ini untuk mencoba lebih cepat. Jawaban yang sudah tersimpan tidak akan hilang.',
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
        a: 'Beritahu pengawas segera. Pengawas dapat mencatat kejadian dan melaporkan ke admin. Admin atau guru bisa memberikan ujian susulan dengan kode akses baru melalui fitur Susulan. Jawaban sebelum listrik mati tetap tersimpan.',
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
        a: 'Pastikan siswa benar-benar mengklik "Selesai Ujian", bukan hanya menutup browser. Jika sudah selesai namun nilai belum muncul, coba refresh halaman. Untuk mata pelajaran yang punya soal essay, nilai total memang baru tampil setelah guru memeriksa essay dan merilis nilainya di menu Penilaian. Admin atau guru bisa cek di menu Rekap Nilai apakah data sudah masuk.',
      },
      {
        q: 'Data sekolah hilang setelah reset',
        a: 'Jika reset "Semua Data" dilakukan, semua pengaturan termasuk nama sekolah dan logo akan terhapus. Isi kembali di halaman Informasi Sekolah (dibuka lewat kartu di atas tab Pengaturan). Selalu lakukan backup di tab Backup & Restore sebelum melakukan reset apapun.',
      },
      {
        q: 'Internet sekolah mati total saat ujian berlangsung, bagaimana pengawas harus bertindak?',
        a: 'Untuk soal pilihan ganda, tidak perlu tindakan khusus — jawaban siswa tersimpan di perangkat masing-masing dan terkirim otomatis begitu internet kembali. Untuk soal essay, buka Mode Pengawas lalu tekan "Tampilkan Kode Darurat", dan bacakan/tuliskan kode tersebut di papan tulis (jangan lewat grup chat/internet) agar siswa bisa membuka soal essay secara offline. Begitu koneksi pulih, sistem otomatis menyinkronkan data essay siswa yang tadi offline.',
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
        a: 'Gunakan tombol import di halaman Data Siswa (bukan menu Import terpisah). Unduh template Excel yang tersedia di sana, isi data siswa sesuai format (NIS, nama, kelas, dll), lalu upload kembali. Sistem akan memvalidasi dan memasukkan data secara otomatis.',
      },
      {
        q: 'Apakah soal bisa digunakan ulang untuk ujian berikutnya?',
        a: 'Soal PG dan essay dibuat langsung di dalam satu paket lewat menu Buat Soal, jadi tidak ada bank soal terpisah yang bisa dipakai lintas paket. Yang bisa dilakukan adalah menduplikasi paket soal yang sudah ada untuk ujian susulan atau semester berikutnya.',
      },
      {
        q: 'Apa itu fitur "Lihat Sebagai" untuk admin?',
        a: 'Fitur ini memungkinkan admin login sementara sebagai akun guru, kepala sekolah, atau siswa tertentu — berguna untuk mengecek atau memperbaiki masalah dari sudut pandang user tersebut tanpa perlu tahu passwordnya. Sesi ini otomatis berakhir setelah 2 jam, dan pemilik akun akan melihat notifikasi bahwa akunnya sedang dilihat oleh admin.',
      },
      {
        q: 'Satu guru mengajar di lebih dari satu sekolah/jenjang, apakah bisa?',
        a: 'Bisa. Admin dapat menautkan satu akun guru ke lebih dari satu sekolah di menu Data Pengguna, sehingga guru tersebut bisa melihat kelas dan kisi-kisi dari semua sekolah yang diampu dalam satu akun yang sama.',
      },
    ],
  },
]
