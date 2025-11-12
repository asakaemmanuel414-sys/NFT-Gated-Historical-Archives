// nft-minter.test.ts
import { describe, it, expect, beforeEach } from "vitest";

const ERR_NOT_AUTHORIZED = 300;
const ERR_INSUFFICIENT_PAYMENT = 301;
const ERR_INVALID_TIER = 302;
const ERR_NFT_NOT_FOUND = 303;
const ERR_ALREADY_OWNED = 304;
const ERR_ROYALTY_TRANSFER_FAILED = 305;
const ERR_TIER_SOLD_OUT = 306;
const ERR_MAX_SUPPLY_REACHED = 307;

interface NFT {
  owner: string;
  tier: bigint;
  mintedAt: bigint;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class NFTMinterMock {
  state: {
    fundDisbursementContract: string;
    royaltyRecipient: string;
    nextNftId: bigint;
    baseUri: string;
    nfts: Map<bigint, NFT>;
    tierPrices: Map<bigint, bigint>;
    tierSupplies: Map<bigint, bigint>;
    tierMaxSupplies: Map<bigint, bigint>;
  } = {
    fundDisbursementContract: "ST1FUND",
    royaltyRecipient: "ST1ROYALTY",
    nextNftId: 0n,
    baseUri: "ipfs://Qm.../",
    nfts: new Map(),
    tierPrices: new Map(),
    tierSupplies: new Map(),
    tierMaxSupplies: new Map(),
  };

  caller: string = "ST1CALLER";
  owner: string = "ST1OWNER";
  blockHeight: bigint = 100n;
  stxTransfers: Array<{ amount: bigint; from: string; to: string }> = [];
  events: Array<{ event: string; [key: string]: any }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      fundDisbursementContract: "ST1FUND",
      royaltyRecipient: "ST1ROYALTY",
      nextNftId: 0n,
      baseUri: "ipfs://Qm.../",
      nfts: new Map(),
      tierPrices: new Map(),
      tierSupplies: new Map(),
      tierMaxSupplies: new Map(),
    };
    this.caller = "ST1CALLER";
    this.blockHeight = 100n;
    this.stxTransfers = [];
    this.events = [];
  }

  setFundDisbursementContract(newContract: string): Result<boolean> {
    if (this.caller !== this.owner)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.fundDisbursementContract = newContract;
    return { ok: true, value: true };
  }

  setRoyaltyRecipient(newRecipient: string): Result<boolean> {
    if (this.caller !== this.owner)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.royaltyRecipient = newRecipient;
    return { ok: true, value: true };
  }

  setBaseUri(newUri: string): Result<boolean> {
    if (this.caller !== this.owner)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.baseUri = newUri;
    return { ok: true, value: true };
  }

  setTierPrice(tier: bigint, price: bigint): Result<boolean> {
    if (this.caller !== this.owner)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (price === 0n) return { ok: false, value: ERR_INSUFFICIENT_PAYMENT };
    this.state.tierPrices.set(tier, price);
    return { ok: true, value: true };
  }

  setTierMaxSupply(tier: bigint, maxSupply: bigint): Result<boolean> {
    if (this.caller !== this.owner)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (maxSupply === 0n) return { ok: false, value: ERR_INVALID_TIER };
    this.state.tierMaxSupplies.set(tier, maxSupply);
    return { ok: true, value: true };
  }

  mintNft(tier: bigint, recipient: string, payment: bigint): Result<bigint> {
    const price = this.state.tierPrices.get(tier);
    if (!price) return { ok: false, value: ERR_INVALID_TIER };
    const currentSupply = this.state.tierSupplies.get(tier) || 0n;
    const maxSupply = this.state.tierMaxSupplies.get(tier);
    if (!maxSupply) return { ok: false, value: ERR_INVALID_TIER };
    if (currentSupply + 1n > maxSupply)
      return { ok: false, value: ERR_TIER_SOLD_OUT };
    if (payment < price) return { ok: false, value: ERR_INSUFFICIENT_PAYMENT };

    const royaltyAmount = (price * 5n) / 100n;
    const treasuryAmount = price - royaltyAmount;

    this.stxTransfers.push({
      amount: price,
      from: this.caller,
      to: "contract",
    });
    this.stxTransfers.push({
      amount: royaltyAmount,
      from: "contract",
      to: this.state.royaltyRecipient,
    });
    this.stxTransfers.push({
      amount: treasuryAmount,
      from: "contract",
      to: this.state.fundDisbursementContract,
    });

    const id = this.state.nextNftId;
    this.state.nfts.set(id, {
      owner: recipient,
      tier,
      mintedAt: this.blockHeight,
    });
    this.state.tierSupplies.set(tier, currentSupply + 1n);
    this.state.nextNftId += 1n;
    this.events.push({ event: "nft-minted", id, tier, to: recipient, price });
    return { ok: true, value: id };
  }

  transferNft(nftId: bigint, recipient: string): Result<boolean> {
    const nft = this.state.nfts.get(nftId);
    if (!nft) return { ok: false, value: ERR_NFT_NOT_FOUND };
    if (nft.owner !== this.caller)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (recipient === this.caller)
      return { ok: false, value: ERR_ALREADY_OWNED };
    this.state.nfts.set(nftId, { ...nft, owner: recipient });
    this.events.push({
      event: "nft-transferred",
      id: nftId,
      from: this.caller,
      to: recipient,
    });
    return { ok: true, value: true };
  }

  burnNft(nftId: bigint): Result<boolean> {
    const nft = this.state.nfts.get(nftId);
    if (!nft) return { ok: false, value: ERR_NFT_NOT_FOUND };
    if (nft.owner !== this.caller)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.nfts.delete(nftId);
    const supply = (this.state.tierSupplies.get(nft.tier) || 1n) - 1n;
    if (supply > 0n) this.state.tierSupplies.set(nft.tier, supply);
    else this.state.tierSupplies.delete(nft.tier);
    this.events.push({ event: "nft-burned", id: nftId, tier: nft.tier });
    return { ok: true, value: true };
  }

  getNft(id: bigint): NFT | null {
    return this.state.nfts.get(id) || null;
  }

  getNftUri(id: bigint): Result<string> {
    const nft = this.state.nfts.get(id);
    if (!nft) return { ok: false, value: ERR_NFT_NOT_FOUND };
    return { ok: true, value: `${this.state.baseUri}${id}` };
  }

  getTotalSupply(): Result<bigint> {
    return { ok: true, value: this.state.nextNftId };
  }
}

