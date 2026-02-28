'use client'

import Link from 'next/link'

const photos = [
  { gradient: 'linear-gradient(135deg, #fbbf24, #f97316, #ef4444)', aspect: '4/3', title: 'Golden Hour Portrait', caption: 'Natural light, f/1.8 — Sarah & James Wedding', date: 'Feb 14' },
  { gradient: 'linear-gradient(135deg, #60a5fa, #34d399)', aspect: '3/4', title: 'Emerald Coast', caption: 'Long exposure, dawn — Coastal Series', date: 'Feb 10' },
  { gradient: 'linear-gradient(135deg, #6366f1, #8b5cf6, #ec4899)', aspect: '1/1', title: 'Violet Dreams', caption: 'Studio lighting, gels — Fashion Editorial', date: 'Feb 8' },
  { gradient: 'linear-gradient(135deg, #0ea5e9, #06b6d4, #14b8a6)', aspect: '16/9', title: 'Ocean Panorama', caption: '5-image stitch, golden hour — Coastal Series', date: 'Feb 10' },
  { gradient: 'linear-gradient(135deg, #f43f5e, #fb923c, #fbbf24)', aspect: '3/2', title: 'Sunset Fire', caption: 'Silhouette, backlit — Sarah & James Wedding', date: 'Feb 14' },
  { gradient: 'linear-gradient(135deg, #64748b, #94a3b8, #cbd5e1)', aspect: '2/3', title: 'Urban Concrete', caption: 'Leading lines, overcast — Architecture Walk', date: 'Feb 5' },
  { gradient: 'linear-gradient(135deg, #84cc16, #22c55e, #10b981)', aspect: '4/5', title: 'Spring Garden', caption: 'Macro, morning dew — Botanical Study', date: 'Feb 1' },
  { gradient: 'linear-gradient(135deg, #e879f9, #c084fc, #818cf8)', aspect: '3/2', title: 'Lilac Bloom', caption: 'Shallow depth, overexposed highlights — Botanical Study', date: 'Feb 1' },
  { gradient: 'linear-gradient(135deg, #fb923c, #facc15, #a3e635)', aspect: '4/3', title: 'Amber Harvest', caption: 'Wide angle, warm tones — Fall Collection', date: 'Jan 28' },
  { gradient: 'linear-gradient(135deg, #2dd4bf, #38bdf8, #818cf8)', aspect: '1/1', title: 'Tidal Pool', caption: 'Overhead, polarizer — Coastal Series', date: 'Feb 10' },
]

