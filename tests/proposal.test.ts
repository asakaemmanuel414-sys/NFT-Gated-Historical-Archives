// proposal.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  uintCV,
  stringUtf8CV,
  listCV,
  principalCV,
  tupleCV,
  trueCV,
  falseCV,
} from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 200;
const ERR_PROPOSAL_EXISTS = 201;
const ERR_PROPOSAL_NOT_FOUND = 202;
const ERR_INVALID_BUDGET = 203;
const ERR_INVALID_MILESTONES = 204;
const ERR_INVALID_TITLE = 205;
const ERR_INVALID_DESCRIPTION = 206;
const ERR_PROPOSAL_CLOSED = 207;
const ERR_ALREADY_VOTED = 208;
const ERR_INSUFFICIENT_VOTES = 209;
const ERR_VOTING_NOT_STARTED = 210;
const ERR_PROPOSAL_REJECTED = 211;
const ERR_MAX_MILESTONES = 212;

interface Proposal {
  proposer: string;
  institution: string;
  totalBudget: bigint;
  milestones: bigint[];
  title: string;
  description: string;
  createdAt: bigint;
  status: string;
  votesFor: bigint;
  votesAgainst: bigint;
  votingEnd: bigint;
}

interface Vote {
  vote: boolean;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class ProposalMock {
  state: {
    fundDisbursementContract: string;
    nextProposalId: bigint;
    minVotesRequired: bigint;
    proposals: Map<bigint, Proposal>;
    votes: Map<string, Vote>;
  } = {
    fundDisbursementContract: "ST1FUND",
    nextProposalId: 0n,
    minVotesRequired: 3n,
    proposals: new Map(),
    votes: new Map(),
  };

  caller: string = "ST1CALLER";
  owner: string = "ST1OWNER";
  blockHeight: bigint = 100n;
  events: Array<{ event: string; [key: string]: any }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      fundDisbursementContract: "ST1FUND",
      nextProposalId: 0n,
      minVotesRequired: 3n,
      proposals: new Map(),
      votes: new Map(),
    };
    this.caller = "ST1CALLER";
    this.blockHeight = 100n;
    this.events = [];
  }

  setFundDisbursementContract(newContract: string): Result<boolean> {
    if (this.caller !== this.owner)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.fundDisbursementContract = newContract;
    return { ok: true, value: true };
  }

  setMinVotesRequired(newMin: bigint): Result<boolean> {
    if (this.caller !== this.owner)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (newMin === 0n) return { ok: false, value: ERR_INVALID_BUDGET };
    this.state.minVotesRequired = newMin;
    return { ok: true, value: true };
  }

  submitProposal(
    institution: string,
    totalBudget: bigint,
    milestones: bigint[],
    title: string,
    description: string,
    votingDuration: bigint
  ): Result<bigint> {
    if (totalBudget === 0n) return { ok: false, value: ERR_INVALID_BUDGET };
    if (milestones.length > 10 || milestones.length === 0)
      return {
        ok: false,
        value:
          milestones.length > 10 ? ERR_MAX_MILESTONES : ERR_INVALID_MILESTONES,
      };
    const sum = milestones.reduce((a, b) => a + b, 0n);
    if (sum !== totalBudget) return { ok: false, value: ERR_INVALID_BUDGET };
    if (title.length === 0) return { ok: false, value: ERR_INVALID_TITLE };
    if (description.length === 0)
      return { ok: false, value: ERR_INVALID_DESCRIPTION };
    if (votingDuration === 0n) return { ok: false, value: ERR_INVALID_BUDGET };

    const id = this.state.nextProposalId;
    const end = this.blockHeight + votingDuration;
    this.state.proposals.set(id, {
      proposer: this.caller,
      institution,
      totalBudget,
      milestones,
      title,
      description,
      createdAt: this.blockHeight,
      status: "voting",
      votesFor: 0n,
      votesAgainst: 0n,
      votingEnd: end,
    });
    this.state.nextProposalId += 1n;
    this.events.push({
      event: "proposal-submitted",
      id,
      budget: totalBudget,
      end,
    });
    return { ok: true, value: id };
  }

  voteOnProposal(proposalId: bigint, support: boolean): Result<boolean> {
    const proposal = this.state.proposals.get(proposalId);
    if (!proposal || proposal.status !== "voting")
      return { ok: false, value: ERR_PROPOSAL_CLOSED };
    if (this.blockHeight > proposal.votingEnd)
      return { ok: false, value: ERR_PROPOSAL_CLOSED };
    const voteKey = `${proposalId}-${this.caller}`;
    if (this.state.votes.has(voteKey))
      return { ok: false, value: ERR_ALREADY_VOTED };

    this.state.votes.set(voteKey, { vote: support });
    const updated = {
      ...proposal,
      votesFor: support ? proposal.votesFor + 1n : proposal.votesFor,
      votesAgainst: support
        ? proposal.votesAgainst
        : proposal.votesAgainst + 1n,
    };
    this.state.proposals.set(proposalId, updated);
    this.events.push({
      event: "vote-cast",
      proposalId,
      voter: this.caller,
      support,
    });
    return { ok: true, value: true };
  }

  finalizeProposal(proposalId: bigint): Result<boolean> {
    const proposal = this.state.proposals.get(proposalId);
    if (!proposal) return { ok: false, value: ERR_PROPOSAL_NOT_FOUND };
    if (this.blockHeight <= proposal.votingEnd)
      return { ok: false, value: ERR_VOTING_NOT_STARTED };
    if (proposal.status !== "voting")
      return { ok: false, value: ERR_PROPOSAL_CLOSED };

    if (proposal.votesFor >= this.state.minVotesRequired) {
      this.state.proposals.set(proposalId, { ...proposal, status: "approved" });
      this.events.push({ event: "proposal-approved", id: proposalId });
      return { ok: true, value: true };
    } else {
      this.state.proposals.set(proposalId, { ...proposal, status: "rejected" });
      this.events.push({ event: "proposal-rejected", id: proposalId });
      return { ok: true, value: false };
    }
  }

  cancelProposal(proposalId: bigint): Result<boolean> {
    const proposal = this.state.proposals.get(proposalId);
    if (!proposal) return { ok: false, value: ERR_PROPOSAL_NOT_FOUND };
    if (this.caller !== proposal.proposer)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (proposal.status !== "voting")
      return { ok: false, value: ERR_PROPOSAL_CLOSED };
    this.state.proposals.set(proposalId, { ...proposal, status: "cancelled" });
    return { ok: true, value: true };
  }

  getProposal(id: bigint): Proposal | null {
    return this.state.proposals.get(id) || null;
  }

  getVote(proposalId: bigint, voter: string): Vote | null {
    return this.state.votes.get(`${proposalId}-${voter}`) || null;
  }
}

