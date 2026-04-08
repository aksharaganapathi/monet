import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  ChartColumnBig,
  Wallet,
  ArrowLeftRight,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import type { Page } from '../lib/types';
import monetLogo from '../monet_logo.svg';

const navItems: { page: Page; label: string; icon: React.ReactNode }[] = [
  { page: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
  { page: 'insights', label: 'Insights', icon: <ChartColumnBig size={20} /> },
  { page: 'accounts', label: 'Accounts', icon: <Wallet size={20} /> },
  { page: 'transactions', label: 'Transactions', icon: <ArrowLeftRight size={20} /> },
  { page: 'settings', label: 'Settings', icon: <Settings size={20} /> },
];

export function Sidebar() {
  const { activePage, setActivePage, isSidebarCollapsed, toggleSidebar } = useUIStore();

  return (
    <motion.aside
      className="z-20 flex h-full flex-col border-r border-border bg-sidebar"
      animate={{ width: isSidebarCollapsed ? 40 : 224 }}
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
      <nav className="flex-1 space-y-1 px-2 py-4" role="navigation" aria-label="Main navigation">
        {navItems.map(({ page, label, icon }) => {
          const isActive = activePage === page;
          return (
            <button
              key={page}
              onClick={() => setActivePage(page)}
              className={`
                relative flex w-full items-center gap-3 overflow-hidden rounded-lg px-3 py-2.5 text-[13px] font-medium
                cursor-pointer border border-transparent transition-colors duration-150
                ${isActive
                  ? 'bg-sidebar-active text-accent font-semibold'
                  : 'text-text-secondary hover:bg-surface-muted hover:text-text-primary'
                }
              `}
              aria-current={isActive ? 'page' : undefined}
              title={isSidebarCollapsed ? label : undefined}
            >
              {isActive && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute left-0 top-1/2 h-4/5 w-0.5 -translate-y-1/2 bg-accent"
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
          className="surface-card flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-text-tertiary transition-colors hover:bg-surface-muted hover:text-text-secondary cursor-pointer"
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
