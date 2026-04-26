/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        s: { 0:"#060709",1:"#0C0E14",2:"#111520",3:"#171C2B",4:"#1D2336",5:"#242B40" },
        gold:   { DEFAULT:"#D4B86A", bright:"#EDD08A", dim:"#8A7240" },
        teal:   { DEFAULT:"#00C9A7", bright:"#00E5C0", dim:"#007D68" },
        rose:   { DEFAULT:"#F0516A", bright:"#FF6B82" },
        amber:  { DEFAULT:"#F5A623" },
        violet: { DEFAULT:"#9B72FF" },
        t:      { 1:"#F0F2F8", 2:"#9BA3BC", 3:"#5A6380", 4:"#343B52" },
      },
      fontFamily: {
        display: ["Syne", "system-ui", "sans-serif"],
        sans:    ["DM Sans", "system-ui", "sans-serif"],
        mono:    ["DM Mono", "monospace"],
      },
      borderRadius: {
        sm: "10px", md: "14px", lg: "20px", xl: "28px", "2xl": "36px",
      },
      boxShadow: {
        "glow-gold": "0 0 30px rgba(212,184,106,0.15), 0 0 60px rgba(212,184,106,0.07)",
        "glow-teal": "0 0 30px rgba(0,201,167,0.15),  0 0 60px rgba(0,201,167,0.07)",
        "glow-rose": "0 0 20px rgba(240,81,106,0.2)",
        "card":      "0 4px 24px rgba(0,0,0,0.35)",
        "card-hover":"0 8px 48px rgba(0,0,0,0.5)",
      },
      animation: {
        shimmer: "shimmer 3s linear infinite",
        "pulse-dot": "pulse-dot 2s ease-in-out infinite",
        float: "float 4s ease-in-out infinite",
        fadeUp: "fadeUp 0.5s ease both",
      },
      backgroundImage: {
        "gold-gradient":  "linear-gradient(135deg, #C9A84C 0%, #E6C96A 40%, #C9A84C 100%)",
        "teal-gradient":  "linear-gradient(135deg, #009980 0%, #00C9A7 100%)",
        "full-gradient":  "linear-gradient(90deg, #D4B86A 0%, #00C9A7 50%, #9B72FF 100%)",
        "hero-mesh":      "radial-gradient(ellipse 80% 50% at 20% -10%, rgba(212,184,106,0.1) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 90% 20%, rgba(0,201,167,0.06) 0%, transparent 55%)",
      },
    },
  },
  plugins: [],
};
