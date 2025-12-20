import { motion } from 'framer-motion'
import { Sidebar } from './Sidebar'
import { MobileNav } from './MobileNav'
import { useUIStore } from '../../lib/store'

export function Layout({ children }) {
  const { sidebarOpen } = useUIStore()

  return (
    <div className="min-h-screen bg-dark-950">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="blob blob-1" />
        <div className="blob blob-2" />
      </div>

      {/* Sidebar (desktop) */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Main content */}
      <motion.main
        initial={false}
        animate={{
          marginLeft: sidebarOpen ? 280 : 80,
        }}
        className="hidden lg:block min-h-screen transition-all duration-300"
      >
        <div className="p-8">{children}</div>
      </motion.main>

      {/* Mobile content */}
      <main className="lg:hidden min-h-screen pb-20">
        <div className="p-4">{children}</div>
      </main>

      {/* Mobile navigation */}
      <MobileNav />
    </div>
  )
}
