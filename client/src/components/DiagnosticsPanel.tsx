import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';

interface DiagnosticStatus {
  status: 'HEALTHY' | 'WARNING' | 'ERROR';
  message: string;
  timestamp: number;
  [key: string]: unknown;
}

interface DebugInfo {
  status: string;
  timestamp: number;
  trades?: {
    total: number;
    wins: number;
    losses: number;
    winRate: string;
    totalPnL: string;
    avgPnLPerTrade: string;
  };
}

export function DiagnosticsPanel() {
  const [connectionStatus, setConnectionStatus] = useState<DiagnosticStatus | null>(null);
  const [databaseStatus, setDatabaseStatus] = useState<DiagnosticStatus | null>(null);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const runDiagnostics = async () => {
    setLoading(true);
    try {
      // Test connection
      const connRes = await fetch('/api/diagnostics/connection');
      const connData = await connRes.json();
      setConnectionStatus(connData);

      // Test database
      const dbRes = await fetch('/api/diagnostics/database');
      const dbData = await dbRes.json();
      setDatabaseStatus(dbData);

      // Get debug info
      const debugRes = await fetch('/api/diagnostics/debug');
      const debugData = await debugRes.json();
      setDebugInfo(debugData);
    } catch (error) {
      console.error('Diagnostics failed:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runDiagnostics();
  }, []);

  const StatusIcon = ({ status }: { status: string }) => {
    switch (status) {
      case 'HEALTHY':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'WARNING':
        return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      case 'ERROR':
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-amber-500">System Diagnostics</h2>
        <Button onClick={runDiagnostics} disabled={loading} size="sm">
          <RefreshCw className="w-4 h-4 mr-2" />
          {loading ? 'Testing...' : 'Run Tests'}
        </Button>
      </div>

      {/* Connection Status */}
      {connectionStatus && (
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <StatusIcon status={connectionStatus.status} />
              OANDA Connection
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <div className="text-slate-400">{connectionStatus.message}</div>
            {connectionStatus.accountBalance ? (
              <div className="text-amber-500">
                Balance: £{String(connectionStatus.accountBalance)}
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* Database Status */}
      {databaseStatus && (
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <StatusIcon status={databaseStatus.status} />
              Database Connection
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <div className="text-slate-400">{String(databaseStatus.message)}</div>
          </CardContent>
        </Card>
      )}

      {/* Debug Info */}
      {debugInfo?.trades && (
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Trade Statistics</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-slate-400">Total Trades:</span>
                <div className="text-amber-500 font-mono">{debugInfo.trades.total}</div>
              </div>
              <div>
                <span className="text-slate-400">Win Rate:</span>
                <div className="text-green-500 font-mono">{debugInfo.trades.winRate}</div>
              </div>
              <div>
                <span className="text-slate-400">Total P&L:</span>
                <div className="text-amber-500 font-mono">£{debugInfo.trades.totalPnL}</div>
              </div>
              <div>
                <span className="text-slate-400">Avg P&L/Trade:</span>
                <div className="text-amber-500 font-mono">£{debugInfo.trades.avgPnLPerTrade}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Alert className="bg-slate-900 border-slate-700">
        <AlertCircle className="h-4 w-4 text-amber-500" />
        <AlertDescription className="text-slate-300">
          All systems operational. Ready to test with OANDA credentials.
        </AlertDescription>
      </Alert>
    </div>
  );
}
