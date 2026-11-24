/**
 * The code printed under a table's QR, for guests whose camera won't scan. Same alphabet as new_table_code() in the
 * database: no 0/O or 1/I, which look alike on paper.
 */
export const TABLE_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const TABLE_CODE_LENGTH = 6;

/** What someone typed, tidied: capitals, no spaces or dashes ("k7m-4qp" → "K7M4QP"). */
export const normalizeTableCode = (typed: string) => typed.toUpperCase().replace(/[\s\-–—_.]/g, "");

/** As printed and shown: "K7M-4QP". */
export const formatTableCode = (code: string) => (code.length > 3 ? `${code.slice(0, 3)}-${code.slice(3)}` : code);

export type TableCodeProblem = "EMPTY" | "BAD_CHARACTER" | "TOO_SHORT" | "TOO_LONG";

/** Why a typed code can't be a table code, or null if it could be one. */
export function tableCodeProblem(typed: string): TableCodeProblem | null {
  const code = normalizeTableCode(typed);
  if (!code) return "EMPTY";
  if ([...code].some((c) => !TABLE_CODE_ALPHABET.includes(c))) return "BAD_CHARACTER";
  if (code.length < TABLE_CODE_LENGTH) return "TOO_SHORT";
  if (code.length > TABLE_CODE_LENGTH) return "TOO_LONG";
  return null;
}
