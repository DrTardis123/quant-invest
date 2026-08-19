import Link from "next/link";

const items = [
  { href: "/", label: "Home" },
  { href: "/stocks", label: "Stocks" },
  { href: "/factors", label: "Factors" },
  { href: "/backtest", label: "Backtest" },
  { href: "/signals", label: "Signals" },
];

export default function Nav() {
  return (
    <nav className="border-b border-gray-800 bg-bg-card">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
        <Link href="/" className="text-lg font-semibold text-accent-blue">
          KOSPI 200
          <span className="ml-2 text-sm font-normal text-ink-dim">Factor Lab</span>
        </Link>
        <ul className="flex gap-1">
          {items.slice(1).map((it) => (
            <li key={it.href}>
              <Link
                href={it.href}
                className="rounded-md px-3 py-1.5 text-sm text-ink-dim transition hover:bg-bg-elev hover:text-ink"
              >
                {it.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="ml-auto text-xs text-ink-faint">13팩터 · train 2020-22 / test 2023-25</div>
      </div>
    </nav>
  );
}
