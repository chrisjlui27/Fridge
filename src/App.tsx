import { Component, type ReactNode } from "react";
import { Link, Navigate, NavLink, Outlet, Route, Routes } from "react-router-dom";
import { SessionProvider, useSession } from "./lib/session";
import { errorData } from "./lib/errors";
import { safeSet } from "./lib/storage";
import { Avatar } from "./components/Avatar";
import { DoorPage } from "./pages/Door";
import { ListDetailPage, ListsPage, OwnersPage } from "./pages/Lists";
import { JobsPage } from "./pages/Jobs";
import { ThanksPage } from "./pages/Thanks";
import { MePage } from "./pages/Me";
import { FamilyPage } from "./pages/Family";
import { WallPage } from "./pages/Wall";
import { CalendarPage } from "./pages/Calendar";
import { ArtPage } from "./pages/Art";
import { UpdateBanner } from "./components/UpdateBanner";

export function App() {
  return (
    <ErrorBoundary>
      <UpdateBanner />
      <SessionProvider>
        <Routes>
          <Route path="/wall" element={<WallPage />} />
          <Route element={<Shell />}>
            <Route index element={<Home />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="art" element={<ArtPage />} />
            <Route path="lists" element={<ListsPage />} />
            <Route path="lists/:listId" element={<ListDetailPage />} />
            <Route path="owners" element={<OwnersPage />} />
            <Route path="jobs" element={<JobsPage />} />
            <Route path="thanks" element={<ThanksPage />} />
            <Route path="me" element={<MePage />} />
            <Route path="family" element={<FamilyPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </SessionProvider>
    </ErrorBoundary>
  );
}

function Home() {
  const { isWall } = useSession();
  return isWall ? <Navigate to="/wall" replace /> : <DoorPage />;
}

function Shell() {
  const { who, viewer, isWall, requestActor } = useSession();
  const tabs = [
    { to: isWall ? "/wall" : "/", label: isWall ? "Wall" : "Door", icon: "🧲" },
    { to: "/calendar", label: "Calendar", icon: "📅" },
    { to: "/lists", label: "Lists", icon: "🛒" },
    { to: "/jobs", label: "Jobs", icon: "✅" },
    { to: "/thanks", label: "Thanks", icon: "💛" },
    { to: "/me", label: "Me", icon: "🙂" },
  ];
  return (
    <div className="app">
      <header className="topbar">
        <Link to={isWall ? "/wall" : "/"} className="brand">
          <span className="brand-magnet" aria-hidden />
          {who.household.name}
        </Link>
        {viewer ? (
          <Link to="/me" className="topbar-me" aria-label="Me">
            <Avatar member={viewer} size={32} />
          </Link>
        ) : (
          <button className="btn small" onClick={() => void requestActor()}>
            Tap in
          </button>
        )}
      </header>
      <main className="content">
        <Outlet />
      </main>
      <nav className="tabbar" aria-label="Main">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to === "/"} className={({ isActive }) => `tab${isActive ? " on" : ""}`}>
            <span className="tab-icon" aria-hidden>
              {t.icon}
            </span>
            <span>{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  componentDidCatch() {
    // Nobody is standing at the kitchen wall to press "Reload".
    if (window.location.pathname.startsWith("/wall")) {
      window.setTimeout(() => window.location.reload(), 30_000);
    }
  }
  render() {
    if (!this.state.error) return this.props.children;
    const { code, message } = errorData(this.state.error);
    if (code === "SIGNED_OUT") {
      safeSet("fridge.session", null);
      window.location.replace("/");
      return null;
    }
    return (
      <div className="welcome">
        <div className="welcome-card">
          <h1>Oops</h1>
          <p>{message}</p>
          <button className="btn primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
