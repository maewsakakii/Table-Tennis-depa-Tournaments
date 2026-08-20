const PLAYER_ID_PREFIX = "DT";
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RECOVERY_BYTES = 15;
const RECOVERY_CHARACTERS = 24;

export function formatPublicPlayerId(sequence: number) {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new RangeError("Player sequence must be a positive integer");
  }
  return `${PLAYER_ID_PREFIX}-${String(sequence).padStart(2, "0")}`;
}

export function nextPublicPlayerId(existingIds: Iterable<string>) {
  let highest = 0;
  for (const id of existingIds) {
    const match = /^DT-(\d+)$/.exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return formatPublicPlayerId(highest + 1);
}

function encodeBase32(bytes: Uint8Array) {
  let buffer = 0;
  let bits = 0;
  let result = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += RECOVERY_ALPHABET[(buffer >>> bits) & 31];
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits > 0) result += RECOVERY_ALPHABET[(buffer << (5 - bits)) & 31];
  return result;
}

export function generateRecoveryCode(randomBytes?: Uint8Array) {
  const bytes = randomBytes ?? crypto.getRandomValues(new Uint8Array(RECOVERY_BYTES));
  if (bytes.length !== RECOVERY_BYTES) {
    throw new RangeError(`Recovery code needs exactly ${RECOVERY_BYTES} random bytes`);
  }
  const encoded = encodeBase32(bytes);
  if (encoded.length !== RECOVERY_CHARACTERS) throw new Error("Invalid recovery code entropy");
  return `DT-${encoded.match(/.{1,4}/g)?.join("-")}`;
}

export function normalizeRecoveryCode(value: string) {
  const compact = value.toUpperCase().replace(/[\s-]/g, "");
  if (/^DTRCV[A-F0-9]{30}$/.test(compact)) {
    const body = compact.slice(5);
    return `DT-RCV-${body.match(/.{1,5}/g)?.join("-")}`;
  }
  if (!/^DT[A-HJ-NP-Z2-9]{24}$/.test(compact)) return null;
  const body = compact.slice(2);
  return `DT-${body.match(/.{1,4}/g)?.join("-")}`;
}
