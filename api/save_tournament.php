<?php
require 'db.php';

$body = json_decode(file_get_contents('php://input'), true);
if(!$body){ http_response_code(400); echo json_encode(['status'=>'failure','reason'=>'Invalid JSON']); exit; }

try{
  $pdo->beginTransaction();

  // ── Insert tournament ────────────────────────────────────────────────────
  $pdo->prepare(
    'INSERT INTO tournaments (name, series_id, status, start_date, weekly_captains, created_at)
     VALUES (?,?,?,?,?,?)'
  )->execute([
    $body['name'],
    $body['seriesId'] ?? null,
    $body['status']   ?? 'active',
    $body['startDate'] ?? date('Y-m-d'),
    isset($body['weeklyCaptains']) ? json_encode($body['weeklyCaptains'], JSON_UNESCAPED_SLASHES) : null,
    time()
  ]);
  $tId = $pdo->lastInsertId();

  // ── Insert teams + players ───────────────────────────────────────────────
  foreach(($body['teams'] ?? []) as $team){
    $pdo->prepare(
      'INSERT INTO teams (tournament_id, name, owner, players_count) VALUES (?,?,?,?)'
    )->execute([
      $tId,
      $team['name'],
      $team['owner'] ?? $team['name'],
      count($team['players'] ?? [])
    ]);
    $teamId = $pdo->lastInsertId();

    foreach(($team['players'] ?? []) as $p){
      $mp = (!empty($p['matchPoints']))
        ? json_encode($p['matchPoints'], JSON_UNESCAPED_SLASHES)
        : null;

      $pdo->prepare(
        'INSERT INTO players
           (team_id, name, original_name, price,
            total_points, batting_points, bowling_points, fielding_points,
            match_points, is_injured, cricket_team, replaced_for)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
      )->execute([
        $teamId,
        $p['name'],
        $p['originalName']   ?? $p['name'],
        $p['price']          ?? 0,
        $p['totalPoints']    ?? 0,
        $p['battingPoints']  ?? 0,
        $p['bowlingPoints']  ?? 0,
        $p['fieldingPoints'] ?? 0,
        $mp,
        isset($p['isInjured']) ? ($p['isInjured'] ? 1 : 0) : 0,
        $p['cricketTeam']    ?? null,
        $p['replacedFor']    ?? null
      ]);
    }
  }

  // ── Insert matches if provided ───────────────────────────────────────────
  if(!empty($body['matches']) && is_array($body['matches'])){
    $stmtM = $pdo->prepare(
      'INSERT INTO matches
         (tournament_id, external_id, name, match_number, date, venue,
          status, result, team_info, is_scored, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,0,?)'
    );
    foreach($body['matches'] as $m){
      $teamInfoJson = !empty($m['teamInfo']) ? json_encode($m['teamInfo'], JSON_UNESCAPED_SLASHES) : null;
      $matchNum     = isset($m['matchNumber']) ? (int)$m['matchNumber'] : null;
      $stmtM->execute([
        $tId,
        $m['id']     ?? null,
        $m['name']   ?? null,
        $matchNum,
        $m['date']   ?? null,
        $m['venue']  ?? null,
        $m['status'] ?? null,
        $m['result'] ?? null,
        $teamInfoJson,
        time()
      ]);
    }
  }

  $pdo->commit();
  echo json_encode(['status'=>'success','id'=>$tId]);

} catch(Exception $e){
  $pdo->rollBack();
  http_response_code(500);
  echo json_encode(['status'=>'failure','reason'=>$e->getMessage()]);
}
