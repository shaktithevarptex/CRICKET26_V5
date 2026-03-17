<?php
require 'db.php';

// Sync match scorecards from CricAPI.
// Usage: GET api/sync_matches.php?apikey=YOUR_KEY[&mode=full]
set_time_limit(0);
$apikey = isset($_GET['apikey']) ? $_GET['apikey'] : null;
$mode = isset($_GET['mode']) ? strtolower($_GET['mode']) : 'sync'; // 'full' or 'sync'
if(!$apikey){ http_response_code(400); echo json_encode(['status'=>'failure','reason'=>'apikey required']); exit; }

$out = ['status'=>'success','mode'=>$mode,'fetched'=>0,'updated'=>0,'errors'=>[]];

try{
  if($mode === 'full'){
    $stmt = $pdo->query("SELECT id, external_id FROM matches WHERE external_id IS NOT NULL AND external_id != ''");
  } else {
    // default sync: only today's or recent matches (ongoing)
    $stmt = $pdo->query("SELECT id, external_id FROM matches WHERE external_id IS NOT NULL AND external_id != '' AND (DATE(date) = CURDATE() OR status LIKE '%LIVE%' OR status LIKE '%ONGO%' OR (date BETWEEN DATE_SUB(NOW(), INTERVAL 1 DAY) AND DATE_ADD(NOW(), INTERVAL 1 DAY)))");
  }
  $rows = $stmt->fetchAll();
  foreach($rows as $r){
    $mid = $r['external_id'];
    if(!$mid) continue;
    $url = 'https://api.cricapi.com/v1/match_scorecard?apikey=' . urlencode($apikey) . '&id=' . urlencode($mid);
    $ctx = stream_context_create(['http'=>['timeout'=>20]]);
    $txt = @file_get_contents($url, false, $ctx);
    $out['fetched']++;
    if(!$txt){ $out['errors'][] = ['id'=>$mid,'reason'=>'no response']; continue; }
    $j = json_decode($txt, true);
    if(!$j || !isset($j['status']) || $j['status'] !== 'success'){ $out['errors'][] = ['id'=>$mid,'reason'=>'api failure','raw'=>$j]; continue; }
    // store useful bits in matches table
    $teamInfo = isset($j['data']) ? $j['data'] : $j;
    $status = isset($teamInfo['status']) ? $teamInfo['status'] : (isset($j['status']) ? $j['status'] : null);
    $result = null;
    if(isset($teamInfo['score'])){
      $result = is_string($teamInfo['score']) ? $teamInfo['score'] : json_encode($teamInfo['score']);
    } elseif(isset($teamInfo['matchSummary'])){
      $result = json_encode($teamInfo['matchSummary']);
    }
    $teamInfoJson = json_encode($teamInfo, JSON_UNESCAPED_SLASHES);
    $update = $pdo->prepare('UPDATE matches SET team_info = ?, status = ?, result = ?, created_at = ? WHERE id = ?');
    $update->execute([$teamInfoJson, $status, $result, time(), $r['id']]);
    $out['updated']++;
  }
} catch(Exception $e){ http_response_code(500); $out['status']='failure'; $out['reason']=$e->getMessage(); }

echo json_encode($out, JSON_UNESCAPED_SLASHES);
