'use client'

import Link from 'next/link'

const photos = [
  { gradient: 'linear-gradient(135deg, #fbbf24, #f97316, #ef4444)', aspect: '4/3', title: 'Golden Hour Portrait', count: '48 photos' },
  { gradient: 'linear-gradient(135deg, #60a5fa, #34d399)', aspect: '3/4', title: 'Emerald Coast', count: '32 photos' },
  { gradient: 'linear-gradient(135deg, #6366f1, #8b5cf6, #ec4899)', aspect: '1/1', title: 'Violet Dreams', count: '56 photos' },
  { gradient: 'linear-gradient(135deg, #0ea5e9, #06b6d4, #14b8a6)', aspect: '16/9', title: 'Ocean Panorama', count: '27 photos' },
  { gradient: 'linear-gradient(135deg, #f43f5e, #fb923c, #fbbf24)', aspect: '3/2', title: 'Sunset Fire', count: '41 photos' },
  { gradient: 'linear-gradient(135deg, #64748b, #94a3b8, #cbd5e1)', aspect: '2/3', title: 'Urban Concrete', count: '19 photos' },
  { gradient: 'linear-gradient(135deg, #84cc16, #22c55e, #10b981)', aspect: '4/5', title: 'Spring Garden', count: '63 photos' },
  { gradient: 'linear-gradient(135deg, #e879f9, #c084fc, #818cf8)', aspect: '3/2', title: 'Lilac Bloom', count: '35 photos' },
  { gradient: 'linear-gradient(135deg, #fb923c, #facc15, #a3e635)', aspect: '4/3', title: 'Amber Harvest', count: '22 photos' },
  { gradient: 'linear-gradient(135deg, #2dd4bf, #38bdf8, #818cf8)', aspect: '1/1', title: 'Tidal Pool', count: '44 photos' },
  { gradient: 'linear-gradient(135deg, #f97316, #ef4444, #dc2626)', aspect: '16/9', title: 'Canyon Glow', count: '38 photos' },
  { gradient: 'linear-gradient(135deg, #a78bfa, #f472b6, #fb923c)', aspect: '3/4', title: 'Peach Blossom', count: '51 photos' },
]

