(define-constant CONTRACT-OWNER tx-sender)
(define-constant ERR-NOT-AUTHORIZED (err u100))
(define-constant ERR-PROPOSAL-NOT-APPROVED (err u101))
(define-constant ERR-MILESTONE-NOT-REACHED (err u102))
(define-constant ERR-INSUFFICIENT-FUNDS (err u103))
(define-constant ERR-ALREADY-DISBURSED (err u104))
(define-constant ERR-PROJECT-NOT-FOUND (err u105))
(define-constant ERR-INVALID-MILESTONE (err u106))
(define-constant ERR-INVALID-BUDGET (err u107))
(define-constant ERR-INVALID-INSTITUTION (err u108))
(define-constant ERR-ORACLE-NOT-SET (err u109))
(define-constant ERR-MILESTONE-INDEX-OOB (err u110))
(define-constant ERR-MAX-MILESTONES (err u111))

(define-data-var treasury-balance uint u0)
(define-data-var proposal-contract principal tx-sender)
(define-data-var oracle principal tx-sender)
(define-data-var next-project-id uint u0)

(define-map projects 
  uint 
  {
    institution: principal,
    total-budget: uint,
    disbursed: uint,
    milestones: (list 10 uint),
    current-milestone: uint,
    approved: bool,
    title: (string-utf8 120),
    description: (string-utf8 500),
    created-at: uint,
    status: (string-ascii 20)
  }
)

(define-map milestone-proof 
  { project-id: uint, milestone-index: uint } 
  { verified: bool, verified-at: uint, verifier: principal }
)

(define-read-only (get-project (id uint))
  (map-get? projects id)
)

(define-read-only (get-milestone-proof (project-id uint) (milestone-index uint))
  (map-get? milestone-proof { project-id: project-id, milestone-index: milestone-index })
)

(define-read-only (get-treasury-balance)
  (ok (var-get treasury-balance))
)

(define-read-only (get-next-project-id)
  (ok (var-get next-project-id))
)

(define-read-only (is-oracle (caller principal))
  (is-eq caller (var-get oracle))
)

(define-public (set-proposal-contract (new-contract principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (var-set proposal-contract new-contract)
    (ok true)
  )
)

(define-public (set-oracle (new-oracle principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (var-set oracle new-oracle)
    (ok true)
  )
)

(define-public (deposit-funds)
  (let ((amount (stx-get-balance tx-sender)))
    (var-set treasury-balance (+ (var-get treasury-balance) amount))
    (stx-transfer? amount tx-sender (as-contract tx-sender))
  )
)

(define-public (create-project 
  (institution principal)
  (total-budget uint)
  (milestones (list 10 uint))
  (title (string-utf8 120))
  (description (string-utf8 500))
)
  (let (
        (project-id (var-get next-project-id))
        (milestone-sum (fold + milestones u0))
      )
    (asserts! (is-eq tx-sender (var-get proposal-contract)) ERR-NOT-AUTHORIZED)
    (asserts! (> total-budget u0) ERR-INVALID-BUDGET)
    (asserts! (not (is-eq institution tx-sender)) ERR-INVALID-INSTITUTION)
    (asserts! (<= (len milestones) u10) ERR-MAX-MILESTONES)
    (asserts! (> (len milestones) u0) ERR-INVALID-MILESTONE)
    (asserts! (is-eq milestone-sum total-budget) ERR-INVALID-BUDGET)
    (asserts! (> (len title) u0) ERR-INVALID-BUDGET)
    (map-set projects project-id
      {
        institution: institution,
        total-budget: total-budget,
        disbursed: u0,
        milestones: milestones,
        current-milestone: u0,
        approved: true,
        title: title,
        description: description,
        created-at: block-height,
        status: "active"
      }
    )
    (var-set next-project-id (+ project-id u1))
    (print { event: "project-created", id: project-id, budget: total-budget })
    (ok project-id)
  )
)

(define-public (verify-milestone (project-id uint) (milestone-index uint))
  (let (
        (project (unwrap! (map-get? projects project-id) ERR-PROJECT-NOT-FOUND))
        (milestones (get milestones project))
        (current (get current-milestone project))
      )
    (asserts! (is-oracle tx-sender) ERR-NOT-AUTHORIZED)
    (asserts! (get approved project) ERR-PROPOSAL-NOT-APPROVED)
    (asserts! (is-eq (get status project) "active") ERR-PROJECT-NOT-FOUND)
    (asserts! (< milestone-index (len milestones)) ERR-MILESTONE-INDEX-OOB)
    (asserts! (is-eq milestone-index current) ERR-MILESTONE-NOT-REACHED)
    (map-set milestone-proof 
      { project-id: project-id, milestone-index: milestone-index }
      { verified: true, verified-at: block-height, verifier: tx-sender }
    )
    (print { event: "milestone-verified", project-id: project-id, index: milestone-index })
    (ok true)
  )
)

(define-public (disburse-milestone (project-id uint) (milestone-index uint))
  (let (
        (project (unwrap! (map-get? projects project-id) ERR-PROJECT-NOT-FOUND))
        (proof (unwrap! (map-get? milestone-proof { project-id: project-id, milestone-index: milestone-index }) ERR-MILESTONE-NOT-REACHED))
        (milestones (get milestones project))
        (milestone-amount (unwrap! (element-at milestones milestone-index) ERR-MILESTONE-INDEX-OOB))
        (current (get current-milestone project))
        (disbursed (get disbursed project))
      )
    (asserts! (get verified proof) ERR-MILESTONE-NOT-REACHED)
    (asserts! (is-eq milestone-index current) ERR-MILESTONE-NOT-REACHED)
    (asserts! (>= (var-get treasury-balance) milestone-amount) ERR-INSUFFICIENT-FUNDS)
    (asserts! (is-eq (get status project) "active") ERR-PROJECT-NOT-FOUND)
    (var-set treasury-balance (- (var-get treasury-balance) milestone-amount))
    (map-set projects project-id
      (merge project {
        disbursed: (+ disbursed milestone-amount),
        current-milestone: (+ current u1)
      })
    )
    (match (element-at milestones (+ milestone-index u1))
      next-milestone (ok true)
      (begin
        (map-set projects project-id
          (merge project { status: "completed" })
        )
        (ok true)
      )
    )
    (try! (as-contract (stx-transfer? milestone-amount tx-sender (get institution project))))
    (print { event: "milestone-disbursed", project-id: project-id, amount: milestone-amount, to: (get institution project) })
    (ok milestone-amount)
  )
)

(define-public (emergency-withdraw (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (asserts! (<= amount (var-get treasury-balance)) ERR-INSUFFICIENT-FUNDS)
    (var-set treasury-balance (- (var-get treasury-balance) amount))
    (as-contract (stx-transfer? amount tx-sender recipient))
  )
)

(define-public (cancel-project (project-id uint))
  (let ((project (unwrap! (map-get? projects project-id) ERR-PROJECT-NOT-FOUND)))
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (asserts! (is-eq (get status project) "active") ERR-PROJECT-NOT-FOUND)
    (map-set projects project-id
      (merge project { status: "cancelled", approved: false }))
    (ok true)
  )
)

(define-read-only (calculate-remaining-budget (project-id uint))
  (match (map-get? projects project-id)
    project (ok (- (get total-budget project) (get disbursed project)))
    (err ERR-PROJECT-NOT-FOUND)
  )
)