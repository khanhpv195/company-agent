/**
 * TypeORM's postgres driver returns `[rows, affectedCount]` for UPDATE/DELETE ... RETURNING
 * and a plain row array for SELECT. Normalises both to the rows.
 */
export const returnedRows = <T>(result: unknown): T[] => {
  if (Array.isArray(result) && result.length === 2 && Array.isArray(result[0])) {
    return result[0] as T[];
  }
  return Array.isArray(result) ? (result as T[]) : [];
};
