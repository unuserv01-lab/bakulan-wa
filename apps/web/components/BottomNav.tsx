"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Beranda", icon: "⌂" },
  { href: "/chat", label: "Chat", icon: "💬" },
  { href: "/persona", label: "Persona", icon: "🤖" },
  { href: "/saldo", label: "Saldo", icon: "👛" },
];

export default function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="bottom-nav" aria-label="Navigasi utama">
      {ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={pathname === item.href ? "nav-item active" : "nav-item"}
        >
          <span className="nav-icon" aria-hidden="true">{item.icon}</span>
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
