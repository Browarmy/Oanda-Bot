import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
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

  const validateMutation = trpc.bot.validateCredentials.useMutation({
    onSuccess: (data) => {
      if (data.valid) {
        // Use the resolved account ID (with correct dashes) if returned
        const resolvedId = (data as any).resolvedAccountId ?? accountId;
        localStorage.setItem("oanda_credentials", JSON.stringify({ token, accountId: resolvedId }));
        localStorage.setItem("oanda_env", environment);
        setSuccess(true);
        setTimeout(() => onConnected({ token, accountId: resolvedId }), 800);
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
    <div className="min-h-screen bg-black text-amber-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-slate-900 border-amber-900/30">
        <div className="p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="text-4xl font-bold text-amber-400 mb-2 font-mono">⚡ OANDA BOT</div>
            <p className="text-amber-100/70 text-sm font-mono">Real-Time Algorithmic Trading</p>
          </div>

          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold text-amber-50 mb-1">Connect Account</h1>
            <p className="text-amber-100/60 text-sm">Enter your OANDA credentials to start trading</p>
          </div>

          <form onSubmit={handleConnect} className="space-y-5">
            {/* Environment Toggle */}
            <div>
              <label className="block text-amber-100/70 text-xs font-mono mb-2 uppercase tracking-widest">
                Account Type
              </label>
              <div className="flex rounded-md overflow-hidden border border-amber-900/40">
                <button
                  type="button"
                  onClick={() => setEnvironment("practice")}
                  className={`flex-1 py-2.5 text-sm font-mono font-bold transition-colors ${
                    environment === "practice"
                      ? "bg-amber-600 text-black"
                      : "bg-slate-800 text-amber-100/50 hover:bg-slate-700"
                  }`}
                >
                  PRACTICE
                </button>
                <button
                  type="button"
                  onClick={() => setEnvironment("live")}
                  className={`flex-1 py-2.5 text-sm font-mono font-bold transition-colors ${
                    environment === "live"
                      ? "bg-red-600 text-white"
                      : "bg-slate-800 text-amber-100/50 hover:bg-slate-700"
                  }`}
                >
                  LIVE
                </button>
              </div>
              {environment === "live" && (
                <p className="text-red-400 text-xs mt-1.5 font-mono">
                  ⚠️ Live trading uses real money. Ensure you understand the risks.
                </p>
              )}
            </div>

            {/* Token Input */}
            <div>
              <label className="block text-amber-100/70 text-xs font-mono mb-2 uppercase tracking-widest">
                API Token
              </label>
              <Input
                type="password"
                placeholder="Enter your OANDA API token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={loading || success}
                className="bg-slate-800 border-amber-900/30 text-amber-50 placeholder-amber-900/50 font-mono text-sm"
              />
              <p className="text-amber-900/50 text-xs mt-1 font-mono">
                OANDA → My Account → Manage API Access → Generate Token
              </p>
            </div>

            {/* Account ID Input */}
            <div>
              <label className="block text-amber-100/70 text-xs font-mono mb-2 uppercase tracking-widest">
                Account ID
              </label>
              <Input
                type="text"
                placeholder="e.g., 101-004-12345678-001"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                disabled={loading || success}
                className="bg-slate-800 border-amber-900/30 text-amber-50 placeholder-amber-900/50 font-mono text-sm"
              />
              <p className="text-amber-900/50 text-xs mt-1 font-mono">
                OANDA dashboard → account selector (include dashes)
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-3 p-3 bg-red-950/30 border border-red-900/50 rounded">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-red-200 text-sm font-mono">{error}</p>
              </div>
            )}

            {/* Success */}
            {success && (
              <div className="flex items-start gap-3 p-3 bg-green-950/30 border border-green-900/50 rounded">
                <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                <p className="text-green-200 text-sm font-mono">Connected! Loading dashboard...</p>
              </div>
            )}

            {/* Submit */}
            <Button
              type="submit"
              disabled={loading || success || !token.trim() || !accountId.trim()}
              className="w-full bg-amber-600 hover:bg-amber-700 text-black font-bold font-mono py-2 h-11"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Verifying...</>
              ) : success ? (
                <><CheckCircle2 className="w-4 h-4 mr-2" />Connected</>
              ) : (
                `Connect ${environment === "live" ? "Live" : "Practice"} Account`
              )}
            </Button>
          </form>

          <div className="mt-6 pt-5 border-t border-amber-900/30">
            <p className="text-amber-900/60 text-xs font-mono text-center mb-2">
              🔒 Credentials stored locally on this device only
            </p>
            <div className="space-y-1 text-amber-900/50 text-xs font-mono">
              <p>• Never share your API token</p>
              <p>• Use practice account for testing</p>
              <p>• Validation runs server-side — no CORS issues</p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
