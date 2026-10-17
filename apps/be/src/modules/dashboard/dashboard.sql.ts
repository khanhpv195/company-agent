/**
 * Finished work: task runs that completed or failed, plus finished chat replies, per local
 * day, agent and outcome. Params: workspace id, timezone, first day, last day. The
 * `finalized_at` / `ended_at` bounds are sargable (plain column against a computed instant)
 * so the indexes apply; the outer `day` filter stays the exact one.
 */
export const FINISHED_SQL = `
  WITH done AS (
    SELECT a.agent_id,
           (r.finalized_at AT TIME ZONE $2)::date AS day,
           r.status = 'completed' AS ok,
           greatest(1, round(coalesce(r.duration_sec, 0) / 60.0)) AS minutes
    FROM task_runs r JOIN assignments a ON a.id = r.assignment_id
    WHERE r.workspace_id = $1 AND r.status IN ('completed', 'failed')
      AND r.finalized_at >= ($3::date::timestamp AT TIME ZONE $2)
      AND r.finalized_at < (($4::date + 1)::timestamp AT TIME ZONE $2)
    UNION ALL
    SELECT a.agent_id,
           (a.ended_at AT TIME ZONE $2)::date,
           a.status = 'completed',
           greatest(1, round(extract(epoch FROM (a.ended_at - coalesce(a.started_at, a.created_at))) / 60.0))
    FROM assignments a
    WHERE a.workspace_id = $1 AND a.source_kind = 'chat'
      AND a.status IN ('completed', 'failed') AND a.ended_at >= ($3::date::timestamp AT TIME ZONE $2)
      AND a.ended_at < (($4::date + 1)::timestamp AT TIME ZONE $2)
  )
  SELECT to_char(day, 'YYYY-MM-DD') AS day, agent_id, ok,
         count(*)::int AS count, sum(minutes)::int AS minutes
  FROM done
  WHERE day BETWEEN $3::date AND $4::date
  GROUP BY day, agent_id, ok`;
