// Package store 提供基于 SQLite 的本地持久化：连接设置、模型可用性快照、审批状态与变更记录。
package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

// Store 封装 SQLite 连接。
type Store struct {
	DB *sql.DB
}

// Open 打开（必要时创建）数据库并执行迁移。
func Open(path string) (*Store, error) {
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("创建数据目录失败: %w", err)
		}
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("打开 SQLite 失败: %w", err)
	}
	// SQLite 单写者模型：限制单连接，避免 busy 冲突。
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;`); err != nil {
		db.Close()
		return nil, fmt.Errorf("初始化 PRAGMA 失败: %w", err)
	}
	s := &Store{DB: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

// Close 关闭数据库。
func (s *Store) Close() error { return s.DB.Close() }

func (s *Store) migrate() error {
	const ddl = `
CREATE TABLE IF NOT EXISTS settings (
	k TEXT PRIMARY KEY,
	v TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_models (
	account_key  TEXT NOT NULL,
	account_type TEXT NOT NULL,
	account_name TEXT NOT NULL,
	model_name   TEXT NOT NULL,
	alias        TEXT NOT NULL DEFAULT '',
	updated_at   TEXT NOT NULL,
	PRIMARY KEY (account_key, model_name)
);
CREATE TABLE IF NOT EXISTS model_status (
	account_key   TEXT NOT NULL,
	account_type  TEXT NOT NULL,
	account_name  TEXT NOT NULL,
	model_name    TEXT NOT NULL,
	status        TEXT NOT NULL DEFAULT 'pending',
	first_seen_at TEXT NOT NULL,
	updated_at    TEXT NOT NULL,
	payload       TEXT NOT NULL DEFAULT '',
	PRIMARY KEY (account_key, model_name)
);
CREATE TABLE IF NOT EXISTS change_records (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	account_key  TEXT NOT NULL,
	account_type TEXT NOT NULL,
	account_name TEXT NOT NULL,
	model_name   TEXT NOT NULL,
	action       TEXT NOT NULL,
	created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_change_id ON change_records (id DESC);
CREATE TABLE IF NOT EXISTS account_settings (
	account_key TEXT PRIMARY KEY,
	auto_sync   INTEGER NOT NULL DEFAULT 1
);
`
	if _, err := s.DB.Exec(ddl); err != nil {
		return err
	}
	if err := s.ensureColumn("model_status", "payload", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	// 兼容旧结构：auto_sync 列缺失时补齐（默认开启）。
	if err := s.ensureColumn("account_settings", "auto_sync", "INTEGER NOT NULL DEFAULT 1"); err != nil {
		return err
	}
	// 账号分组：仅本控制台的本地标记，不写入 CPA。
	return s.ensureColumn("account_settings", "grp", "TEXT NOT NULL DEFAULT ''")
}

// ensureColumn 为旧库补列（幂等）。
func (s *Store) ensureColumn(table, column, definition string) error {
	rows, err := s.DB.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	found := false
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull, pk int
		var dflt any
		if err := rows.Scan(&cid, &name, &typ, &notNull, &dflt, &pk); err != nil {
			return err
		}
		if name == column {
			found = true
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if found {
		return nil
	}
	_, err = s.DB.Exec(`ALTER TABLE ` + table + ` ADD COLUMN ` + column + ` ` + definition)
	return err
}

func now() string { return time.Now().Format(time.RFC3339) }

// ---------- settings ----------

// GetSettings 返回全部设置项。
func (s *Store) GetSettings() (map[string]string, error) {
	rows, err := s.DB.Query(`SELECT k, v FROM settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

// SetSettings 合并写入设置项。
func (s *Store) SetSettings(kv map[string]string) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for k, v := range kv {
		if _, err := tx.Exec(
			`INSERT INTO settings(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`, k, v); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ---------- account_models（最近一次同步的可用模型快照） ----------

// AccountModel 表示某账号当前发现的一个模型。
type AccountModel struct {
	AccountKey  string
	AccountType string
	AccountName string
	Model       string
	Alias       string
	// Payload 保存发现时的原始模型对象 JSON（openai-compatibility 重写 models 时用于完整还原）。
	Payload string
	// FromConfig 表示模型来自 CPA 条目显式配置（区别于上游探测发现），
	// 仅同步流程内存使用，不落库；显式配置的模型发现时自动放行。
	FromConfig bool
}

// ReplaceAccountModels 全量重建可用模型快照。
func (s *Store) ReplaceAccountModels(rows []AccountModel) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM account_models`); err != nil {
		return err
	}
	stmt, err := tx.Prepare(`INSERT INTO account_models(account_key, account_type, account_name, model_name, alias, updated_at) VALUES(?,?,?,?,?,?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	ts := now()
	for _, r := range rows {
		if _, err := stmt.Exec(r.AccountKey, r.AccountType, r.AccountName, r.Model, r.Alias, ts); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ModelCountsByAccount 统计各账号当前可用模型数。
func (s *Store) ModelCountsByAccount() (map[string]int, error) {
	return s.countsByAccount(`SELECT account_key, COUNT(*) FROM account_models GROUP BY account_key`)
}

// PendingCountsByAccount 统计各账号待审批模型数。
func (s *Store) PendingCountsByAccount() (map[string]int, error) {
	return s.countsByAccount(`SELECT account_key, COUNT(*) FROM model_status WHERE status = 'pending' GROUP BY account_key`)
}

func (s *Store) countsByAccount(query string) (map[string]int, error) {
	rows, err := s.DB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var k string
		var n int
		if err := rows.Scan(&k, &n); err != nil {
			return nil, err
		}
		out[k] = n
	}
	return out, rows.Err()
}

// ---------- model_status（审批状态） ----------

// ModelStatus 是一条"账号 × 模型"的审批状态。
type ModelStatus struct {
	AccountKey  string `json:"accountKey"`
	AccountType string `json:"accountType"`
	AccountName string `json:"accountName"`
	Model       string `json:"model"`
	Alias       string `json:"alias"`
	Status      string `json:"status"`
	FirstSeenAt string `json:"firstSeenAt"`
	UpdatedAt   string `json:"updatedAt"`
	Available   bool   `json:"available"`
}

// ModelRef 定位一条审批记录（账号 + 模型名）。
type ModelRef struct {
	AccountKey string
	Model      string
}

// InsertedPending 是一条新插入的审批记录及其初始状态。
type InsertedPending struct {
	Row    AccountModel
	Status string
}

// InsertPending 批量插入发现记录（忽略已存在项），返回实际新增的记录。
// defaultStatus 按模型记录返回初始状态（nil 或返回空视为 pending；返回 approved 表示自动放行，
// 如 openai-compatibility 条目显式配置的模型）。
func (s *Store) InsertPending(rows []AccountModel, defaultStatus func(row AccountModel) string) ([]InsertedPending, error) {
	existing := map[string]bool{}
	func() {
		res, err := s.DB.Query(`SELECT account_key, model_name FROM model_status`)
		if err != nil {
			return
		}
		defer res.Close()
		for res.Next() {
			var k, m string
			if res.Scan(&k, &m) == nil {
				existing[k+"\x00"+m] = true
			}
		}
	}()
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	stmt, err := tx.Prepare(`INSERT INTO model_status(account_key, account_type, account_name, model_name, status, first_seen_at, updated_at, payload) VALUES(?,?,?,?,?,?,?,?)`)
	if err != nil {
		return nil, err
	}
	defer stmt.Close()
	ts := now()
	var inserted []InsertedPending
	for _, r := range rows {
		if existing[r.AccountKey+"\x00"+r.Model] {
			continue
		}
		status := "pending"
		if defaultStatus != nil {
			if st := defaultStatus(r); st == "approved" {
				status = "approved"
			}
		}
		if _, err := stmt.Exec(r.AccountKey, r.AccountType, r.AccountName, r.Model, status, ts, ts, r.Payload); err != nil {
			return nil, err
		}
		existing[r.AccountKey+"\x00"+r.Model] = true
		inserted = append(inserted, InsertedPending{Row: r, Status: status})
	}
	return inserted, tx.Commit()
}

// SetStatus 更新指定记录的状态，返回实际发生变更的记录。
func (s *Store) SetStatus(refs []ModelRef, status string) ([]ModelStatus, error) {
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	upd, err := tx.Prepare(`UPDATE model_status SET status = ?, updated_at = ? WHERE account_key = ? AND model_name = ? AND status <> ?`)
	if err != nil {
		return nil, err
	}
	defer upd.Close()
	sel, err := tx.Prepare(`SELECT account_key, account_type, account_name, model_name, status, first_seen_at, updated_at FROM model_status WHERE account_key = ? AND model_name = ?`)
	if err != nil {
		return nil, err
	}
	defer sel.Close()
	ts := now()
	var changed []ModelStatus
	for _, r := range refs {
		res, err := upd.Exec(status, ts, r.AccountKey, r.Model, status)
		if err != nil {
			return nil, err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			continue
		}
		var ms ModelStatus
		if err := sel.QueryRow(r.AccountKey, r.Model).Scan(
			&ms.AccountKey, &ms.AccountType, &ms.AccountName, &ms.Model, &ms.Status, &ms.FirstSeenAt, &ms.UpdatedAt); err != nil {
			return nil, err
		}
		changed = append(changed, ms)
	}
	return changed, tx.Commit()
}

// AllStatuses 返回全部审批记录（含可用性与别名联查）。
func (s *Store) AllStatuses() ([]ModelStatus, error) {
	const q = `SELECT ms.account_key, ms.account_type, ms.account_name, ms.model_name, ms.status, ms.first_seen_at, ms.updated_at,
	COALESCE(am.alias, ''), CASE WHEN am.model_name IS NULL THEN 0 ELSE 1 END
	FROM model_status ms
	LEFT JOIN account_models am ON am.account_key = ms.account_key AND am.model_name = ms.model_name
	ORDER BY ms.first_seen_at DESC`
	rows, err := s.DB.Query(q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ModelStatus
	for rows.Next() {
		var ms ModelStatus
		var avail int
		if err := rows.Scan(&ms.AccountKey, &ms.AccountType, &ms.AccountName, &ms.Model, &ms.Status, &ms.FirstSeenAt, &ms.UpdatedAt, &ms.Alias, &avail); err != nil {
			return nil, err
		}
		ms.Available = avail == 1
		out = append(out, ms)
	}
	return out, rows.Err()
}

// CountByStatus 统计各状态数量。
func (s *Store) CountByStatus() (map[string]int, error) {
	rows, err := s.DB.Query(`SELECT status, COUNT(*) FROM model_status GROUP BY status`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var st string
		var n int
		if err := rows.Scan(&st, &n); err != nil {
			return nil, err
		}
		out[st] = n
	}
	return out, rows.Err()
}

// ApprovedModels 返回某账号处于放行状态的模型（别名取自可用性快照，payload 取自审批状态，用于 openai-compatibility 还原）。
func (s *Store) ApprovedModels(accountKey string) ([]AccountModel, error) {
	rows, err := s.DB.Query(
		`SELECT ms.model_name, COALESCE(am.alias, ''), COALESCE(ms.payload, '')
		FROM model_status ms
		LEFT JOIN account_models am ON am.account_key = ms.account_key AND am.model_name = ms.model_name
		WHERE ms.account_key = ? AND ms.status = 'approved'
		ORDER BY ms.first_seen_at`,
		accountKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AccountModel
	for rows.Next() {
		var r AccountModel
		if err := rows.Scan(&r.Model, &r.Alias, &r.Payload); err != nil {
			return nil, err
		}
		r.AccountKey = accountKey
		out = append(out, r)
	}
	return out, rows.Err()
}

// DeleteStatusModels 删除某账号指定模型的审批状态，返回被删记录（用于变更记录）。
func (s *Store) DeleteStatusModels(accountKey string, models []string) ([]ModelStatus, error) {
	if len(models) == 0 {
		return nil, nil
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	sel, err := tx.Prepare(`SELECT account_key, account_type, account_name, model_name, status FROM model_status WHERE account_key = ? AND model_name = ?`)
	if err != nil {
		return nil, err
	}
	del, err := tx.Prepare(`DELETE FROM model_status WHERE account_key = ? AND model_name = ?`)
	if err != nil {
		return nil, err
	}
	defer sel.Close()
	defer del.Close()
	var removed []ModelStatus
	for _, m := range models {
		rows, err := sel.Query(accountKey, m)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var ms ModelStatus
			if err := rows.Scan(&ms.AccountKey, &ms.AccountType, &ms.AccountName, &ms.Model, &ms.Status); err != nil {
				rows.Close()
				return nil, err
			}
			removed = append(removed, ms)
		}
		rows.Close()
		if _, err := del.Exec(accountKey, m); err != nil {
			return nil, err
		}
	}
	return removed, tx.Commit()
}

// BlockedCountsByAccount 统计各账号未放行（待审批+已拒绝）模型数。
func (s *Store) BlockedCountsByAccount() (map[string]int, error) {
	return s.countsByAccount(`SELECT account_key, COUNT(*) FROM model_status WHERE status IN ('pending','rejected') GROUP BY account_key`)
}

// DeleteByAccounts 删除指定账号的全部审批状态，返回被删记录（用于变更记录）。
func (s *Store) DeleteByAccounts(accountKeys []string) ([]ModelStatus, error) {
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	sel, err := tx.Prepare(`SELECT account_key, account_type, account_name, model_name, status FROM model_status WHERE account_key = ?`)
	if err != nil {
		return nil, err
	}
	del, err := tx.Prepare(`DELETE FROM model_status WHERE account_key = ?`)
	if err != nil {
		return nil, err
	}
	defer sel.Close()
	defer del.Close()
	var removed []ModelStatus
	for _, key := range accountKeys {
		rows, err := sel.Query(key)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var ms ModelStatus
			if err := rows.Scan(&ms.AccountKey, &ms.AccountType, &ms.AccountName, &ms.Model, &ms.Status); err != nil {
				rows.Close()
				return nil, err
			}
			removed = append(removed, ms)
		}
		rows.Close()
		if _, err := del.Exec(key); err != nil {
			return nil, err
		}
	}
	return removed, tx.Commit()
}

// ---------- account_settings（账号级配置） ----------

// AutoSyncDisabledAccounts 返回关闭自动同步的账号标识集合（未写入配置的账号默认开启）。
func (s *Store) AutoSyncDisabledAccounts() (map[string]bool, error) {
	rows, err := s.DB.Query(`SELECT account_key FROM account_settings WHERE auto_sync = 0`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, err
		}
		out[k] = true
	}
	return out, rows.Err()
}

// SetAutoSync 写入账号自动同步开关。
func (s *Store) SetAutoSync(accountKey string, on bool) error {
	v := 0
	if on {
		v = 1
	}
	_, err := s.DB.Exec(
		`INSERT INTO account_settings(account_key, auto_sync) VALUES(?, ?)
		ON CONFLICT(account_key) DO UPDATE SET auto_sync = excluded.auto_sync`, accountKey, v)
	return err
}

// AccountGroups 返回有分组标记的账号（未标记的账号不在结果中）。
func (s *Store) AccountGroups() (map[string]string, error) {
	rows, err := s.DB.Query(`SELECT account_key, grp FROM account_settings WHERE grp != ''`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, g string
		if err := rows.Scan(&k, &g); err != nil {
			return nil, err
		}
		out[k] = g
	}
	return out, rows.Err()
}

// SetAccountGroup 写入账号分组标记（空串表示清除分组）。
func (s *Store) SetAccountGroup(accountKey, grp string) error {
	_, err := s.DB.Exec(
		`INSERT INTO account_settings(account_key, auto_sync, grp) VALUES(?, 1, ?)
		ON CONFLICT(account_key) DO UPDATE SET grp = excluded.grp`, accountKey, grp)
	return err
}

// RenameAccountSetting 账号标识变更时迁移配置（旧标识不存在则不做任何事）。
func (s *Store) RenameAccountSetting(oldKey, newKey string) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var autoSync int
	var grp string
	err = tx.QueryRow(`SELECT auto_sync, grp FROM account_settings WHERE account_key = ?`, oldKey).Scan(&autoSync, &grp)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	if _, err := tx.Exec(
		`INSERT INTO account_settings(account_key, auto_sync, grp) VALUES(?, ?, ?)
		ON CONFLICT(account_key) DO UPDATE SET auto_sync = excluded.auto_sync, grp = excluded.grp`,
		newKey, autoSync, grp); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM account_settings WHERE account_key = ?`, oldKey); err != nil {
		return err
	}
	return tx.Commit()
}

// DeleteAccountSettings 删除账号的全部配置行（账号移除时清理）。
func (s *Store) DeleteAccountSettings(accountKeys []string) error {
	if len(accountKeys) == 0 {
		return nil
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, key := range accountKeys {
		if _, err := tx.Exec(`DELETE FROM account_settings WHERE account_key = ?`, key); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ---------- change_records ----------

// ChangeRecord 是一条审批/发现/移除变更记录。
type ChangeRecord struct {
	ID          int64  `json:"id"`
	AccountKey  string `json:"accountKey"`
	AccountType string `json:"accountType"`
	AccountName string `json:"accountName"`
	Model       string `json:"model"`
	Action      string `json:"action"`
	CreatedAt   string `json:"createdAt"`
}

// InsertChangeRecords 批量写入变更记录。
func (s *Store) InsertChangeRecords(recs []ChangeRecord) error {
	if len(recs) == 0 {
		return nil
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stmt, err := tx.Prepare(`INSERT INTO change_records(account_key, account_type, account_name, model_name, action, created_at) VALUES(?,?,?,?,?,?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	ts := now()
	for _, r := range recs {
		createdAt := r.CreatedAt
		if createdAt == "" {
			createdAt = ts
		}
		if _, err := stmt.Exec(r.AccountKey, r.AccountType, r.AccountName, r.Model, r.Action, createdAt); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ListChangeRecords 按时间倒序返回变更记录（可按账号过滤）。
func (s *Store) ListChangeRecords(limit int, account string) ([]ChangeRecord, error) {
	if limit <= 0 {
		limit = 200
	}
	query := `SELECT id, account_key, account_type, account_name, model_name, action, created_at FROM change_records`
	var args []any
	if account != "" {
		query += ` WHERE account_key = ?`
		args = append(args, account)
	}
	query += ` ORDER BY id DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ChangeRecord
	for rows.Next() {
		var r ChangeRecord
		if err := rows.Scan(&r.ID, &r.AccountKey, &r.AccountType, &r.AccountName, &r.Model, &r.Action, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
