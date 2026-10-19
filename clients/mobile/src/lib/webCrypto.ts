import * as Crypto from "expo-crypto";

/* Hermes has no Web Crypto. Without it supabase-js quietly builds the PKCE
   verifier from Math.random() and sends it as a "plain" challenge; with
   these two functions it uses secure random bytes and S256. */
const target = globalThis as { crypto?: Partial<Crypto_> };
type Crypto_ = { getRandomValues: typeof Crypto.getRandomValues; subtle: Partial<SubtleCrypto> };

target.crypto ??= {};
target.crypto.getRandomValues ??= Crypto.getRandomValues;
target.crypto.subtle ??= {
  digest: (algorithm: AlgorithmIdentifier, data: BufferSource) => {
    const name = typeof algorithm === "string" ? algorithm : algorithm.name;
    if (name.toUpperCase() !== "SHA-256") return Promise.reject(new Error(`Unsupported digest ${name}`));
    return Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, data);
  }
};
