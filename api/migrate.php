<?php
require 'db.php';
$body = json_decode(file_get_contents('php://input'), true);
if(!$body || !is_array($body)){ http_response_code(400); echo json_encode(['status'=>'failure','reason'=>'Expected array of tournaments']); exit; }
$inserted = 0;
try{
  foreach($body as $t){
    $pdo->beginTransaction();
    $stmt = $pdo->prepare('INSERT INTO tournaments (name, series_id, status, start_date, created_at) VALUES (?,?,?,?,?)');
    $stmt->execute([$t['name'],$t['seriesId'] ?? null,$t['status'] ?? 'active',$t['startDate'] ?? date('Y-m-d'),$t['createdAt'] ?? time()]);
    $tId = $pdo->lastInsertId();
    foreach($t['teams'] as $team){
      $stmt = $pdo->prepare('INSERT INTO teams (tournament_id, name, owner, players_count) VALUES (?,?,?,?)');
      $stmt->execute([$tId,$team['name'],$team['owner'] ?? $team['name'], count($team['players'] ?? [])]);
      $teamId = $pdo->lastInsertId();
      foreach($team['players'] as $p){
        $stmt = $pdo->prepare('INSERT INTO players (team_id, name, original_name, price, total_points, batting_points, bowling_points, fielding_points, match_points, is_injured) VALUES (?,?,?,?,?,?,?,?,?,?)');
        $mp = isset($p['matchPoints']) ? json_encode($p['matchPoints']) : json_encode(new stdClass());
        $stmt->execute([$teamId,$p['name'],$p['originalName'] ?? $p['name'],$p['price'] ?? 0,$p['totalPoints'] ?? 0,$p['battingPoints'] ?? 0,$p['bowlingPoints'] ?? 0,$p['fieldingPoints'] ?? 0,$mp,isset($p['isInjured'])?($p['isInjured']?1:0):0]);
      }
    }
    $pdo->commit();
    $inserted++;
  }
  echo json_encode(['status'=>'success','inserted'=>$inserted]);
} catch(Exception $e){ $pdo->rollBack(); http_response_code(500); echo json_encode(['status'=>'failure','reason'=>$e->getMessage()]); }
