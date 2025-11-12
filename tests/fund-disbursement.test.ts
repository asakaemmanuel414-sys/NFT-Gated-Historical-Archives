import { describe, it, expect, beforeEach } from "vitest";
import { uintCV, someCV, noneCV, stringUtf8CV, listCV, tupleCV, principalCV, trueCV, falseCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_PROPOSAL_NOT_APPROVED = 101;
const ERR_MILESTONE_NOT_REACHED = 102;
const ERR_INSUFFICIENT_FUNDS = 103;
const ERR_ALREADY_DISBURSED = 104;
const ERR_PROJECT_NOT_FOUND = 105;
const ERR_INVALID_MILESTONE = 106;
const ERR_INVALID_BUDGET = 107;
const ERR_INVALID_INSTITUTION = 108;
const ERR_ORACLE_NOT_SET = 109;
const ERR_MILESTONE_INDEX_OOB = 110;
const ERR_MAX_MILESTONES = 111;

interface Project {
  institution: string;
  totalBudget: bigint;
  disbursed: bigint;
  milestones: bigint[];
  currentMilestone: bigint;
  approved: boolean;
  title: string;
  description: string;
  createdAt: bigint;
  status: string;
}

interface MilestoneProof {
  verified: boolean;
  verifiedAt: bigint;
  verifier: string;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class FundDisbursementMock {
  state: {
    treasuryBalance: bigint;
    proposalContract: string;
    oracle: string;
    nextProjectId: bigint;
    projects: Map<bigint, Project>;
    milestoneProof: Map<string, MilestoneProof>;
  } = {
    treasuryBalance: 0n,
    proposalContract: "ST1PROPOSAL",
    oracle: "ST1ORACLE",
    nextProjectId: 0n,
    projects: new Map(),
    milestoneProof: new Map(),
  };

  caller: string = "ST1CALLER";
  owner: string = "ST1OWNER";
  blockHeight: bigint = 100n;
  stxTransfers: Array<{ amount: bigint; from: string; to: string }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      treasuryBalance: 0n,
      proposalContract: "ST1PROPOSAL",
      oracle: "ST1ORACLE",
      nextProjectId: 0n,
      projects: new Map(),
      milestoneProof: new Map(),
    };
    this.caller = "ST1CALLER";
    this.blockHeight = 100n;
    this.stxTransfers = [];
  }

  setProposalContract(newContract: string): Result<boolean> {
    if (this.caller !== this.owner) return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.proposalContract = newContract;
    return { ok: true, value: true };
  }

  setOracle(newOracle: string): Result<boolean> {
    if (this.caller !== this.owner) return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.oracle = newOracle;
    return { ok: true, value: true };
  }

  depositFunds(amount: bigint): Result<bigint> {
    this.state.treasuryBalance += amount;
    this.stxTransfers.push({ amount, from: this.caller, to: "contract" });
    return { ok: true, value: amount };
  }

  createProject(
    institution: string,
    totalBudget: bigint,
    milestones: bigint[],
    title: string,
    description: string
  ): Result<bigint> {
    if (this.caller !== this.state.proposalContract) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (totalBudget === 0n) return { ok: false, value: ERR_INVALID_BUDGET };
    if (institution === this.caller) return { ok: false, value: ERR_INVALID_INSTITUTION };
    if (milestones.length > 10 || milestones.length === 0) return { ok: false, value: milestones.length > 10 ? ERR_MAX_MILESTONES : ERR_INVALID_MILESTONE };
    const sum = milestones.reduce((a, b) => a + b, 0n);
    if (sum !== totalBudget) return { ok: false, value: ERR_INVALID_BUDGET };
    if (title.length === 0) return { ok: false, value: ERR_INVALID_BUDGET };

    const id = this.state.nextProjectId;
    this.state.projects.set(id, {
      institution,
      totalBudget,
      disbursed: 0n,
      milestones,
      currentMilestone: 0n,
      approved: true,
      title,
      description,
      createdAt: this.blockHeight,
      status: "active",
    });
    this.state.nextProjectId += 1n;
    return { ok: true, value: id };
  }

  verifyMilestone(projectId: bigint, milestoneIndex: bigint): Result<boolean> {
    if (this.caller !== this.state.oracle) return { ok: false, value: ERR_NOT_AUTHORIZED };
    const project = this.state.projects.get(projectId);
    if (!project || !project.approved || project.status !== "active") return { ok: false, value: ERR_PROJECT_NOT_FOUND };
    if (milestoneIndex >= BigInt(project.milestones.length)) return { ok: false, value: ERR_MILESTONE_INDEX_OOB };
    if (milestoneIndex !== project.currentMilestone) return { ok: false, value: ERR_MILESTONE_NOT_REACHED };

    const key = `${projectId}-${milestoneIndex}`;
    this.state.milestoneProof.set(key, { verified: true, verifiedAt: this.blockHeight, verifier: this.caller });
    return { ok: true, value: true };
  }

  disburseMilestone(projectId: bigint, milestoneIndex: bigint): Result<bigint> {
    const project = this.state.projects.get(projectId);
    if (!project) return { ok: false, value: ERR_PROJECT_NOT_FOUND };
    const key = `${projectId}-${milestoneIndex}`;
    const proof = this.state.milestoneProof.get(key);
    if (!proof || !proof.verified) return { ok: false, value: ERR_MILESTONE_NOT_REACHED };
    if (milestoneIndex !== project.currentMilestone) return { ok: false, value: ERR_MILESTONE_NOT_REACHED };
    if (this.state.treasuryBalance < project.milestones[Number(milestoneIndex)]) return { ok: false, value: ERR_INSUFFICIENT_FUNDS };
    if (project.status !== "active") return { ok: false, value: ERR_PROJECT_NOT_FOUND };

    const amount = project.milestones[Number(milestoneIndex)];
    this.state.treasuryBalance -= amount;
    const updated = { ...project, disbursed: project.disbursed + amount, currentMilestone: project.currentMilestone + 1n };
    this.state.projects.set(projectId, updated);
    this.stxTransfers.push({ amount, from: "contract", to: project.institution });

    if (project.currentMilestone + 1n >= BigInt(project.milestones.length)) {
      this.state.projects.set(projectId, { ...updated, status: "completed" });
    }
    return { ok: true, value: amount };
  }

  emergencyWithdraw(amount: bigint, recipient: string): Result<boolean> {
    if (this.caller !== this.owner) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (amount > this.state.treasuryBalance) return { ok: false, value: ERR_INSUFFICIENT_FUNDS };
    this.state.treasuryBalance -= amount;
    this.stxTransfers.push({ amount, from: "contract", to: recipient });
    return { ok: true, value: true };
  }

  cancelProject(projectId: bigint): Result<boolean> {
    if (this.caller !== this.owner) return { ok: false, value: ERR_NOT_AUTHORIZED };
    const project = this.state.projects.get(projectId);
    if (!project || project.status !== "active") return { ok: false, value: ERR_PROJECT_NOT_FOUND };
    this.state.projects.set(projectId, { ...project, status: "cancelled", approved: false });
    return { ok: true, value: true };
  }

  getProject(id: bigint): Project | null {
    return this.state.projects.get(id) || null;
  }

  getTreasuryBalance(): Result<bigint> {
    return { ok: true, value: this.state.treasuryBalance };
  }
}

