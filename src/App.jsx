import {
  BrowserRouter,
  Navigate,
  Routes,
  Route,
  useLocation,
} from "react-router-dom";
import { useLayoutEffect } from "react";
import Editor from "./pages/Editor";
import BugReport from "./pages/BugReport";
import Templates from "./pages/Templates";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Verify from "./pages/Verify";
import Forgot from "./pages/Forgot";
import Reset from "./pages/Reset";
import Account from "./pages/Account";
import Projects from "./pages/Projects";
import ProjectEditor from "./pages/ProjectEditor";
import AdminUsers from "./pages/AdminUsers";
import AuthContextProvider from "./context/AuthContext";
import {
  RequireAuth,
  RequireAdmin,
  GuestOnly,
} from "./components/Auth/RequireAuth";
import SettingsContextProvider from "./context/SettingsContext";
import NotFound from "./pages/NotFound";
import MigrationBanner, { isLegacyHost } from "./components/MigrationBanner";

export default function App() {
  const routes = (
    <Routes>
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Route>
      <Route path="/verify" element={<Verify />} />
      <Route path="/forgot" element={<Forgot />} />
      <Route path="/reset" element={<Reset />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<ProjectEditor />} />
        <Route path="/account" element={<Account />} />
        <Route path="/editor" element={<Editor />} />
        <Route path="/editor/diagrams/:id" element={<Editor />} />
        <Route path="/editor/templates/:id" element={<Editor />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/bug-report" element={<BugReport />} />
        <Route element={<RequireAdmin />}>
          <Route path="/admin/users" element={<AdminUsers />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );

  return (
    <BrowserRouter>
      <SettingsContextProvider>
        <AuthContextProvider>
          <RestoreScroll />
          {isLegacyHost() ? (
            <div className="h-full flex flex-col">
              <MigrationBanner />
              <div className="flex-1 min-h-0">{routes}</div>
            </div>
          ) : (
            routes
          )}
        </AuthContextProvider>
      </SettingsContextProvider>
    </BrowserRouter>
  );
}

function RestoreScroll() {
  const location = useLocation();
  useLayoutEffect(() => {
    window.scroll(0, 0);
  }, [location.pathname]);
  return null;
}
