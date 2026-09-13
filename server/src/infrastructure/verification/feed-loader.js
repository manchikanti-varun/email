// Loads optional external feed files (data/feeds/*.txt) and merges them into a
// ReferenceData instance. This is the infrastructure side of the reference
// data — the domain ReferenceData stays free of filesystem concerns.
import fs from 'node:fs';
import path from 'node:path';

export function loadFeeds(referenceData, root) {
  const dir = path.join(root, 'data', 'feeds');
  const mergeFile = (file, which) => {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) return 0;
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    return referenceData.merge(which, lines);
  };
  const d = mergeFile('disposable.txt', 'disposable');
  const r = mergeFile('roles.txt', 'roles');
  if (d || r) console.log(`  Loaded feeds: +${d} disposable, +${r} role domains`);
  return { disposable: d, roles: r };
}