describe("FundDisbursement", () => {
  let contract: FundDisbursementMock;

  beforeEach(() => {
    contract = new FundDisbursementMock();
    contract.reset();
    contract.caller = contract.owner;
  });

  it("sets proposal contract by owner", () => {
    const result = contract.setProposalContract("ST2NEW");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
  });

  it("rejects non-owner setting proposal contract", () => {
    contract.caller = "ST2HACKER";
    const result = contract.setProposalContract("ST2NEW");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("sets oracle by owner", () => {
    const result = contract.setOracle("ST2ORACLE");
    expect(result.ok).toBe(true);
  });

  it("deposits funds successfully", () => {
    contract.caller = "ST1DONOR";
    const result = contract.depositFunds(1000n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1000n);
    expect(contract.state.treasuryBalance).toBe(1000n);
  });

  it("creates project with valid milestones", () => {
    contract.caller = contract.state.proposalContract;
    const result = contract.createProject(
      "ST1INST",
      3000n,
      [1000n, 1000n, 1000n],
      "Digitize WWII Letters",
      "Preserve veteran correspondence"
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0n);
    const project = contract.getProject(0n);
    expect(project?.totalBudget).toBe(3000n);
    expect(project?.milestones).toEqual([1000n, 1000n, 1000n]);
    expect(project?.status).toBe("active");
  });

  it("rejects project with mismatched milestone sum", () => {
    contract.caller = contract.state.proposalContract;
    const result = contract.createProject("ST1INST", 3000n, [1000n, 1000n], "Title", "Desc");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_BUDGET);
  });

  it("rejects project with more than 10 milestones", () => {
    contract.caller = contract.state.proposalContract;
    const milestones = Array(11).fill(100n);
    const result = contract.createProject("ST1INST", 1100n, milestones, "Title", "Desc");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_MILESTONES);
  });

  it("rejects project with empty title", () => {
    contract.caller = contract.state.proposalContract;
    const result = contract.createProject("ST1INST", 1000n, [1000n], "", "Desc");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_BUDGET);
  });

  it("verifies milestone by oracle", () => {
    contract.caller = contract.state.proposalContract;
    contract.createProject("ST1INST", 1000n, [1000n], "Test", "Desc");
    contract.caller = contract.state.oracle;
    const result = contract.verifyMilestone(0n, 0n);
    expect(result.ok).toBe(true);
  });

  it("rejects non-oracle verifying milestone", () => {
    contract.caller = contract.state.proposalContract;
    contract.createProject("ST1INST", 1000n, [1000n], "Test", "Desc");
    contract.caller = "ST2FAKE";
    const result = contract.verifyMilestone(0n, 0n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("disburses milestone after verification", () => {
    contract.caller = "ST1DONOR";
    contract.depositFunds(1000n);
    contract.caller = contract.state.proposalContract;
    contract.createProject("ST1INST", 1000n, [1000n], "Test", "Desc");
    contract.caller = contract.state.oracle;
    contract.verifyMilestone(0n, 0n);
    contract.caller = "ST1CALLER";
    const result = contract.disburseMilestone(0n, 0n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1000n);
    expect(contract.state.treasuryBalance).toBe(0n);
    expect(contract.getProject(0n)?.status).toBe("completed");
  });

  it("rejects disbursement without verification", () => {
    contract.caller = "ST1DONOR";
    contract.depositFunds(1000n);
    contract.caller = contract.state.proposalContract;
    contract.createProject("ST1INST", 1000n, [1000n], "Test", "Desc");
    const result = contract.disburseMilestone(0n, 0n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MILESTONE_NOT_REACHED);
  });

  it("rejects disbursement with insufficient treasury", () => {
    contract.caller = contract.state.proposalContract;
    contract.createProject("ST1INST", 1000n, [1000n], "Test", "Desc");
    contract.caller = contract.state.oracle;
    contract.verifyMilestone(0n, 0n);
    const result = contract.disburseMilestone(0n, 0n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INSUFFICIENT_FUNDS);
  });

  it("completes project after final milestone", () => {
    contract.caller = "ST1DONOR";
    contract.depositFunds(3000n);
    contract.caller = contract.state.proposalContract;
    contract.createProject("ST1INST", 3000n, [1000n, 2000n], "Test", "Desc");
    contract.caller = contract.state.oracle;
    contract.verifyMilestone(0n, 0n);
    contract.caller = "ST1CALLER";
    contract.disburseMilestone(0n, 0n);
    contract.caller = contract.state.oracle;
    contract.verifyMilestone(0n, 1n);
    contract.caller = "ST1CALLER";
    const result = contract.disburseMilestone(0n, 1n);
    expect(result.ok).toBe(true);
    expect(contract.getProject(0n)?.status).toBe("completed");
  });

  it("allows emergency withdrawal by owner", () => {
    contract.caller = "ST1DONOR";
    contract.depositFunds(500n);
    contract.caller = contract.owner;
    const result = contract.emergencyWithdraw(500n, "ST2RECIPIENT");
    expect(result.ok).toBe(true);
    expect(contract.state.treasuryBalance).toBe(0n);
  });

  it("cancels active project", () => {
    contract.caller = contract.state.proposalContract;
    contract.createProject("ST1INST", 1000n, [1000n], "Test", "Desc");
    contract.caller = contract.owner;
    const result = contract.cancelProject(0n);
    expect(result.ok).toBe(true);
    expect(contract.getProject(0n)?.status).toBe("cancelled");
    expect(contract.getProject(0n)?.approved).toBe(false);
  });

  it("returns correct treasury balance", () => {
    contract.caller = "ST1DONOR";
    contract.depositFunds(2500n);
    const result = contract.getTreasuryBalance();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2500n);
  });
});