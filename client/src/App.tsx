import { Routes, Route, Navigate } from "react-router-dom";
import Dashboard from "./pages/Dashboard.tsx";
import Watchlist from "./pages/Watchlist.tsx";
import Settings from "./pages/Settings.tsx";
import Collection from "./pages/Collection.tsx";
import Portfolio from "./pages/Portfolio.tsx";
import Login from "./pages/Login.tsx";

/**
 * Route guard — redirects unauthenticated users to /login.
 * Checks for the presence of the JWT in localStorage (existence only,
 * not validity — invalid tokens will be caught by the server and
 * trigger a redirect via the axios interceptor in lib/api.ts).
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("token");
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/watchlist"
        element={
          <RequireAuth>
            <Watchlist />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <Settings />
          </RequireAuth>
        }
      />
      <Route
        path="/collection"
        element={
          <RequireAuth>
            <Collection />
          </RequireAuth>
        }
      />
      <Route
        path="/portfolio"
        element={
          <RequireAuth>
            <Portfolio />
          </RequireAuth>
        }
      />
      {/* Catch-all → dashboard */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
