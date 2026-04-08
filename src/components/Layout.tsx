import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { SidebarSimple } from '@phosphor-icons/react';

import { Sidebar } from './Sidebar';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/useIsMobile';
import { CircleNotch } from '@phosphor-icons/react';

export function Layout() {
  const { user, isLoading } = useAuth();
  const isMobile = useIsMobile();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(
    localStorage.getItem('sidebarOpen') !== 'false',
  );

  useEffect(() => {
    localStorage.setItem('sidebarOpen', isSidebarOpen.toString());
  }, [isSidebarOpen]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-adam-bg-secondary-dark">
        <CircleNotch className="h-8 w-8 animate-spin text-adam-blue" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-dvh overflow-hidden">
        <Sidebar
          isSidebarOpen={isSidebarOpen}
          setIsSidebarOpen={setIsSidebarOpen}
        />
        <Outlet context={{ isSidebarOpen }} />
      </div>
    );
  }

  return (
    <div className="h-dvh overflow-hidden">
      <div className="flex h-dvh transition-all ease-in-out">
        <Sidebar
          isSidebarOpen={isSidebarOpen}
          setIsSidebarOpen={setIsSidebarOpen}
        />
        <div className="relative flex-1 overflow-auto bg-adam-bg-dark">
          {/* Toggle Sidebar Button - Positioned on main content area */}
          {!isMobile && user && (
            <Button
              variant="ghost"
              size="icon"
              className={`bg-adam-neutral-3000 fixed z-10 h-7 w-7 rounded-md text-gray-400 transition-all duration-300 [@media(hover:hover)]:hover:bg-adam-neutral-950 [@media(hover:hover)]:hover:text-adam-neutral-10 ${
                isSidebarOpen ? 'left-[272px]' : 'left-20'
              } ${
                location.pathname === '/' && isSidebarOpen
                  ? 'top-[2.25rem]'
                  : 'top-3.5'
              }`}
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            >
              <SidebarSimple className="h-4 w-4" />
            </Button>
          )}
          <div className="h-full bg-adam-bg-dark">
            <Outlet context={{ isSidebarOpen }} />
          </div>
        </div>
      </div>
    </div>
  );
}
