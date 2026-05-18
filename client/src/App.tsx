import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Welcome from "./pages/Welcome";
import Dashboard from "./pages/Dashboard";
import { useState, useEffect } from "react";

function Router() {
  const [credentials, setCredentials] = useState<{
    token: string;
    accountId: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("oanda_credentials");
    if (stored) {
      try {
        setCredentials(JSON.parse(stored));
      } catch (e) {
        // Invalid stored credentials
      }
    }
    setLoading(false);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("oanda_credentials");
    setCredentials(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-amber-400 font-mono">Loading...</div>
      </div>
    );
  }

  if (!credentials) {
    return (
      <Switch>
        <Route
          path="*"
          component={() => (
            <Welcome
              onConnected={(creds) => {
                setCredentials(creds);
              }}
            />
          )}
        />
      </Switch>
    );
  }

  return (
    <Switch>
      <Route
        path="*"
        component={() => (
          <Dashboard credentials={credentials} onLogout={handleLogout} />
        )}
      />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
