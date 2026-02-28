'use client'

import Link from 'next/link'

const photos = [
  { gradient: 'linear-gradient(135deg, #fbbf24, #f97316, #ef4444)', aspect: '4/3', title: 'Golden Hour Portrait', tags: ['portrait', 'golden hour'] },
  { gradient: 'linear-gradient(135deg, #60a5fa, #34d399)', aspect: '3/4', title: 'Emerald Coast', tags: ['landscape', 'ocean'] },
  { gradient: 'linear-gradient(135deg, #6366f1, #8b5cf6, #ec4899)', aspect: '1/1', title: 'Violet Dreams', tags: ['studio', 'fashion'] },
  { gradient: 'linear-gradient(135deg, #0ea5e9, #06b6d4, #14b8a6)', aspect: '16/9', title: 'Ocean Panorama', tags: ['panorama', 'seascape'] },
  { gradient: 'linear-gradient(135deg, #f43f5e, #fb923c, #fbbf24)', aspect: '3/2', title: 'Sunset Fire', tags: ['sunset', 'silhouette'] },
  { gradient: 'linear-gradient(135deg, #64748b, #94a3b8, #cbd5e1)', aspect: '2/3', title: 'Urban Concrete', tags: ['architecture', 'minimal'] },
  { gradient: 'linear-gradient(135deg, #84cc16, #22c55e, #10b981)', aspect: '4/5', title: 'Spring Garden', tags: ['macro', 'nature'] },
  { gradient: 'linear-gradient(135deg, #e879f9, #c084fc, #818cf8)', aspect: '3/2', title: 'Lilac Bloom', tags: ['botanical', 'soft'] },
  { gradient: 'linear-gradient(135deg, #fb923c, #facc15, #a3e635)', aspect: '4/3', title: 'Amber Harvest', tags: ['autumn', 'warm'] },
  { gradient: 'linear-gradient(135deg, #2dd4bf, #38bdf8, #818cf8)', aspect: '1/1', title: 'Tidal Pool', tags: ['coastal', 'abstract'] },
  { gradient: 'linear-gradient(135deg, #f97316, #ef4444, #dc2626)', aspect: '16/9', title: 'Canyon Glow', tags: ['desert', 'dramatic'] },
  { gradient: 'linear-gradient(135deg, #a78bfa, #f472b6, #fb923c)', aspect: '3/4', title: 'Peach Blossom', tags: ['floral', 'pastel'] },
]

