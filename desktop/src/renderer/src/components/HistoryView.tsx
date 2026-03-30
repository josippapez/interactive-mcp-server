import { useState, useEffect } from 'react';

type Conversation = {
  id: number;
  promptMessage: string;
  projectName: string;
  userResponse: string;
  predefinedOptions: string | null;
  createdAt: string;
};

export default function HistoryView(): JSX.Element {
  const [history, setHistory] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHistory = async (): Promise<void> => {
    setLoading(true);
    const data = await window.api.getHistory();
    setHistory(data);
    setLoading(false);
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleClear = async (): Promise<void> => {
    await window.api.clearHistory();
    setHistory([]);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        Loading…
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-2">
        <p className="text-sm">No conversation history yet.</p>
        <p className="text-xs text-gray-600">
          Prompts and responses will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
        <span className="text-xs text-gray-400">
          {history.length} conversation{history.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={handleClear}
          className="text-xs text-red-400 hover:text-red-300 transition-colors"
        >
          Clear all
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {history.map((item) => (
          <div
            key={item.id}
            className="rounded-lg border border-gray-800 bg-gray-900/50 p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="px-2 py-0.5 rounded bg-violet-600/20 text-violet-400 text-xs font-medium">
                {item.projectName}
              </span>
              <span className="text-xs text-gray-500">
                {new Date(item.createdAt).toLocaleString()}
              </span>
            </div>
            <p className="text-sm text-gray-300 whitespace-pre-wrap">
              {item.promptMessage}
            </p>
            <div className="border-t border-gray-800 pt-2">
              <p className="text-sm text-gray-100">
                <span className="text-xs text-gray-500 mr-1">→</span>
                {item.userResponse}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
