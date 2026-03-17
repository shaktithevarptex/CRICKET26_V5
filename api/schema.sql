-- ╔══════════════════════════════════════════════════════════════╗
-- ║   Cricket Fantasy League — Full Schema                       ║
-- ║   Safe to run on existing DB                                 ║
-- ╚══════════════════════════════════════════════════════════════╝

CREATE DATABASE IF NOT EXISTS cricket_fantasy
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_general_ci;

USE cricket_fantasy;

-- ──────────────────────────────────────────────────────────────
-- TOURNAMENTS
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tournaments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  series_id VARCHAR(100) DEFAULT NULL,
  created_at BIGINT DEFAULT 0,

  weekly_captains JSON DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ──────────────────────────────────────────────────────────────
-- TEAMS
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tournament_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  owner VARCHAR(255) DEFAULT NULL,
  created_at BIGINT DEFAULT 0,

  INDEX idx_tournament (tournament_id),
  FOREIGN KEY (tournament_id)
    REFERENCES tournaments(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ──────────────────────────────────────────────────────────────
-- PLAYERS
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS players (
  id INT AUTO_INCREMENT PRIMARY KEY,
  team_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) DEFAULT NULL,

  price INT DEFAULT 0,
  country VARCHAR(100) DEFAULT NULL,
  cricket_team VARCHAR(255) DEFAULT NULL,

  total_points INT DEFAULT 0,
  batting_points INT DEFAULT 0,
  bowling_points INT DEFAULT 0,
  fielding_points INT DEFAULT 0,

  match_points JSON DEFAULT NULL,

  is_injured TINYINT(1) DEFAULT 0,
  replaced_for VARCHAR(255) DEFAULT NULL,

  created_at BIGINT DEFAULT 0,

  INDEX idx_team (team_id),
  INDEX idx_team_injured (team_id,is_injured),

  FOREIGN KEY (team_id)
    REFERENCES teams(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ──────────────────────────────────────────────────────────────
-- MATCHES
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tournament_id INT NOT NULL,

  name VARCHAR(255) NOT NULL,
  external_id VARCHAR(100) DEFAULT NULL,

  venue VARCHAR(255) DEFAULT NULL,
  date DATETIME DEFAULT NULL,

  status VARCHAR(50) DEFAULT NULL,
  result TEXT DEFAULT NULL,

  is_scored TINYINT(1) DEFAULT 0,

  scorecard_raw LONGTEXT,
  team_info JSON,

  created_at BIGINT DEFAULT 0,

  INDEX idx_tournament (tournament_id),
  INDEX idx_tournament_scored (tournament_id,is_scored),

  FOREIGN KEY (tournament_id)
    REFERENCES tournaments(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ──────────────────────────────────────────────────────────────
-- WEEKLY CAPTAINS
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weekly_captains (
  id INT AUTO_INCREMENT PRIMARY KEY,

  tournament_id INT NOT NULL,
  team_id INT NOT NULL,

  week_key VARCHAR(10) NOT NULL,
  captain_id INT NOT NULL,
  vc_id INT NOT NULL,

  created_at BIGINT DEFAULT 0,
  updated_at BIGINT DEFAULT 0,

  UNIQUE KEY uq_team_week (tournament_id,team_id,week_key),
  INDEX idx_tournament_week (tournament_id,week_key),

  FOREIGN KEY (tournament_id)
    REFERENCES tournaments(id)
    ON DELETE CASCADE,

  FOREIGN KEY (team_id)
    REFERENCES teams(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ──────────────────────────────────────────────────────────────
-- API KEYS
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id INT AUTO_INCREMENT PRIMARY KEY,
  label VARCHAR(100) UNIQUE,
  api_key TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ──────────────────────────────────────────────────────────────
-- NIGHTLY JOB LOG
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nightly_job_log (
  id INT AUTO_INCREMENT PRIMARY KEY,

  run_date DATE,
  started_at DATETIME,
  finished_at DATETIME,

  matches_found INT DEFAULT 0,
  matches_scored INT DEFAULT 0,
  api_hits_used INT DEFAULT 0,

  errors TEXT,
  created_at BIGINT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ──────────────────────────────────────────────────────────────
-- COUNTRIES CACHE
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS countries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255),
  code VARCHAR(10),
  flag_url TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ──────────────────────────────────────────────────────────────
-- PERFORMANCE INDEXES
-- ──────────────────────────────────────────────────────────────
ALTER TABLE players
ADD INDEX IF NOT EXISTS idx_player_team (team_id);

ALTER TABLE matches
ADD INDEX IF NOT EXISTS idx_match_external (external_id);
