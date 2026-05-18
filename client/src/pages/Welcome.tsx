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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (!token.trim() || !accountId.trim()) {
        throw new Error("Please enter both API token and account ID");
      }

      // Validate credentials by attempting to fetch account info
      const response = await fetch(
        `https://api-fxpractice.oanda.com/v3/accounts/${accountId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Accept-Encoding": "identity",
          },
        }
      );

      if (!response.ok) {
        throw new Error("Invalid credentials. Please check your token and account ID.");
      }

      // Store credentials securely in localStorage
      localStorage.setItem(
        "oanda_credentials",
        JSON.stringify({ token, accountId })
      );

      setSuccess(true);
      setTimeout(() => {
        onConnected({ token, accountId });
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-amber-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-slate-900 border-amber-900/30">
        <div className="p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="text-4xl font-bold text-amber-400 mb-2 font-mono">
              ⚡ OANDA BOT
            </div>
            <p className="text-amber-100/70 text-sm font-mono">
              Real-Time Algorithmic Trading
            </p>
          </div>

          {/* Welcome Message */}
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold text-amber-50 mb-2">Welcome</h1>
            <p className="text-amber-100/60 text-sm">
              Connect your OANDA account to start trading
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleConnect} className="space-y-6">
            {/* Token Input */}
            <div>
              <label className="block text-amber-100/70 text-xs font-mono mb-2">
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
                Get your token from OANDA → Account Settings → API Access
              </p>
            </div>

            {/* Account ID Input */}
            <div>
              <label className="block text-amber-100/70 text-xs font-mono mb-2">
                Account ID
              </label>
              <Input
                type="text"
                placeholder="e.g., 123456789"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                disabled={loading || success}
                className="bg-slate-800 border-amber-900/30 text-amber-50 placeholder-amber-900/50 font-mono text-sm"
              />
              <p className="text-amber-900/50 text-xs mt-1 font-mono">
                Found in OANDA Account Settings
              </p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="flex items-start gap-3 p-3 bg-red-950/30 border border-red-900/50 rounded">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-red-200 text-sm font-mono">{error}</p>
              </div>
            )}

            {/* Success Message */}
            {success && (
              <div className="flex items-start gap-3 p-3 bg-green-950/30 border border-green-900/50 rounded">
                <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                <p className="text-green-200 text-sm font-mono">
                  Connected! Loading dashboard...
                </p>
              </div>
            )}

            {/* Connect Button */}
            <Button
              type="submit"
              disabled={loading || success || !token.trim() || !accountId.trim()}
              className="w-full bg-amber-600 hover:bg-amber-700 text-black font-bold font-mono py-2 h-10"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : success ? (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Connected
                </>
              ) : (
                "Connect Account"
              )}
            </Button>
          </form>

          {/* Info Section */}
          <div className="mt-8 pt-6 border-t border-amber-900/30">
            <p className="text-amber-900/60 text-xs font-mono text-center mb-3">
              🔒 Your credentials are stored locally on this device only
            </p>
            <div className="space-y-2 text-amber-900/50 text-xs font-mono">
              <p>• Never share your API token</p>
              <p>• Use practice account for testing</p>
              <p>• Keep this app updated</p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
