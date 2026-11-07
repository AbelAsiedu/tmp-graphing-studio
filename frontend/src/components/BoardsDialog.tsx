import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type BoardSummary, type User } from '../api';
import { store, useStore } from '../store';

const VIS_LABEL = { private: 'Private', class: 'Published to class', submitted: 'Submitted to tutor' } as const;

interface Props {
  user: User;
  onClose: () => void;
  toast: (m: string) => void;
  confirmReplace: () => boolean;
}

/** Cloud boards: open, save, duplicate, share. Tutors publish lessons to a class; students submit work to their tutor. */
export function BoardsDialog({ user, onClose, toast, confirmReplace }: Props) {
  const s = useStore();
  const [tab, setTab] = useState<'mine' | 'shared'>('mine');
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [busy, setBusy] = useState('');
  const [classId, setClassId] = useState(user.classIds[0] ?? '');
  const canCreate = user.role !== 'viewer';
  const isTutor = user.role === 'tutor' || user.role === 'admin';

  const refresh = useCallback(async () => {
    setBoards(null);
    try { setBoards(await api.listBoards(tab)); } catch (e) { toast(e instanceof Error ? e.message : 'Could not load boards'); setBoards([]); }
  }, [tab, toast]);
  useEffect(() => { refresh(); }, [refresh]);

  const guard = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try { await fn(); } catch (e) { toast(e instanceof ApiError ? e.message : 'Something went wrong'); } finally { setBusy(''); }
  };

  const open = (id: string) => guard('open', async () => {
    if (!confirmReplace()) return;
    const { board, permissions } = await api.getBoard(id);
    store.load(board.data, board.title, { id: board.id, version: board.version, ownerId: board.ownerId, visibility: board.visibility, classId: board.classId, canWrite: permissions.write });
    toast(permissions.write ? 'Board opened' : 'Opened read-only — use “Make my copy” to edit your own version');
    onClose();
  });

  const saveNew = () => guard('save', async () => {
    const b = await api.createBoard(store.title, store.doc);
    store.setBoard({ id: b.id, version: b.version, ownerId: b.ownerId, visibility: b.visibility, classId: b.classId, canWrite: true });
    store.markSaved();
    toast('Saved to your boards');
    refresh();
  });

  const share = (b: BoardSummary, visibility: 'private' | 'class' | 'submitted') => guard('share', async () => {
    const updated = await api.setVisibility(b.id, visibility, visibility === 'private' ? null : classId);
    if (store.board?.id === b.id) store.setBoard({ ...store.board, visibility: updated.visibility, classId: updated.classId });
    toast(visibility === 'private' ? 'Now private' : visibility === 'class' ? `Published to ${classId}` : `Submitted to your tutor (${classId})`);
    refresh();
  });

  const copy = (id: string) => guard('copy', async () => {
    const b = await api.duplicate(id);
    toast(`Copied as “${b.title}”`);
    setTab('mine');
    if (tab === 'mine') refresh();
  });

  const remove = (b: BoardSummary) => guard('delete', async () => {
    if (!confirm(`Delete “${b.title}” permanently?`)) return;
    await api.remove(b.id);
    if (store.board?.id === b.id) store.setBoard(null);
    refresh();
  });

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Boards" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h2>Your boards</h2>
          <button className="icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="seg wide" role="tablist">
          <button role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>My boards</button>
          <button role="tab" aria-selected={tab === 'shared'} className={tab === 'shared' ? 'on' : ''} onClick={() => setTab('shared')}>{isTutor ? 'Student submissions' : 'Shared with me'}</button>
        </div>

        {tab === 'mine' && canCreate && (
          <div className="card">
            <div className="row gap center-v">
              <div className="grow"><strong>{s.title}</strong><div className="muted small">
                {s.board ? (s.board.canWrite ? `Cloud board · ${VIS_LABEL[s.board.visibility]}` : 'Read-only copy of a shared board') : 'Not saved to the cloud yet'}</div></div>
              {!s.board && <button className="btn primary" disabled={!!busy} onClick={saveNew}>Save to cloud</button>}
              {s.board && !s.board.canWrite && <button className="btn primary" disabled={!!busy} onClick={() => copy(s.board!.id)}>Make my copy</button>}
            </div>
          </div>
        )}
        {!canCreate && <p className="note">Your account can view shared boards but not create them.</p>}

        {user.classIds.length > 0 && tab === 'mine' && (
          <label className="row gap center-v">Class
            <select value={classId} onChange={(e) => setClassId(e.target.value)}>{user.classIds.map((c) => <option key={c}>{c}</option>)}</select>
          </label>
        )}

        <div className="board-list">
          {boards === null && <p className="muted">Loading…</p>}
          {boards?.length === 0 && <p className="muted">{tab === 'mine' ? 'No saved boards yet.' : isTutor ? 'No submissions from your classes yet.' : 'Nothing has been shared with you yet.'}</p>}
          {boards?.map((b) => (
            <div className="board" key={b.id}>
              <div className="grow">
                <strong>{b.title}</strong>
                <div className="muted small">{tab === 'shared' ? `${b.ownerName} · ` : ''}{VIS_LABEL[b.visibility]}{b.classId ? ` (${b.classId})` : ''} · {new Date(b.updatedAt).toLocaleDateString()}</div>
              </div>
              <button className="btn sm" disabled={!!busy} onClick={() => open(b.id)}>Open</button>
              {tab === 'shared' && canCreate && <button className="btn sm" disabled={!!busy} onClick={() => copy(b.id)}>Copy</button>}
              {tab === 'mine' && canCreate && (
                <>
                  {isTutor && b.visibility !== 'class' && classId && <button className="btn sm" disabled={!!busy} onClick={() => share(b, 'class')}>Publish</button>}
                  {user.role === 'student' && b.visibility !== 'submitted' && classId && <button className="btn sm" disabled={!!busy} onClick={() => share(b, 'submitted')}>Submit</button>}
                  {b.visibility !== 'private' && <button className="btn sm" disabled={!!busy} onClick={() => share(b, 'private')}>Unshare</button>}
                  <button className="btn sm danger" disabled={!!busy} onClick={() => remove(b)}>Delete</button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
