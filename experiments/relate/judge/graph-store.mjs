import init, { RelateDb } from '@relate/relate-wasm';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
await init({ module_or_path:'/relate_bg.wasm' });
export const digest = text => bytesToHex(sha256(text));

export function openStore() {
  let db = new RelateDb();
  // The browser binding has no explicit transactions. Replay completed
  // transactions if a multi-statement update fails partway through.
  const committed = [];
  let transaction;
  function query(statement, params) {
    const args = [statement, JSON.stringify(params ?? {})];
    const result = JSON.parse(db.execute(...args));
    if (result.error) throw new Error(result.error);
    transaction?.push(args);
    return result;
  }
  return { query, begin() { transaction = []; },
    commit() { committed.push(...transaction); transaction = undefined; },
    rollback() {
      transaction = undefined;
      db.free();
      db = new RelateDb();
      for (const args of committed) {
        const result = JSON.parse(db.execute(...args));
        if (result.error) throw new Error(result.error);
      }
    },
  };
}
