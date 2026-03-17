<?php
require 'db.php';

$body = json_decode(file_get_contents('php://input'), true);
if(!$body || !isset($body['id'])){
  http_response_code(400);
  echo json_encode(['status'=>'failure','reason'=>'Missing id']);
  exit;
}

$tId = (int)$body['id'];

try{
  $pdo->beginTransaction();

  // ── 1. Update tournament row ─────────────────────────────────────────────
  $wc = isset($body['weeklyCaptains'])
    ? json_encode($body['weeklyCaptains'], JSON_UNESCAPED_SLASHES)
    : null;

  // Always overwrite weekly_captains — supports deletions.
  // If frontend doesn't send it (null), keep existing value.
  $stmt_t = $pdo->prepare(
    'UPDATE tournaments
     SET name=?, series_id=?, status=?, start_date=?,
         weekly_captains = IF(? IS NOT NULL, ?, weekly_captains)
     WHERE id=?'
  );
  $stmt_t->execute([
    $body['name'],
    $body['seriesId']  ?? null,
    $body['status']    ?? 'active',
    $body['startDate'] ?? date('Y-m-d'),
    $wc, $wc,
    $tId
  ]);

  // ── 2. Delete all existing teams+players for THIS tournament only ─────────
  $existingTeams = $pdo->prepare('SELECT id FROM teams WHERE tournament_id=?');
  $existingTeams->execute([$tId]);
  foreach($existingTeams->fetchAll() as $tm){
    $pdo->prepare('DELETE FROM players WHERE team_id=?')->execute([$tm['id']]);
  }
  $pdo->prepare('DELETE FROM teams WHERE tournament_id=?')->execute([$tId]);

  // ── 3. Re-insert teams and players ───────────────────────────────────────
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
      // Preserve full match_points JSON so scoring history is never lost
      $mp = null;
      if(isset($p['matchPoints']) && !empty($p['matchPoints'])){
        $mp = json_encode($p['matchPoints'], JSON_UNESCAPED_SLASHES);
      }

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
        $p['cricketTeam']    ?? $p['cricket_team'] ?? null,
        $p['replacedFor']    ?? null   // name of injured player this replaces
      ]);
    }
  }

  // ── 4. Matches: soft update — only delete/re-insert if matches are sent ───
  // If frontend sends matches array, rebuild it entirely for THIS tournament.
  // We preserve scorecard_raw and is_scored for matches that already exist.
  if(isset($body['matches']) && is_array($body['matches'])){

    // Capture existing scorecard_raw and is_scored by external_id before delete
    $existing = $pdo->prepare(
      'SELECT external_id, scorecard_raw, is_scored FROM matches WHERE tournament_id=?'
    );
    $existing->execute([$tId]);
    $scorecardCache = [];
    foreach($existing->fetchAll() as $row){
      if($row['external_id']){
        $scorecardCache[$row['external_id']] = [
          'scorecard_raw' => $row['scorecard_raw'],
          'is_scored'     => $row['is_scored'],
        ];
      }
    }

    $pdo->prepare('DELETE FROM matches WHERE tournament_id=?')->execute([$tId]);

    $stmtM = $pdo->prepare(
      'INSERT INTO matches
         (tournament_id, external_id, name, match_number, date, venue,
          status, result, team_info, is_scored, scorecard_raw, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
    );

    foreach($body['matches'] as $m){
      $extId       = $m['id']          ?? null;
      $teamInfoJson= !empty($m['teamInfo']) ? json_encode($m['teamInfo'], JSON_UNESCAPED_SLASHES) : null;
      $matchNum    = isset($m['matchNumber']) ? (int)$m['matchNumber'] : null;
      $isScored    = isset($m['isScored'])    ? ($m['isScored'] ? 1 : 0) : 0;
      $scRaw       = null;

      // Restore cached scorecard_raw and is_scored if match already existed
      if($extId && isset($scorecardCache[$extId])){
        $scRaw    = $scorecardCache[$extId]['scorecard_raw'];
        $isScored = max($isScored, (int)$scorecardCache[$extId]['is_scored']);
      }

      $stmtM->execute([
        $tId,
        $extId,
        $m['name']   ?? null,
        $matchNum,
        $m['date']   ?? null,
        $m['venue']  ?? null,
        $m['status'] ?? null,
        $m['result'] ?? null,
        $teamInfoJson,
        $isScored,
        $scRaw,
        time()
      ]);
    }
  }

  $pdo->commit();
  echo json_encode(['status'=>'success']);

} catch(Exception $e){
  $pdo->rollBack();
  http_response_code(500);
  echo json_encode(['status'=>'failure','reason'=>$e->getMessage()]);
}
