/**
 * Claim order for idle queue rows:
 *   1. Due tasks first, earliest due instant wins
 *   2. If none are due, highest priority (lowest `priority` number)
 *
 * A row is due when `past_due` or `next_run_at` is set. The claim query already
 * gates `next_run_at` (NULL or <= now), so a stored next_run_at here means
 * "ready / overdue". The due instant is the earlier of the two timestamps.
 *
 * Tie-breakers (same due instant, or several non-due rows): priority, then
 * never-run first / oldest `completed_at`, then `created_at`.
 */

function toMs(value) {
    if (value == null || value === "") return null;
    const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(t) ? t : null;
}

/** Earlier of `next_run_at` and `past_due`, or null when neither is set. */
export function claimDueInstantMs(row) {
    const nextRun = toMs(row?.next_run_at);
    const pastDue = toMs(row?.past_due);
    if (nextRun == null) return pastDue;
    if (pastDue == null) return nextRun;
    return Math.min(nextRun, pastDue);
}

export function isClaimDue(row) {
    return claimDueInstantMs(row) != null;
}

/**
 * Sort comparator matching {@link applyClaimOrder}. Negative => `a` is claimed first.
 *
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
export function compareClaimCandidates(a, b) {
    const dueA = claimDueInstantMs(a);
    const dueB = claimDueInstantMs(b);
    const aDue = dueA != null;
    const bDue = dueB != null;
    if (aDue !== bDue) return aDue ? -1 : 1;
    if (aDue && dueA !== dueB) return dueA - dueB;

    const priA = Number(a?.priority);
    const priB = Number(b?.priority);
    const pA = Number.isFinite(priA) ? priA : 50;
    const pB = Number.isFinite(priB) ? priB : 50;
    if (pA !== pB) return pA - pB;

    const doneA = toMs(a?.completed_at);
    const doneB = toMs(b?.completed_at);
    if ((doneA == null) !== (doneB == null)) return doneA == null ? -1 : 1;
    if (doneA != null && doneB != null && doneA !== doneB) return doneA - doneB;

    const createdA = toMs(a?.created_at) ?? 0;
    const createdB = toMs(b?.created_at) ?? 0;
    if (createdA !== createdB) return createdA - createdB;
    return 0;
}

/**
 * Knex ORDER BY matching {@link compareClaimCandidates} (must stay in sync so
 * `scanLimit` keeps the rows that should actually be claimed first).
 *
 * @param {import("knex").Knex.QueryBuilder} query
 * @returns {import("knex").Knex.QueryBuilder}
 */
export function applyClaimOrder(query) {
    return query
        .orderByRaw(
            "CASE WHEN past_due IS NOT NULL OR next_run_at IS NOT NULL THEN 0 ELSE 1 END ASC"
        )
        .orderByRaw(
            "LEAST(COALESCE(next_run_at, past_due), COALESCE(past_due, next_run_at)) ASC NULLS LAST"
        )
        .orderBy([{ column: "priority", order: "asc" }])
        .orderByRaw("CASE WHEN completed_at IS NULL THEN 0 ELSE 1 END ASC")
        .orderBy([{ column: "completed_at", order: "asc" }, { column: "created_at", order: "asc" }]);
}
