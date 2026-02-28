import Link from 'next/link'

const options = [
  {
    id: 'a',
    title: 'Dark Studio',
    subtitle: 'Lightroom meets Linear',
    description: 'Professional darkroom aesthetic. Warm amber accents on deep black. Monospace metadata. Photos are the hero — everything else recedes.',
    gradient: 'linear-gradient(135deg, #0B0B0F 0%, #1a1510 50%, #0B0B0F 100%)',
    accent: '#F59E0B',
    border: 'rgba(245, 158, 11, 0.3)',
  },
  {
    id: 'b',
    title: 'Luminous',
    subtitle: 'Apple Vision Pro meets Notion',
    description: 'Soft light, layered depth, ambient gradient orbs. Floating glass surfaces with deep shadows. Premium consumer product feel.',
    gradient: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 50%, #f5f3ff 100%)',
    accent: '#8B5CF6',
    border: 'rgba(139, 92, 246, 0.3)',
  },
  {
    id: 'c',
    title: 'Editorial',
    subtitle: 'Kinfolk meets Unsplash',
    description: 'High-fashion magazine aesthetic. Bold serif headlines, generous whitespace, photos that breathe. Minimal chrome, maximum impact.',
    gradient: 'linear-gradient(135deg, #FFFFFF 0%, #fafaf9 50%, #FFFFFF 100%)',
    accent: '#10B981',
    border: 'rgba(16, 185, 129, 0.3)',
  },
  {
    id: 'd',
    title: 'Neon Prism',
    subtitle: 'Vercel meets Stripe',
    description: 'Dark canvas with electric gradient accents. Animated mesh backgrounds, glowing borders, prismatic light effects. Bold and futuristic.',
    gradient: 'linear-gradient(135deg, #030712 0%, #0f0a1e 50%, #030712 100%)',
    accent: '#EC4899',
    border: 'rgba(236, 72, 153, 0.3)',
  },
]

export default function MockupsIndex() {
  return (
    <div
      className="min-h-screen px-8 py-16"
      style={{
        background: '#09090b',
        fontFamily: 'var(--font-space), var(--font-inter), system-ui, sans-serif',
      }}
    >
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold text-white tracking-tight mb-4">
            SPS Prism — Design Directions
          </h1>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            Four distinct visual identities. Each goes all-out on a different aesthetic.
            Browse them, feel them, then pick a direction.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {options.map((opt) => (
            <Link
              key={opt.id}
              href={`/mockups/${opt.id}`}
              className="group relative rounded-2xl overflow-hidden transition-all duration-500 hover:scale-[1.02]"
              style={{
                background: opt.gradient,
                border: `1px solid ${opt.border}`,
                minHeight: '280px',
              }}
            >
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                style={{ background: `radial-gradient(circle at 50% 50%, ${opt.accent}15, transparent 70%)` }}
              />
              <div className="relative p-8 h-full flex flex-col justify-end">
                <div
                  className="text-xs font-bold tracking-[0.2em] uppercase mb-2"
                  style={{ color: opt.accent }}
                >
                  Option {opt.id.toUpperCase()}
                </div>
                <h2
                  className="text-3xl font-bold mb-1 transition-colors duration-300"
                  style={{ color: opt.id === 'b' || opt.id === 'c' ? '#111' : '#fff' }}
                >
                  {opt.title}
                </h2>
                <p
                  className="text-sm font-medium mb-3"
                  style={{ color: opt.id === 'b' || opt.id === 'c' ? '#666' : '#999' }}
                >
                  {opt.subtitle}
                </p>
                <p
                  className="text-sm leading-relaxed max-w-md"
                  style={{ color: opt.id === 'b' || opt.id === 'c' ? '#888' : '#777' }}
                >
                  {opt.description}
                </p>
                <div
                  className="mt-4 inline-flex items-center gap-2 text-sm font-semibold transition-all duration-300 group-hover:gap-3"
                  style={{ color: opt.accent }}
                >
                  View Mockup <span className="text-lg">→</span>
                </div>
              </div>
            </Link>
          ))}
        </div>

        <p className="text-center text-gray-600 text-sm mt-12">
          These are design explorations — gradient placeholders stand in for real photos.
        </p>
      </div>
    </div>
  )
}
