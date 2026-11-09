import type { Context } from 'hono';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';

export interface RpConfig {
  rpName: string;
  rpID: string;
  origin: string;
}

export function getRpConfig(c: Context): RpConfig {
  const hostHeader = c.req.header('host') || 'localhost:3000';
  const defaultRpId = hostHeader.split(':')[0]; // strip port

  const proto = c.req.header('x-forwarded-proto') || 'http';
  const defaultOrigin = c.req.header('origin') || `${proto}://${hostHeader}`;

  return {
    rpName: process.env.CAPY_RP_NAME || 'CapyLLM',
    rpID: process.env.CAPY_RP_ID || defaultRpId,
    origin: process.env.CAPY_ORIGIN || defaultOrigin,
  };
}

export async function createRegistrationOptions(
  c: Context,
  userId: string,
  userEmail: string
) {
  const { rpName, rpID } = getRpConfig(c);

  return await generateRegistrationOptions({
    rpName,
    rpID,
    userID: new TextEncoder().encode(userId),
    userName: userEmail,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'preferred',
      requireResidentKey: true,
    },
  });
}

export async function verifyRegistration(
  c: Context,
  body: any,
  expectedChallenge: string
): Promise<VerifiedRegistrationResponse> {
  const { rpID, origin } = getRpConfig(c);
  const possibleOrigins = [
    origin,
    origin.replace('http://', 'https://'),
    origin.replace('https://', 'http://'),
  ];

  return await verifyRegistrationResponse({
    response: body,
    expectedChallenge,
    expectedOrigin: possibleOrigins,
    expectedRPID: rpID,
    requireUserVerification: false,
  });
}

export async function createAuthenticationOptions(c: Context) {
  const { rpID } = getRpConfig(c);

  return await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
    allowCredentials: [], // Allows 1-click discoverable credentials (residentKey)
  });
}

export async function verifyAuthentication(
  c: Context,
  body: any,
  expectedChallenge: string,
  credential: {
    id: string;
    publicKey: Uint8Array;
    counter: number;
    transports?: any[];
  }
): Promise<VerifiedAuthenticationResponse> {
  const { rpID, origin } = getRpConfig(c);
  const possibleOrigins = [
    origin,
    origin.replace('http://', 'https://'),
    origin.replace('https://', 'http://'),
  ];

  return await verifyAuthenticationResponse({
    response: body,
    expectedChallenge,
    expectedOrigin: possibleOrigins,
    expectedRPID: rpID,
    credential: {
      id: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: credential.transports,
    },
    requireUserVerification: false,
  });
}