describe("NFTMinter", () => {
  let contract: NFTMinterMock;

  beforeEach(() => {
    contract = new NFTMinterMock();
    contract.reset();
    contract.caller = contract.owner;
    contract.setTierPrice(1n, 1000n);
    contract.setTierMaxSupply(1n, 100n);
  });

  it("sets fund disbursement contract", () => {
    const result = contract.setFundDisbursementContract("ST2FUND");
    expect(result.ok).toBe(true);
  });

  it("sets royalty recipient", () => {
    const result = contract.setRoyaltyRecipient("ST2ROYALTY");
    expect(result.ok).toBe(true);
  });

  it("sets base URI", () => {
    const result = contract.setBaseUri("ipfs://new/");
    expect(result.ok).toBe(true);
    expect(contract.state.baseUri).toBe("ipfs://new/");
  });

  it("mints NFT with correct payment split", () => {
    contract.caller = "ST1BUYER";
    const result = contract.mintNft(1n, "ST1BUYER", 1000n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0n);
    expect(contract.stxTransfers).toEqual([
      { amount: 1000n, from: "ST1BUYER", to: "contract" },
      { amount: 50n, from: "contract", to: "ST1ROYALTY" },
      { amount: 950n, from: "contract", to: "ST1FUND" },
    ]);
    const nft = contract.getNft(0n);
    expect(nft?.tier).toBe(1n);
    expect(nft?.owner).toBe("ST1BUYER");
  });

  it("rejects mint with insufficient payment", () => {
    contract.caller = "ST1BUYER";
    const result = contract.mintNft(1n, "ST1BUYER", 500n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INSUFFICIENT_PAYMENT);
  });

  it("rejects mint for invalid tier", () => {
    contract.caller = "ST1BUYER";
    const result = contract.mintNft(99n, "ST1BUYER", 1000n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_TIER);
  });

  it("enforces tier max supply", () => {
    contract.setTierMaxSupply(1n, 1n);
    contract.caller = "ST1BUYER";
    contract.mintNft(1n, "ST1BUYER", 1000n);
    contract.caller = "ST2BUYER";
    const result = contract.mintNft(1n, "ST2BUYER", 1000n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_TIER_SOLD_OUT);
  });

  it("transfers NFT ownership", () => {
    contract.caller = "ST1BUYER";
    contract.mintNft(1n, "ST1BUYER", 1000n);
    const result = contract.transferNft(0n, "ST2HOLDER");
    expect(result.ok).toBe(true);
    expect(contract.getNft(0n)?.owner).toBe("ST2HOLDER");
  });

  it("rejects transfer by non-owner", () => {
    contract.caller = "ST1BUYER";
    contract.mintNft(1n, "ST1BUYER", 1000n);
    contract.caller = "ST2HACKER";
    const result = contract.transferNft(0n, "ST2HACKER");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("burns NFT and reduces supply", () => {
    contract.caller = "ST1BUYER";
    contract.mintNft(1n, "ST1BUYER", 1000n);
    const result = contract.burnNft(0n);
    expect(result.ok).toBe(true);
    expect(contract.getNft(0n)).toBeNull();
    expect(contract.state.tierSupplies.get(1n)).toBeUndefined();
  });

  it("returns correct NFT URI", () => {
    contract.caller = "ST1BUYER";
    contract.mintNft(1n, "ST1BUYER", 1000n);
    const result = contract.getNftUri(0n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe("ipfs://Qm.../0");
  });

  it("returns total supply", () => {
    contract.caller = "ST1BUYER";
    contract.mintNft(1n, "ST1BUYER", 1000n);
    contract.caller = "ST2BUYER";
    contract.mintNft(1n, "ST2BUYER", 1000n);
    const result = contract.getTotalSupply();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2n);
  });
});
