interface HeaderProps {
  googleIdToken: string | null;
  userEmail: string | null;
}

export default function Header({ googleIdToken, userEmail }: HeaderProps) {
  return (
    <header className="border-b border-slate-900/60 bg-[#060913]/70 backdrop-blur-md sticky top-0 z-50 transition-all duration-300">
      <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-2xl bg-[#0c1220] border border-slate-900 flex items-center justify-center shadow-md relative group overflow-hidden">
            <div className="absolute inset-0 bg-teal-500/5 group-hover:bg-teal-500/10 transition-colors duration-500" />
            <svg
              className="w-6 h-6 text-teal-400/90 relative z-10 transition-transform duration-700 group-hover:rotate-180"
              viewBox="0 0 100 100"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path
                d="M50 82 C25 72, 20 45, 50 25 C80 45, 75 72, 50 82 Z"
                fill="currentColor"
                fillOpacity="0.1"
              />
              <path
                d="M50 82 C35 77, 35 55, 50 45 C65 55, 65 77, 50 82 Z"
                fill="currentColor"
                fillOpacity="0.2"
              />
            </svg>
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-display font-bold tracking-wide text-slate-100 flex items-center gap-2">
              <span>MINGHUI INSIGHTS</span>
              <span className="text-2xs font-mono px-2 py-0.5 rounded-md bg-teal-500/10 text-teal-400 border border-teal-500/15 uppercase font-medium tracking-widest">
                TH
              </span>
            </h1>
            <p className="text-3xs sm:text-2xs text-slate-400 font-sans tracking-wide">
              ระบบสืบค้นข้อมูลและแปลถอดความบทความสัจธรรมธรรมปฏิบัติฝึกสมาธิ
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {googleIdToken && (
            <div className="hidden sm:flex items-center gap-2 bg-[#0c1220]/60 border border-slate-900 px-3.5 py-1.5 rounded-xl text-3xs font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-opacity" />
              <span className="text-slate-300 max-w-[140px] truncate">
                {userEmail}
              </span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
