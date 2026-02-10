import { useState, useEffect } from 'react';
import api from '../../utils/api.js';
import ScriptCard from './ScriptCard.jsx';
import AddScriptModal from './AddScriptModal.jsx';

export default function ScriptList({ projectId, project }) {
  const [scripts, setScripts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    loadScripts();
  }, [projectId]);

  async function loadScripts() {
    try {
      const data = await api.get(`/api/projects/${projectId}/scripts`);
      setScripts(data.scripts || []);
    } catch (err) {
      console.error('Failed to load scripts:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(scriptId) {
    try {
      await api.delete(`/api/projects/${projectId}/scripts/${scriptId}`);
      setScripts(scripts.filter(s => s.id !== scriptId));
    } catch (err) {
      console.error('Failed to delete script:', err);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      {scripts.length === 0 ? (
        <div className="text-center py-12">
          <svg className="w-12 h-12 text-text-dim mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
          </svg>
          <h3 className="text-text font-medium mb-1">No scripts yet</h3>
          <p className="text-text-muted text-sm mb-4">Add scripts to run dev servers, tests, etc.</p>
        </div>
      ) : (
        scripts.map((script) => (
          <ScriptCard
            key={script.id}
            script={script}
            projectId={projectId}
            onDelete={handleDelete}
            onRefresh={loadScripts}
          />
        ))
      )}

      <button
        onClick={() => setShowModal(true)}
        className="btn-outline w-full"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Add Script
      </button>

      {showModal && (
        <AddScriptModal
          projectId={projectId}
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); loadScripts(); }}
        />
      )}
    </div>
  );
}
