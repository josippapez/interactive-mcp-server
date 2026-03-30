import { useState, useEffect } from 'react';

export default function StatusBar(): JSX.Element {
  const [status, setStatus] = useState<{
    running: boolean;
    port: number;
  } | null>(null);

  useEffect(() => {
    window.api.getServerStatus().then(setStatus);
    const interval = setInterval(() => {
      window.api.getServerStatus().then(setStatus);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <footer className="flex items-center justify-between px-4 py-1.5 border-t border-gray-800 bg-gray-950 text-xs text-gray-500">
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full ${status?.running ? 'bg-green-500' : 'bg-red-500'}`}
        />
        <span>
          {status?.running ? `SSE on :${status.port}` : 'Server stopped'}
        </span>
      </div>
      <span>Interactive MCP Desktop v1.0.0 — 5 tools</span>
    </footer>
  );
}
