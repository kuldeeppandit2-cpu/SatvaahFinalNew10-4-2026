// Stub for expo-crypto — native AES/SHA unavailable in Expo Go
// Uses Node.js crypto built-ins via React Native's JS engine

import { Platform } from 'react-native';

export enum CryptoDigestAlgorithm {
  SHA1 = 'SHA-1',
  SHA256 = 'SHA-256',
  SHA384 = 'SHA-384',
  SHA512 = 'SHA-512',
  MD2 = 'MD2',
  MD4 = 'MD4',
  MD5 = 'MD5',
}

export enum CryptoEncoding {
  BASE64 = 'base64',
  HEX = 'hex',
}

// Simple SHA-256 implementation using available JS APIs
async function sha256Hex(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Base64(message: string): Promise<string> {
  const hex = await sha256Hex(message);
  const bytes = hex.match(/.{2}/g)!.map(b => parseInt(b, 16));
  return btoa(String.fromCharCode(...bytes));
}

export async function digestStringAsync(
  algorithm: CryptoDigestAlgorithm,
  data: string,
  options?: { encoding?: CryptoEncoding }
): Promise<string> {
  const encoding = options?.encoding ?? CryptoEncoding.HEX;
  // For Expo Go testing, use a simple hash approximation
  if (encoding === CryptoEncoding.BASE64) {
    return sha256Base64(data);
  }
  return sha256Hex(data);
}

export async function getRandomBytesAsync(byteCount: number): Promise<Uint8Array> {
  const bytes = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

export function getRandomBytes(byteCount: number): Uint8Array {
  return getRandomBytesAsync(byteCount) as any;
}
