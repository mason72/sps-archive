'use client'

import Link from 'next/link'

const photos = [
  { gradient: 'linear-gradient(135deg, #fbbf24, #f97316, #ef4444)', aspect: '4/3', title: 'Golden Hour Portrait', meta: 'DSC_4521.ARW · 42.8 MB', event: 'Sarah & James Wedding' },
  { gradient: 'linear-gradient(135deg, #60a5fa, #34d399)', aspect: '3/4', title: 'Emerald Coast', meta: 'DSC_4522.ARW · 38.2 MB', event: 'Coastal Series' },
  { gradient: 'linear-gradient(135deg, #6366f1, #8b5cf6, #ec4899)', aspect: '1/1', title: 'Violet Dreams', meta: 'DSC_4523.ARW · 45.1 MB', event: 'Fashion Editorial' },
  { gradient: 'linear-gradient(135deg, #0ea5e9, #06b6d4, #14b8a6)', aspect: '16/9', title: 'Ocean Panorama', meta: 'DSC_4524.ARW · 52.3 MB', event: 'Coastal Series' },
  { gradient: 'linear-gradient(135deg, #f43f5e, #fb923c, #fbbf24)', aspect: '3/2', title: 'Sunset Fire', meta: 'DSC_4525.ARW · 41.7 MB', event: 'Sarah & James Wedding' },
  { gradient: 'linear-gradient(135deg, #64748b, #94a3b8, #cbd5e1)', aspect: '2/3', title: 'Urban Concrete', meta: 'DSC_4526.ARW · 39.4 MB', event: 'Architecture Walk' },
  { gradient: 'linear-gradient(135deg, #84cc16, #22c55e, #10b981)', aspect: '4/5', title: 'Spring Garden', meta: 'DSC_4527.ARW · 44.6 MB', event: 'Botanical Study' },
  { gradient: 'linear-gradient(135deg, #e879f9, #c084fc, #818cf8)', aspect: '3/2', title: 'Lilac Bloom', meta: 'DSC_4528.ARW · 43.2 MB', event: 'Botanical Study' },
  { gradient: 'linear-gradient(135deg, #fb923c, #facc15, #a3e635)', aspect: '4/3', title: 'Amber Harvest', meta: 'DSC_4529.ARW · 40.8 MB', event: 'Fall Collection' },
  { gradient: 'linear-gradient(135deg, #2dd4bf, #38bdf8, #818cf8)', aspect: '1/1', title: 'Tidal Pool', meta: 'DSC_4530.ARW · 46.5 MB', event: 'Coastal Series' },
  { gradient: 'linear-gradient(135deg, #f97316, #ef4444, #dc2626)', aspect: '16/9', title: 'Canyon Glow', meta: 'DSC_4531.ARW · 51.9 MB', event: 'Desert Trip' },
  { gradient: 'linear-gradient(135deg, #a78bfa, #f472b6, #fb923c)', aspect: '3/4', title: 'Peach Blossom', meta: 'DSC_4532.ARW · 42.1 MB', event: 'Botanical Study' },
]

const stats = [
  { label: 'Events', value: '24', sub: 'this month' },
  { label: 'Photos', value: '3,847', sub: 'total' },
  { label: 'Storage', value: '42 GB', sub: 'of 100 GB' },
  { label: 'AI Processed', value: '98%', sub: '3,770 photos' },
]

