<?php
// ── fetch_series_matches.php ──────────────────────────────────────────────────
// Fetches match schedule from CricAPI series_info and stores NEW matches
// for a SPECIFIC tournament only. Existing match IDs (per tournament) are skipped.
// POST: { "tournament_id": 1, "series_id": "...", "api_key": "..." }
// ─────────────────────────────────────────────────────────────────────────────
require 'db.php';

$body = json_decode(file_get_contents('php://input'), true);
if(!$body || !isset($body['tournament_id']) || !isset($body['series_id'])){
  http_response_code(400); echo json_encode(['status'=>'failure','reason'=>'Missing tournament_id or series_id']); exit;
}

$tId      = (int)trim($body['tournament_id']);
$seriesId = trim($body['series_id']);

// Verify tournament exists
$tCheck = $pdo->prepare('SELECT id FROM tournaments WHERE id=?');
$tCheck->execute([$tId]);
if(!$tCheck->fetch()){
  echo json_encode(['status'=>'failure','reason'=>'Tournament not found']); exit;
}

// Get API key
$keyRow = $pdo->query("SELECT api_key FROM api_keys WHERE label='series_fetch' LIMIT 1")->fetch();
$apiKey = $body['api_key'] ?? ($keyRow['api_key'] ?? '');
if(!$apiKey){ echo json_encode(['status'=>'failure','reason'=>'No API key']); exit; }

// Call series_info
$url = "https://api.cricapi.com/v1/series_info?apikey=".urlencode($apiKey)."&id=".urlencode($seriesId)."&offset=0";
$ctx = stream_context_create(['http'=>['timeout'=>20,'ignore_errors'=>true]]);
$txt = @file_get_contents($url, false, $ctx);
if(!$txt){ http_response_code(502); echo json_encode(['status'=>'failure','reason'=>'Could not reach CricAPI']); exit; }

$j = json_decode($txt, true);
if(!$j || ($j['status']??'') !== 'success'){
  echo json_encode(['status'=>'failure','reason'=>$j['reason']??'API failure']); exit;
}

$matchList  = array_values($j['data']['matchList'] ?? []);
$seriesName = $j['data']['info']['name'] ?? $seriesId;
$hitsToday  = $j['info']['hitsToday'] ?? 0;

function parseMatchNumber(string $name): ?int {
  return preg_match('/\b(\d+)(?:st|nd|rd|th)\s+match/i', $name, $m) ? (int)$m[1] : null;
}

// Sort: numbered matches by number, then unknowns by date
usort($matchList, function($a,$b){
  $na=parseMatchNumber($a['name']??''); $nb=parseMatchNumber($b['name']??'');
  if($na!==null&&$nb!==null) return $na-$nb;
  if($na!==null) return -1; if($nb!==null) return 1;
  return strtotime($a['date']??'0')-strtotime($b['date']??'0');
});

// Check existing external_ids FOR THIS TOURNAMENT ONLY
$existing = $pdo->prepare('SELECT external_id FROM matches WHERE tournament_id=? AND external_id IS NOT NULL');
$existing->execute([$tId]);
$existingIds = array_column($existing->fetchAll(),'external_id');
$existingSet = array_flip($existingIds);

$stmtInsert = $pdo->prepare(
  'INSERT INTO matches
     (tournament_id, external_id, name, match_number, date, venue, status, result, team_info, is_scored, created_at)
   VALUES (?,?,?,?,?,?,?,?,?,0,?)'
);

$new=0; $skip=0; $errors=[];

foreach($matchList as $m){
  $mid = $m['id'] ?? null;
  if(!$mid) continue;

  if(isset($existingSet[$mid])){ $skip++; continue; }

  $matchNum  = parseMatchNumber($m['name']??'');
  $dateRaw   = $m['date'] ?? null;
  $dateParsed= $dateRaw ? date('Y-m-d H:i:s',strtotime($dateRaw)) : null;
  $status    = 'upcoming';
  if(!empty($m['matchEnded']))     $status='completed';
  elseif(!empty($m['matchStarted'])) $status='live';
  $teamInfoJson = isset($m['teamInfo']) ? json_encode($m['teamInfo'],JSON_UNESCAPED_SLASHES) : null;

  try{
    $stmtInsert->execute([$tId,$mid,$m['name']??'',$matchNum,$dateParsed,$m['venue']??'',$status,$m['status']??'',$teamInfoJson,time()]);
    $new++;
  }catch(Exception $e){ $errors[]="Match {$mid}: ".$e->getMessage(); }
}

// Update tournament's series_id
$pdo->prepare('UPDATE tournaments SET series_id=? WHERE id=?')->execute([$seriesId,$tId]);

echo json_encode([
  'status'      =>'success',
  'series_name' =>$seriesName,
  'total'       =>count($matchList),
  'new'         =>$new,
  'existing'    =>$skip,
  'hits_today'  =>$hitsToday,
  'errors'      =>$errors,
], JSON_UNESCAPED_SLASHES);
