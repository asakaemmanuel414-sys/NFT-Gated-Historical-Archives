;; proposal.clar
(define-constant CONTRACT-OWNER tx-sender)
(define-constant ERR-NOT-AUTHORIZED (err u200))
(define-constant ERR-PROPOSAL-EXISTS (err u201))
(define-constant ERR-PROPOSAL-NOT-FOUND (err u202))
(define-constant ERR-INVALID-BUDGET (err u203))
(define-constant ERR-INVALID-MILESTONES (err u204))
(define-constant ERR-INVALID-TITLE (err u205))
(define-constant ERR-INVALID-DESCRIPTION (err u206))
(define-constant ERR-PROPOSAL-CLOSED (err u207))
(define-constant ERR-ALREADY-VOTED (err u208))
(define-constant ERR-INSUFFICIENT-VOTES (err u209))
(define-constant ERR-VOTING-NOT-STARTED (err u210))
(define-constant ERR-PROPOSAL-REJECTED (err u211))
(define-constant ERR-MAX-MILESTONES (err u212))

(define-data-var fund-disbursement-contract principal tx-sender)
(define-data-var next-proposal-id uint u0)
(define-data-var min-votes-required uint u3)

(define-map proposals
  uint
  {
    proposer: principal,
    institution: principal,
    total-budget: uint,
    milestones: (list 10 uint),
    title: (string-utf8 120),
    description: (string-utf8 500),
    created-at: uint,
    status: (string-ascii 20),
    votes-for: uint,
    votes-against: uint,
    voting-end: uint
  }
)

(define-map votes { proposal-id: uint, voter: principal } { vote: bool })

(define-read-only (get-proposal (id uint))
  (map-get? proposals id)
)

(define-read-only (get-vote (proposal-id uint) (voter principal))
  (map-get? votes { proposal-id: proposal-id, voter: voter })
)

(define-read-only (get-next-proposal-id)
  (ok (var-get next-proposal-id))
)

(define-read-only (get-min-votes-required)
  (ok (var-get min-votes-required))
)

(define-public (set-fund-disbursement-contract (new-contract principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (var-set fund-disbursement-contract new-contract)
    (ok true)
  )
)

(define-public (set-min-votes-required (new-min uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (asserts! (> new-min u0) ERR-INVALID-BUDGET)
    (var-set min-votes-required new-min)
    (ok true)
  )
)

(define-public (submit-proposal
  (institution principal)
  (total-budget uint)
  (milestones (list 10 uint))
  (title (string-utf8 120))
  (description (string-utf8 500))
  (voting-duration uint)
)
  (let (
        (proposal-id (var-get next-proposal-id))
        (milestone-sum (fold + milestones u0))
        (end-block (+ block-height voting-duration))
      )
    (asserts! (> total-budget u0) ERR-INVALID-BUDGET)
    (asserts! (<= (len milestones) u10) ERR-MAX-MILESTONES)
    (asserts! (> (len milestones) u0) ERR-INVALID-MILESTONES)
    (asserts! (is-eq milestone-sum total-budget) ERR-INVALID-BUDGET)
    (asserts! (> (len title) u0) ERR-INVALID-TITLE)
    (asserts! (> (len description) u0) ERR-INVALID-DESCRIPTION)
    (asserts! (> voting-duration u0) ERR-INVALID-BUDGET)
    (map-set proposals proposal-id
      {
        proposer: tx-sender,
        institution: institution,
        total-budget: total-budget,
        milestones: milestones,
        title: title,
        description: description,
        created-at: block-height,
        status: "voting",
        votes-for: u0,
        votes-against: u0,
        voting-end: end-block
      }
    )
    (var-set next-proposal-id (+ proposal-id u1))
    (print { event: "proposal-submitted", id: proposal-id, budget: total-budget, end: end-block })
    (ok proposal-id)
  )
)

(define-public (vote-on-proposal (proposal-id uint) (support bool))
  (let ((proposal (unwrap! (map-get? proposals proposal-id) ERR-PROPOSAL-NOT-FOUND)))
    (asserts! (is-eq (get status proposal) "voting") ERR-PROPOSAL-CLOSED)
    (asserts! (<= block-height (get voting-end proposal)) ERR-PROPOSAL-CLOSED)
    (asserts! (is-none (map-get? votes { proposal-id: proposal-id, voter: tx-sender })) ERR-ALREADY-VOTED)
    (map-set votes { proposal-id: proposal-id, voter: tx-sender } { vote: support })
    (if support
      (map-set proposals proposal-id
        (merge proposal { votes-for: (+ (get votes-for proposal) u1) }))
      (map-set proposals proposal-id
        (merge proposal { votes-against: (+ (get votes-against proposal) u1) }))
    )
    (print { event: "vote-cast", proposal-id: proposal-id, voter: tx-sender, support: support })
    (ok true)
  )
)

(define-public (finalize-proposal (proposal-id uint))
  (let (
        (proposal (unwrap! (map-get? proposals proposal-id) ERR-PROPOSAL-NOT-FOUND))
        (total-votes (+ (get votes-for proposal) (get votes-against proposal)))
      )
    (asserts! (> block-height (get voting-end proposal)) ERR-VOTING-NOT-STARTED)
    (asserts! (is-eq (get status proposal) "voting") ERR-PROPOSAL-CLOSED)
    (if (>= (get votes-for proposal) (var-get min-votes-required))
      (begin
        (map-set proposals proposal-id
          (merge proposal { status: "approved" }))
        (try! (contract-call? (var-get fund-disbursement-contract) create-project
          (get institution proposal)
          (get total-budget proposal)
          (get milestones proposal)
          (get title proposal)
          (get description proposal)
        ))
        (print { event: "proposal-approved", id: proposal-id })
        (ok true)
      )
      (begin
        (map-set proposals proposal-id
          (merge proposal { status: "rejected" }))
        (print { event: "proposal-rejected", id: proposal-id })
        (ok false)
      )
    )
  )
)

(define-public (cancel-proposal (proposal-id uint))
  (let ((proposal (unwrap! (map-get? proposals proposal-id) ERR-PROPOSAL-NOT-FOUND)))
    (asserts! (is-eq tx-sender (get proposer proposal)) ERR-NOT-AUTHORIZED)
    (asserts! (is-eq (get status proposal) "voting") ERR-PROPOSAL-CLOSED)
    (map-set proposals proposal-id
      (merge proposal { status: "cancelled" }))
    (ok true)
  )
)

(define-read-only (is-proposal-active (proposal-id uint))
  (match (map-get? proposals proposal-id)
    proposal (and (is-eq (get status proposal) "voting") (<= block-height (get voting-end proposal)))
    false
  )
)

(define-read-only (get-proposal-status (proposal-id uint))
  (match (map-get? proposals proposal-id)
    proposal (ok (get status proposal))
    (err ERR-PROPOSAL-NOT-FOUND)
  )
)