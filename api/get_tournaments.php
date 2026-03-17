<?php
require 'db.php';

try{
  $stmt = $pdo->query('SELECT * FROM tournaments ORDER BY id DESC');
  $tournaments = $stmt->fetchAll();

  foreach($tournaments as &$t){

    // ── Decode weekly_captains JSON ──────────────────────────────────────────
    if(!empty($t['weekly_captains'])){
      $wc = json_decode($t['weekly_captains'], true);
      $t['weeklyCaptains'] = is_array($wc) ? $wc : new stdClass();
    } else {
      $t['weeklyCaptains'] = new stdClass();
    }
    unset($t['weekly_captains']);

    // ── Teams for this tournament ────────────────────────────────────────────
    $stmt2 = $pdo->prepare('SELECT * FROM teams WHERE tournament_id = ? ORDER BY id ASC');
    $stmt2->execute([$t['id']]);
    $teams = $stmt2->fetchAll();

    foreach($teams as &$tm){
      $stmt3 = $pdo->prepare('SELECT * FROM players WHERE team_id = ? ORDER BY id ASC');
      $stmt3->execute([$tm['id']]);
      $tm_players = $stmt3->fetchAll();

      foreach($tm_players as &$p){

        // match_points JSON → matchPoints
        if(!empty($p['match_points'])){
          $mp = json_decode($p['match_points'], true);
          $p['matchPoints'] = is_array($mp) ? $mp : new stdClass();
        } else {
          $p['matchPoints'] = new stdClass();
        }
        unset($p['match_points']);

        // snake_case → camelCase for all numeric fields
        $p['totalPoints']   = isset($p['total_points'])   ? (int)$p['total_points']   : 0;
        $p['battingPoints'] = isset($p['batting_points']) ? (int)$p['batting_points'] : 0;
        $p['bowlingPoints'] = isset($p['bowling_points']) ? (int)$p['bowling_points'] : 0;
        $p['fieldingPoints']= isset($p['fielding_points'])? (int)$p['fielding_points']: 0;
        unset($p['total_points'],$p['batting_points'],$p['bowling_points'],$p['fielding_points']);

        $p['isInjured']   = isset($p['is_injured']) ? (bool)$p['is_injured'] : false;
        unset($p['is_injured']);

        // national cricket team (from inning string during scoring)
        $p['cricketTeam'] = $p['cricket_team'] ?? '';
        unset($p['cricket_team']);

        // injury replacement link — name of the player this one replaced
        $p['replacedFor'] = $p['replaced_for'] ?? null;
        unset($p['replaced_for']);

        // country / flag
        $p['country']        = $p['country']        ?? '';
        $p['countryFlagUrl'] = $p['country_flag_url'] ?? '';
        unset($p['country_flag_url']);

        // player_info JSON
        if(!empty($p['player_info'])){
          $p['playerInfo'] = json_decode($p['player_info'], true);
        } else {
          $p['playerInfo'] = new stdClass();
        }
        unset($p['player_info']);

        // price
        $p['price'] = isset($p['price']) ? (float)$p['price'] : 0;

        // id always string
        $p['id'] = (string)$p['id'];
      }
      $tm['players'] = $tm_players;
      $tm['id']      = (string)$tm['id'];
    }
    $t['teams'] = $teams;

    // ── Matches for this tournament ──────────────────────────────────────────
    // Order by match_number ASC (nulls last), then date ASC for knockouts
    $stmtM = $pdo->prepare(
      'SELECT * FROM matches WHERE tournament_id = ?
       ORDER BY CASE WHEN match_number IS NULL THEN 1 ELSE 0 END, match_number ASC, date ASC'
    );
    $stmtM->execute([$t['id']]);
    $matches = $stmtM->fetchAll();

    foreach($matches as &$m){
      // teamInfo JSON
      $m['teamInfo'] = !empty($m['team_info']) ? json_decode($m['team_info'], true) : [];
      unset($m['team_info']);

      // score JSON (stored inside scorecard_raw if available)
      // Don't send full scorecard_raw to frontend — too large
      unset($m['scorecard_raw']);

      // id: prefer external_id (CricAPI UUID)
      $m['id']          = !empty($m['external_id']) ? $m['external_id'] : (string)$m['id'];
      $m['matchNumber'] = isset($m['match_number'])  ? $m['match_number']  : null;
      $m['isScored']    = isset($m['is_scored'])      ? (bool)$m['is_scored'] : false;

      unset($m['external_id'],$m['match_number'],$m['is_scored'],$m['created_at']);
    }
    $t['matches'] = $matches;

    $t['id'] = (string)$t['id'];
  }

  echo json_encode(['status'=>'success','data'=>$tournaments], JSON_UNESCAPED_SLASHES);

} catch(Exception $e){
  http_response_code(500);
  echo json_encode(['status'=>'failure','reason'=>$e->getMessage()]);
}
