import { WALLET_ENCRYPTION } from '@solwallet/config';
import type { EncryptedWallet } from './encrypt';

/**
 * 암호화된 private key를 PIN으로 복호화
 * 알고리즘: PBKDF2 → AES-256-GCM (decrypt)
 *
 * @param encrypted — 암호화된 지갑 데이터
 * @param pin — 사용자 PIN
 * @returns 복호화된 secretKey (Uint8Array)
 * @throws PIN이 틀리거나 데이터가 손상된 경우 에러
 */
export async function decryptPrivateKey(
  encrypted: EncryptedWallet,
  pin: string,
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const salt = new Uint8Array(base64ToUint8Array(encrypted.salt));
  const iv = new Uint8Array(base64ToUint8Array(encrypted.iv));
  const ciphertext = new Uint8Array(base64ToUint8Array(encrypted.ciphertext));

  // PBKDF2로 암호화 키 도출 (암호화할 때와 동일한 과정)
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
      salt: salt.buffer as ArrayBuffer,
      iterations: WALLET_ENCRYPTION.iterations,
      hash: 'SHA-256',
    },
    rawKey,
    256,
  );

  // AES-256-GCM 키 생성
  const aesKey = await crypto.subtle.importKey(
    'raw',
    derivedBits,
    'AES-GCM',
    false,
    ['decrypt'],
  );

  // 복호화
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    aesKey,
    ciphertext.buffer as ArrayBuffer,
  );

  return new Uint8Array(decrypted);
}

// ─── Helpers ───

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
