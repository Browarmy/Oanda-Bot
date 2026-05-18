import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";

const C = {
  bg: "#050505", s1: "#0C0C0C", s2: "#111",
  s3: "#161616", border: "#1E1E1E", border2: "#2A2A2A",
  amber: "#F5A623", amberDim: "#7A5210",
  green: "#00E676", greenDim: "#004D29",
  red: "#FF3D00", redDim: "#4D1100",
  blue: "#448AFF", text: "#D8D3CA",
  muted: "#3D3D3D", muted2: "#5A5A5A",
};

const mono = "monospace";
const Card = ({ children, glow, style }: any) => <div style={{ background: C.s1, border: `1px solid ${glow || C.border}`, borderRadius: 10, padding: 14, marginBottom: 10, boxShadow: glow ? `0 0 12px ${glow}22` : "none", ...style }}>{children}</div>;
const KV = ({ k, v, col }: any) => <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
  <span style={{ fontSize: 10, color: C.muted2, fontFamily: mono, letterSpacing: 0.5 }}>{k}</span>
  <span style={{ fontSize: 11, fontFamily: mono, fontWeight: 700, color: col || C.text }}>{v ?? "—"}</span>
</div>;

export default function SessionAndGuardConfig() {
  const { data: sessions, isLoading: sessionsLoading } = trpc.sessions.getConfig.useQuery();
  const { data: isActive } = trpc.sessions.isActive.useQuery();
  const updateSessionMutation = trpc.sessions.updateConfig.useMutation();
  const [maxDrawdown, setMaxDrawdown] = useState(5);

  if (sessionsLoading) {
    return <div style={{ color: C.text }}>Loading configuration...</div>;
  }

  const handleSessionToggle = (sessionName: string, enabled: boolean) => {
    updateSessionMutation.mutate({ sessionName, enabled });
  };

  const handleSessionTimeChange = (sessionName: string, field: string, value: number) => {
    const updates: any = { sessionName };
    updates[field] = value;
    updateSessionMutation.mutate(updates);
  };

  return (
    <div>
      {/* Session Filter Configuration */}
      <Card>
        <div style={{ fontSize: 9, color: C.amber, fontFamily: mono, letterSpacing: 2, marginBottom: 12 }}>TRADING SESSIONS (UTC)</div>
        <div style={{ marginBottom: 12, padding: "8px 12px", background: isActive ? C.greenDim : C.redDim, borderRadius: 6, fontSize: 10, color: isActive ? C.green : C.red, fontFamily: mono }}>
          {isActive ? "✓ Currently in active session" : "✗ Outside active sessions"}
        </div>
        
        {sessions && sessions.map((session: any) => (
          <div key={session.sessionName} style={{ marginBottom: 16, padding: 12, background: C.s2, borderRadius: 8, border: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontFamily: mono, fontWeight: 700, color: C.text }}>
                {session.sessionName}
              </div>
              <button
                onClick={() => handleSessionToggle(session.sessionName, !session.enabled)}
                style={{
                  padding: "4px 12px",
                  background: session.enabled ? C.green : C.muted,
                  color: C.bg,
                  border: "none",
                  borderRadius: 4,
                  fontFamily: mono,
                  fontWeight: 700,
                  fontSize: 10,
                  cursor: "pointer",
                }}
              >
                {session.enabled ? "ENABLED" : "DISABLED"}
              </button>
            </div>
            
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <div>
                <label style={{ display: "block", fontSize: 9, color: C.muted2, fontFamily: mono, marginBottom: 4 }}>START</label>
                <div style={{ display: "flex", gap: 4 }}>
                  <input
                    type="number"
                    min="0"
                    max="23"
                    value={session.startHour}
                    onChange={(e) => handleSessionTimeChange(session.sessionName, "startHour", parseInt(e.target.value))}
                    style={{ width: "50%", padding: "6px", background: C.s3, border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, fontFamily: mono, fontSize: 10 }}
                  />
                  <span style={{ color: C.muted2 }}>:</span>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={session.startMinute}
                    onChange={(e) => handleSessionTimeChange(session.sessionName, "startMinute", parseInt(e.target.value))}
                    style={{ width: "50%", padding: "6px", background: C.s3, border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, fontFamily: mono, fontSize: 10 }}
                  />
                </div>
              </div>
              
              <div>
                <label style={{ display: "block", fontSize: 9, color: C.muted2, fontFamily: mono, marginBottom: 4 }}>END</label>
                <div style={{ display: "flex", gap: 4 }}>
                  <input
                    type="number"
                    min="0"
                    max="23"
                    value={session.endHour}
                    onChange={(e) => handleSessionTimeChange(session.sessionName, "endHour", parseInt(e.target.value))}
                    style={{ width: "50%", padding: "6px", background: C.s3, border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, fontFamily: mono, fontSize: 10 }}
                  />
                  <span style={{ color: C.muted2 }}>:</span>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={session.endMinute}
                    onChange={(e) => handleSessionTimeChange(session.sessionName, "endMinute", parseInt(e.target.value))}
                    style={{ width: "50%", padding: "6px", background: C.s3, border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, fontFamily: mono, fontSize: 10 }}
                  />
                </div>
              </div>
            </div>
            
            {session.description && (
              <div style={{ fontSize: 9, color: C.muted2, fontFamily: mono, fontStyle: "italic" }}>
                {session.description}
              </div>
            )}
          </div>
        ))}
      </Card>

      {/* Daily Loss Guard Configuration */}
      <Card>
        <div style={{ fontSize: 9, color: C.amber, fontFamily: mono, letterSpacing: 2, marginBottom: 12 }}>DAILY LOSS GUARD</div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: C.muted2, fontFamily: mono }}>Max Daily Drawdown</span>
            <span style={{ fontSize: 12, color: C.amber, fontFamily: mono, fontWeight: 700 }}>{maxDrawdown}%</span>
          </div>
          <input
            type="range"
            min="1"
            max="20"
            step="0.5"
            value={maxDrawdown}
            onChange={(e) => setMaxDrawdown(parseFloat(e.target.value))}
            style={{ width: "100%", accentColor: C.amber }}
          />
        </div>
        
        <div style={{ padding: 12, background: C.s2, borderRadius: 8, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 9, color: C.muted2, fontFamily: mono, marginBottom: 8 }}>HOW IT WORKS</div>
          <div style={{ fontSize: 10, color: C.muted2, lineHeight: 1.6 }}>
            • Tracks daily NAV from market open<br />
            • Calculates drawdown from peak NAV<br />
            • Pauses auto-trading when limit reached<br />
            • Resets daily at midnight UTC
          </div>
        </div>
      </Card>
    </div>
  );
}