export default function Luminous() {
  return (
    <div className="min-h-screen relative overflow-hidden" style={{ background: 'linear-gradient(160deg, #f8fafc 0%, #eff6ff 30%, #faf5ff 60%, #fdf2f8 100%)', fontFamily: 'var(--font-space), var(--font-inter), system-ui, sans-serif' }}>
      <style>{`
        @keyframes float { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(30px, -20px) scale(1.05); } 66% { transform: translate(-20px, 15px) scale(0.95); } }
        @keyframes shimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
        @keyframes fadeScale { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        .orb { position: absolute; border-radius: 50%; filter: blur(80px); opacity: 0.35; animation: float 20s ease-in-out infinite; pointer-events: none; }
        .float-card { transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1); }
        .float-card:hover { transform: translateY(-8px) scale(1.01); box-shadow: 0 24px 60px -12px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(139, 92, 246, 0.1); }
        .float-card:hover .img-scale { transform: scale(1.08); }
        .img-scale { transition: transform 0.8s cubic-bezier(0.16, 1, 0.3, 1); }
        .slide-up { animation: slideUp 0.7s ease-out both; }
        .gradient-text { background: linear-gradient(135deg, #7C3AED, #3B82F6, #EC4899); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        .gradient-border { background: linear-gradient(135deg, #7C3AED22, #3B82F622, #EC489922); }
        .shimmer-border { background: linear-gradient(90deg, transparent, rgba(139,92,246,0.15), transparent); background-size: 200% 100%; animation: shimmer 3s linear infinite; }
      `}</style>

      {/* Ambient orbs */}
      <div className="orb" style={{ width: '500px', height: '500px', background: 'radial-gradient(circle, #818cf8, transparent)', top: '-10%', right: '10%', animationDelay: '0s' }} />
      <div className="orb" style={{ width: '400px', height: '400px', background: 'radial-gradient(circle, #c084fc, transparent)', bottom: '5%', left: '-5%', animationDelay: '-7s' }} />
      <div className="orb" style={{ width: '350px', height: '350px', background: 'radial-gradient(circle, #f9a8d4, transparent)', top: '40%', right: '-8%', animationDelay: '-13s' }} />

      {/* Nav */}
      <nav className="relative z-10 mx-6 mt-5 px-6 py-4 rounded-2xl flex items-center justify-between slide-up" style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(40px) saturate(180%)', boxShadow: '0 8px 32px -8px rgba(0,0,0,0.08), 0 0 0 1px rgba(255,255,255,0.7)', }}>
        <div className="flex items-center gap-8">
          <span className="text-xl font-bold gradient-text">Prism</span>
          <div className="flex gap-6 text-[13px] font-medium">
            <span className="text-gray-900 cursor-pointer">Library</span>
            <span className="text-gray-400 hover:text-gray-700 cursor-pointer transition-colors duration-300">Events</span>
            <span className="text-gray-400 hover:text-gray-700 cursor-pointer transition-colors duration-300">Collections</span>
            <span className="text-gray-400 hover:text-gray-700 cursor-pointer transition-colors duration-300">AI Tools</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button className="px-4 py-2 rounded-xl text-[13px] font-semibold text-white transition-all duration-300 hover:shadow-lg hover:shadow-violet-500/25" style={{ background: 'linear-gradient(135deg, #7C3AED, #3B82F6)' }}>
            + Upload
          </button>
          <div className="w-9 h-9 rounded-full ring-2 ring-white shadow-md" style={{ background: 'linear-gradient(135deg, #7C3AED, #EC4899)' }} />
        </div>
      </nav>

      {/* Hero */}
      <div className="relative z-10 px-12 pt-12 pb-6">
        <h1 className="text-4xl font-bold text-gray-900 tracking-tight slide-up" style={{ animationDelay: '0.1s' }}>
          Good evening, <span className="gradient-text">Michael</span>
        </h1>
        <p className="text-gray-500 mt-2 text-[15px] slide-up" style={{ animationDelay: '0.15s' }}>
          You have 12 new photos ready for AI processing
        </p>

        {/* Quick stats */}
        <div className="flex gap-3 mt-6">
          {[
            { icon: '◆', value: '3,847', label: 'Photos', color: '#7C3AED' },
            { icon: '◇', value: '24', label: 'Events', color: '#3B82F6' },
            { icon: '✦', value: '98%', label: 'Processed', color: '#EC4899' },
          ].map((s, i) => (
            <div key={i} className="px-5 py-3.5 rounded-2xl flex items-center gap-3 slide-up" style={{
              background: 'rgba(255,255,255,0.55)',
              backdropFilter: 'blur(20px)',
              boxShadow: '0 4px 16px -4px rgba(0,0,0,0.06), 0 0 0 1px rgba(255,255,255,0.6)',
              animationDelay: `${0.2 + i * 0.05}s`,
            }}>
              <span style={{ color: s.color, fontSize: '18px' }}>{s.icon}</span>
              <div>
                <div className="text-xl font-bold text-gray-900">{s.value}</div>
                <div className="text-[11px] text-gray-400 font-medium">{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="relative z-10 px-12 mb-6 slide-up" style={{ animationDelay: '0.3s' }}>
        <div className="relative">
          <div className="absolute inset-0 rounded-2xl shimmer-border" />
          <input
            type="text"
            placeholder="Search your archive — try describing a scene, mood, or color palette..."
            className="relative w-full px-6 py-4 rounded-2xl text-[14px] text-gray-700 placeholder-gray-400 outline-none"
            style={{ background: 'rgba(255,255,255,0.65)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.6)', boxShadow: '0 4px 16px -4px rgba(0,0,0,0.05)' }}
          />
        </div>
      </div>

      {/* Photo Grid */}
      <div className="relative z-10 px-12 pb-16">
        <div className="flex items-center justify-between mb-5 slide-up" style={{ animationDelay: '0.35s' }}>
          <h2 className="text-[13px] font-bold tracking-wide text-gray-400 uppercase">Recent Work</h2>
          <div className="flex gap-2">
            {['All', 'Events', 'Favorites'].map((f, i) => (
              <button key={f} className="px-4 py-1.5 rounded-xl text-[12px] font-medium transition-all duration-300" style={{
                background: i === 0 ? 'linear-gradient(135deg, #7C3AED15, #3B82F615)' : 'rgba(255,255,255,0.4)',
                color: i === 0 ? '#7C3AED' : '#9CA3AF',
                border: i === 0 ? '1px solid rgba(124, 58, 237, 0.2)' : '1px solid rgba(255,255,255,0.5)',
              }}>{f}</button>
            ))}
          </div>
        </div>

        <div className="columns-3 gap-4">
          {photos.map((photo, i) => (
            <div key={i} className="break-inside-avoid mb-4 rounded-2xl overflow-hidden cursor-pointer float-card slide-up" style={{
              background: 'rgba(255,255,255,0.55)',
              backdropFilter: 'blur(20px)',
              boxShadow: '0 4px 24px -8px rgba(0,0,0,0.08), 0 0 0 1px rgba(255,255,255,0.6)',
              animationDelay: `${0.3 + i * 0.04}s`,
            }}>
              <div className="overflow-hidden rounded-t-2xl">
                <div className="img-scale" style={{ aspectRatio: photo.aspect, background: photo.gradient }} />
              </div>
              <div className="p-4">
                <div className="text-[14px] text-gray-800 font-semibold">{photo.title}</div>
                <div className="text-[12px] text-gray-400 mt-0.5">{photo.count}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Back link */}
      <div className="fixed bottom-6 left-6 z-20">
        <Link href="/mockups" className="px-4 py-2 rounded-xl text-[12px] font-medium text-gray-500 hover:text-gray-700 transition-all duration-300" style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.7)', boxShadow: '0 4px 12px -4px rgba(0,0,0,0.06)' }}>
          ← All Mockups
        </Link>
      </div>
    </div>
  )
}