export default function NeonPixeltrunk() {
  return (
    <div className="min-h-screen relative overflow-hidden" style={{ background: '#030712', fontFamily: 'var(--font-space), var(--font-inter), system-ui, sans-serif' }}>
      <style>{`
        @keyframes meshMove { 0% { transform: translate(0, 0) rotate(0deg); } 33% { transform: translate(40px, -30px) rotate(120deg); } 66% { transform: translate(-30px, 20px) rotate(240deg); } 100% { transform: translate(0, 0) rotate(360deg); } }
        @keyframes borderGlow { 0%, 100% { border-color: rgba(99, 102, 241, 0.3); box-shadow: 0 0 20px rgba(99, 102, 241, 0.1); } 33% { border-color: rgba(168, 85, 247, 0.3); box-shadow: 0 0 20px rgba(168, 85, 247, 0.1); } 66% { border-color: rgba(236, 72, 153, 0.3); box-shadow: 0 0 20px rgba(236, 72, 153, 0.1); } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
        @keyframes gradientShift { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
        .mesh-gradient { animation: meshMove 25s ease-in-out infinite; }
        .glow-border { animation: borderGlow 4s ease-in-out infinite; }
        .slide-up { animation: slideUp 0.7s ease-out both; }
        .neon-card { transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1); border: 1px solid rgba(255,255,255,0.06); }
        .neon-card:hover { border-color: rgba(139, 92, 246, 0.4); box-shadow: 0 0 30px rgba(139, 92, 246, 0.15), 0 20px 40px -15px rgba(0,0,0,0.5); transform: translateY(-4px); }
        .neon-card:hover .neon-img { transform: scale(1.05); }
        .neon-img { transition: transform 0.7s cubic-bezier(0.16, 1, 0.3, 1); }
        .gradient-shift { background-size: 200% 200%; animation: gradientShift 3s ease infinite; }
        .grid-pattern { background-image: linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px); background-size: 60px 60px; }
        .tag-chip { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); transition: all 0.3s ease; }
        .tag-chip:hover { background: rgba(139, 92, 246, 0.15); border-color: rgba(139, 92, 246, 0.3); color: #c4b5fd; }
      `}</style>

      {/* Background effects */}
      <div className="absolute inset-0 grid-pattern" />
      <div className="mesh-gradient absolute" style={{ width: '600px', height: '600px', top: '-15%', right: '-10%', background: 'radial-gradient(circle, rgba(99, 102, 241, 0.15), transparent 70%)', filter: 'blur(60px)' }} />
      <div className="mesh-gradient absolute" style={{ width: '500px', height: '500px', bottom: '-10%', left: '-5%', background: 'radial-gradient(circle, rgba(236, 72, 153, 0.12), transparent 70%)', filter: 'blur(60px)', animationDelay: '-8s' }} />
      <div className="mesh-gradient absolute" style={{ width: '400px', height: '400px', top: '30%', left: '40%', background: 'radial-gradient(circle, rgba(168, 85, 247, 0.1), transparent 70%)', filter: 'blur(60px)', animationDelay: '-16s' }} />

      {/* Nav */}
      <nav className="relative z-10 mx-6 mt-5 px-6 py-4 rounded-xl flex items-center justify-between glow-border slide-up" style={{ background: 'rgba(255,255,255,0.03)', backdropFilter: 'blur(40px)' }}>
        <div className="flex items-center gap-8">
          <span className="text-xl font-bold gradient-shift" style={{ background: 'linear-gradient(135deg, #818CF8, #A78BFA, #EC4899, #818CF8)', backgroundSize: '200% 200%', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            ◈ PIXELTRUNK
          </span>
          <div className="flex gap-6 text-[13px]">
            <span className="text-white font-medium cursor-pointer">Library</span>
            <span className="text-gray-600 hover:text-gray-300 cursor-pointer transition-colors duration-300">Events</span>
            <span className="text-gray-600 hover:text-gray-300 cursor-pointer transition-colors duration-300">Collections</span>
            <span className="text-gray-600 hover:text-gray-300 cursor-pointer transition-colors duration-300">AI Tools</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white transition-all duration-300 hover:shadow-lg gradient-shift" style={{ background: 'linear-gradient(135deg, #6366F1, #A855F7, #EC4899)', backgroundSize: '200% 200%', boxShadow: '0 0 20px rgba(139, 92, 246, 0.3)' }}>
            ↑ Upload
          </button>
          <div className="w-9 h-9 rounded-lg gradient-shift" style={{ background: 'linear-gradient(135deg, #6366F1, #EC4899)', backgroundSize: '200% 200%', border: '2px solid rgba(255,255,255,0.1)' }} />
        </div>
      </nav>

      {/* Search */}
      <div className="relative z-10 px-12 pt-10 pb-2 slide-up" style={{ animationDelay: '0.1s' }}>
        <div className="relative rounded-xl overflow-hidden glow-border" style={{ background: 'rgba(255,255,255,0.03)', backdropFilter: 'blur(20px)' }}>
          <div className="absolute inset-0 opacity-30" style={{ background: 'linear-gradient(90deg, rgba(99,102,241,0.1), rgba(168,85,247,0.1), rgba(236,72,153,0.1))' }} />
          <input
            type="text"
            placeholder="◈ Describe what you're looking for — scenes, moods, colors, people..."
            className="relative w-full px-6 py-4 text-[14px] text-gray-200 placeholder-gray-600 outline-none bg-transparent"
          />
        </div>
      </div>

      {/* Stats */}
      <div className="relative z-10 px-12 py-8 flex gap-10 slide-up" style={{ animationDelay: '0.15s' }}>
        {[
          { value: '3,847', label: 'Photos', color: '#818CF8' },
          { value: '24', label: 'Events', color: '#A78BFA' },
          { value: '42 GB', label: 'Storage', color: '#C084FC' },
          { value: '98%', label: 'AI Ready', color: '#EC4899' },
        ].map((s, i) => (
          <div key={i} className="flex items-baseline gap-2">
            <span className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</span>
            <span className="text-[12px] text-gray-600">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Filter tags */}
      <div className="relative z-10 px-12 mb-6 flex flex-wrap gap-2 slide-up" style={{ animationDelay: '0.2s' }}>
        {['All', 'Portraits', 'Landscapes', 'Architecture', 'Events', 'Macro', 'Studio', 'Street'].map((tag, i) => (
          <button key={tag} className="tag-chip px-3 py-1.5 rounded-lg text-[12px] text-gray-500">
            {i === 0 && <span className="mr-1.5" style={{ color: '#A78BFA' }}>●</span>}
            {tag}
          </button>
        ))}
      </div>

      {/* Photo Grid */}
      <div className="relative z-10 px-12 pb-20">
        <div className="columns-3 gap-4">
          {photos.map((photo, i) => (
            <div key={i} className="break-inside-avoid mb-4 rounded-xl overflow-hidden cursor-pointer neon-card slide-up" style={{
              background: 'rgba(255,255,255,0.02)',
              animationDelay: `${0.2 + i * 0.04}s`,
            }}>
              <div className="overflow-hidden">
                <div className="neon-img" style={{ aspectRatio: photo.aspect, background: photo.gradient }} />
              </div>
              <div className="p-3.5">
                <div className="text-[13px] text-gray-200 font-medium">{photo.title}</div>
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {photo.tags.map((tag) => (
                    <span key={tag} className="px-2 py-0.5 rounded text-[10px] text-gray-500" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Back link */}
      <div className="fixed bottom-6 left-6 z-20">
        <Link href="/mockups" className="px-4 py-2 rounded-lg text-[12px] text-gray-600 hover:text-gray-300 transition-all duration-300 glow-border" style={{ background: 'rgba(255,255,255,0.03)', backdropFilter: 'blur(20px)' }}>
          ← All Mockups
        </Link>
      </div>
    </div>
  )
}