describe("Proposal", () => {
  let contract: ProposalMock;

  beforeEach(() => {
    contract = new ProposalMock();
    contract.reset();
    contract.caller = contract.owner;
  });

  it("sets fund disbursement contract by owner", () => {
    const result = contract.setFundDisbursementContract("ST2FUND");
    expect(result.ok).toBe(true);
  });

  it("rejects non-owner setting fund contract", () => {
    contract.caller = "ST2HACKER";
    const result = contract.setFundDisbursementContract("ST2FUND");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("sets minimum votes required", () => {
    const result = contract.setMinVotesRequired(5n);
    expect(result.ok).toBe(true);
    expect(contract.state.minVotesRequired).toBe(5n);
  });

  it("rejects zero min votes", () => {
    const result = contract.setMinVotesRequired(0n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_BUDGET);
  });

  it("submits valid proposal", () => {
    contract.caller = "ST1PROPOSER";
    const result = contract.submitProposal(
      "ST1INST",
      5000n,
      [2000n, 3000n],
      "Digitize Colonial Maps",
      "Preserve 18th century cartography",
      100n
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0n);
    const proposal = contract.getProposal(0n);
    expect(proposal?.title).toBe("Digitize Colonial Maps");
    expect(proposal?.totalBudget).toBe(5000n);
    expect(proposal?.status).toBe("voting");
    expect(proposal?.votingEnd).toBe(200n);
  });

  it("rejects mismatched milestone sum", () => {
    contract.caller = "ST1PROPOSER";
    const result = contract.submitProposal(
      "ST1INST",
      5000n,
      [2000n, 2000n],
      "Title",
      "Desc",
      100n
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_BUDGET);
  });

  it("rejects empty title", () => {
    contract.caller = "ST1PROPOSER";
    const result = contract.submitProposal(
      "ST1INST",
      1000n,
      [1000n],
      "",
      "Desc",
      100n
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_TITLE);
  });

  it("rejects more than 10 milestones", () => {
    contract.caller = "ST1PROPOSER";
    const milestones = Array(11).fill(100n);
    const result = contract.submitProposal(
      "ST1INST",
      1100n,
      milestones,
      "Title",
      "Desc",
      100n
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_MILESTONES);
  });

  it("allows voting during voting period", () => {
    contract.caller = "ST1PROPOSER";
    contract.submitProposal("ST1INST", 1000n, [1000n], "Test", "Desc", 50n);
    contract.caller = "ST1VOTER1";
    contract.blockHeight = 120n;
    const result = contract.voteOnProposal(0n, true);
    expect(result.ok).toBe(true);
    const proposal = contract.getProposal(0n);
    expect(proposal?.votesFor).toBe(1n);
  });

  it("rejects voting after end", () => {
    contract.caller = "ST1PROPOSER";
    contract.submitProposal("ST1INST", 1000n, [1000n], "Test", "Desc", 10n);
    contract.blockHeight = 120n;
    contract.caller = "ST1VOTER1";
    const result = contract.voteOnProposal(0n, true);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_PROPOSAL_CLOSED);
  });

  it("rejects double voting", () => {
    contract.caller = "ST1PROPOSER";
    contract.submitProposal("ST1INST", 1000n, [1000n], "Test", "Desc", 50n);
    contract.caller = "ST1VOTER1";
    contract.blockHeight = 120n;
    contract.voteOnProposal(0n, true);
    const result = contract.voteOnProposal(0n, false);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ALREADY_VOTED);
  });

  it("finalizes approved proposal", () => {
    contract.caller = "ST1PROPOSER";
    contract.submitProposal("ST1INST", 1000n, [1000n], "Test", "Desc", 10n);
    contract.caller = "ST1VOTER1";
    contract.blockHeight = 105n;
    contract.voteOnProposal(0n, true);
    contract.caller = "ST1VOTER2";
    contract.voteOnProposal(0n, true);
    contract.caller = "ST1VOTER3";
    contract.voteOnProposal(0n, true);
    contract.blockHeight = 120n;
    contract.caller = "ST1ANY";
    const result = contract.finalizeProposal(0n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getProposal(0n)?.status).toBe("approved");
  });

  it("finalizes rejected proposal", () => {
    contract.caller = "ST1PROPOSER";
    contract.submitProposal("ST1INST", 1000n, [1000n], "Test", "Desc", 10n);
    contract.caller = "ST1VOTER1";
    contract.blockHeight = 105n;
    contract.voteOnProposal(0n, false);
    contract.blockHeight = 120n;
    const result = contract.finalizeProposal(0n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(false);
    expect(contract.getProposal(0n)?.status).toBe("rejected");
  });

  it("rejects finalize before voting end", () => {
    contract.caller = "ST1PROPOSER";
    contract.submitProposal("ST1INST", 1000n, [1000n], "Test", "Desc", 50n);
    contract.blockHeight = 120n;
    const result = contract.finalizeProposal(0n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_VOTING_NOT_STARTED);
  });

  it("cancels proposal by proposer", () => {
    contract.caller = "ST1PROPOSER";
    contract.submitProposal("ST1INST", 1000n, [1000n], "Test", "Desc", 50n);
    const result = contract.cancelProposal(0n);
    expect(result.ok).toBe(true);
    expect(contract.getProposal(0n)?.status).toBe("cancelled");
  });

  it("rejects cancel by non-proposer", () => {
    contract.caller = "ST1PROPOSER";
    contract.submitProposal("ST1INST", 1000n, [1000n], "Test", "Desc", 50n);
    contract.caller = "ST2HACKER";
    const result = contract.cancelProposal(0n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("returns correct proposal status", () => {
    contract.caller = "ST1PROPOSER";
    contract.submitProposal("ST1INST", 1000n, [1000n], "Test", "Desc", 50n);
    const proposal = contract.getProposal(0n);
    expect(proposal?.status).toBe("voting");
  });
});
