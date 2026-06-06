'use client'

import AnalisisUjianView from '@/components/shared/AnalisisUjianView'

export default function AdminAnalisisUjianPage() {
  return <AnalisisUjianView apiPath="/api/admin/analisis-ujian" showMapelFilter={true} />
}