export default function DarkStudio() {
  return (
    <div className="min-h-screen" style={{ background: '#0B0B0F', fontFamily: 'var(--font-inter), system-ui, sans-serif' }}>
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes glow { 0%, 100% { box-shadow: 0 0 20px rgba(245, 158, 11, 0.08); } 50% { box-shadow: 0 0 30px rgba(245, 158, 11, 0.15); } }
        .fade-up { animation: fadeUp 0.6s ease-out both; }
        .fade-1 { animation-delay: 0.05s; } .fade-2 { animation-delay: 0.1s; }
        .fade-3 { animation-delay: 0.15s; } .fade-4 { animation-delay: 0.2s; }
        .card-hover { transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
        .card-hover:hover { transform: translateY(-4px); box-shadow: 0 12px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(245, 158, 11, 0.15); }
        .img-zoom { transition: transform 0.7s cubic-bezier(0.16, 1, 0.3, 1); }
        .card-hover:hover .img-zoom { transform: scale(1.06); }
        .amber-dot { width: 6px; height: 6px; border-radius: 50%; background: #F59E0B; animation: glow 3s ease-in-out infinite; }
      `}</style>

      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-10">
          <div className="flex items-center gap-3">
            <div className="amber-dot" />
            <span className="text-lg font-bold tracking-[0.15em]" style={{ color: '#F59E0B' }}>PRISM</span>
          </div>
          <div className="flex gap-8 text-[13px] tracking-wide">
            <span className="text-white font-medium cursor-pointer">Library</span>
            <span className="text-gray-500 hover:text-gray-300 cursor-pointer transition-colors duration-300">Events</span>
            <span className="text-gray-500 hover:text-gray-300 cursor-pointer transition-colors duration-300">Collections</span>
            <span className="text-gray-500 hover:text-gray-300 cursor-pointer transition-colors duration-300">AI Tools</span>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-[13px] text-gray-500" style={{ fontFamily: 'var(--font-jetbrains), monospace' }}>v2.1.0</div>
          <div className="w-8 h-8 rounded-full" style={{ background: 'linear-gradient(135deg, #F59E0B, #B45309)' }} />
        </div>
      </nav>

      <div className="flex">
        {/* Main */}
        <main className="flex-1 p-8">
          {/* Search */}
          <div className="mb-8 fade-up">
            <div className="relative">
              <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
              <input
                type="text"
                placeholder="Search by name, event, camera, or describe what you're looking for..."
                className="w-full pl-11 pr-5 py-3.5 rounded-xl text-[14px] text-gray-200 placeholder-gray-600 outline-none transition-all duration-300 focus:ring-1"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', }}
              />
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-3 mb-8">
            {stats.map((stat, i) => (
              <div key={i} className={`rounded-xl p-5 fade-up fade-${i + 1}`} style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="text-2xl font-semibold text-white tracking-tight">{stat.value}</div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-[13px] text-gray-500">{stat.label}</span>
                  <span className="text-[11px] text-gray-700" style={{ fontFamily: 'var(--font-jetbrains), monospace' }}>{stat.sub}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Section header */}
          <div className="flex items-center justify-between mb-5 fade-up fade-3">
            <h2 className="text-[13px] font-semibold tracking-[0.15em] text-gray-400 uppercase">Recent Uploads</h2>
            <div className="flex gap-2">
              {['All', 'Favorites', 'Unprocessed'].map((f, i) => (
                <button key={f} className="px-3 py-1.5 rounded-lg text-[12px] transition-all duration-300" style={{
                  background: i === 0 ? 'rgba(245, 158, 11, 0.12)' : 'transparent',
                  color: i === 0 ? '#F59E0B' : '#6B7280',
                  border: i === 0 ? '1px solid rgba(245, 158, 11, 0.2)' : '1px solid transparent',
                }}>{f}</button>
              ))}
            </div>
          </div>

          {/* Photo Grid */}
          <div className="columns-3 gap-3" style={{ columnFill: 'balance' }}>
            {photos.map((photo, i) => (
              <div key={i} className="break-inside-avoid mb-3 rounded-xl overflow-hidden cursor-pointer card-hover fade-up" style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.05)',
                animationDelay: `${0.05 * i}s`,
              }}>
                <div className="overflow-hidden">
                  <div className="img-zoom" style={{ aspectRatio: photo.aspect, background: photo.gradient }} />
                </div>
                <div className="p-3">
                  <div className="text-[13px] text-gray-200 font-medium">{photo.title}</div>
                  <div className="text-[11px] text-gray-600 mt-1" style={{ fontFamily: 'var(--font-jetbrains), monospace' }}>{photo.meta}</div>
                  <div className="text-[11px] text-gray-700 mt-0.5">{photo.event}</div>
                </div>
              </div>
            ))}
          </div>
        </main>

        {/* Sidebar */}
        <aside className="w-72 p-6 shrink-0" style={{ borderLeft: '1px solid rgba(255,255,255,0.05)' }}>
          <h3 className="text-[11px] font-bold tracking-[0.2em] text-gray-600 uppercase mb-5">Photo Details</h3>
          <div className="rounded-xl overflow-hidden mb-5" style={{ aspectRatio: '4/3', background: photos[0].gradient }} />
          <div className="space-y-4">
            {[
              ['Filename', 'DSC_4521.ARW', true],
              ['Camera', 'Sony A7R V', false],
              ['Lens', 'GM 24-70mm f/2.8', false],
              ['Settings', 'f/2.8 · 1/250s · ISO 400', true],
              ['Dimensions', '9504 × 6336', true],
              ['Event', 'Sarah & James Wedding', false],
              ['AI Tags', 'portrait, golden hour, outdoor', false],
            ].map(([label, value, mono]) => (
              <div key={label as string}>
                <div className="text-[10px] tracking-wider text-gray-600 uppercase mb-0.5">{label as string}</div>
                <div className="text-[13px] text-gray-300" style={mono ? { fontFamily: 'var(--font-jetbrains), monospace' } : {}}>{value as string}</div>
              </div>
            ))}
          </div>
          <div className="mt-6 pt-5" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <button className="w-full py-2.5 rounded-lg text-[13px] font-medium transition-all duration-300 hover:brightness-110" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#F59E0B', border: '1px solid rgba(245, 158, 11, 0.25)' }}>
              ✦ Enhance with AI
            </button>
          </div>
        </aside>
      </div>

      {/* Back link */}
      <div className="fixed bottom-6 left-6">
        <Link href="/mockups" className="px-4 py-2 rounded-lg text-[12px] text-gray-500 hover:text-gray-300 transition-colors duration-300" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
          ← All Mockups
        </Link>
      </div>
    </div>
  )
}
