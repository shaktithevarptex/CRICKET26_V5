<?php
// ── get_scorecard.php ─────────────────────────────────────────────────────────
// Returns cached scorecard for a match. Falls back to live CricAPI fetch.
// GET: ?match_id=UUID&tournament_id=1[&api_key=override]
// ─────────────────────────────────────────────────────────────────────────────
require 'db.php';

$matchId = trim($_GET['match_id']      ?? '');
$tId     = (int)($_GET['tournament_id'] ?? 0);

if(!$matchId){ http_response_code(400); echo json_encode(['status'=>'failure','reason'=>'match_id required']); exit; }

// Scoped to tournament so two tournaments can have the same match without collision
$where = $tId ? 'AND tournament_id = ?' : '';
$sql   = "SELECT scorecard_raw FROM matches WHERE external_id = ? {$where} LIMIT 1";
$stmt  = $pdo->prepare($sql);
$params= $tId ? [$matchId, $tId] : [$matchId];
$stmt->execute($params);
$row = $stmt->fetch();

if($row && !empty($row['scorecard_raw'])){
  echo json_encode([
    'status'  =>'success',
    'source'  =>'db',
    'match_id'=>$matchId,
    'data'    =>json_decode($row['scorecard_raw'],true),
  ], JSON_UNESCAPED_SLASHES);
  exit;
}

// Not cached — fetch live
$keyRow = $pdo->query("SELECT api_key FROM api_keys WHERE label='scorecard' LIMIT 1")->fetch();
$apiKey = $_GET['api_key'] ?? ($keyRow['api_key'] ?? '');
if(!$apiKey){ http_response_code(400); echo json_encode(['status'=>'failure','reason'=>'No scorecard API key']); exit; }

$url = "https://api.cricapi.com/v1/match_scorecard?apikey=".urlencode($apiKey)."&id=".urlencode($matchId);
$ctx = stream_context_create(['http'=>['timeout'=>20,'ignore_errors'=>true]]);
$txt = @file_get_contents($url, false, $ctx);

if(!$txt){ http_response_code(502); echo json_encode(['status'=>'failure','reason'=>'Could not reach CricAPI']); exit; }
$j = json_decode($txt, true);
if(!$j || ($j['status']??'') !== 'success'){
  echo json_encode(['status'=>'failure','reason'=>$j['reason']??'API failure']); exit;
}

// Cache it for next time (scoped to tournament if we have one)
if($row !== false){ // row exists but no scorecard_raw yet
  $upd = $tId
    ? 'UPDATE matches SET scorecard_raw=? WHERE external_id=? AND tournament_id=?'
    : 'UPDATE matches SET scorecard_raw=? WHERE external_id=?';
  $uParams = $tId
    ? [json_encode($j['data'],JSON_UNESCAPED_SLASHES), $matchId, $tId]
    : [json_encode($j['data'],JSON_UNESCAPED_SLASHES), $matchId];
  $pdo->prepare($upd)->execute($uParams);
}

echo json_encode([
  'status'  =>'success',
  'source'  =>'live',
  'match_id'=>$matchId,
  'data'    =>$j['data'],
], JSON_UNESCAPED_SLASHES);
