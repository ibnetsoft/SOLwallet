import { WALLET_ENCRYPTION } from '@solwallet/config';

export interface EncryptedWallet {
  ciphertext: string; // base64 인코딩된 암호문
  iv: string;         // base64 인코딩된 초기화 벡터
  salt: string;       // base64 인코딩된 솔트
  version: 1;         // 암호화 버전
}

/**
 * private key를 PIN/비밀번호로 암호화
 * 알고리즘: PBKDF2 → AES-256-GCM
 *
 * @param secretKey — Uint8Array (64 bytes for Ed25519)
 * @param pin — 사용자 PIN (최소 4자리)
 * @returns 암호화된 지갑 데이터
 */
export async function encryptPrivateKey(
  secretKey: Uint8Array,
  pin: string,
): Promise<EncryptedWallet> {
  const encoder = new TextEncoder();

  // 랜덤 솔트 생성
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // PBKDF2로 암호화 키 도출
  const rawKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey'],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: WALLET_ENCRYPTION.iterations,
      hash: 'SHA-256',
    },
    rawKey,
    256, // 256-bit key for AES-256
  );

  // AES-256-GCM 키 생성
  const aesKey = await crypto.subtle.importKey(
    'raw',
    derivedBits,
    'AES-GCM',
    false,
    ['encrypt'],
  );

  // 랜덤 IV 생성
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // 암호화
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    aesKey,
    secretKey.buffer as ArrayBuffer,
  );

  return {
    ciphertext: uint8ArrayToBase64(new Uint8Array(ciphertext)),
    iv: uint8ArrayToBase64(iv),
    salt: uint8ArrayToBase64(salt),
    version: 1,
  };
}

// ─── Helpers ───

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
