# Billing policy

**Who pays:** the **school**. Teachers and headmasters never pay personally.
**Price:** **GH₵2.00 per registered student per semester** by default. The Platform Super Admin can change it under *Platform → Settings*.

Everything below is enforced in the database (`supabase/migrations/`), not only in the UI.

## 1. What is counted

A student counts once for a semester if they have a **registration** (`student_enrollments` row) for that semester whose status is not `voided`.

```
billable students = COUNT(DISTINCT student_id)
                    FROM student_enrollments
                    WHERE semester_id = :semester AND status <> 'voided'
amount due        = billable students × price per student
balance           = amount due − sum of valid payments
```

- **No double counting.** There is a unique constraint on `(student_id, semester_id)`, so a student can't be registered twice in the same semester. Running "Register all active students" again does nothing to existing registrations.
- **Duplicate student records are prevented.** Admission numbers are unique per school, case-insensitive. Name + date of birth is also unique per school.
- **Schools are counted separately.** A student who moves to another school on the platform is a different student record there, and each school is billed for its own registrations.

## 2. Status of a registration during the semester

| Event | Registration status | Billable? | Why |
|---|---|---|---|
| Registered (manually or "register all") | `registered` | **Yes** | |
| Class transfer *within* the school | stays `registered`, class updated | **Yes, once** | Same student, same semester |
| Student **withdraws** mid-semester | `withdrawn` (automatic) | **Yes** | The seat was used for that semester |
| Student **transfers out** to another school | `transferred_out` (automatic) | **Yes** | Same as withdrawal |
| Registration was a **mistake** (wrong student, duplicate, never attended) | `voided` (needs a reason) | **No** | See grace period below |
| Withdrawn/voided student comes back in the same semester | back to `registered` | **Yes, still once** | Unique per semester |

**Void grace period:** a headmaster can void a registration within **14 days** of creating it. The Super Admin can change this period in Settings. After the grace period, only the Super Admin can void one, for example after a dispute. Every void needs a written reason, and the change is written to the audit log.

## 3. Late registration

- A semester can have a **registration deadline**. Registrations made after it are flagged `is_late = true`. They are still billable at the same price, and the flag only appears in reports.
- When the headmaster **closes** a semester, no new registrations are accepted for it. Reopening it is audited.

## 4. Billing records (invoices)

- The Super Admin creates or refreshes the billing record for each school's current semester ("Generate / refresh"). The record stores the **student count at that moment**, plus a snapshot of the **price** and **currency**.
- Refreshing later updates the **count** but **keeps the price snapshot**. Changing the platform price therefore affects only records created after the change. To change the price on an existing record, the Super Admin uses *Billing → Terms*, which audits the old and new values.
- The due date defaults to semester start (or today, if later) plus 30 days. This is configurable.
- The headmaster's Billing page also shows a **live** count, which can be higher than the invoiced count if students were registered after the last refresh.

## 5. Payments

- **No automatic "paid" status.** The app does not integrate with a payment provider. A payment shows only after the **Super Admin records it**, having checked the bank or MoMo statement or the receipt. Each payment row stores `verification = 'recorded_by_admin'`. The value `provider_verified` is reserved for a future provider webhook.
- The same `(method, reference)` can't be recorded twice.
- Payments are never deleted. They can be **voided** with a reason, which restores the balance. Both actions are audited.
- **Statuses**
  - Payment status: `unpaid` → `partial` → `paid` (or `overpaid`). A record for zero students is `no_charge`.
  - Renewal status: `renewed` when the balance is ≤ 0, `overdue` when past the due date with a balance, otherwise `pending`.

## 6. Suspension

The Super Admin can suspend a school. Staff of a suspended school lose access to school records, but the headmaster can still see Billing (and semesters, for context) so they can settle the account. All data is kept.

## 7. Audit

Every insert, update or delete on `semester_billing`, `payments`, `platform_settings` and `student_enrollments` writes an `audit_logs` row. The row records the actor, their role, the school, the time, and the changed fields. Headmasters see their own school's entries; the Super Admin sees all.
