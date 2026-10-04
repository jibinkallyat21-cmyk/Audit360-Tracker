export interface VersionRef {
  id: string;
  storage_path: string;
}

/**
 * After a restore, every stored version must still point at a file that exists.
 * `exists` is given a storage path and answers whether the file is there.
 */
export async function findMissingFiles(
  versions: VersionRef[],
  exists: (storagePath: string) => Promise<boolean>,
): Promise<VersionRef[]> {
  const missing: VersionRef[] = [];
  for (const v of versions) if (!(await exists(v.storage_path))) missing.push(v);
  return missing;
}
