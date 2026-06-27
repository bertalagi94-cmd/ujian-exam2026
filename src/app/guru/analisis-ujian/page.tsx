'use client'

import AnalisisUjianView from '@/components/shared/AnalisisUjianView'

export default function GuruAnalisisUjianPage() {
  // PENTING: showMapelFilter HARUS true. Sebelumnya false, sehingga dropdown
  // pilihan mata pelajaran tidak pernah dirender — akibatnya filterMapelId
  // tidak pernah terisi dan analisis tidak pernah dimuat sama sekali, walau
  // sesi ujiannya sudah SELESAI. Satu guru bisa mengampu lebih dari satu
  // mapel/kelas (mapel_id berbeda per kelas), jadi guru tetap perlu memilih
  // mapel mana yang ingin dilihat — sama seperti halaman admin.
  return <AnalisisUjianView apiPath="/api/guru/analisis-ujian" showMapelFilter />
}
