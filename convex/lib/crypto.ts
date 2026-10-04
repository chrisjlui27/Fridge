import { scrypt } from "@noble/hashes/scrypt.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

// Only call the random helpers from actions: queries and mutations are
// deterministic in Convex, so secrets are generated where randomness is real.

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/** 256-bit session token, base64url. */
export function randomToken(): string {
  let s = "";
  for (const byte of randomBytes(32)) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// No 0/O, 1/I/L so codes can be read aloud and typed on a tablet.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function randomCode(length = 8): string {
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      // Rejection sampling avoids modulo bias.
      if (byte < 256 - (256 % CODE_ALPHABET.length) && out.length < length) {
        out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      }
    }
  }
  return out;
}

export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return bytesToHex(new Uint8Array(digest));
}

const SCRYPT = { N: 2 ** 14, r: 8, p: 1, dkLen: 32 };

export function hashSecret(secret: string, saltHex?: string): { hash: string; salt: string } {
  const salt = saltHex ? hexToBytes(saltHex) : randomBytes(16);
  const hash = scrypt(secret.normalize("NFKC"), salt, SCRYPT);
  return { hash: bytesToHex(hash), salt: bytesToHex(salt) };
}

export function verifySecret(secret: string, hashHex: string, saltHex: string): boolean {
  const { hash } = hashSecret(secret, saltHex);
  if (hash.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}
