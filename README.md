# 📜 NFT-Gated Historical Archives

Welcome to a revolutionary Web3 platform that democratizes access to historical archives while funding their digitization! This project addresses the real-world problem of underfunded historical preservation: many invaluable documents, artifacts, and records remain locked in physical vaults, deteriorating over time due to lack of resources for digitization. By leveraging NFTs on the Stacks blockchain (using Clarity smart contracts), users can purchase gated access to digitized content, with proceeds directly funding ongoing digitization efforts through transparent, community-driven crowdfunding.

## ✨ Features

- **NFT-Based Access Control**: Mint and own NFTs that unlock tiered access to digitized historical archives (e.g., basic viewers vs. premium researchers).
- **Crowdfunding for Digitization**: Propose and vote on new digitization projects, with NFT sales and donations automatically allocated to approved initiatives.
- **Immutable Provenance Tracking**: Every digitized item is hashed and timestamped on-chain for verifiable authenticity and ownership history.
- **Community Governance**: NFT holders participate in DAO-style decisions on what archives to prioritize for digitization.
- **Royalty Distribution**: Creators or institutions uploading archives receive ongoing royalties from secondary NFT sales.
- **Secure Content Delivery**: Off-chain storage (e.g., IPFS) integrated with on-chain verification to ensure only NFT holders can access high-res files.
- **Analytics and Reporting**: Transparent dashboards showing fund usage, digitization progress, and community impact.

## 🛠 How It Works

This project is built entirely with Clarity smart contracts on the Stacks blockchain, ensuring security, transparency, and decentralization. It involves 8 core smart contracts to handle various aspects of the ecosystem:

1. **NFT-Minter Contract**: Handles minting of access NFTs with different tiers (e.g., bronze for basic access, gold for full archives). Users call `mint-nft` with payment in STX, which triggers token creation and funds allocation.
2. **Access-Gate Contract**: Verifies NFT ownership to grant access. Integrates with off-chain services via oracles; call `check-access` with user principal and NFT ID to confirm permissions.
3. **Crowdfund-Proposal Contract**: Allows users to submit digitization proposals (e.g., "Digitize 19th-century maps"). Includes functions like `submit-proposal` with details, budget, and timeline.
4. **Voting-DAO Contract**: NFT holders vote on proposals using `vote-on-proposal`. Uses weighted voting based on NFT tiers; tallies results immutably.
5. **Fund-Disbursement Contract**: Manages treasury funds from NFT sales. Automatically releases funds to approved projects via `disburse-funds` after milestones are met (verified by oracles).
6. **Provenance-Tracker Contract**: Registers digitized items with hashes, timestamps, and metadata. Call `register-archive` to store immutable records and prevent duplicates.
7. **Royalty-Distributor Contract**: Enforces royalties on secondary NFT transfers. Uses `transfer-nft` to calculate and distribute percentages to original uploaders or institutions.
8. **Analytics-Reporter Contract**: Provides read-only queries like `get-fund-usage` or `get-digitization-stats` for transparent reporting on-chain.

**For Users (Archive Enthusiasts)**
- Browse available digitized archives on the frontend.
- Purchase an NFT via the NFT-Minter contract (pay in STX, which partially funds the treasury).
- Use your NFT to unlock content: The Access-Gate contract verifies ownership before serving files from IPFS.

**For Contributors (Institutions or Historians)**
- Upload digitized content hashes and metadata to the Provenance-Tracker contract.
- Propose new digitization projects through the Crowdfund-Proposal contract.
- Earn royalties as NFTs tied to your contributions are resold.

**For Community Members**
- Hold NFTs to vote in the Voting-DAO contract on what gets digitized next.
- Track progress via the Analytics-Reporter contract for full transparency.

Boom! Your participation not only grants you exclusive access but also preserves history for future generations. Funds are locked in smart contracts, ensuring they can only be used for approved digitization efforts—no middlemen, no waste.

## 🚀 Getting Started

- **Tech Stack**: Clarity for all smart contracts, Stacks blockchain for deployment, IPFS for content storage, and a simple React frontend for user interaction.
- **Deployment**: Deploy contracts using Clarinet (Stacks dev tool). Start with the NFT-Minter and build from there.
- **Example Usage**: In Clarity, a basic mint function might look like:
  ```
  (define-public (mint-nft (tier uint) (recipient principal))
    (let ((id (var-get next-id)))
      (try! (stx-transfer? (calculate-price tier) tx-sender treasury))
      (map-set nfts id {owner: recipient, tier: tier})
      (var-set next-id (+ id u1))
      (ok id)))
  ```
  Extend this across the 8 contracts for full functionality.

This project empowers communities to preserve cultural heritage while creating economic incentives—turning history into a sustainable, decentralized asset!