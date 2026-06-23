export default function LotusFlower({
  active,
  progress,
}: {
  active: boolean;
  progress: number;
}) {
  return (
    <div className="relative w-32 h-32 flex items-center justify-center mx-auto mb-4 animate-float">
      {/* Glow behind the lotus */}
      <div
        className={`absolute inset-4 rounded-full blur-2xl transition-all duration-1000 ${
          active
            ? "bg-teal-500/25 shadow-[0_0_40px_rgba(20,184,166,0.4)] animate-pulse"
            : "bg-amber-500/[0.04] shadow-[0_0_20px_rgba(234,179,8,0.05)]"
        }`}
      />

      {/* Orbit Ring */}
      <svg
        className={`absolute inset-0 w-full h-full ${
          active ? "animate-spin" : "animate-pulse"
        }`}
        style={{ animationDuration: active ? "12s" : "4s" }}
        viewBox="0 0 100 100"
      >
        <circle
          className="text-slate-800/40"
          strokeWidth="1.5"
          stroke="currentColor"
          fill="transparent"
          r="44"
          cx="50"
          cy="50"
        />
        {active && (
          <circle
            className="text-teal-400/80 transition-all duration-300"
            strokeWidth="2"
            strokeDasharray={276.46}
            strokeDashoffset={276.46 - (276.46 * progress) / 100}
            strokeLinecap="round"
            stroke="currentColor"
            fill="transparent"
            r="44"
            cx="50"
            cy="50"
          />
        )}
      </svg>

      {/* Lotus Petals SVG */}
      <svg
        className={`w-16 h-16 transition-all duration-1000 ${
          active
            ? "text-teal-400 scale-105"
            : "text-slate-500 hover:text-teal-300"
        }`}
        viewBox="0 0 100 100"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        {/* Base leaves */}
        <path
          d="M50 78 C35 78, 25 72, 25 65 C25 58, 35 55, 50 55 C65 55, 75 58, 75 65 C75 72, 65 78, 50 78 Z"
          fill="currentColor"
          fillOpacity="0.05"
        />

        {/* Outer Petals */}
        <path
          d="M50 80 C15 70, 10 40, 50 20 C90 40, 85 70, 50 80 Z"
          fill="currentColor"
          fillOpacity={active ? 0.12 : 0.03}
        />

        {/* Left/Right Petals */}
        <path
          d="M50 80 C20 75, 20 45, 50 35 C80 45, 80 75, 50 80 Z"
          fill="currentColor"
          fillOpacity={active ? 0.1 : 0.02}
        />

        {/* Center Petals */}
        <path
          d="M50 80 C32 75, 32 50, 50 42 C68 50, 68 75, 50 80 Z"
          fill="currentColor"
          fillOpacity={active ? 0.18 : 0.04}
        />

        {/* Core Bud */}
        <path
          d="M50 80 C40 75, 40 60, 50 50 C60 60, 60 75, 50 80 Z"
          fill="currentColor"
          fillOpacity={active ? 0.3 : 0.08}
          strokeWidth="2"
        />
      </svg>
    </div>
  );
}
