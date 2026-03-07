import { invoke } from "@tauri-apps/api/core";

export default function LoginView({ sessionExpired = false }) {
  return (
    <div className="min-h-screen bg-background-dark text-slate-100 flex items-center justify-center overflow-hidden">
      {/* Ambient background */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-background-dark/80 bg-glow" />
      </div>

      <main className="relative z-10 w-full max-w-md px-6">
        {sessionExpired && (
          <div className="mb-4 flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm px-4 py-3 rounded-lg">
            <span className="material-symbols-outlined text-base">warning</span>
            <span>Your session has expired. Please log in again.</span>
          </div>
        )}
        <div className="glass-panel p-8 rounded-xl shadow-2xl flex flex-col gap-8">
          {/* Logo / Header */}
          <div className="flex flex-col items-center text-center gap-2">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-2 border border-primary/20 bg-primary/10">
              <span className="material-symbols-outlined text-primary text-4xl">
                keyboard_alt
              </span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">MoErgo Login</h1>
            <p className="text-slate-400 text-sm">
              Welcome back to your ergonomic workspace
            </p>
          </div>

          {/* Login button */}
          <button
            type="button"
            onClick={() => invoke("open_login")}
            className="w-full bg-primary hover:bg-primary/90 text-background-dark font-bold py-4 rounded-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-lg shadow-primary/20 cursor-pointer"
          >
            <span>Login with MoErgo</span>
            <span className="material-symbols-outlined">login</span>
          </button>
        </div>

        {/* Footer links */}
        <div className="mt-8 flex justify-center gap-6 text-slate-500 text-xs uppercase tracking-widest font-medium">
          <a href="#" className="hover:text-primary transition-colors">Support</a>
          <span className="text-slate-700">•</span>
          <a href="#" className="hover:text-primary transition-colors">Privacy</a>
          <span className="text-slate-700">•</span>
          <a href="#" className="hover:text-primary transition-colors">Terms</a>
        </div>
      </main>
    </div>
  );
}
