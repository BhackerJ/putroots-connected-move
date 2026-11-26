import { Database } from '@relate/relate';
import { createHash } from 'node:crypto';

export const digest = text => createHash('sha256').update(text).digest('hex');
export function openStore(path) {
  const db = Database.open(path);
  const conn = db.connect();
  return { query:(q,p) => conn.query(q,p), begin:() => conn.begin(), commit:() => conn.commit(),
    rollback:() => conn.rollback(), checkpoint:() => db.checkpoint() };
}
