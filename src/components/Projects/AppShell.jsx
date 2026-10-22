import { useEffect } from "react";
import { useThemedPage } from "../../hooks";
import ProjectsHeader from "./ProjectsHeader";

export default function AppShell({ children }) {
  useThemedPage();
  useEffect(() => {
    document.body.setAttribute("class", "theme");
  }, []);

  return (
    <div className="min-h-screen p-6 max-w-5xl mx-auto">
      <ProjectsHeader />
      {children}
    </div>
  );
}
