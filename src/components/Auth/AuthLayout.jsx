import { useEffect } from "react";
import { Link } from "react-router-dom";
import logo_light from "../../assets/logo_light_160.png";
import logo_dark from "../../assets/logo_dark_160.png";
import { useThemedPage } from "../../hooks";

export default function AuthLayout({ title, children }) {
  const theme = localStorage.getItem("theme") || "light";
  useThemedPage();
  useEffect(() => {
    document.body.setAttribute("class", "theme");
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      <Link to="/">
        <img
          src={theme === "dark" ? logo_dark : logo_light}
          alt="logo"
          className="h-[42px] mb-6"
        />
      </Link>
      <div className="card-theme rounded-md p-6 w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">{title}</h1>
        {children}
      </div>
    </div>
  );
}
