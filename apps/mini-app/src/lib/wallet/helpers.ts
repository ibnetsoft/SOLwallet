import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';

/**
 * 32바이트 시드에서 Solana Keypair 도출
 * Ed25519 (NaCl)을 사용하여 키 페어 생성
 *
 * tweetnacl의 keyPair.secretKey는 이미 64바이트 (32 seed + 32 public)이므로
 * 추가로 publicKey를 append할 필요 없이 그대로 사용합니다.
 */
export function deriveKeypairFromSeed(seed: Uint8Array): Keypair {
  const keypair = nacl.sign.keyPair.fromSeed(seed);

  // secretKey는 64바이트 — @solana/web3.js Keypair.fromSecretKey가 요구하는 형식
  return Keypair.fromSecretKey(
    new Uint8Array(keypair.secretKey),
  );
}
