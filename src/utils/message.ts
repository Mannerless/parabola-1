import { decodeStellarForwardHook } from "./encoding.js";

/**
 * Byte offsets into the CCTP V2 message and its burn body, taken from Circle's reference
 * contracts (circlefin/evm-cctp-contracts, src/messages/v2/MessageV2.sol and
 * src/messages/v2/BurnMessageV2.sol) rather than inferred. The header is a fixed 148 bytes
 * for every CCTP V2 message; the token-transfer body that follows is 228 bytes, with any
 * hook data appended after it, so a message carrying a hook is longer than 376.
 *
 * Cross-checked against a live testnet attestation from Circle's Iris sandbox, whose
 * message decodes at these offsets to a 0x3600...0000 burn token, an amount of 0xf4240
 * (1.000000 USDC), and a 56-byte Stellar strkey inside the hook data.
 */
const HEADER_OFFSET = {
  version: 0,
  sourceDomain: 4,
  destinationDomain: 8,
  nonce: 12,
  sender: 44,
  recipient: 76,
  destinationCaller: 108,
  minFinalityThreshold: 140,
  finalityThresholdExecuted: 144,
} as const;

const BODY_OFFSET = {
  version: 148,
  burnToken: 152,
  mintRecipient: 184,
  amount: 216,
  messageSender: 248,
  maxFee: 280,
  feeExecuted: 312,
  expirationBlock: 344,
  hookData: 376,
} as const;

/** Every CCTP V2 message header is this long, and every burn body at least this long. */
const V2_BURN_MESSAGE_MINIMUM_LENGTH = BODY_OFFSET.hookData;

export interface CctpBurnMessage {
  version: number;
  sourceDomain: number;
  destinationDomain: number;
  nonce: `0x${string}`;
  sender: `0x${string}`;
  /** The destination-chain contract that handles the body. For Stellar this is the CctpForwarder. */
  recipient: `0x${string}`;
  destinationCaller: `0x${string}`;
  minFinalityThreshold: number;
  finalityThresholdExecuted: number;
  burnBodyVersion: number;
  burnToken: `0x${string}`;
  mintRecipient: `0x${string}`;
  /** Amount burned, in the source chain's base units (6 decimals on Arc, 7 on Stellar). */
  amountRaw: bigint;
  messageSender: `0x${string}`;
  maxFeeRaw: bigint;
  feeExecutedRaw: bigint;
  expirationBlockRaw: bigint;
  hookData: `0x${string}` | null;
  /**
   * Stellar account the forward hook will pay, decoded from the hook data. Null when the
   * burn carried no hook, or carried one this SDK cannot read. A Stellar-bound CCTP
   * transfer always encodes its real recipient here, because CCTP cannot mint to a Stellar
   * address directly.
   */
  forwardRecipient: string | null;
}

function hexToBuffer(hex: string): Buffer {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new Error(`Not a valid hex string: ${hex}`);
  }
  return Buffer.from(clean, "hex");
}

function readBytes32(raw: Buffer, offset: number): `0x${string}` {
  return `0x${raw.subarray(offset, offset + 32).toString("hex")}`;
}

/**
 * Expected on-wire version fields for CCTP messages and burn bodies decoded by this SDK.
 * Note: While Circle references the protocol as CCTP V2, both MessageV2.sol and
 * BurnMessageV2.sol define their on-wire protocol versions as uint32 1.
 */
export const SUPPORTED_MESSAGE_VERSION = 1;
export const SUPPORTED_BURN_BODY_VERSION = 1;

/**
 * Decodes a CCTP V2 burn message into its header and body fields. Every message this SDK
 * produces or completes is a burn message, so the body is decoded as one; a message whose
 * body is not a burn body is rejected by the length check rather than misread.
 */
export function decodeCctpMessage(message: string): CctpBurnMessage {
  const raw = hexToBuffer(message);
  if (raw.length < V2_BURN_MESSAGE_MINIMUM_LENGTH) {
    throw new Error(
      `CCTP message is ${raw.length} bytes, shorter than the ${V2_BURN_MESSAGE_MINIMUM_LENGTH}-byte V2 burn message minimum`,
    );
  }

  const version = raw.readUInt32BE(HEADER_OFFSET.version);
  if (version !== SUPPORTED_MESSAGE_VERSION) {
    throw new Error(
      `Unsupported CCTP message version: expected ${SUPPORTED_MESSAGE_VERSION}, got ${version}`,
    );
  }

  const burnBodyVersion = raw.readUInt32BE(BODY_OFFSET.version);
  if (burnBodyVersion !== SUPPORTED_BURN_BODY_VERSION) {
    throw new Error(
      `Unsupported CCTP burn body version: expected ${SUPPORTED_BURN_BODY_VERSION}, got ${burnBodyVersion}`,
    );
  }

  const hookBytes = raw.subarray(BODY_OFFSET.hookData);
  const hookData =
    hookBytes.length > 0 ? (`0x${hookBytes.toString("hex")}` as `0x${string}`) : null;

  return {
    version: raw.readUInt32BE(HEADER_OFFSET.version),
    sourceDomain: raw.readUInt32BE(HEADER_OFFSET.sourceDomain),
    destinationDomain: raw.readUInt32BE(HEADER_OFFSET.destinationDomain),
    nonce: readBytes32(raw, HEADER_OFFSET.nonce),
    sender: readBytes32(raw, HEADER_OFFSET.sender),
    recipient: readBytes32(raw, HEADER_OFFSET.recipient),
    destinationCaller: readBytes32(raw, HEADER_OFFSET.destinationCaller),
    minFinalityThreshold: raw.readUInt32BE(HEADER_OFFSET.minFinalityThreshold),
    finalityThresholdExecuted: raw.readUInt32BE(HEADER_OFFSET.finalityThresholdExecuted),
    burnBodyVersion: raw.readUInt32BE(BODY_OFFSET.version),
    burnToken: readBytes32(raw, BODY_OFFSET.burnToken),
    mintRecipient: readBytes32(raw, BODY_OFFSET.mintRecipient),
    amountRaw: BigInt(readBytes32(raw, BODY_OFFSET.amount)),
    messageSender: readBytes32(raw, BODY_OFFSET.messageSender),
    maxFeeRaw: BigInt(readBytes32(raw, BODY_OFFSET.maxFee)),
    feeExecutedRaw: BigInt(readBytes32(raw, BODY_OFFSET.feeExecuted)),
    expirationBlockRaw: BigInt(readBytes32(raw, BODY_OFFSET.expirationBlock)),
    hookData,
    forwardRecipient: hookData ? (decodeStellarForwardHook(hookData) ?? null) : null,
  };
}
