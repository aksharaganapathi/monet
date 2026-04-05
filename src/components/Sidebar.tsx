import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  Tags,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import type { Page } from '../lib/types';
import monetLogo from '../monet_logo.png';

const navItems: { page: Page; label: string; icon: React.ReactNode }[] = [
  { page: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
  { page: 'accounts', label: 'Accounts', icon: <Wallet size={20} /> },
  { page: 'transactions', label: 'Transactions', icon: <ArrowLeftRight size={20} /> },
  { page: 'categories', label: 'Categories', icon: <Tags size={20} /> },
];

export function Sidebar() {
  const { activePage, setActivePage, isSidebarCollapsed, toggleSidebar } = useUIStore();

  return (
    <motion.aside
      className="z-20 h-full flex flex-col bg-sidebar border-r border-[rgba(0,0,0,0.08)]"
      animate={{ width: isSidebarCollapsed ? 72 : 220 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Logo / Brand */}
      <div className="flex items-center justify-center border-b border-border-subtle px-4 py-5">
        <AnimatePresence mode="wait">
          {!isSidebarCollapsed ? (
            <motion.div
              key="full-logo"
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.16 }}
              className="flex items-center gap-2"
            >
              <img src={monetLogo} alt="Monet" className="h-20 w-auto" />
            </motion.div>
          ) : (
            <motion.div
              key="collapsed-logo"
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.16 }}
              className="flex items-center justify-center p-1"
            >
              <img src={monetLogo} alt="Monet" className="h-14 w-auto" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4" role="navigation" aria-label="Main navigation">
        {navItems.map(({ page, label, icon }) => {
          const isActive = activePage === page;
          return (
            <button
              key={page}
              onClick={() => setActivePage(page)}
              className={`
                relative w-full flex items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium
                cursor-pointer transition-all duration-200 overflow-hidden
                ${isActive
                  ? 'bg-sidebar-active text-accent font-semibold'
                  : 'text-text-secondary hover:bg-black/5 hover:text-text-primary'
                }
              `}
              aria-current={isActive ? 'page' : undefined}
              title={isSidebarCollapsed ? label : undefined}
            >
              {isActive && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-3/5 bg-accent rounded-r-full"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                />
              )}
              <span className="flex-shrink-0 relative z-10">{icon}</span>
              <AnimatePresence>
                {!isSidebarCollapsed && (
                  <motion.span
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden whitespace-nowrap relative z-10"
                  >
                    {label}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="px-3 pb-4">
        <button
          onClick={toggleSidebar}
          className="w-full flex items-center justify-center gap-2 rounded-md bg-black/[0.04] px-3 py-2 text-text-tertiary transition-colors hover:bg-black/[0.07] hover:text-text-secondary cursor-pointer"
          aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isSidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          <AnimatePresence>
            {!isSidebarCollapsed && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-xs"
              >
                Collapse
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </motion.aside>
  );
}
