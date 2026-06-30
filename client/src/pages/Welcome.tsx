import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Eye, EyeOff, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface WelcomeProps {
  onConnected: (credentials: { token: string; accountId: string }) => void;
}

export default function Welcome({ onConnected }: WelcomeProps) {
  const [token, setToken] = useState("");
  const [accountId, setAccountId] = useState("");
  const [environment, setEnvironment] = useState<"practice" | "live">("practice");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [showToken, setShowToken] = useState(false);

  const validateMutation = trpc.bot.validateCredentials.useMutation({
    onSuccess: (data) => {
      if (data.valid) {
        const resolvedId = (data as any).resolvedAccountId ?? accountId;
        localStorage.setItem("oanda_credentials", JSON.stringify({ token, accountId: resolvedId }));
        localStorage.setItem("oanda_env", environment);
        setSuccess(true);
        setTimeout(() => onConnected({ token, accountId: resolvedId }), 900);
      } else {
        setError(data.error ?? "Invalid credentials. Check your token and account ID.");
        setLoading(false);
      }
    },
    onError: (err) => {
      setError(err.message ?? "Connection failed. Please try again.");
      setLoading(false);
    },
  });

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!token.trim() || !accountId.trim()) {
      setError("Please enter both API token and account ID.");
      return;
    }
    setLoading(true);
    validateMutation.mutate({ token: token.trim(), accountId: accountId.trim(), environment });
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-5 relative overflow-hidden"
      style={{
        background: "linear-gradient(135deg, #050c1a 0%, #0a1628 50%, #0d1f3a 100%)",
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 20px)",
      }}>

      {/* Background glow orbs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-72 h-72 rounded-full opacity-20"
          style={{ background: "radial-gradient(circle, #f5a623 0%, transparent 70%)" }} />
        <div className="absolute bottom-[-10%] right-[-10%] w-64 h-64 rounded-full opacity-10"
          style={{ background: "radial-gradient(circle, #448aff 0%, transparent 70%)" }} />
      </div>

      <div className="w-full max-w-sm relative z-10">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl mb-5 shadow-2xl"
            style={{ background: "linear-gradient(135deg, #f5a623, #e8940f)", boxShadow: "0 0 40px #f5a62340" }}>
            <span className="text-3xl">⚡</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight mb-1" style={{ color: "#f5f0e8" }}>Neveqo</h1>
          <p className="text-sm font-medium" style={{ color: "#4a6080" }}>Autonomous Forex Trading</p>
        </div>

        {/* Environment selector */}
        <div className="mb-6">
          <div className="flex rounded-2xl overflow-hidden p-1"
            style={{ background: "#0c1525", border: "1px solid #1a2d45" }}>
            {(["practice", "live"] as const).map((env) => (
              <button key={env} type="button" onClick={() => setEnvironment(env)}
                className="flex-1 py-3 text-sm font-bold rounded-xl transition-all duration-200"
                style={{
                  background: environment === env
                    ? env === "live" ? "linear-gradient(135deg, #c0392b, #e74c3c)" : "linear-gradient(135deg, #f5a623, #e8940f)"
                    : "transparent",
                  color: environment === env ? (env === "live" ? "#fff" : "#060d18") : "#4a6080",
                  boxShadow: environment === env ? "0 4px 15px rgba(0,0,0,0.3)" : "none",
                }}>
                {env === "live" ? "🔴 LIVE" : "🟡 PRACTICE"}
              </button>
            ))}
          </div>
          {environment === "live" && (
            <p className="text-xs mt-2 text-center font-medium" style={{ color: "#e74c3c" }}>
              ⚠ Real money — trade responsibly
            </p>
          )}
        </div>

        {/* Form card */}
        <div className="rounded-3xl p-6 mb-4"
          style={{ background: "rgba(12, 21, 37, 0.8)", border: "1px solid #1a2d45", backdropFilter: "blur(20px)" }}>

          <form onSubmit={handleConnect} className="space-y-4">
            {/* Token input */}
            <div>
              <label className="block text-xs font-bold mb-2 tracking-widest uppercase" style={{ color: "#4a6080" }}>
                API Token
              </label>
              <div className="relative">
                <input
                  type={showToken ? "text" : "password"}
                  placeholder="Paste your OANDA API token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  disabled={loading || success}
                  className="w-full rounded-xl px-4 py-3.5 pr-12 text-sm font-mono outline-none transition-all"
                  style={{
                    background: "#060d18",
                    border: `1px solid ${token ? "#f5a62344" : "#1a2d45"}`,
                    color: "#f5f0e8",
                    fontSize: 13,
                  }}
                />
                <button type="button" onClick={() => setShowToken(!showToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1"
                  style={{ color: "#4a6080" }}>
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs mt-1.5" style={{ color: "#2a4060" }}>
                hub.oanda.com → Tools → API → Generate
              </p>
            </div>

            {/* Account ID input */}
            <div>
              <label className="block text-xs font-bold mb-2 tracking-widest uppercase" style={{ color: "#4a6080" }}>
                Account ID
              </label>
              <input
                type="text"
                placeholder="e.g. 101-004-12345678-001"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                disabled={loading || success}
                className="w-full rounded-xl px-4 py-3.5 text-sm font-mono outline-none transition-all"
                style={{
                  background: "#060d18",
                  border: `1px solid ${accountId ? "#f5a62344" : "#1a2d45"}`,
                  color: "#f5f0e8",
                  fontSize: 13,
                }}
              />
              <p className="text-xs mt-1.5" style={{ color: "#2a4060" }}>
                HUB → Accounts → v20 Account Number
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-3 rounded-xl p-3"
                style={{ background: "#2d0a0a", border: "1px solid #c0392b44" }}>
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "#e74c3c" }} />
                <p className="text-xs font-mono leading-relaxed" style={{ color: "#ff8a80" }}>{error}</p>
              </div>
            )}

            {/* Success */}
            {success && (
              <div className="flex items-center gap-3 rounded-xl p-3"
                style={{ background: "#0a2d1a", border: "1px solid #00e67644" }}>
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: "#00e676" }} />
                <p className="text-xs font-mono" style={{ color: "#69f0ae" }}>Connected! Loading dashboard...</p>
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={loading || success || !token.trim() || !accountId.trim()}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-black text-sm tracking-wide transition-all duration-200 active:scale-95 disabled:opacity-40"
              style={{
                background: success ? "linear-gradient(135deg, #00c853, #00e676)"
                  : "linear-gradient(135deg, #f5a623, #e8940f)",
                color: "#060d18",
                boxShadow: "0 8px 30px rgba(245, 166, 35, 0.3)",
              }}>
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Verifying...</>
              ) : success ? (
                <><CheckCircle2 className="w-4 h-4" />Connected</>
              ) : (
                <>Connect {environment === "live" ? "Live" : "Practice"} Account <ChevronRight className="w-4 h-4" /></>
              )}
            </button>
          </form>
        </div>

        {/* Footer note */}
        <p className="text-center text-xs" style={{ color: "#2a4060" }}>
          🔒 Credentials stored locally on this device only
        </p>
      </div>
    </div>
  );
}
