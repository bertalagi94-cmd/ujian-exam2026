'use client'

import AnalisisUjianView from '@/components/shared/AnalisisUjianView'

export default function GuruAnalisisUjianPage() {
  return <AnalisisUjianView apiPath="/api/guru/analisis-ujian" showMapelFilter={false} />
}