export default function Editorial() {
  return (
    <div className="min-h-screen" style={{ background: '#FAFAF9', fontFamily: 'var(--font-inter), system-ui, sans-serif' }}>
      <style>{`
        @keyframes revealLine { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .reveal-line { transform-origin: left; animation: revealLine 0.8s ease-out both; }
        .fade-in { animation: fadeIn 0.8s ease-out both; }
        .slide-in { animation: slideIn 0.7s ease-out both; }
        .photo-card { transition: all 0.5s ease; }
        .photo-card:hover { transform: translateY(-2px); }
        .photo-card:hover .photo-overlay { opacity: 1; }
        .photo-card:hover .photo-img { transform: scale(1.03); }
        .photo-img { transition: transform 0.8s ease; }
        .photo-overlay { opacity: 0; transition: opacity 0.4s ease; }
        .editorial-link { position: relative; display: inline-block; }
        .editorial-link::after { content: ''; position: absolute; bottom: -2px; left: 0; width: 100%; height: 1px; background: #10B981; transform: scaleX(0); transform-origin: right; transition: transform 0.4s ease; }
        .editorial-link:hover::after { transform: scaleX(1); transform-origin: left; }
      `}</style>

      {/* Nav — ultra minimal */}
      <nav className="flex items-center justify-between px-12 py-8 fade-in">
        <h1 style={{ fontFamily: 'var(--font-playfair), Georgia, serif', fontSize: '28px', fontWeight: 700, letterSpacing: '-0.02em', color: '#111' }}>
          Pixeltrunk
        </h1>
        <div className="flex items-center gap-10 text-[13px] tracking-wide">
          <span className="editorial-link cursor-pointer text-gray-900 font-medium">Archive</span>
          <span className="editorial-link cursor-pointer text-gray-400">Events</span>
          <span className="editorial-link cursor-pointer text-gray-400">Collections</span>
          <span className="editorial-link cursor-pointer text-gray-400">Search</span>
        </div>
      </nav>

      {/* Divider */}
      <div className="mx-12 h-px bg-gray-200 reveal-line" />

      {/* Hero */}
      <div className="px-12 py-16">
        <p className="text-[13px] uppercase tracking-[0.25em] text-gray-400 font-medium mb-4 slide-in" style={{ animationDelay: '0.1s' }}>
          Your visual archive
        </p>
        <h2 className="slide-in" style={{
          fontFamily: 'var(--font-playfair), Georgia, serif',
          fontSize: '56px',
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: '-0.03em',
          color: '#111',
          maxWidth: '700px',
          animationDelay: '0.15s',
        }}>
          Every frame tells<br />
          <span style={{ fontStyle: 'italic', color: '#10B981' }}>a story</span>
        </h2>
        <p className="text-gray-400 text-[15px] mt-5 max-w-lg leading-relaxed slide-in" style={{ animationDelay: '0.2s' }}>
          3,847 photographs across 24 events. AI-organized, searchable by description, mood, or visual similarity.
        </p>
      </div>

      {/* Section divider with label */}
      <div className="px-12 flex items-center gap-4 mb-10 slide-in" style={{ animationDelay: '0.25s' }}>
        <div className="h-px bg-gray-200 flex-1" />
        <span className="text-[11px] uppercase tracking-[0.3em] text-gray-400 font-medium shrink-0">Recent Work</span>
        <div className="h-px bg-gray-200 flex-1" />
      </div>

      {/* Photo Grid — editorial asymmetric layout */}
      <div className="px-12 pb-20">
        <div className="columns-2 gap-8" style={{ columnFill: 'balance' }}>
          {photos.map((photo, i) => (
            <div key={i} className="break-inside-avoid mb-10 photo-card cursor-pointer slide-in" style={{ animationDelay: `${0.25 + i * 0.06}s` }}>
              <div className="overflow-hidden relative">
                <div className="photo-img" style={{ aspectRatio: photo.aspect, background: photo.gradient }} />
                <div className="photo-overlay absolute inset-0 flex items-end p-6" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.5), transparent 60%)' }}>
                  <span className="text-white text-[13px] font-medium">View →</span>
                </div>
              </div>
              <div className="mt-4">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-[18px] font-semibold text-gray-900 tracking-tight" style={{ fontFamily: 'var(--font-playfair), Georgia, serif' }}>
                    {photo.title}
                  </h3>
                  <span className="text-[12px] text-gray-400 font-medium">{photo.date}</span>
                </div>
                <p className="text-[13px] text-gray-400 mt-1.5 leading-relaxed" style={{ fontStyle: 'italic' }}>
                  {photo.caption}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="px-12 py-8" style={{ borderTop: '1px solid #e5e5e5' }}>
        <div className="flex items-center justify-between">
          <p className="text-[12px] text-gray-400">
            <span style={{ fontFamily: 'var(--font-playfair), Georgia, serif', fontWeight: 600, color: '#111' }}>Pixeltrunk</span>
            {' '}— Intelligent photo archiving for professionals
          </p>
          <div className="flex gap-6 text-[12px] text-gray-400">
            <span className="editorial-link cursor-pointer">Settings</span>
            <span className="editorial-link cursor-pointer">Export</span>
            <span className="editorial-link cursor-pointer">Help</span>
          </div>
        </div>
      </div>

      {/* Back link */}
      <div className="fixed bottom-6 left-6 z-20">
        <Link href="/mockups" className="px-4 py-2 text-[12px] font-medium text-gray-400 hover:text-gray-700 transition-colors duration-300 editorial-link" style={{ background: 'rgba(250,250,249,0.9)', backdropFilter: 'blur(10px)', border: '1px solid #e5e5e5', borderRadius: '8px' }}>
          ← All Mockups
        </Link>
      </div>
    </div>
  )
}
