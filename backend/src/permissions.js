// Board access rules — the single source of truth for who may do what.
//
// visibility:
//   private   : owner only (admins can read/delete)
//   class     : published by a tutor; every member of `classId` may read (and duplicate) it
//   submitted : submitted by a student; tutors of `classId` may read it
//
// Roles: admin > tutor > student > viewer (viewer = read-only, e.g. a parent watching a class)

const inClass = (user, classId) => !!classId && user.classIds.includes(String(classId));

export function canRead(user, board) {
  if (!user) return false;
  if (board.ownerId === user.id) return true;
  if (user.role === 'admin') return true;
  if (board.visibility === 'class') return inClass(user, board.classId);
  if (board.visibility === 'submitted') return user.role === 'tutor' && inClass(user, board.classId);
  return false;
}

export function canWrite(user, board) {
  if (!user || user.role === 'viewer') return false;
  return board.ownerId === user.id;
}

export function canDelete(user, board) {
  if (!user || user.role === 'viewer') return false;
  return board.ownerId === user.id || user.role === 'admin';
}

export function canCreate(user) {
  return !!user && user.role !== 'viewer';
}

/** Returns null if allowed, otherwise a human-readable reason. */
export function checkVisibilityChange(user, board, visibility, classId) {
  if (!canWrite(user, board)) return 'Only the owner can change sharing.';
  if (visibility === 'private') return null;
  if (!classId) return 'A class is required for this visibility.';
  if (!inClass(user, classId) && user.role !== 'admin') return 'You are not a member of that class.';
  if (visibility === 'class' && user.role !== 'tutor' && user.role !== 'admin') return 'Only tutors can publish boards to a class.';
  if (visibility === 'submitted' && user.role !== 'student') return 'Only students submit work to a tutor.';
  return null;
}

export function summarize(board) {
  const { data, ...meta } = board;
  return meta;
}
