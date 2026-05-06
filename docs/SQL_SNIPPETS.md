# SQL Snippets

A grab-bag of ad-hoc SQL queries that keep coming up when poking at the
MLS data warehouse. Each entry has a short description of what the query
does, the query itself, and notes on how to read the result or adjust it.

Queries are Postgres-flavoured unless a snippet explicitly says otherwise.

---

## Listings modified per day (last 60 days)

Bucket every listing by the day portion of its `ModificationTimestamp`
and count how many rows landed on each day. Also emits a short weekday
label (`Mon`, `Tue`, …) so you can eyeball weekly rhythm — feed
ingestion usually has a visible weekday/weekend shape.

```sql
SELECT
    TO_CHAR(date_trunc('day', "ModificationTimestamp"), 'YYYY-MM-DD') AS day,
    TO_CHAR(date_trunc('day', "ModificationTimestamp"), 'Dy') AS w,
    COUNT(*) AS count
FROM listings
WHERE "ModificationTimestamp" >= NOW() - INTERVAL '60 days'
GROUP BY 1
ORDER BY MIN(date_trunc('day', "ModificationTimestamp"));
```

Notes:

- Output columns: `day` (ISO date), `w` (abbreviated weekday), `count`
  (rows modified that day).
- The `GROUP BY 1` groups by the first `SELECT` expression — the
  `YYYY-MM-DD` string — so days with the same ISO label roll up even
  though we re-derive the weekday in column 2.
- `ORDER BY MIN(date_trunc(...))` sorts chronologically by the real
  timestamp rather than alphabetically by the string, which is safer
  across month boundaries.
- Change `INTERVAL '60 days'` to widen or narrow the window. Use
  `NOW() - INTERVAL '1 day'` for a rolling 24h cut, or
  `date_trunc('month', NOW())` for month-to-date.
- To switch the grouping granularity, swap `date_trunc('day', ...)` for
  `'hour'` / `'week'` / `'month'` everywhere it appears.
