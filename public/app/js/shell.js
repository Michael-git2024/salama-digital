// Shared workspace shell: renders sidebar, mobile drawer, top navbar, and footer disclaimer.
(function () {
  const NAV_ITEMS = [
    { id: 'overview', label: 'Overview Dashboard', href: '/app/index.html', icon: 'layout-dashboard', roles: 'internal' },
    { id: 'dashboard-police', label: 'Police/DCI Dashboard', href: '/dashboard/police.html', icon: 'shield', roles: ['police_dci_focal_person'] },
    { id: 'dashboard-court', label: 'Court/ODPP Dashboard', href: '/dashboard/court.html', icon: 'scale', roles: ['court_odpp_focal_person'] },
    { id: 'records', label: 'Research Records', href: '/app/records.html', icon: 'database', roles: 'internal' },
    { id: 'fieldwork', label: 'Fieldwork Dashboard', href: '/app/fieldwork.html', icon: 'clipboard-check', roles: 'internal' },
    { id: 'abstraction', label: 'Admin Abstraction', href: '/app/abstraction.html', icon: 'file-plus-2', roles: 'internal' },
    { id: 'directory', label: 'Service & Referral Map', href: '/app/directory.html', icon: 'map-pin', roles: 'internal' },
    { id: 'readiness', label: 'Institutional Readiness', href: '/app/readiness.html', icon: 'shield-check', roles: 'internal' },
    { id: 'reports', label: 'Evidence & Reports', href: '/app/reports.html', icon: 'file-bar-chart', roles: 'all' },
    { id: 'users', label: 'User Management', href: '/app/users.html', icon: 'users', roles: 'internal' },
  ];

  // Institutional partners (Police/DCI, Court/ODPP) see only their dashboard + Evidence/Reports.
  function visibleNavItems(role) {
    const isPartner = role === 'police_dci_focal_person' || role === 'court_odpp_focal_person';
    return NAV_ITEMS.filter((item) =>
      item.roles === 'all' ? true :
      isPartner ? Array.isArray(item.roles) && item.roles.includes(role) :
      item.roles === 'internal');
  }

  async function currentUserRole() {
    try {
      const me = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!me.ok) return null;
      return (await me.json()).role || null;
    } catch { return null; }
  }

  const SECONDARY_ITEMS = [
    { id: 'about', label: 'About Beyond Reporting', href: '/app/about.html', icon: 'info' },
  ];

  function buildNavLinks(activeId, items) {
    const linkHtml = (item) => {
      const isActive = item.id === activeId;
      const cls = isActive
        ? 'bg-white/[0.08] text-white font-semibold border-l-[3px] border-l-[#F27C22] pl-3'
        : 'text-slate-300 hover:bg-white/[0.06] hover:text-white border-l-[3px] border-l-transparent pl-3';
      return `<a href="${item.href}" class="flex items-center gap-3 pr-3.5 py-2.5 rounded-r-lg text-sm transition-all duration-200 ${cls}">
        <i data-lucide="${item.icon}" class="w-4 h-4 shrink-0${isActive ? ' text-[#F27C22]' : ''}"></i>
        <span>${item.label}</span>
      </a>`;
    };

    return `
      <div class="space-y-0.5">
        <p class="px-3.5 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">Workspace Modules</p>
        ${items.map(linkHtml).join('')}
      </div>
      <div class="mt-6 pt-4 border-t border-white/10 space-y-0.5">
        <p class="px-3.5 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">Study &amp; Governance</p>
        ${SECONDARY_ITEMS.map(linkHtml).join('')}
      </div>
    `;
  }

  window.initSalamaShell = async function ({ activeId, breadcrumb, pageTitle }) {
    const appShell = document.getElementById('salama-shell');
    if (!appShell) return;
    const role = await currentUserRole();
    const items = visibleNavItems(role);
    const linkFor = (id) => NAV_ITEMS.find((n) => n.id === id);

    const mainContent = appShell.innerHTML;

    appShell.className = 'min-h-screen flex bg-[#F8FAFC] text-[#0D2757] font-sans';
    appShell.innerHTML = `
      <!-- Desktop Sidebar -->
      <aside class="hidden lg:flex lg:flex-col w-[272px] bg-[#0D2757] text-white shrink-0 border-r border-[#0a1e45]">
        <div class="px-5 py-5 border-b border-white/10 flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-[#56B847] flex items-center justify-center shadow-md">
            <span class="text-[#0D2757] font-black text-sm tracking-tight">S+</span>
          </div>
          <div>
            <div class="text-[15px] font-bold tracking-tight text-white leading-tight">Salama Digital</div>
            <div class="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">Beyond Reporting</div>
          </div>
        </div>

        <nav class="flex-1 px-2 py-5 overflow-y-auto" aria-label="Workspace navigation">
          ${buildNavLinks(activeId, items)}
        </nav>

        <div class="p-4 space-y-3.5 border-t border-white/10">
          <div class="rounded-lg bg-white/[0.05] border border-white/10 p-3">
            <div class="flex items-center gap-1.5 text-[11px] font-bold text-[#56B847] uppercase tracking-wider">
              <i data-lucide="lock" class="w-3 h-3"></i>
              <span>Privacy first</span>
            </div>
            <p class="mt-1 text-[11px] leading-relaxed text-slate-400">
              Research data access is restricted. This MVP is for synthetic or approved non-sensitive records only.
            </p>
          </div>
          <div class="flex items-center gap-3 px-1">
            <div class="w-9 h-9 rounded-full bg-[#F27C22] text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-sm">
              AD
            </div>
            <div class="min-w-0">
              <div class="text-sm font-semibold text-white truncate">digitalsalama9@gmail.com</div>
              <div class="text-[11px] text-slate-400 truncate">administrator</div>
            </div>
          </div>
        </div>
      </aside>

      <!-- Mobile Drawer Backdrop -->
      <div id="mobile-backdrop" class="fixed inset-0 bg-slate-900/60 z-40 hidden lg:hidden backdrop-blur-sm"></div>

      <!-- Mobile Sidebar Drawer -->
      <aside id="mobile-drawer" class="fixed inset-y-0 left-0 w-72 bg-[#0D2757] text-white z-50 transform -translate-x-full transition-transform duration-200 lg:hidden flex flex-col">
        <div class="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-lg bg-[#56B847] flex items-center justify-center">
              <span class="text-[#0D2757] font-black text-xs">S+</span>
            </div>
            <div>
              <div class="text-sm font-bold text-white">Salama Digital</div>
              <div class="text-[10px] uppercase tracking-widest text-slate-400">Beyond Reporting</div>
            </div>
          </div>
          <button id="close-mobile-menu" class="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10" aria-label="Close menu">
            <i data-lucide="x" class="w-5 h-5"></i>
          </button>
        </div>
        <nav class="flex-1 px-2 py-4 overflow-y-auto">
          ${buildNavLinks(activeId, items)}
        </nav>
      </aside>

      <!-- Main Column -->
      <div class="flex-1 flex flex-col min-w-0">
        <!-- Top Navbar -->
        <header class="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200/80 px-4 sm:px-8 h-14 flex items-center justify-between gap-4">
          <div class="flex items-center gap-3 min-w-0">
            <button id="open-mobile-menu" class="lg:hidden p-2 rounded-lg border border-slate-200 text-[#0D2757] hover:bg-slate-50" aria-label="Open menu">
              <i data-lucide="menu" class="w-5 h-5"></i>
            </button>
            <div class="flex items-center gap-2 text-sm truncate">
              <span class="text-slate-400 hidden sm:inline">Beyond Reporting</span>
              <span class="text-slate-300 hidden sm:inline">/</span>
              <span class="font-semibold text-[#0D2757] truncate">${breadcrumb || pageTitle}</span>
            </div>
          </div>

          <div class="flex items-center gap-2 sm:gap-2.5 shrink-0">
            <div class="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#0D2757]/5 border border-[#0D2757]/10 text-xs font-medium text-[#0D2757]">
              <span class="w-2 h-2 rounded-full bg-[#56B847] animate-pulse"></span>
              <span>Research workspace</span>
            </div>
            <a href="/app/login.html" class="px-3 py-1.5 rounded-lg border border-slate-300 text-[#0D2757] text-xs font-semibold hover:bg-slate-50 transition-colors">
              Sign in
            </a>
            <a href="/app/login.html" class="px-3 py-1.5 rounded-lg bg-[#0D2757] text-white text-xs font-semibold hover:bg-[#163a7a] transition-colors shadow-sm">
              Sign out
            </a>
          </div>
        </header>

        <!-- Page Content -->
        <main class="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto">
          ${mainContent}
        </main>

        <!-- Disclaimer Footer -->
        <footer class="bg-white border-t border-slate-200/80 px-4 sm:px-8 py-3.5 mt-auto">
          <div class="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[11px] text-slate-500">
            <p class="flex items-center gap-2">
              <i data-lucide="info" class="w-3.5 h-3.5 text-slate-400 shrink-0"></i>
              <span>Salama Digital is a secure research workspace. It is not a public case-reporting portal or clinical record system.</span>
            </p>
            <span class="text-slate-400 shrink-0">&copy; 2025 Beyond Reporting &bull; Mombasa &amp; Kilifi</span>
          </div>
        </footer>
      </div>
    `;

    // Mobile drawer handlers
    const drawer = document.getElementById('mobile-drawer');
    const backdrop = document.getElementById('mobile-backdrop');
    const openBtn = document.getElementById('open-mobile-menu');
    const closeBtn = document.getElementById('close-mobile-menu');

    function toggleDrawer(open) {
      if (!drawer || !backdrop) return;
      drawer.classList.toggle('-translate-x-full', !open);
      backdrop.classList.toggle('hidden', !open);
    }

    openBtn?.addEventListener('click', () => toggleDrawer(true));
    closeBtn?.addEventListener('click', () => toggleDrawer(false));
    backdrop?.addEventListener('click', () => toggleDrawer(false));

    if (window.lucide) {
      window.lucide.createIcons();
    }
  };
})();
