import { app, session, ipcMain, BrowserWindow, shell, nativeImage, Tray, Menu, dialog } from "electron";
import { ListToolsRequestSchema, isInitializeRequest, LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Router } from "express";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import { join, basename, resolve, sep, dirname, relative as relative$1, posix } from "path";
import { existsSync, unlinkSync, writeFileSync, readdirSync, statSync, rmSync, mkdirSync, openSync, closeSync, promises, readFileSync as readFileSync$1 } from "fs";
import { tmpdir, homedir } from "os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { statSync as statSync$1, readFileSync, existsSync as existsSync$1, readdirSync as readdirSync$1 } from "node:fs";
import { join as join$1, relative, basename as basename$1 } from "node:path";
import { spawnSync } from "node:child_process";
import JSZip from "jszip";
import { readdir } from "fs/promises";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
const is = {
  dev: !app.isPackaged
};
const platform = {
  isWindows: process.platform === "win32",
  isMacOS: process.platform === "darwin",
  isLinux: process.platform === "linux"
};
const electronApp = {
  setAppUserModelId(id) {
    if (platform.isWindows)
      app.setAppUserModelId(is.dev ? process.execPath : id);
  },
  setAutoLaunch(auto) {
    if (platform.isLinux)
      return false;
    const isOpenAtLogin = () => {
      return app.getLoginItemSettings().openAtLogin;
    };
    if (isOpenAtLogin() !== auto) {
      app.setLoginItemSettings({ openAtLogin: auto });
      return isOpenAtLogin() === auto;
    } else {
      return true;
    }
  },
  skipProxy() {
    return session.defaultSession.setProxy({ mode: "direct" });
  }
};
const optimizer = {
  watchWindowShortcuts(window, shortcutOptions) {
    if (!window)
      return;
    const { webContents } = window;
    const { escToCloseWindow = false, zoom = false } = shortcutOptions || {};
    webContents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown") {
        if (!is.dev) {
          if (input.code === "KeyR" && (input.control || input.meta))
            event.preventDefault();
          if (input.code === "KeyI" && (input.alt && input.meta || input.control && input.shift)) {
            event.preventDefault();
          }
        } else {
          if (input.code === "F12") {
            if (webContents.isDevToolsOpened()) {
              webContents.closeDevTools();
            } else {
              webContents.openDevTools({ mode: "undocked" });
              console.log("Open dev tool...");
            }
          }
        }
        if (escToCloseWindow) {
          if (input.code === "Escape" && input.key !== "Process") {
            window.close();
            event.preventDefault();
          }
        }
        if (!zoom) {
          if (input.code === "Minus" && (input.control || input.meta))
            event.preventDefault();
          if (input.code === "Equal" && input.shift && (input.control || input.meta))
            event.preventDefault();
        }
      }
    });
  },
  registerFramelessWindowIpc() {
    ipcMain.on("win:invoke", (event, action) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) {
        if (action === "show") {
          win.show();
        } else if (action === "showInactive") {
          win.showInactive();
        } else if (action === "min") {
          win.minimize();
        } else if (action === "max") {
          const isMaximized = win.isMaximized();
          if (isMaximized) {
            win.unmaximize();
          } else {
            win.maximize();
          }
        } else if (action === "close") {
          win.close();
        }
      }
    });
  }
};
let db = null;
let dbPath = "";
const SCHEMA_VERSION = 13;
function mapRowToRegisteredConnection(row) {
  return {
    providerType: row.provider_type ?? "standalone",
    providerSessionId: row.provider_session_id,
    connectionId: row.connection_id,
    channelName: row.agent_name,
    projectName: row.project_name,
    baseDirectory: row.base_directory,
    idFilePath: row.id_file_path,
    parentSessionId: row.parent_session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function createTables() {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_message     TEXT    NOT NULL,
      project_name       TEXT    NOT NULL,
      user_response      TEXT    NOT NULL,
      predefined_options TEXT,
      attachments        TEXT,
      created_at         TEXT    DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_channels (
      session_id TEXT     PRIMARY KEY,
      label      TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_messages (
      id         INTEGER  PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      message    TEXT     NOT NULL,
      sent       INTEGER  DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_channel_history (
      id           INTEGER  PRIMARY KEY AUTOINCREMENT,
      session_id   TEXT     NOT NULL,
      message_type TEXT     NOT NULL,
      message_text TEXT     NOT NULL,
      attachments  TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS skills_and_instructions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL UNIQUE,
      type        TEXT    NOT NULL CHECK(type IN ('skill', 'instruction')),
      description TEXT    NOT NULL,
      content     TEXT    NOT NULL,
      category    TEXT,
      tags        TEXT,
      enabled     INTEGER NOT NULL DEFAULT 1,
      is_builtin  INTEGER NOT NULL DEFAULT 0,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      folder_id   INTEGER,
      scope       TEXT    NOT NULL DEFAULT 'global' CHECK(scope IN ('global', 'session-scoped'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_scoped_entries (
      provider_type       TEXT     NOT NULL,
      provider_session_id TEXT     NOT NULL,
      entry_name          TEXT     NOT NULL,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (provider_type, provider_session_id, entry_name)
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sse_entry_name
      ON session_scoped_entries (entry_name)
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_muted_entries (
      provider_type       TEXT     NOT NULL,
      provider_session_id TEXT     NOT NULL,
      entry_name          TEXT     NOT NULL,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (provider_type, provider_session_id, entry_name)
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sme_entry_name
      ON session_muted_entries (entry_name)
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS registered_connections (
      provider_type        TEXT     NOT NULL DEFAULT 'standalone' CHECK(provider_type IN ('opencode', 'copilot-cli', 'claude-sdk', 'standalone')),
      provider_session_id  TEXT     NOT NULL,
      connection_id        TEXT,
      agent_name           TEXT     NOT NULL,
      project_name         TEXT     NOT NULL,
      base_directory       TEXT,
      id_file_path         TEXT     NOT NULL,
      parent_session_id    TEXT,
      created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (provider_type, provider_session_id)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_context_injections (
      id                  INTEGER  PRIMARY KEY AUTOINCREMENT,
      provider_type       TEXT     NOT NULL DEFAULT 'standalone',
      provider_session_id TEXT     NOT NULL,
      source              TEXT     NOT NULL DEFAULT 'manual',
      replace_key         TEXT,
      payload             TEXT     NOT NULL,
      claimed             INTEGER  DEFAULT 0,
      delivered           INTEGER  DEFAULT 0,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_pci_session_delivered
      ON pending_context_injections (provider_type, provider_session_id, delivered)
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS pinned_projects (
      path        TEXT     PRIMARY KEY,
      name        TEXT     NOT NULL,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}
async function initDatabase() {
  dbPath = join(app.getPath("userData"), "conversations.db");
  existsSync(dbPath);
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  const storedVersion = getSchemaVersion();
  if (storedVersion !== SCHEMA_VERSION) {
    const preservedSkills = preserveSkillsAndInstructions();
    dropAllTables();
    createTables();
    restoreSkillsAndInstructions(preservedSkills);
    setSchemaVersion(SCHEMA_VERSION);
  } else {
    createTables();
  }
}
function getDbInstance() {
  return db;
}
function getSchemaVersion() {
  if (!db) return 0;
  const row = db.pragma("user_version", { simple: true });
  return row ?? 0;
}
function setSchemaVersion(version) {
  if (!db) return;
  db.pragma(`user_version = ${version}`);
}
function dropAllTables() {
  if (!db) return;
  const tables = [
    "session_scoped_entries",
    "session_muted_entries",
    "pending_context_injections",
    "session_messages",
    "session_channel_history",
    "session_channels",
    "registered_connections",
    "conversations",
    "skills_and_instructions",
    "pinned_projects",
    "folders"
  ];
  for (const table of tables) {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
  }
}
function preserveSkillsAndInstructions() {
  if (!db) return [];
  try {
    const rows = db.prepare(
      `SELECT name, type, description, content, category, tags, enabled, is_builtin, created_at, updated_at
         FROM skills_and_instructions`
    ).all();
    return rows.map((row) => ({
      name: row.name,
      type: row.type,
      description: row.description,
      content: row.content,
      category: row.category,
      tags: row.tags,
      enabled: row.enabled ?? 1,
      isBuiltin: row.is_builtin ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  } catch {
    return [];
  }
}
function restoreSkillsAndInstructions(rows) {
  if (!db || rows.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO skills_and_instructions
       (name, type, description, content, category, tags, enabled, is_builtin, created_at, updated_at, folder_id, scope)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'global')`
  );
  for (const r of rows) {
    stmt.run(
      r.name,
      r.type,
      r.description,
      r.content,
      r.category,
      r.tags,
      r.enabled,
      r.isBuiltin,
      r.createdAt,
      r.updatedAt
    );
  }
}
function saveConversation(data) {
  if (!db) return;
  db.prepare(
    `INSERT INTO conversations (prompt_message, project_name, user_response, predefined_options, attachments)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    data.promptMessage,
    data.projectName,
    data.userResponse,
    data.predefinedOptions ? JSON.stringify(data.predefinedOptions) : null,
    data.attachments?.length ? JSON.stringify(data.attachments) : null
  );
}
function getConversationHistory(limit = 100) {
  if (!db) return [];
  const rows = db.prepare(
    `SELECT id, prompt_message, project_name, user_response, predefined_options, attachments, created_at
       FROM conversations ORDER BY created_at DESC LIMIT ?`
  ).all(limit);
  return rows.map((row) => ({
    id: row.id,
    promptMessage: row.prompt_message,
    projectName: row.project_name,
    userResponse: row.user_response,
    predefinedOptions: row.predefined_options,
    attachments: row.attachments,
    createdAt: row.created_at
  }));
}
function clearHistory() {
  if (!db) return;
  db.exec("DELETE FROM conversations");
}
function resetDatabase() {
  if (!db) {
    return { ok: false, clearedTables: [], removedIdFiles: 0 };
  }
  let removedIdFiles = 0;
  const registered = getAllRegisteredConnections();
  for (const rec of registered) {
    try {
      unlinkSync(rec.idFilePath);
      removedIdFiles += 1;
    } catch {
    }
  }
  const clearedTables = [
    "session_scoped_entries",
    "session_muted_entries",
    "session_messages",
    "session_channel_history",
    "session_channels",
    "registered_connections",
    "conversations",
    "skills_and_instructions",
    "folders"
  ];
  for (const table of clearedTables) {
    db.exec(`DELETE FROM ${table}`);
  }
  return { ok: true, clearedTables, removedIdFiles };
}
function createSessionChannel(sessionId, label) {
  if (!db) return;
  db.prepare(
    `INSERT OR REPLACE INTO session_channels (session_id, label) VALUES (?, ?)`
  ).run(sessionId, label ?? null);
}
function getUnsentMessages(sessionId) {
  if (!db) return [];
  const rows = db.prepare(
    `SELECT id, message, created_at FROM session_messages
       WHERE session_id = ? AND sent = 0 ORDER BY id ASC`
  ).all(sessionId);
  return rows.map((row) => ({
    id: row.id,
    message: row.message,
    createdAt: row.created_at
  }));
}
function getUnsentCount(sessionId) {
  if (!db) return 0;
  const row = db.prepare(
    `SELECT COUNT(*) as c FROM session_messages WHERE session_id = ? AND sent = 0`
  ).get(sessionId);
  return row?.c ?? 0;
}
function markMessagesSent(ids) {
  if (!db || ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(
    `UPDATE session_messages SET sent = 1 WHERE id IN (${placeholders})`
  ).run(...ids);
}
function queueSessionMessage(sessionId, message) {
  if (!db) return;
  const tx = db.transaction((sid, msg) => {
    db.prepare(
      `INSERT INTO session_messages (session_id, message) VALUES (?, ?)`
    ).run(sid, msg);
    db.prepare(
      `INSERT INTO session_channel_history (session_id, message_type, message_text)
         VALUES (?, 'outbound', ?)`
    ).run(sid, msg);
  });
  tx(sessionId, message);
}
function appendSessionChannelMessage(data) {
  if (!db) return;
  db.prepare(
    `INSERT INTO session_channel_history (session_id, message_type, message_text, attachments)
     VALUES (?, ?, ?, ?)`
  ).run(
    data.sessionId,
    data.messageType,
    data.messageText,
    data.attachments?.length ? JSON.stringify(data.attachments) : null
  );
}
function getSessionChannelHistory(sessionId, limit = 500) {
  if (!db) return [];
  const rows = db.prepare(
    `SELECT id, session_id, message_type, message_text, attachments, created_at
       FROM session_channel_history
       WHERE session_id = ?
       ORDER BY id ASC
       LIMIT ?`
  ).all(sessionId, limit);
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    messageType: row.message_type,
    messageText: row.message_text,
    attachments: row.attachments,
    createdAt: row.created_at
  }));
}
function clearSessionChannelMessages(sessionId) {
  if (!db) return;
  const tx = db.transaction((sid) => {
    db.prepare(`DELETE FROM session_messages WHERE session_id = ?`).run(sid);
    db.prepare(`DELETE FROM session_channel_history WHERE session_id = ?`).run(sid);
  });
  tx(sessionId);
}
function deleteSessionChannel(sessionId) {
  if (!db) return;
  const tx = db.transaction((sid) => {
    db.prepare(`DELETE FROM session_messages WHERE session_id = ?`).run(sid);
    db.prepare(`DELETE FROM session_channel_history WHERE session_id = ?`).run(sid);
    db.prepare(`DELETE FROM session_channels WHERE session_id = ?`).run(sid);
  });
  tx(sessionId);
}
function getActiveSessionChannels() {
  if (!db) return [];
  const rows = db.prepare(
    `SELECT sc.session_id, sc.label, sc.created_at,
              rc.provider_session_id, rc.parent_session_id
       FROM session_channels sc
       LEFT JOIN registered_connections rc ON rc.provider_session_id = sc.session_id
       ORDER BY sc.created_at ASC`
  ).all();
  return rows.map((row) => ({
    sessionId: row.session_id,
    label: row.label,
    createdAt: row.created_at,
    providerSessionId: row.provider_session_id ?? null,
    parentSessionId: row.parent_session_id ?? null
  }));
}
function agentIdFilePath(channelName, providerSessionId, providerType = "standalone") {
  const safe = channelName.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  const identity = providerSessionId.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  const provider = providerType.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  return join(tmpdir(), `imcp-agent-${provider}-${safe}-${identity}.json`);
}
function upsertRegisteredConnection(data) {
  const providerType = data.providerType ?? "standalone";
  const providerSessionId = data.providerSessionId;
  const idFilePath = agentIdFilePath(
    data.channelName,
    providerSessionId,
    providerType
  );
  if (db) {
    const existing = getRegisteredConnectionBySessionId(
      providerSessionId,
      providerType
    );
    if (existing) {
      const incomingConnectionId = data.connectionId ?? null;
      const incomingParentSessionId = data.parentSessionId ?? null;
      const baseDirUnchanged = data.baseDirectory === void 0 || existing.baseDirectory === data.baseDirectory;
      const unchanged = existing.connectionId === incomingConnectionId && existing.channelName === data.channelName && existing.projectName === data.projectName && existing.parentSessionId === incomingParentSessionId && existing.idFilePath === idFilePath && baseDirUnchanged;
      if (unchanged) {
        return idFilePath;
      }
    }
  }
  try {
    writeFileSync(
      idFilePath,
      JSON.stringify({
        connectionId: data.connectionId ?? null,
        channelName: data.channelName,
        projectName: data.projectName,
        baseDirectory: data.baseDirectory ?? null,
        providerSessionId,
        parentSessionId: data.parentSessionId ?? null,
        providerType
      }),
      "utf-8"
    );
  } catch {
  }
  if (db) {
    db.prepare(
      `INSERT INTO registered_connections
         (provider_type, provider_session_id, connection_id, agent_name, project_name, base_directory, id_file_path, parent_session_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(provider_type, provider_session_id) DO UPDATE SET
         connection_id = excluded.connection_id,
         agent_name = excluded.agent_name,
         project_name = excluded.project_name,
         base_directory = COALESCE(excluded.base_directory, base_directory),
         id_file_path = excluded.id_file_path,
         parent_session_id = excluded.parent_session_id,
         updated_at = CURRENT_TIMESTAMP`
    ).run(
      providerType,
      providerSessionId,
      data.connectionId ?? null,
      data.channelName,
      data.projectName,
      data.baseDirectory ?? null,
      idFilePath,
      data.parentSessionId ?? null
    );
  }
  return idFilePath;
}
function getAllRegisteredConnections() {
  if (!db) return [];
  const rows = db.prepare(
    `SELECT provider_type, provider_session_id, connection_id, agent_name, project_name, base_directory, id_file_path, parent_session_id, created_at, updated_at
       FROM registered_connections ORDER BY created_at ASC`
  ).all();
  return rows.map(mapRowToRegisteredConnection);
}
function getRegisteredConnection(connectionId) {
  if (!db) return null;
  const row = db.prepare(
    `SELECT provider_type, provider_session_id, connection_id, agent_name, project_name, base_directory, id_file_path, parent_session_id, created_at, updated_at
       FROM registered_connections WHERE connection_id = ?
       ORDER BY created_at ASC, rowid ASC LIMIT 1`
  ).get(connectionId);
  if (!row) return null;
  return mapRowToRegisteredConnection(row);
}
function getRegisteredConnectionsByConnectionId(connectionId) {
  if (!db) return [];
  const rows = db.prepare(
    `SELECT provider_type, provider_session_id, connection_id, agent_name, project_name, base_directory, id_file_path, parent_session_id, created_at, updated_at
       FROM registered_connections WHERE connection_id = ?
       ORDER BY created_at ASC, rowid ASC`
  ).all(connectionId);
  return rows.map(mapRowToRegisteredConnection);
}
function getRegisteredConnectionBySessionId(providerSessionId, providerType = "opencode") {
  if (!db) return null;
  const row = db.prepare(
    `SELECT provider_type, provider_session_id, connection_id, agent_name, project_name, base_directory, id_file_path, parent_session_id, created_at, updated_at
       FROM registered_connections WHERE provider_type = ? AND provider_session_id = ?`
  ).get(providerType, providerSessionId);
  if (!row) return null;
  return mapRowToRegisteredConnection(row);
}
function updateConnectionId(providerSessionId, connectionId, providerType = "opencode") {
  if (!db) return;
  db.prepare(
    `UPDATE registered_connections
     SET connection_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE provider_type = ? AND provider_session_id = ?`
  ).run(connectionId, providerType, providerSessionId);
}
function isProviderSessionClaimed(providerSessionId, providerType = "opencode") {
  if (!db) return false;
  const row = db.prepare(
    `SELECT 1 as present FROM registered_connections
       WHERE provider_type = ? AND provider_session_id = ?
       LIMIT 1`
  ).get(providerType, providerSessionId);
  return row !== void 0;
}
function getRegisteredConnectionsByProvider(providerType) {
  if (!db) return [];
  const rows = db.prepare(
    `SELECT provider_type, provider_session_id, connection_id, agent_name, project_name, base_directory, id_file_path, parent_session_id, created_at, updated_at
       FROM registered_connections WHERE provider_type = ? ORDER BY created_at ASC`
  ).all(providerType);
  return rows.map(mapRowToRegisteredConnection);
}
function deleteRegisteredConnection(providerSessionId, providerType = "opencode") {
  if (!db) return;
  const rec = getRegisteredConnectionBySessionId(
    providerSessionId,
    providerType
  );
  if (rec) {
    try {
      unlinkSync(rec.idFilePath);
    } catch {
    }
  }
  const txn = db.transaction((pt, psid) => {
    db.prepare(
      `DELETE FROM registered_connections WHERE provider_type = ? AND provider_session_id = ?`
    ).run(pt, psid);
    db.prepare(
      `DELETE FROM session_scoped_entries WHERE provider_type = ? AND provider_session_id = ?`
    ).run(pt, psid);
    db.prepare(
      `DELETE FROM session_muted_entries WHERE provider_type = ? AND provider_session_id = ?`
    ).run(pt, psid);
  });
  txn(providerType, providerSessionId);
}
function mapRowToSkillOrInstruction(row) {
  let tags = null;
  if (row.tags) {
    try {
      tags = JSON.parse(row.tags);
    } catch {
      tags = null;
    }
  }
  const scopeRaw = row.scope ?? "global";
  const scope = scopeRaw === "session-scoped" ? "session-scoped" : "global";
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description,
    content: row.content,
    category: row.category,
    tags,
    enabled: row.enabled === 1,
    isBuiltin: row.is_builtin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    folderId: row.folder_id ?? null,
    scope
  };
}
function upsertSkillOrInstruction(data) {
  if (!db) return null;
  const tagsJson = data.tags ? JSON.stringify(data.tags) : null;
  const folderIdValue = data.folderId === void 0 ? null : data.folderId;
  const scopeValue = data.scope ?? "global";
  const hasExplicitFolder = data.folderId !== void 0;
  const hasExplicitScope = data.scope !== void 0;
  const updateFolderClause = hasExplicitFolder ? "folder_id = excluded.folder_id," : "";
  const updateScopeClause = hasExplicitScope ? "scope = excluded.scope," : "";
  db.prepare(
    `INSERT INTO skills_and_instructions (name, type, description, content, category, tags, folder_id, scope)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       type = excluded.type,
       description = excluded.description,
       content = excluded.content,
       category = excluded.category,
       tags = excluded.tags,
       ${updateFolderClause}
       ${updateScopeClause}
       updated_at = CURRENT_TIMESTAMP`
  ).run(
    data.name,
    data.type,
    data.description,
    data.content,
    data.category ?? null,
    tagsJson,
    folderIdValue,
    scopeValue
  );
  return getSkillOrInstructionByName(data.name);
}
function listSkillsAndInstructions(filterType, filterCategory) {
  if (!db) return [];
  const conditions = [];
  const params = [];
  if (filterType) {
    conditions.push("type = ?");
    params.push(filterType);
  }
  if (filterCategory) {
    conditions.push("category = ?");
    params.push(filterCategory);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const query = `SELECT id, name, type, description, content, category, tags, enabled, is_builtin, created_at, updated_at, folder_id, scope
     FROM skills_and_instructions ${whereClause} ORDER BY name ASC`;
  const rows = db.prepare(query).all(...params);
  return rows.map(mapRowToSkillOrInstruction);
}
function getSkillOrInstructionByName(name) {
  if (!db) return null;
  const row = db.prepare(
    `SELECT id, name, type, description, content, category, tags, enabled, is_builtin, created_at, updated_at, folder_id, scope
       FROM skills_and_instructions WHERE name = ?`
  ).get(name);
  if (!row) return null;
  return mapRowToSkillOrInstruction(row);
}
function deleteSkillOrInstruction(name) {
  if (!db) return false;
  const info = db.prepare(`DELETE FROM skills_and_instructions WHERE name = ?`).run(name);
  return info.changes > 0;
}
function toggleSkillOrInstructionEnabled(name, enabled) {
  if (!db) return null;
  db.prepare(
    `UPDATE skills_and_instructions
     SET enabled = ?, updated_at = CURRENT_TIMESTAMP
     WHERE name = ?`
  ).run(enabled ? 1 : 0, name);
  return getSkillOrInstructionByName(name);
}
function duplicateSkillOrInstruction(name) {
  if (!db) return null;
  const original = getSkillOrInstructionByName(name);
  if (!original) return null;
  let copyName = `${name}-copy`;
  let suffix = 1;
  while (getSkillOrInstructionByName(copyName) !== null) {
    suffix += 1;
    copyName = `${name}-copy-${suffix}`;
  }
  db.prepare(
    `INSERT INTO skills_and_instructions (name, type, description, content, enabled)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    copyName,
    original.type,
    original.description,
    original.content,
    original.enabled ? 1 : 0
  );
  return getSkillOrInstructionByName(copyName);
}
function seedBuiltinTemplates(templates) {
  if (!db) return 0;
  const existsStmt = db.prepare(
    `SELECT 1 as present FROM skills_and_instructions WHERE name = ?`
  );
  const insertStmt = db.prepare(
    `INSERT INTO skills_and_instructions (name, type, description, content, category, is_builtin, enabled)
     VALUES (?, ?, ?, ?, ?, 1, 1)`
  );
  let insertedCount = 0;
  for (const template of templates) {
    const existing = existsStmt.get(template.name);
    if (existing) continue;
    insertStmt.run(
      template.name,
      template.type,
      template.description,
      template.content,
      template.category
    );
    insertedCount++;
  }
  return insertedCount;
}
function resetBuiltinTemplates(templates) {
  if (!db) return 0;
  const existsStmt = db.prepare(
    `SELECT 1 as present FROM skills_and_instructions WHERE name = ?`
  );
  const updateStmt = db.prepare(
    `UPDATE skills_and_instructions
     SET type = ?, description = ?, content = ?, category = ?, is_builtin = 1, enabled = 1, updated_at = CURRENT_TIMESTAMP
     WHERE name = ?`
  );
  const insertStmt = db.prepare(
    `INSERT INTO skills_and_instructions (name, type, description, content, category, is_builtin, enabled)
     VALUES (?, ?, ?, ?, ?, 1, 1)`
  );
  let resetCount = 0;
  for (const template of templates) {
    const existing = existsStmt.get(template.name);
    if (existing) {
      updateStmt.run(
        template.type,
        template.description,
        template.content,
        template.category,
        template.name
      );
    } else {
      insertStmt.run(
        template.name,
        template.type,
        template.description,
        template.content,
        template.category
      );
    }
    resetCount++;
  }
  return resetCount;
}
function getMissingBuiltinCount(templateNames) {
  if (!db || templateNames.length === 0) return 0;
  const placeholders = templateNames.map(() => "?").join(",");
  const row = db.prepare(
    `SELECT COUNT(*) as c FROM skills_and_instructions WHERE name IN (${placeholders})`
  ).get(...templateNames);
  const existingCount = row?.c ?? 0;
  return templateNames.length - existingCount;
}
function upsertContextInjection(providerSessionId, providerType, payload, source = "manual", replaceKey) {
  if (!db) return;
  const tx = db.transaction(() => {
    if (replaceKey) {
      db.prepare(
        `DELETE FROM pending_context_injections
           WHERE provider_type = ? AND provider_session_id = ? AND replace_key = ? AND delivered = 0`
      ).run(providerType, providerSessionId, replaceKey);
    }
    db.prepare(
      `INSERT INTO pending_context_injections (provider_type, provider_session_id, source, replace_key, payload)
         VALUES (?, ?, ?, ?, ?)`
    ).run(
      providerType,
      providerSessionId,
      source,
      replaceKey ?? null,
      payload
    );
  });
  tx();
}
function claimContextInjections(providerSessionId, providerType) {
  if (!db) return [];
  const selectStmt = db.prepare(
    `SELECT id, source, payload, created_at
     FROM pending_context_injections
     WHERE provider_type = ? AND provider_session_id = ? AND delivered = 0
     ORDER BY id ASC`
  );
  const tx = db.transaction(
    (pType, pSid) => {
      const rows = selectStmt.all(pType, pSid);
      if (rows.length === 0) return [];
      const items = rows.map((row) => ({
        id: row.id,
        source: row.source,
        payload: row.payload,
        createdAt: row.created_at
      }));
      const ids = items.map((item) => item.id);
      const placeholders = ids.map(() => "?").join(",");
      db.prepare(
        `UPDATE pending_context_injections SET delivered = 1 WHERE id IN (${placeholders})`
      ).run(...ids);
      return items;
    }
  );
  return tx(providerType, providerSessionId);
}
function deleteContextInjectionsForSession(providerSessionId, providerType) {
  if (!db) return;
  db.prepare(
    `DELETE FROM pending_context_injections WHERE provider_type = ? AND provider_session_id = ?`
  ).run(providerType, providerSessionId);
}
function getPinnedProjects() {
  if (!db) return [];
  const rows = db.prepare(
    `SELECT path, name, created_at FROM pinned_projects ORDER BY created_at DESC`
  ).all();
  return rows.map((row) => ({
    path: row.path,
    name: row.name,
    createdAt: row.created_at
  }));
}
function addPinnedProject(path, name) {
  if (!db) return false;
  try {
    const info = db.prepare(
      `INSERT OR IGNORE INTO pinned_projects (path, name) VALUES (?, ?)`
    ).run(path, name);
    return info.changes > 0;
  } catch {
    return false;
  }
}
function removePinnedProject(path) {
  if (!db) return false;
  db.prepare(`DELETE FROM pinned_projects WHERE path = ?`).run(path);
  return true;
}
function mapRowToFolder(row) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function listFolders() {
  if (!db) return [];
  const rows = db.prepare(
    `SELECT id, name, created_at, updated_at FROM folders ORDER BY name ASC`
  ).all();
  return rows.map(mapRowToFolder);
}
function getFolderById(id) {
  if (!db) return null;
  const row = db.prepare(
    `SELECT id, name, created_at, updated_at FROM folders WHERE id = ?`
  ).get(id);
  if (!row) return null;
  return mapRowToFolder(row);
}
function getFolderByName(name) {
  if (!db) return null;
  const row = db.prepare(
    `SELECT id, name, created_at, updated_at FROM folders WHERE name = ?`
  ).get(name);
  if (!row) return null;
  return mapRowToFolder(row);
}
function createFolder(name) {
  if (!db) return null;
  const trimmed = name.trim();
  if (trimmed === "") return null;
  if (getFolderByName(trimmed) !== null) return null;
  db.prepare(`INSERT INTO folders (name) VALUES (?)`).run(trimmed);
  return getFolderByName(trimmed);
}
function renameFolder(id, newName) {
  if (!db) return null;
  const trimmed = newName.trim();
  if (trimmed === "") return null;
  const existing = getFolderById(id);
  if (!existing) return null;
  const collision = getFolderByName(trimmed);
  if (collision && collision.id !== id) return null;
  db.prepare(
    `UPDATE folders SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(trimmed, id);
  return getFolderById(id);
}
function deleteFolder(id) {
  if (!db) return false;
  const existing = getFolderById(id);
  if (!existing) return false;
  const txn = db.transaction((folderId) => {
    db.prepare(
      `UPDATE skills_and_instructions SET folder_id = NULL WHERE folder_id = ?`
    ).run(folderId);
    db.prepare(`DELETE FROM folders WHERE id = ?`).run(folderId);
  });
  txn(id);
  return true;
}
function setEntryFolder(entryName, folderId) {
  if (!db) return false;
  if (folderId !== null && getFolderById(folderId) === null) return false;
  const existing = getSkillOrInstructionByName(entryName);
  if (!existing) return false;
  db.prepare(
    `UPDATE skills_and_instructions
     SET folder_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE name = ?`
  ).run(folderId, entryName);
  return true;
}
function setEntryScope(entryName, scope) {
  if (!db) return false;
  const existing = getSkillOrInstructionByName(entryName);
  if (!existing) return false;
  db.prepare(
    `UPDATE skills_and_instructions
     SET scope = ?, updated_at = CURRENT_TIMESTAMP
     WHERE name = ?`
  ).run(scope, entryName);
  return true;
}
function listSessionScopedEntryNames(providerType, providerSessionId) {
  if (!db) return [];
  const rows = db.prepare(
    `SELECT entry_name FROM session_scoped_entries
       WHERE provider_type = ? AND provider_session_id = ?
       ORDER BY entry_name ASC`
  ).all(providerType, providerSessionId);
  return rows.map((row) => row.entry_name);
}
function setSessionScopedEntries(providerType, providerSessionId, entryNames) {
  if (!db) return;
  const txn = db.transaction((pt, psid, names) => {
    db.prepare(
      `DELETE FROM session_scoped_entries
         WHERE provider_type = ? AND provider_session_id = ?`
    ).run(pt, psid);
    const insert = db.prepare(
      `INSERT OR IGNORE INTO session_scoped_entries (provider_type, provider_session_id, entry_name)
       VALUES (?, ?, ?)`
    );
    for (const name of names) {
      insert.run(pt, psid, name);
    }
  });
  txn(providerType, providerSessionId, entryNames);
}
function listSessionMutedEntryNames(providerType, providerSessionId) {
  if (!db) return [];
  const rows = db.prepare(
    `SELECT entry_name FROM session_muted_entries
       WHERE provider_type = ? AND provider_session_id = ?
       ORDER BY entry_name ASC`
  ).all(providerType, providerSessionId);
  return rows.map((row) => row.entry_name);
}
function setSessionMutedEntries(providerType, providerSessionId, entryNames) {
  if (!db) return;
  const txn = db.transaction((pt, psid, names) => {
    db.prepare(
      `DELETE FROM session_muted_entries
         WHERE provider_type = ? AND provider_session_id = ?`
    ).run(pt, psid);
    const insert = db.prepare(
      `INSERT OR IGNORE INTO session_muted_entries (provider_type, provider_session_id, entry_name)
       VALUES (?, ?, ?)`
    );
    for (const name of names) {
      insert.run(pt, psid, name);
    }
  });
  txn(providerType, providerSessionId, entryNames);
}
let _getSoundEnabled = () => true;
let _getPromptTimeoutMs = () => 12e5;
function setSoundEnabled(fn) {
  _getSoundEnabled = fn;
}
function setPromptTimeout(fn) {
  _getPromptTimeoutMs = fn;
}
function getPromptTimeoutSeconds() {
  return Math.round(_getPromptTimeoutMs() / 1e3);
}
const activePrompts = /* @__PURE__ */ new Map();
const activePromptStatesById = /* @__PURE__ */ new Map();
let promptResponseListenerRegistered = false;
const queuedPrompts = /* @__PURE__ */ new Map();
const queueRunning = /* @__PURE__ */ new Set();
let lastBeepTime = 0;
const BEEP_COOLDOWN_MS = 2e3;
const MAX_SAFE_TIMEOUT_MS = 2147483647;
function trackPromptState(state2) {
  const existing = activePromptStatesById.get(state2.promptId);
  if (existing) {
    existing.add(state2);
    return;
  }
  activePromptStatesById.set(state2.promptId, /* @__PURE__ */ new Set([state2]));
}
function untrackPromptState(state2) {
  const states = activePromptStatesById.get(state2.promptId);
  if (!states) return;
  states.delete(state2);
  if (states.size === 0) {
    activePromptStatesById.delete(state2.promptId);
  }
}
function getIndexedPromptStateCount() {
  let count = 0;
  for (const states of activePromptStatesById.values()) {
    count += states.size;
  }
  return count;
}
function handlePromptResponse(_event, response) {
  if (!response?.id) return;
  const states = activePromptStatesById.get(response.id);
  if (!states || states.size === 0) return;
  for (const state2 of Array.from(states)) {
    if (state2.settled) continue;
    _settlePrompt(state2, {
      answer: response.answer,
      attachments: response.attachments
    });
    state2.sendPromptClear();
    saveConversation({
      promptMessage: state2.data.message,
      projectName: state2.data.projectName,
      userResponse: response.answer,
      predefinedOptions: state2.data.predefinedOptions,
      attachments: response.attachments
    });
    appendSessionChannelMessage({
      sessionId: state2.promptKey,
      messageType: "answer",
      messageText: response.answer,
      attachments: response.attachments
    });
  }
}
function ensurePromptResponseListener() {
  if (promptResponseListenerRegistered) return;
  ipcMain.on("prompt-response", handlePromptResponse);
  promptResponseListenerRegistered = true;
}
function getActivePromptData() {
  const result = [];
  for (const state2 of activePrompts.values()) {
    result.push(state2.data);
  }
  return result;
}
function cancelActivePrompt(identity) {
  const keysToCancel = /* @__PURE__ */ new Set();
  for (const [key, state2] of activePrompts.entries()) {
    if (state2.data.connectionId === identity || state2.data.providerSessionId === identity || key === identity) {
      keysToCancel.add(key);
    }
  }
  for (const key of keysToCancel) {
    const state2 = activePrompts.get(key);
    if (!state2) continue;
    state2.sendPromptClear();
    _settlePrompt(state2, {
      answer: "Error: Prompt superseded by a newer prompt."
    });
  }
  for (const [key, queued] of queuedPrompts.entries()) {
    if (!queued.length) {
      queuedPrompts.delete(key);
      continue;
    }
    const remaining = [];
    for (const entry of queued) {
      if (entry.connectionId !== identity && key !== identity) {
        remaining.push(entry);
        continue;
      }
      entry.resolve({
        answer: "Error: Prompt cancelled before display because the connection was closed."
      });
    }
    if (remaining.length === 0) {
      queuedPrompts.delete(key);
      continue;
    }
    queuedPrompts.set(key, remaining);
  }
}
function forceTerminateChat(identity) {
  const terminationMessage = "USER_FORCE_TERMINATED: The user has force-terminated this conversation. Stop all current work and acknowledge the termination.";
  const keysToTerminate = /* @__PURE__ */ new Set();
  for (const [key, state2] of activePrompts.entries()) {
    if (state2.data.connectionId === identity || state2.data.providerSessionId === identity || key === identity) {
      keysToTerminate.add(key);
    }
  }
  for (const key of keysToTerminate) {
    const state2 = activePrompts.get(key);
    if (!state2) continue;
    _settlePrompt(state2, { answer: terminationMessage });
  }
  for (const [key, queued] of queuedPrompts.entries()) {
    if (!queued.length) {
      queuedPrompts.delete(key);
      continue;
    }
    const remaining = [];
    for (const entry of queued) {
      if (entry.connectionId !== identity && key !== identity) {
        remaining.push(entry);
        continue;
      }
      entry.resolve({ answer: terminationMessage });
    }
    if (remaining.length === 0) {
      queuedPrompts.delete(key);
      continue;
    }
    queuedPrompts.set(key, remaining);
  }
}
function promptUser(win, data, signal) {
  const promptKey = data.providerSessionId ?? "";
  if (!promptKey) {
    return Promise.resolve({
      answer: "Error: providerSessionId could not be resolved — the agent session is not registered."
    });
  }
  console.log(
    `[prompt-routing] promptUser called:
  data.connectionId=${data.connectionId}
  data.providerSessionId=${data.providerSessionId ?? "undefined"}
  resolved promptKey=${promptKey}`
  );
  return new Promise((resolveOuter) => {
    _enqueuePrompt(promptKey, {
      connectionId: data.connectionId,
      resolve: resolveOuter,
      run: async () => {
        if (signal?.aborted) {
          resolveOuter({
            answer: "Error: Tool call aborted — the MCP session was closed or the request was cancelled."
          });
          return;
        }
        if (!win || win.isDestroyed()) {
          resolveOuter({
            answer: "Error: Application window is not available."
          });
          return;
        }
        const existing = activePrompts.get(promptKey);
        if (existing && !existing.settled) {
          void existing.promise.then(resolveOuter);
          return;
        }
        win.show();
        win.focus();
        const now = Date.now();
        if (_getSoundEnabled() && now - lastBeepTime >= BEEP_COOLDOWN_MS) {
          lastBeepTime = now;
          shell.beep();
        }
        const timeoutMs = _getPromptTimeoutMs();
        const safeTimeoutMs = timeoutMs > 0 ? Math.min(timeoutMs, MAX_SAFE_TIMEOUT_MS) : 0;
        const promptWithExpiry = {
          ...data,
          expiresAt: timeoutMs > 0 ? now + timeoutMs : 0,
          providerSessionId: data.providerSessionId ?? null
        };
        let durableResolve;
        const durablePromise = new Promise((res) => {
          durableResolve = res;
        });
        const sendPromptClear = () => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("prompt-clear", {
              id: data.id,
              providerSessionId: promptWithExpiry.providerSessionId ?? null
            });
          }
        };
        const durableState = {
          promptId: data.id,
          data: promptWithExpiry,
          promptKey,
          promise: durablePromise,
          resolve: durableResolve,
          settled: false,
          timer: null,
          diagInterval: null,
          sendPromptClear
        };
        ensurePromptResponseListener();
        activePrompts.set(promptKey, durableState);
        trackPromptState(durableState);
        void durablePromise.then(resolveOuter);
        win.webContents.send("prompt-request", {
          id: promptWithExpiry.id,
          message: promptWithExpiry.message,
          projectName: promptWithExpiry.projectName,
          predefinedOptions: promptWithExpiry.predefinedOptions,
          sessionId: promptWithExpiry.sessionId,
          connectionName: promptWithExpiry.connectionName,
          timeoutSeconds: promptWithExpiry.timeoutSeconds,
          expiresAt: promptWithExpiry.expiresAt,
          baseDirectory: promptWithExpiry.baseDirectory,
          clientInfo: promptWithExpiry.clientInfo,
          providerSessionId: promptWithExpiry.providerSessionId
        });
        appendSessionChannelMessage({
          sessionId: promptKey,
          messageType: "question",
          messageText: data.message
        });
        const diagStart = Date.now();
        durableState.diagInterval = setInterval(() => {
          if (durableState.settled) {
            clearInterval(durableState.diagInterval);
            durableState.diagInterval = null;
            return;
          }
          const elapsed = Math.round((Date.now() - diagStart) / 1e3);
          const listenerCount = ipcMain.listenerCount("prompt-response");
          const indexedPromptIds = activePromptStatesById.size;
          const indexedPromptStates = getIndexedPromptStateCount();
          console.log(
            `[prompt-diag] id=${data.id} connectionId=${data.connectionId} promptKey=${promptKey} settled=${durableState.settled} elapsed=${elapsed}s prompt-response-listeners=${listenerCount} activePrompts=${activePrompts.size} indexedPromptIds=${indexedPromptIds} indexedPromptStates=${indexedPromptStates}`
          );
        }, 1e4);
        if (safeTimeoutMs > 0) {
          durableState.timer = setTimeout(() => {
            const state2 = activePrompts.get(promptKey);
            if (!state2 || state2.settled) return;
            _settlePrompt(state2, { answer: null });
            appendSessionChannelMessage({
              sessionId: promptKey,
              messageType: "agent_message",
              messageText: "Prompt expired before a reply was submitted. Ask again to continue this interaction."
            });
            sendPromptClear();
          }, safeTimeoutMs);
        }
      }
    });
  });
}
function _settlePrompt(state2, response) {
  if (state2.settled) return;
  state2.settled = true;
  if (state2.timer !== null) {
    clearTimeout(state2.timer);
    state2.timer = null;
  }
  if (state2.diagInterval !== null) {
    clearInterval(state2.diagInterval);
    state2.diagInterval = null;
  }
  const current = activePrompts.get(state2.promptKey);
  if (current && current.promptId === state2.promptId) {
    activePrompts.delete(state2.promptKey);
  }
  untrackPromptState(state2);
  state2.resolve(response);
}
function _enqueuePrompt(promptKey, entry) {
  const queue = queuedPrompts.get(promptKey);
  if (queue) {
    queue.push(entry);
  } else {
    queuedPrompts.set(promptKey, [entry]);
  }
  void _processQueue(promptKey);
}
async function _processQueue(promptKey) {
  if (queueRunning.has(promptKey)) return;
  queueRunning.add(promptKey);
  try {
    while (true) {
      const queue = queuedPrompts.get(promptKey);
      if (!queue?.length) {
        queuedPrompts.delete(promptKey);
        return;
      }
      const next = queue.shift();
      if (!next) return;
      await next.run();
    }
  } finally {
    queueRunning.delete(promptKey);
  }
}
const SESSION_FILE = join(tmpdir(), "imcp-session.json");
const CWD_SESSION_FILE = join(process.cwd(), ".imcp-session");
const MCP_CONFIG_FILE = join(tmpdir(), "imcp-mcp-config.json");
function writeSessionFile(sessionId, port, promptTimeoutMs) {
  const payload = { sessionId, port };
  if (promptTimeoutMs != null && promptTimeoutMs > 0) {
    payload.promptTimeoutMs = promptTimeoutMs;
  }
  const data = JSON.stringify(payload);
  for (const path of [SESSION_FILE, CWD_SESSION_FILE]) {
    try {
      writeFileSync(path, data, "utf-8");
    } catch {
    }
  }
}
function writeMcpConfigHint(port) {
  const config = {};
  config["interactive-desktop"] = {
    type: "remote",
    url: `http://localhost:${port}/mcp`
  };
  try {
    writeFileSync(MCP_CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
  } catch {
  }
}
function clearSessionFile() {
  for (const path of [SESSION_FILE, CWD_SESSION_FILE]) {
    try {
      unlinkSync(path);
    } catch {
    }
  }
  try {
    unlinkSync(MCP_CONFIG_FILE);
  } catch {
  }
}
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
function sanitizeSessionKey(sessionKey) {
  if (!sessionKey) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(sessionKey)) return null;
  return sessionKey;
}
function sessionDir(sessionKey) {
  const safe = sanitizeSessionKey(sessionKey);
  if (!safe) return null;
  return join(tmpdir(), `interactive-mcp-${safe}`);
}
function ensureSessionDir(sessionKey) {
  const dir = sessionDir(sessionKey);
  if (!dir) return null;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
function getAttachmentsDir(sessionKey) {
  return ensureSessionDir(sessionKey);
}
function saveAttachment(sessionKey, base64Data, mimeType) {
  try {
    const dir = ensureSessionDir(sessionKey);
    if (!dir) return null;
    const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
    const filename = `${randomUUID()}.${ext}`;
    const filePath = join(dir, filename);
    writeFileSync(filePath, Buffer.from(base64Data, "base64"));
    return filename;
  } catch {
    return null;
  }
}
function saveNamedAttachment(sessionKey, originalName, data, encoding = "utf8") {
  try {
    const dir = ensureSessionDir(sessionKey);
    if (!dir) return null;
    const safeName = basename(originalName || "attachment.bin");
    const filename = `${randomUUID()}-${safeName}`;
    const filePath = join(dir, filename);
    writeFileSync(filePath, Buffer.from(data, encoding));
    return filename;
  } catch {
    return null;
  }
}
function resolveAttachmentPath(sessionKey, filename) {
  const dir = sessionDir(sessionKey);
  if (!dir) return null;
  if (filename.includes("/") || filename.includes("\\") || filename === "..") {
    return null;
  }
  const filePath = join(dir, filename);
  return existsSync(filePath) ? filePath : null;
}
function attachmentUrl(sessionKey, filename, port) {
  return `http://localhost:${port}/attachments/${encodeURIComponent(
    sessionKey
  )}/${encodeURIComponent(filename)}`;
}
function clearSessionAttachments(sessionKey) {
  const dir = sessionDir(sessionKey);
  if (!dir || !existsSync(dir)) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
  }
}
function cleanupOldAttachments() {
  let removed = 0;
  const base = tmpdir();
  const now = Date.now();
  try {
    for (const entry of readdirSync(base)) {
      if (!entry.startsWith("interactive-mcp-")) continue;
      const dir = join(base, entry);
      try {
        const stat = statSync(dir);
        if (!stat.isDirectory()) continue;
        if (now - stat.mtimeMs <= MAX_AGE_MS) continue;
        try {
          for (const file of readdirSync(dir)) {
            try {
              unlinkSync(join(dir, file));
              removed++;
            } catch {
            }
          }
        } catch {
        }
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
        }
      } catch {
      }
    }
  } catch {
  }
  return removed;
}
const _deletedSessions = /* @__PURE__ */ new Set();
function markSessionDeleted(providerSessionId) {
  _deletedSessions.add(providerSessionId);
}
function staleSessionError(providerSessionId) {
  if (!_deletedSessions.has(providerSessionId)) return null;
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error: "SESSION_REMOVED",
          message: "Your session was removed from the Interactive MCP Desktop app by the user. You must re-register before using any other tools.",
          action: "Call the register_connection tool with your channelName, projectName, and baseDirectory to re-establish your channel.",
          example: {
            tool: "register_connection",
            arguments: {
              channelName: "<your channel name>",
              projectName: "<your project name>",
              baseDirectory: "<absolute path to your working directory>"
            }
          }
        })
      }
    ]
  };
}
function requireProviderSessionId(providerSessionId, requireSessionId) {
  if (!requireSessionId) return null;
  if (typeof providerSessionId === "string" && providerSessionId.trim().length > 0) {
    return null;
  }
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error: "MISSING_SESSION_ID",
          message: "You MUST pass your openCodeSessionId parameter on every tool call. This is required for correct message routing in multi-agent scenarios.",
          action: "Include the openCodeSessionId parameter (format: ses_<alphanumeric>) in your tool call. Your session ID was injected into your context at session start via a <system-reminder> message.",
          hint: 'Look for "<system-reminder>" in your context containing your openCodeSessionId.'
        })
      }
    ]
  };
}
function errorMessage(e) {
  return e instanceof Error ? e.message : String(e);
}
function errWithCause(message, cause) {
  return new Error(message, { cause });
}
const createSseClient = ({ onRequest, onSseError, onSseEvent, responseTransformer, responseValidator, sseDefaultRetryDelay, sseMaxRetryAttempts, sseMaxRetryDelay, sseSleepFn, url, ...options }) => {
  let lastEventId;
  const sleep = sseSleepFn ?? ((ms) => new Promise((resolve2) => setTimeout(resolve2, ms)));
  const createStream = async function* () {
    let retryDelay = sseDefaultRetryDelay ?? 3e3;
    let attempt = 0;
    const signal = options.signal ?? new AbortController().signal;
    while (true) {
      if (signal.aborted)
        break;
      attempt++;
      const headers = options.headers instanceof Headers ? options.headers : new Headers(options.headers);
      if (lastEventId !== void 0) {
        headers.set("Last-Event-ID", lastEventId);
      }
      try {
        const requestInit = {
          redirect: "follow",
          ...options,
          body: options.serializedBody,
          headers,
          signal
        };
        let request = new Request(url, requestInit);
        if (onRequest) {
          request = await onRequest(url, requestInit);
        }
        const _fetch = options.fetch ?? globalThis.fetch;
        const response = await _fetch(request);
        if (!response.ok)
          throw new Error(`SSE failed: ${response.status} ${response.statusText}`);
        if (!response.body)
          throw new Error("No body in SSE response");
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        const abortHandler = () => {
          try {
            reader.cancel();
          } catch {
          }
        };
        signal.addEventListener("abort", abortHandler);
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done)
              break;
            buffer += value;
            buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
            const chunks = buffer.split("\n\n");
            buffer = chunks.pop() ?? "";
            for (const chunk of chunks) {
              const lines = chunk.split("\n");
              const dataLines = [];
              let eventName;
              for (const line of lines) {
                if (line.startsWith("data:")) {
                  dataLines.push(line.replace(/^data:\s*/, ""));
                } else if (line.startsWith("event:")) {
                  eventName = line.replace(/^event:\s*/, "");
                } else if (line.startsWith("id:")) {
                  lastEventId = line.replace(/^id:\s*/, "");
                } else if (line.startsWith("retry:")) {
                  const parsed = Number.parseInt(line.replace(/^retry:\s*/, ""), 10);
                  if (!Number.isNaN(parsed)) {
                    retryDelay = parsed;
                  }
                }
              }
              let data;
              let parsedJson = false;
              if (dataLines.length) {
                const rawData = dataLines.join("\n");
                try {
                  data = JSON.parse(rawData);
                  parsedJson = true;
                } catch {
                  data = rawData;
                }
              }
              if (parsedJson) {
                if (responseValidator) {
                  await responseValidator(data);
                }
                if (responseTransformer) {
                  data = await responseTransformer(data);
                }
              }
              onSseEvent?.({
                data,
                event: eventName,
                id: lastEventId,
                retry: retryDelay
              });
              if (dataLines.length) {
                yield data;
              }
            }
          }
        } finally {
          signal.removeEventListener("abort", abortHandler);
          reader.releaseLock();
        }
        break;
      } catch (error) {
        onSseError?.(error);
        if (sseMaxRetryAttempts !== void 0 && attempt >= sseMaxRetryAttempts) {
          break;
        }
        const backoff = Math.min(retryDelay * 2 ** (attempt - 1), sseMaxRetryDelay ?? 3e4);
        await sleep(backoff);
      }
    }
  };
  const stream = createStream();
  return { stream };
};
const separatorArrayExplode = (style) => {
  switch (style) {
    case "label":
      return ".";
    case "matrix":
      return ";";
    case "simple":
      return ",";
    default:
      return "&";
  }
};
const separatorArrayNoExplode = (style) => {
  switch (style) {
    case "form":
      return ",";
    case "pipeDelimited":
      return "|";
    case "spaceDelimited":
      return "%20";
    default:
      return ",";
  }
};
const separatorObjectExplode = (style) => {
  switch (style) {
    case "label":
      return ".";
    case "matrix":
      return ";";
    case "simple":
      return ",";
    default:
      return "&";
  }
};
const serializeArrayParam = ({ allowReserved, explode, name, style, value }) => {
  if (!explode) {
    const joinedValues2 = (allowReserved ? value : value.map((v) => encodeURIComponent(v))).join(separatorArrayNoExplode(style));
    switch (style) {
      case "label":
        return `.${joinedValues2}`;
      case "matrix":
        return `;${name}=${joinedValues2}`;
      case "simple":
        return joinedValues2;
      default:
        return `${name}=${joinedValues2}`;
    }
  }
  const separator = separatorArrayExplode(style);
  const joinedValues = value.map((v) => {
    if (style === "label" || style === "simple") {
      return allowReserved ? v : encodeURIComponent(v);
    }
    return serializePrimitiveParam({
      allowReserved,
      name,
      value: v
    });
  }).join(separator);
  return style === "label" || style === "matrix" ? separator + joinedValues : joinedValues;
};
const serializePrimitiveParam = ({ allowReserved, name, value }) => {
  if (value === void 0 || value === null) {
    return "";
  }
  if (typeof value === "object") {
    throw new Error("Deeply-nested arrays/objects aren’t supported. Provide your own `querySerializer()` to handle these.");
  }
  return `${name}=${allowReserved ? value : encodeURIComponent(value)}`;
};
const serializeObjectParam = ({ allowReserved, explode, name, style, value, valueOnly }) => {
  if (value instanceof Date) {
    return valueOnly ? value.toISOString() : `${name}=${value.toISOString()}`;
  }
  if (style !== "deepObject" && !explode) {
    let values = [];
    Object.entries(value).forEach(([key, v]) => {
      values = [...values, key, allowReserved ? v : encodeURIComponent(v)];
    });
    const joinedValues2 = values.join(",");
    switch (style) {
      case "form":
        return `${name}=${joinedValues2}`;
      case "label":
        return `.${joinedValues2}`;
      case "matrix":
        return `;${name}=${joinedValues2}`;
      default:
        return joinedValues2;
    }
  }
  const separator = separatorObjectExplode(style);
  const joinedValues = Object.entries(value).map(([key, v]) => serializePrimitiveParam({
    allowReserved,
    name: style === "deepObject" ? `${name}[${key}]` : key,
    value: v
  })).join(separator);
  return style === "label" || style === "matrix" ? separator + joinedValues : joinedValues;
};
const PATH_PARAM_RE = /\{[^{}]+\}/g;
const defaultPathSerializer = ({ path, url: _url }) => {
  let url = _url;
  const matches = _url.match(PATH_PARAM_RE);
  if (matches) {
    for (const match of matches) {
      let explode = false;
      let name = match.substring(1, match.length - 1);
      let style = "simple";
      if (name.endsWith("*")) {
        explode = true;
        name = name.substring(0, name.length - 1);
      }
      if (name.startsWith(".")) {
        name = name.substring(1);
        style = "label";
      } else if (name.startsWith(";")) {
        name = name.substring(1);
        style = "matrix";
      }
      const value = path[name];
      if (value === void 0 || value === null) {
        continue;
      }
      if (Array.isArray(value)) {
        url = url.replace(match, serializeArrayParam({ explode, name, style, value }));
        continue;
      }
      if (typeof value === "object") {
        url = url.replace(match, serializeObjectParam({
          explode,
          name,
          style,
          value,
          valueOnly: true
        }));
        continue;
      }
      if (style === "matrix") {
        url = url.replace(match, `;${serializePrimitiveParam({
          name,
          value
        })}`);
        continue;
      }
      const replaceValue = encodeURIComponent(style === "label" ? `.${value}` : value);
      url = url.replace(match, replaceValue);
    }
  }
  return url;
};
const getUrl = ({ baseUrl, path, query, querySerializer, url: _url }) => {
  const pathUrl = _url.startsWith("/") ? _url : `/${_url}`;
  let url = (baseUrl ?? "") + pathUrl;
  if (path) {
    url = defaultPathSerializer({ path, url });
  }
  let search = query ? querySerializer(query) : "";
  if (search.startsWith("?")) {
    search = search.substring(1);
  }
  if (search) {
    url += `?${search}`;
  }
  return url;
};
function getValidRequestBody(options) {
  const hasBody = options.body !== void 0;
  const isSerializedBody = hasBody && options.bodySerializer;
  if (isSerializedBody) {
    if ("serializedBody" in options) {
      const hasSerializedBody = options.serializedBody !== void 0 && options.serializedBody !== "";
      return hasSerializedBody ? options.serializedBody : null;
    }
    return options.body !== "" ? options.body : null;
  }
  if (hasBody) {
    return options.body;
  }
  return void 0;
}
const getAuthToken = async (auth, callback) => {
  const token = typeof callback === "function" ? await callback(auth) : callback;
  if (!token) {
    return;
  }
  if (auth.scheme === "bearer") {
    return `Bearer ${token}`;
  }
  if (auth.scheme === "basic") {
    return `Basic ${btoa(token)}`;
  }
  return token;
};
const jsonBodySerializer = {
  bodySerializer: (body) => JSON.stringify(body, (_key, value) => typeof value === "bigint" ? value.toString() : value)
};
const createQuerySerializer = ({ parameters = {}, ...args } = {}) => {
  const querySerializer = (queryParams) => {
    const search = [];
    if (queryParams && typeof queryParams === "object") {
      for (const name in queryParams) {
        const value = queryParams[name];
        if (value === void 0 || value === null) {
          continue;
        }
        const options = parameters[name] || args;
        if (Array.isArray(value)) {
          const serializedArray = serializeArrayParam({
            allowReserved: options.allowReserved,
            explode: true,
            name,
            style: "form",
            value,
            ...options.array
          });
          if (serializedArray)
            search.push(serializedArray);
        } else if (typeof value === "object") {
          const serializedObject = serializeObjectParam({
            allowReserved: options.allowReserved,
            explode: true,
            name,
            style: "deepObject",
            value,
            ...options.object
          });
          if (serializedObject)
            search.push(serializedObject);
        } else {
          const serializedPrimitive = serializePrimitiveParam({
            allowReserved: options.allowReserved,
            name,
            value
          });
          if (serializedPrimitive)
            search.push(serializedPrimitive);
        }
      }
    }
    return search.join("&");
  };
  return querySerializer;
};
const getParseAs = (contentType) => {
  if (!contentType) {
    return "stream";
  }
  const cleanContent = contentType.split(";")[0]?.trim();
  if (!cleanContent) {
    return;
  }
  if (cleanContent.startsWith("application/json") || cleanContent.endsWith("+json")) {
    return "json";
  }
  if (cleanContent === "multipart/form-data") {
    return "formData";
  }
  if (["application/", "audio/", "image/", "video/"].some((type) => cleanContent.startsWith(type))) {
    return "blob";
  }
  if (cleanContent.startsWith("text/")) {
    return "text";
  }
  return;
};
const checkForExistence = (options, name) => {
  if (!name) {
    return false;
  }
  if (options.headers.has(name) || options.query?.[name] || options.headers.get("Cookie")?.includes(`${name}=`)) {
    return true;
  }
  return false;
};
const setAuthParams = async ({ security, ...options }) => {
  for (const auth of security) {
    if (checkForExistence(options, auth.name)) {
      continue;
    }
    const token = await getAuthToken(auth, options.auth);
    if (!token) {
      continue;
    }
    const name = auth.name ?? "Authorization";
    switch (auth.in) {
      case "query":
        if (!options.query) {
          options.query = {};
        }
        options.query[name] = token;
        break;
      case "cookie":
        options.headers.append("Cookie", `${name}=${token}`);
        break;
      case "header":
      default:
        options.headers.set(name, token);
        break;
    }
  }
};
const buildUrl = (options) => getUrl({
  baseUrl: options.baseUrl,
  path: options.path,
  query: options.query,
  querySerializer: typeof options.querySerializer === "function" ? options.querySerializer : createQuerySerializer(options.querySerializer),
  url: options.url
});
const mergeConfigs = (a, b) => {
  const config = { ...a, ...b };
  if (config.baseUrl?.endsWith("/")) {
    config.baseUrl = config.baseUrl.substring(0, config.baseUrl.length - 1);
  }
  config.headers = mergeHeaders(a.headers, b.headers);
  return config;
};
const headersEntries = (headers) => {
  const entries = [];
  headers.forEach((value, key) => {
    entries.push([key, value]);
  });
  return entries;
};
const mergeHeaders = (...headers) => {
  const mergedHeaders = new Headers();
  for (const header of headers) {
    if (!header) {
      continue;
    }
    const iterator = header instanceof Headers ? headersEntries(header) : Object.entries(header);
    for (const [key, value] of iterator) {
      if (value === null) {
        mergedHeaders.delete(key);
      } else if (Array.isArray(value)) {
        for (const v of value) {
          mergedHeaders.append(key, v);
        }
      } else if (value !== void 0) {
        mergedHeaders.set(key, typeof value === "object" ? JSON.stringify(value) : value);
      }
    }
  }
  return mergedHeaders;
};
class Interceptors {
  fns = [];
  clear() {
    this.fns = [];
  }
  eject(id) {
    const index = this.getInterceptorIndex(id);
    if (this.fns[index]) {
      this.fns[index] = null;
    }
  }
  exists(id) {
    const index = this.getInterceptorIndex(id);
    return Boolean(this.fns[index]);
  }
  getInterceptorIndex(id) {
    if (typeof id === "number") {
      return this.fns[id] ? id : -1;
    }
    return this.fns.indexOf(id);
  }
  update(id, fn) {
    const index = this.getInterceptorIndex(id);
    if (this.fns[index]) {
      this.fns[index] = fn;
      return id;
    }
    return false;
  }
  use(fn) {
    this.fns.push(fn);
    return this.fns.length - 1;
  }
}
const createInterceptors = () => ({
  error: new Interceptors(),
  request: new Interceptors(),
  response: new Interceptors()
});
const defaultQuerySerializer = createQuerySerializer({
  allowReserved: false,
  array: {
    explode: true,
    style: "form"
  },
  object: {
    explode: true,
    style: "deepObject"
  }
});
const defaultHeaders = {
  "Content-Type": "application/json"
};
const createConfig = (override = {}) => ({
  ...jsonBodySerializer,
  headers: defaultHeaders,
  parseAs: "auto",
  querySerializer: defaultQuerySerializer,
  ...override
});
const createClient = (config = {}) => {
  let _config = mergeConfigs(createConfig(), config);
  const getConfig = () => ({ ..._config });
  const setConfig = (config2) => {
    _config = mergeConfigs(_config, config2);
    return getConfig();
  };
  const interceptors = createInterceptors();
  const beforeRequest = async (options) => {
    const opts = {
      ..._config,
      ...options,
      fetch: options.fetch ?? _config.fetch ?? globalThis.fetch,
      headers: mergeHeaders(_config.headers, options.headers),
      serializedBody: void 0
    };
    if (opts.security) {
      await setAuthParams({
        ...opts,
        security: opts.security
      });
    }
    if (opts.requestValidator) {
      await opts.requestValidator(opts);
    }
    if (opts.body !== void 0 && opts.bodySerializer) {
      opts.serializedBody = opts.bodySerializer(opts.body);
    }
    if (opts.body === void 0 || opts.serializedBody === "") {
      opts.headers.delete("Content-Type");
    }
    const url = buildUrl(opts);
    return { opts, url };
  };
  const request = async (options) => {
    const { opts, url } = await beforeRequest(options);
    const requestInit = {
      redirect: "follow",
      ...opts,
      body: getValidRequestBody(opts)
    };
    let request2 = new Request(url, requestInit);
    for (const fn of interceptors.request.fns) {
      if (fn) {
        request2 = await fn(request2, opts);
      }
    }
    const _fetch = opts.fetch;
    let response;
    try {
      response = await _fetch(request2);
    } catch (error2) {
      let finalError2 = error2;
      for (const fn of interceptors.error.fns) {
        if (fn) {
          finalError2 = await fn(error2, void 0, request2, opts);
        }
      }
      finalError2 = finalError2 || {};
      if (opts.throwOnError) {
        throw finalError2;
      }
      return opts.responseStyle === "data" ? void 0 : {
        error: finalError2,
        request: request2,
        response: void 0
      };
    }
    for (const fn of interceptors.response.fns) {
      if (fn) {
        response = await fn(response, request2, opts);
      }
    }
    const result = {
      request: request2,
      response
    };
    if (response.ok) {
      const parseAs = (opts.parseAs === "auto" ? getParseAs(response.headers.get("Content-Type")) : opts.parseAs) ?? "json";
      if (response.status === 204 || response.headers.get("Content-Length") === "0") {
        let emptyData;
        switch (parseAs) {
          case "arrayBuffer":
          case "blob":
          case "text":
            emptyData = await response[parseAs]();
            break;
          case "formData":
            emptyData = new FormData();
            break;
          case "stream":
            emptyData = response.body;
            break;
          case "json":
          default:
            emptyData = {};
            break;
        }
        return opts.responseStyle === "data" ? emptyData : {
          data: emptyData,
          ...result
        };
      }
      let data;
      switch (parseAs) {
        case "arrayBuffer":
        case "blob":
        case "formData":
        case "text":
          data = await response[parseAs]();
          break;
        case "json": {
          const text = await response.text();
          data = text ? JSON.parse(text) : {};
          break;
        }
        case "stream":
          return opts.responseStyle === "data" ? response.body : {
            data: response.body,
            ...result
          };
      }
      if (parseAs === "json") {
        if (opts.responseValidator) {
          await opts.responseValidator(data);
        }
        if (opts.responseTransformer) {
          data = await opts.responseTransformer(data);
        }
      }
      return opts.responseStyle === "data" ? data : {
        data,
        ...result
      };
    }
    const textError = await response.text();
    let jsonError;
    try {
      jsonError = JSON.parse(textError);
    } catch {
    }
    const error = jsonError ?? textError;
    let finalError = error;
    for (const fn of interceptors.error.fns) {
      if (fn) {
        finalError = await fn(error, response, request2, opts);
      }
    }
    finalError = finalError || {};
    if (opts.throwOnError) {
      throw finalError;
    }
    return opts.responseStyle === "data" ? void 0 : {
      error: finalError,
      ...result
    };
  };
  const makeMethodFn = (method) => (options) => request({ ...options, method });
  const makeSseFn = (method) => async (options) => {
    const { opts, url } = await beforeRequest(options);
    return createSseClient({
      ...opts,
      body: opts.body,
      headers: opts.headers,
      method,
      onRequest: async (url2, init) => {
        let request2 = new Request(url2, init);
        for (const fn of interceptors.request.fns) {
          if (fn) {
            request2 = await fn(request2, opts);
          }
        }
        return request2;
      },
      serializedBody: getValidRequestBody(opts),
      url
    });
  };
  return {
    buildUrl,
    connect: makeMethodFn("CONNECT"),
    delete: makeMethodFn("DELETE"),
    get: makeMethodFn("GET"),
    getConfig,
    head: makeMethodFn("HEAD"),
    interceptors,
    options: makeMethodFn("OPTIONS"),
    patch: makeMethodFn("PATCH"),
    post: makeMethodFn("POST"),
    put: makeMethodFn("PUT"),
    request,
    setConfig,
    sse: {
      connect: makeSseFn("CONNECT"),
      delete: makeSseFn("DELETE"),
      get: makeSseFn("GET"),
      head: makeSseFn("HEAD"),
      options: makeSseFn("OPTIONS"),
      patch: makeSseFn("PATCH"),
      post: makeSseFn("POST"),
      put: makeSseFn("PUT"),
      trace: makeSseFn("TRACE")
    },
    trace: makeMethodFn("TRACE")
  };
};
const extraPrefixesMap = {
  $body_: "body",
  $headers_: "headers",
  $path_: "path",
  $query_: "query"
};
const extraPrefixes = Object.entries(extraPrefixesMap);
const buildKeyMap = (fields, map) => {
  if (!map) {
    map = /* @__PURE__ */ new Map();
  }
  for (const config of fields) {
    if ("in" in config) {
      if (config.key) {
        map.set(config.key, {
          in: config.in,
          map: config.map
        });
      }
    } else if ("key" in config) {
      map.set(config.key, {
        map: config.map
      });
    } else if (config.args) {
      buildKeyMap(config.args, map);
    }
  }
  return map;
};
const stripEmptySlots = (params) => {
  for (const [slot, value] of Object.entries(params)) {
    if (value && typeof value === "object" && !Object.keys(value).length) {
      delete params[slot];
    }
  }
};
const buildClientParams = (args, fields) => {
  const params = {
    body: {},
    headers: {},
    path: {},
    query: {}
  };
  const map = buildKeyMap(fields);
  let config;
  for (const [index, arg] of args.entries()) {
    if (fields[index]) {
      config = fields[index];
    }
    if (!config) {
      continue;
    }
    if ("in" in config) {
      if (config.key) {
        const field = map.get(config.key);
        const name = field.map || config.key;
        if (field.in) {
          params[field.in][name] = arg;
        }
      } else {
        params.body = arg;
      }
    } else {
      for (const [key, value] of Object.entries(arg ?? {})) {
        const field = map.get(key);
        if (field) {
          if (field.in) {
            const name = field.map || key;
            params[field.in][name] = value;
          } else {
            params[field.map] = value;
          }
        } else {
          const extra = extraPrefixes.find(([prefix]) => key.startsWith(prefix));
          if (extra) {
            const [prefix, slot] = extra;
            params[slot][key.slice(prefix.length)] = value;
          } else if ("allowExtra" in config && config.allowExtra) {
            for (const [slot, allowed] of Object.entries(config.allowExtra)) {
              if (allowed) {
                params[slot][key] = value;
                break;
              }
            }
          }
        }
      }
    }
  }
  stripEmptySlots(params);
  return params;
};
const client = createClient(createConfig({ baseUrl: "http://localhost:4096" }));
class HeyApiClient {
  client;
  constructor(args) {
    this.client = args?.client ?? client;
  }
}
class HeyApiRegistry {
  defaultKey = "default";
  instances = /* @__PURE__ */ new Map();
  get(key) {
    const instance = this.instances.get(key ?? this.defaultKey);
    if (!instance) {
      throw new Error(`No SDK client found. Create one with "new OpencodeClient()" to fix this error.`);
    }
    return instance;
  }
  set(value, key) {
    this.instances.set(key ?? this.defaultKey, value);
  }
}
class Config extends HeyApiClient {
  /**
   * Get global configuration
   *
   * Retrieve the current global OpenCode configuration settings and preferences.
   */
  get(options) {
    return (options?.client ?? this.client).get({
      url: "/global/config",
      ...options
    });
  }
  /**
   * Update global configuration
   *
   * Update global OpenCode configuration settings and preferences.
   */
  update(parameters, options) {
    const params = buildClientParams([parameters], [{ args: [{ key: "config", map: "body" }] }]);
    return (options?.client ?? this.client).patch({
      url: "/global/config",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
}
class Global extends HeyApiClient {
  /**
   * Get health
   *
   * Get health information about the OpenCode server.
   */
  health(options) {
    return (options?.client ?? this.client).get({
      url: "/global/health",
      ...options
    });
  }
  /**
   * Get global events
   *
   * Subscribe to global events from the OpenCode system using server-sent events.
   */
  event(options) {
    return (options?.client ?? this.client).sse.get({
      url: "/global/event",
      ...options
    });
  }
  /**
   * Dispose instance
   *
   * Clean up and dispose all OpenCode instances, releasing all resources.
   */
  dispose(options) {
    return (options?.client ?? this.client).post({
      url: "/global/dispose",
      ...options
    });
  }
  /**
   * Upgrade opencode
   *
   * Upgrade opencode to the specified version or latest if not specified.
   */
  upgrade(parameters, options) {
    const params = buildClientParams([parameters], [{ args: [{ in: "body", key: "target" }] }]);
    return (options?.client ?? this.client).post({
      url: "/global/upgrade",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  _config;
  get config() {
    return this._config ??= new Config({ client: this.client });
  }
}
class Auth extends HeyApiClient {
  /**
   * Remove auth credentials
   *
   * Remove authentication credentials
   */
  remove(parameters, options) {
    const params = buildClientParams([parameters], [{ args: [{ in: "path", key: "providerID" }] }]);
    return (options?.client ?? this.client).delete({
      url: "/auth/{providerID}",
      ...options,
      ...params
    });
  }
  /**
   * Set auth credentials
   *
   * Set authentication credentials
   */
  set(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "providerID" },
          { key: "auth", map: "body" }
        ]
      }
    ]);
    return (options?.client ?? this.client).put({
      url: "/auth/{providerID}",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
}
class App extends HeyApiClient {
  /**
   * Write log
   *
   * Write a log entry to the server logs with specified level and metadata.
   */
  log(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "service" },
          { in: "body", key: "level" },
          { in: "body", key: "message" },
          { in: "body", key: "extra" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/log",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * List agents
   *
   * Get a list of all available AI agents in the OpenCode system.
   */
  agents(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/agent",
      ...options,
      ...params
    });
  }
  /**
   * List skills
   *
   * Get a list of all available skills in the OpenCode system.
   */
  skills(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/skill",
      ...options,
      ...params
    });
  }
}
class Adaptor extends HeyApiClient {
  /**
   * List workspace adaptors
   *
   * List all available workspace adaptors for the current project.
   */
  list(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/experimental/workspace/adaptor",
      ...options,
      ...params
    });
  }
}
class Workspace extends HeyApiClient {
  /**
   * List workspaces
   *
   * List all workspaces.
   */
  list(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/experimental/workspace",
      ...options,
      ...params
    });
  }
  /**
   * Create workspace
   *
   * Create a workspace for the current project.
   */
  create(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "id" },
          { in: "body", key: "type" },
          { in: "body", key: "branch" },
          { in: "body", key: "extra" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/experimental/workspace",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * Workspace status
   *
   * Get connection status for workspaces in the current project.
   */
  status(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/experimental/workspace/status",
      ...options,
      ...params
    });
  }
  /**
   * Remove workspace
   *
   * Remove an existing workspace.
   */
  remove(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "id" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).delete({
      url: "/experimental/workspace/{id}",
      ...options,
      ...params
    });
  }
  /**
   * Restore session into workspace
   *
   * Replay a session's sync events into the target workspace in batches.
   */
  sessionRestore(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "id" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "sessionID" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/experimental/workspace/{id}/session-restore",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  _adaptor;
  get adaptor() {
    return this._adaptor ??= new Adaptor({ client: this.client });
  }
}
class Console extends HeyApiClient {
  /**
   * Get active Console provider metadata
   *
   * Get the active Console org name and the set of provider IDs managed by that Console org.
   */
  get(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/experimental/console",
      ...options,
      ...params
    });
  }
  /**
   * List switchable Console orgs
   *
   * Get the available Console orgs across logged-in accounts, including the current active org.
   */
  listOrgs(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/experimental/console/orgs",
      ...options,
      ...params
    });
  }
  /**
   * Switch active Console org
   *
   * Persist a new active Console account/org selection for the current local OpenCode state.
   */
  switchOrg(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "accountID" },
          { in: "body", key: "orgID" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/experimental/console/switch",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
}
class Session extends HeyApiClient {
  /**
   * List sessions
   *
   * Get a list of all OpenCode sessions across projects, sorted by most recently updated. Archived sessions are excluded by default.
   */
  list(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "query", key: "roots" },
          { in: "query", key: "start" },
          { in: "query", key: "cursor" },
          { in: "query", key: "search" },
          { in: "query", key: "limit" },
          { in: "query", key: "archived" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/experimental/session",
      ...options,
      ...params
    });
  }
}
class Resource extends HeyApiClient {
  /**
   * Get MCP resources
   *
   * Get all available MCP resources from connected servers. Optionally filter by name.
   */
  list(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/experimental/resource",
      ...options,
      ...params
    });
  }
}
class Experimental extends HeyApiClient {
  _workspace;
  get workspace() {
    return this._workspace ??= new Workspace({ client: this.client });
  }
  _console;
  get console() {
    return this._console ??= new Console({ client: this.client });
  }
  _session;
  get session() {
    return this._session ??= new Session({ client: this.client });
  }
  _resource;
  get resource() {
    return this._resource ??= new Resource({ client: this.client });
  }
}
class Project extends HeyApiClient {
  /**
   * List all projects
   *
   * Get a list of projects that have been opened with OpenCode.
   */
  list(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/project",
      ...options,
      ...params
    });
  }
  /**
   * Get current project
   *
   * Retrieve the currently active project that OpenCode is working with.
   */
  current(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/project/current",
      ...options,
      ...params
    });
  }
  /**
   * Initialize git repository
   *
   * Create a git repository for the current project and return the refreshed project info.
   */
  initGit(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/project/git/init",
      ...options,
      ...params
    });
  }
  /**
   * Update project
   *
   * Update project properties such as name, icon, and commands.
   */
  update(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "projectID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "name" },
          { in: "body", key: "icon" },
          { in: "body", key: "commands" }
        ]
      }
    ]);
    return (options?.client ?? this.client).patch({
      url: "/project/{projectID}",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
}
class Pty extends HeyApiClient {
  /**
   * List PTY sessions
   *
   * Get a list of all active pseudo-terminal (PTY) sessions managed by OpenCode.
   */
  list(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/pty",
      ...options,
      ...params
    });
  }
  /**
   * Create PTY session
   *
   * Create a new pseudo-terminal (PTY) session for running shell commands and processes.
   */
  create(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "command" },
          { in: "body", key: "args" },
          { in: "body", key: "cwd" },
          { in: "body", key: "title" },
          { in: "body", key: "env" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/pty",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * Remove PTY session
   *
   * Remove and terminate a specific pseudo-terminal (PTY) session.
   */
  remove(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "ptyID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).delete({
      url: "/pty/{ptyID}",
      ...options,
      ...params
    });
  }
  /**
   * Get PTY session
   *
   * Retrieve detailed information about a specific pseudo-terminal (PTY) session.
   */
  get(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "ptyID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/pty/{ptyID}",
      ...options,
      ...params
    });
  }
  /**
   * Update PTY session
   *
   * Update properties of an existing pseudo-terminal (PTY) session.
   */
  update(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "ptyID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "title" },
          { in: "body", key: "size" }
        ]
      }
    ]);
    return (options?.client ?? this.client).put({
      url: "/pty/{ptyID}",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * Connect to PTY session
   *
   * Establish a WebSocket connection to interact with a pseudo-terminal (PTY) session in real-time.
   */
  connect(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "ptyID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/pty/{ptyID}/connect",
      ...options,
      ...params
    });
  }
}
class Config2 extends HeyApiClient {
  /**
   * Get configuration
   *
   * Retrieve the current OpenCode configuration settings and preferences.
   */
  get(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/config",
      ...options,
      ...params
    });
  }
  /**
   * Update configuration
   *
   * Update OpenCode configuration settings and preferences.
   */
  update(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { key: "config", map: "body" }
        ]
      }
    ]);
    return (options?.client ?? this.client).patch({
      url: "/config",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * List config providers
   *
   * Get a list of all configured AI providers and their default models.
   */
  providers(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/config/providers",
      ...options,
      ...params
    });
  }
}
class Tool extends HeyApiClient {
  /**
   * List tool IDs
   *
   * Get a list of all available tool IDs, including both built-in tools and dynamically registered tools.
   */
  ids(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/experimental/tool/ids",
      ...options,
      ...params
    });
  }
  /**
   * List tools
   *
   * Get a list of available tools with their JSON schema parameters for a specific provider and model combination.
   */
  list(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "query", key: "provider" },
          { in: "query", key: "model" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/experimental/tool",
      ...options,
      ...params
    });
  }
}
class Worktree extends HeyApiClient {
  /**
   * Remove worktree
   *
   * Remove a git worktree and delete its branch.
   */
  remove(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { key: "worktreeRemoveInput", map: "body" }
        ]
      }
    ]);
    return (options?.client ?? this.client).delete({
      url: "/experimental/worktree",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * List worktrees
   *
   * List all sandbox worktrees for the current project.
   */
  list(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/experimental/worktree",
      ...options,
      ...params
    });
  }
  /**
   * Create worktree
   *
   * Create a new git worktree for the current project and run any configured startup scripts.
   */
  create(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { key: "worktreeCreateInput", map: "body" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/experimental/worktree",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * Reset worktree
   *
   * Reset a worktree branch to the primary default branch.
   */
  reset(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { key: "worktreeResetInput", map: "body" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/experimental/worktree/reset",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
}
class Session2 extends HeyApiClient {
  /**
   * List sessions
   *
   * Get a list of all OpenCode sessions, sorted by most recently updated.
   */
  list(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "query", key: "roots" },
          { in: "query", key: "start" },
          { in: "query", key: "search" },
          { in: "query", key: "limit" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/session",
      ...options,
      ...params
    });
  }
  /**
   * Create session
   *
   * Create a new OpenCode session for interacting with AI assistants and managing conversations.
   */
  create(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "parentID" },
          { in: "body", key: "title" },
          { in: "body", key: "permission" },
          { in: "body", key: "workspaceID" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/session",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * Get session status
   *
   * Retrieve the current status of all sessions, including active, idle, and completed states.
   */
  status(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/session/status",
      ...options,
      ...params
    });
  }
  /**
   * Delete session
   *
   * Delete a session and permanently remove all associated data, including messages and history.
   */
  delete(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "sessionID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).delete({
      url: "/session/{sessionID}",
      ...options,
      ...params
    });
  }
  /**
   * Get session
   *
   * Retrieve detailed information about a specific OpenCode session.
   */
  get(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "sessionID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/session/{sessionID}",
      ...options,
      ...params
    });
  }
  /**
   * Update session
   *
   * Update properties of an existing session, such as title or other metadata.
   */
  update(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "sessionID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "title" },
          { in: "body", key: "permission" },
          { in: "body", key: "time" }
        ]
      }
    ]);
    return (options?.client ?? this.client).patch({
      url: "/session/{sessionID}",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * Get session children
   *
   * Retrieve all child sessions that were forked from the specified parent session.
   */
  children(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "sessionID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/session/{sessionID}/children",
      ...options,
      ...params
    });
  }
  /**
   * Get session todos
   *
   * Retrieve the todo list associated with a specific session, showing tasks and action items.
   */
  todo(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "sessionID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/session/{sessionID}/todo",
      ...options,
      ...params
    });
  }
  /**
   * Initialize session
   *
   * Analyze the current application and create an AGENTS.md file with project-specific agent configurations.
   */
  init(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "sessionID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "modelID" },
          { in: "body", key: "providerID" },
          { in: "body", key: "messageID" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/session/{sessionID}/init",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * Fork session
   *
   * Create a new session by forking an existing session at a specific message point.
   */
  fork(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "sessionID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "messageID" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/session/{sessionID}/fork",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * Abort session
   *
   * Abort an active session and stop any ongoing AI processing or command execution.
   */
  abort(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "sessionID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/session/{sessionID}/abort",
      ...options,
      ...params
    });
  }
  /**
   * Unshare session
   *
   * Remove the shareable link for a session, making it private again.
   */
  unshare(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "sessionID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).delete({
      url: "/session/{sessionID}/share",
      ...options,
      ...params
    });
  }
  /**
   * Share session
   *
   * Create a shareable link for a session, allowing others to view the conversation.
   */
  share(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "sessionID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/session/{sessionID}/share",
      ...options,
      ...params
    });
  }
  /**
   * Get message diff
   *
   * Get the file changes (diff) that resulted from a specific user message in the session.
   */
  diff(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "sessionID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "query", key: "messageID" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/session/{sessionID}/diff",
      ...options,
      ...params
    });
  }
  /**
   * Summarize session
   *
   * Generate a concise summary of the session using AI compaction to preserve key information.
   */
  summarize(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "sessionID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "providerID" },
          { in: "body", key: "modelID" },
          { in: "body", key: "auto" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/session/{sessionID}/summarize",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * Get session messages
   *
   * Retrieve all messages in a session, including user prompts and AI responses.
   */
  messages(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "sessionID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "query", key: "limit" },
          { in: "query", key: "before" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/session/{sessionID}/message",
      ...options,
      ...params
    });
  }
  /**
   * Send message
   *
   * Create and send a new message to a session, streaming the AI response.
   */
  prompt(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "sessionID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "messageID" },
          { in: "body", key: "model" },
          { in: "body", key: "agent" },
          { in: "body", key: "noReply" },
          { in: "body", key: "tools" },
          { in: "body", key: "format" },
          { in: "body", key: "system" },
          { in: "body", key: "variant" },
          { in: "body", key: "parts" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/session/{sessionID}/message",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * Delete message
   *
   * Permanently delete a specific message (and all of its parts) from a session. This does not revert any file changes that may have been made while processing the message.
   */
  deleteMessage(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "sessionID" },
          { in: "path", key: "messageID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).delete({
      url: "/session/{sessionID}/message/{messageID}",
      ...options,
      ...params
    });
  }
  /**
   * Get message
   *
   * Retrieve a specific message from a session by its message ID.
   */
  message(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "sessionID" },
          { in: "path", key: "messageID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/session/{sessionID}/message/{messageID}",
      ...options,
      ...params
    });
  }
  /**
   * Send async message
   *
   * Create and send a new message to a session asynchronously, starting the session if needed and returning immediately.
   */
  promptAsync(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "sessionID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "messageID" },
          { in: "body", key: "model" },
          { in: "body", key: "agent" },
          { in: "body", key: "noReply" },
          { in: "body", key: "tools" },
          { in: "body", key: "format" },
          { in: "body", key: "system" },
          { in: "body", key: "variant" },
          { in: "body", key: "parts" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/session/{sessionID}/prompt_async",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * Send command
   *
   * Send a new command to a session for execution by the AI assistant.
   */
  command(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "sessionID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "messageID" },
          { in: "body", key: "agent" },
          { in: "body", key: "model" },
          { in: "body", key: "arguments" },
          { in: "body", key: "command" },
          { in: "body", key: "variant" },
          { in: "body", key: "parts" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/session/{sessionID}/command",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * Run shell command
   *
   * Execute a shell command within the session context and return the AI's response.
   */
  shell(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "sessionID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "messageID" },
          { in: "body", key: "agent" },
          { in: "body", key: "model" },
          { in: "body", key: "command" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/session/{sessionID}/shell",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * Revert message
   *
   * Revert a specific message in a session, undoing its effects and restoring the previous state.
   */
  revert(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "sessionID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "messageID" },
          { in: "body", key: "partID" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/session/{sessionID}/revert",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * Restore reverted messages
   *
   * Restore all previously reverted messages in a session.
   */
  unrevert(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "sessionID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/session/{sessionID}/unrevert",
      ...options,
      ...params
    });
  }
}
class Part extends HeyApiClient {
  /**
   * Delete a part from a message
   */
  delete(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "sessionID" },
          { in: "path", key: "messageID" },
          { in: "path", key: "partID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).delete({
      url: "/session/{sessionID}/message/{messageID}/part/{partID}",
      ...options,
      ...params
    });
  }
  /**
   * Update a part in a message
   */
  update(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "sessionID" },
          { in: "path", key: "messageID" },
          { in: "path", key: "partID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { key: "part", map: "body" }
        ]
      }
    ]);
    return (options?.client ?? this.client).patch({
      url: "/session/{sessionID}/message/{messageID}/part/{partID}",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
}
class Permission extends HeyApiClient {
  /**
   * Respond to permission
   *
   * Approve or deny a permission request from the AI assistant.
   *
   * @deprecated
   */
  respond(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "sessionID" },
          { in: "path", key: "permissionID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "response" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/session/{sessionID}/permissions/{permissionID}",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * Respond to permission request
   *
   * Approve or deny a permission request from the AI assistant.
   */
  reply(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "requestID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "reply" },
          { in: "body", key: "message" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/permission/{requestID}/reply",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * List pending permissions
   *
   * Get all pending permission requests across all sessions.
   */
  list(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/permission",
      ...options,
      ...params
    });
  }
}
class Question extends HeyApiClient {
  /**
   * List pending questions
   *
   * Get all pending question requests across all sessions.
   */
  list(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/question",
      ...options,
      ...params
    });
  }
  /**
   * Reply to question request
   *
   * Provide answers to a question request from the AI assistant.
   */
  reply(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "requestID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "answers" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/question/{requestID}/reply",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * Reject question request
   *
   * Reject a question request from the AI assistant.
   */
  reject(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "requestID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/question/{requestID}/reject",
      ...options,
      ...params
    });
  }
}
class Oauth extends HeyApiClient {
  /**
   * OAuth authorize
   *
   * Initiate OAuth authorization for a specific AI provider to get an authorization URL.
   */
  authorize(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "providerID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "method" },
          { in: "body", key: "inputs" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/provider/{providerID}/oauth/authorize",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * OAuth callback
   *
   * Handle the OAuth callback from a provider after user authorization.
   */
  callback(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "providerID" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "method" },
          { in: "body", key: "code" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/provider/{providerID}/oauth/callback",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
}
class Provider extends HeyApiClient {
  /**
   * List providers
   *
   * Get a list of all available AI providers, including both available and connected ones.
   */
  list(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/provider",
      ...options,
      ...params
    });
  }
  /**
   * Get provider auth methods
   *
   * Retrieve available authentication methods for all AI providers.
   */
  auth(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/provider/auth",
      ...options,
      ...params
    });
  }
  _oauth;
  get oauth() {
    return this._oauth ??= new Oauth({ client: this.client });
  }
}
class History extends HeyApiClient {
  /**
   * List sync events
   *
   * List sync events for all aggregates. Keys are aggregate IDs the client already knows about, values are the last known sequence ID. Events with seq > value are returned for those aggregates. Aggregates not listed in the input get their full history.
   */
  list(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { key: "body", map: "body" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/sync/history",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
}
class Sync extends HeyApiClient {
  /**
   * Start workspace sync
   *
   * Start sync loops for workspaces in the current project that have active sessions.
   */
  start(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/sync/start",
      ...options,
      ...params
    });
  }
  /**
   * Replay sync events
   *
   * Validate and replay a complete sync event history.
   */
  replay(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          {
            in: "query",
            key: "query_directory",
            map: "directory"
          },
          { in: "query", key: "workspace" },
          {
            in: "body",
            key: "body_directory",
            map: "directory"
          },
          { in: "body", key: "events" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/sync/replay",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  _history;
  get history() {
    return this._history ??= new History({ client: this.client });
  }
}
class Find extends HeyApiClient {
  /**
   * Find text
   *
   * Search for text patterns across files in the project using ripgrep.
   */
  text(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "query", key: "pattern" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/find",
      ...options,
      ...params
    });
  }
  /**
   * Find files
   *
   * Search for files or directories by name or pattern in the project directory.
   */
  files(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "query", key: "query" },
          { in: "query", key: "dirs" },
          { in: "query", key: "type" },
          { in: "query", key: "limit" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/find/file",
      ...options,
      ...params
    });
  }
  /**
   * Find symbols
   *
   * Search for workspace symbols like functions, classes, and variables using LSP.
   */
  symbols(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "query", key: "query" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/find/symbol",
      ...options,
      ...params
    });
  }
}
class File extends HeyApiClient {
  /**
   * List files
   *
   * List files and directories in a specified path.
   */
  list(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "query", key: "path" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/file",
      ...options,
      ...params
    });
  }
  /**
   * Read file
   *
   * Read the content of a specified file.
   */
  read(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "query", key: "path" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/file/content",
      ...options,
      ...params
    });
  }
  /**
   * Get file status
   *
   * Get the git status of all files in the project.
   */
  status(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/file/status",
      ...options,
      ...params
    });
  }
}
class Event extends HeyApiClient {
  /**
   * Subscribe to events
   *
   * Get events
   */
  subscribe(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).sse.get({
      url: "/event",
      ...options,
      ...params
    });
  }
}
class Auth2 extends HeyApiClient {
  /**
   * Remove MCP OAuth
   *
   * Remove OAuth credentials for an MCP server
   */
  remove(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "name" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).delete({
      url: "/mcp/{name}/auth",
      ...options,
      ...params
    });
  }
  /**
   * Start MCP OAuth
   *
   * Start OAuth authentication flow for a Model Context Protocol (MCP) server.
   */
  start(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "name" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/mcp/{name}/auth",
      ...options,
      ...params
    });
  }
  /**
   * Complete MCP OAuth
   *
   * Complete OAuth authentication for a Model Context Protocol (MCP) server using the authorization code.
   */
  callback(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "name" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "code" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/mcp/{name}/auth/callback",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * Authenticate MCP OAuth
   *
   * Start OAuth flow and wait for callback (opens browser)
   */
  authenticate(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "name" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/mcp/{name}/auth/authenticate",
      ...options,
      ...params
    });
  }
}
class Mcp extends HeyApiClient {
  /**
   * Get MCP status
   *
   * Get the status of all Model Context Protocol (MCP) servers.
   */
  status(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/mcp",
      ...options,
      ...params
    });
  }
  /**
   * Add MCP server
   *
   * Dynamically add a new Model Context Protocol (MCP) server to the system.
   */
  add(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "name" },
          { in: "body", key: "config" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/mcp",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * Connect an MCP server
   */
  connect(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "name" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/mcp/{name}/connect",
      ...options,
      ...params
    });
  }
  /**
   * Disconnect an MCP server
   */
  disconnect(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "path", key: "name" },
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/mcp/{name}/disconnect",
      ...options,
      ...params
    });
  }
  _auth;
  get auth() {
    return this._auth ??= new Auth2({ client: this.client });
  }
}
class Control extends HeyApiClient {
  /**
   * Get next TUI request
   *
   * Retrieve the next TUI (Terminal User Interface) request from the queue for processing.
   */
  next(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/tui/control/next",
      ...options,
      ...params
    });
  }
  /**
   * Submit TUI response
   *
   * Submit a response to the TUI request queue to complete a pending request.
   */
  response(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { key: "body", map: "body" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/tui/control/response",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
}
class Tui extends HeyApiClient {
  /**
   * Append TUI prompt
   *
   * Append prompt to the TUI
   */
  appendPrompt(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "text" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/tui/append-prompt",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * Open help dialog
   *
   * Open the help dialog in the TUI to display user assistance information.
   */
  openHelp(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/tui/open-help",
      ...options,
      ...params
    });
  }
  /**
   * Open sessions dialog
   *
   * Open the session dialog
   */
  openSessions(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/tui/open-sessions",
      ...options,
      ...params
    });
  }
  /**
   * Open themes dialog
   *
   * Open the theme dialog
   */
  openThemes(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/tui/open-themes",
      ...options,
      ...params
    });
  }
  /**
   * Open models dialog
   *
   * Open the model dialog
   */
  openModels(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/tui/open-models",
      ...options,
      ...params
    });
  }
  /**
   * Submit TUI prompt
   *
   * Submit the prompt
   */
  submitPrompt(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/tui/submit-prompt",
      ...options,
      ...params
    });
  }
  /**
   * Clear TUI prompt
   *
   * Clear the prompt
   */
  clearPrompt(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/tui/clear-prompt",
      ...options,
      ...params
    });
  }
  /**
   * Execute TUI command
   *
   * Execute a TUI command (e.g. agent_cycle)
   */
  executeCommand(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "command" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/tui/execute-command",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * Show TUI toast
   *
   * Show a toast notification in the TUI
   */
  showToast(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "title" },
          { in: "body", key: "message" },
          { in: "body", key: "variant" },
          { in: "body", key: "duration" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/tui/show-toast",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * Publish TUI event
   *
   * Publish a TUI event
   */
  publish(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { key: "body", map: "body" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/tui/publish",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  /**
   * Select session
   *
   * Navigate the TUI to display the specified session.
   */
  selectSession(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "body", key: "sessionID" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/tui/select-session",
      ...options,
      ...params,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        ...params.headers
      }
    });
  }
  _control;
  get control() {
    return this._control ??= new Control({ client: this.client });
  }
}
class Instance extends HeyApiClient {
  /**
   * Dispose instance
   *
   * Clean up and dispose the current OpenCode instance, releasing all resources.
   */
  dispose(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).post({
      url: "/instance/dispose",
      ...options,
      ...params
    });
  }
}
class Path extends HeyApiClient {
  /**
   * Get paths
   *
   * Retrieve the current working directory and related path information for the OpenCode instance.
   */
  get(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/path",
      ...options,
      ...params
    });
  }
}
class Vcs extends HeyApiClient {
  /**
   * Get VCS info
   *
   * Retrieve version control system (VCS) information for the current project, such as git branch.
   */
  get(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/vcs",
      ...options,
      ...params
    });
  }
  /**
   * Get VCS diff
   *
   * Retrieve the current git diff for the working tree or against the default branch.
   */
  diff(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" },
          { in: "query", key: "mode" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/vcs/diff",
      ...options,
      ...params
    });
  }
}
class Command extends HeyApiClient {
  /**
   * List commands
   *
   * Get a list of all available commands in the OpenCode system.
   */
  list(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/command",
      ...options,
      ...params
    });
  }
}
class Lsp extends HeyApiClient {
  /**
   * Get LSP status
   *
   * Get LSP server status
   */
  status(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/lsp",
      ...options,
      ...params
    });
  }
}
class Formatter extends HeyApiClient {
  /**
   * Get formatter status
   *
   * Get formatter status
   */
  status(parameters, options) {
    const params = buildClientParams([parameters], [
      {
        args: [
          { in: "query", key: "directory" },
          { in: "query", key: "workspace" }
        ]
      }
    ]);
    return (options?.client ?? this.client).get({
      url: "/formatter",
      ...options,
      ...params
    });
  }
}
class OpencodeClient extends HeyApiClient {
  static __registry = new HeyApiRegistry();
  constructor(args) {
    super(args);
    OpencodeClient.__registry.set(this, args?.key);
  }
  _global;
  get global() {
    return this._global ??= new Global({ client: this.client });
  }
  _auth;
  get auth() {
    return this._auth ??= new Auth({ client: this.client });
  }
  _app;
  get app() {
    return this._app ??= new App({ client: this.client });
  }
  _experimental;
  get experimental() {
    return this._experimental ??= new Experimental({ client: this.client });
  }
  _project;
  get project() {
    return this._project ??= new Project({ client: this.client });
  }
  _pty;
  get pty() {
    return this._pty ??= new Pty({ client: this.client });
  }
  _config;
  get config() {
    return this._config ??= new Config2({ client: this.client });
  }
  _tool;
  get tool() {
    return this._tool ??= new Tool({ client: this.client });
  }
  _worktree;
  get worktree() {
    return this._worktree ??= new Worktree({ client: this.client });
  }
  _session;
  get session() {
    return this._session ??= new Session2({ client: this.client });
  }
  _part;
  get part() {
    return this._part ??= new Part({ client: this.client });
  }
  _permission;
  get permission() {
    return this._permission ??= new Permission({ client: this.client });
  }
  _question;
  get question() {
    return this._question ??= new Question({ client: this.client });
  }
  _provider;
  get provider() {
    return this._provider ??= new Provider({ client: this.client });
  }
  _sync;
  get sync() {
    return this._sync ??= new Sync({ client: this.client });
  }
  _find;
  get find() {
    return this._find ??= new Find({ client: this.client });
  }
  _file;
  get file() {
    return this._file ??= new File({ client: this.client });
  }
  _event;
  get event() {
    return this._event ??= new Event({ client: this.client });
  }
  _mcp;
  get mcp() {
    return this._mcp ??= new Mcp({ client: this.client });
  }
  _tui;
  get tui() {
    return this._tui ??= new Tui({ client: this.client });
  }
  _instance;
  get instance() {
    return this._instance ??= new Instance({ client: this.client });
  }
  _path;
  get path() {
    return this._path ??= new Path({ client: this.client });
  }
  _vcs;
  get vcs() {
    return this._vcs ??= new Vcs({ client: this.client });
  }
  _command;
  get command() {
    return this._command ??= new Command({ client: this.client });
  }
  _lsp;
  get lsp() {
    return this._lsp ??= new Lsp({ client: this.client });
  }
  _formatter;
  get formatter() {
    return this._formatter ??= new Formatter({ client: this.client });
  }
}
function pick(value, fallback, encode) {
  if (!value)
    return;
  if (!fallback)
    return value;
  if (value === fallback)
    return fallback;
  if (encode && value === encode(fallback))
    return fallback;
  return value;
}
function rewrite(request, values) {
  if (request.method !== "GET" && request.method !== "HEAD")
    return request;
  const url = new URL(request.url);
  let changed = false;
  for (const [name, key] of [
    ["x-opencode-directory", "directory"],
    ["x-opencode-workspace", "workspace"]
  ]) {
    const value = pick(request.headers.get(name), key === "directory" ? values.directory : values.workspace, key === "directory" ? encodeURIComponent : void 0);
    if (!value)
      continue;
    if (!url.searchParams.has(key)) {
      url.searchParams.set(key, value);
    }
    changed = true;
  }
  if (!changed)
    return request;
  const next = new Request(url, request);
  next.headers.delete("x-opencode-directory");
  next.headers.delete("x-opencode-workspace");
  return next;
}
function createOpencodeClient(config) {
  if (!config?.fetch) {
    const customFetch = (req) => {
      req.timeout = false;
      return fetch(req);
    };
    config = {
      ...config,
      fetch: customFetch
    };
  }
  if (config?.directory) {
    config.headers = {
      ...config.headers,
      "x-opencode-directory": encodeURIComponent(config.directory)
    };
  }
  if (config?.experimental_workspaceID) {
    config.headers = {
      ...config.headers,
      "x-opencode-workspace": config.experimental_workspaceID
    };
  }
  const client2 = createClient(config);
  client2.interceptors.request.use((request) => rewrite(request, {
    directory: config?.directory,
    workspace: config?.experimental_workspaceID
  }));
  client2.interceptors.response.use((response) => {
    const contentType = response.headers.get("content-type");
    if (contentType === "text/html")
      throw new Error("Request is not supported by this version of OpenCode Server (Server responded with text/html)");
    return response;
  });
  return new OpencodeClient({ client: client2 });
}
let _clientFactory = (port, directory) => {
  const baseUrl = `http://localhost:${port}`;
  return createOpencodeClient({
    baseUrl,
    directory
  });
};
const _clientCache = /* @__PURE__ */ new Map();
function cacheKey(port, directory) {
  return `${port}::${directory ?? ""}`;
}
function getClient(port, directory) {
  const key = cacheKey(port, directory);
  let client2 = _clientCache.get(key);
  if (!client2) {
    client2 = _clientFactory(port, directory);
    _clientCache.set(key, client2);
  }
  return client2;
}
function buildOptions(opts) {
  return opts?.signal ? { signal: opts.signal } : void 0;
}
function withDirectory(params, directory) {
  return directory === void 0 ? params : { ...params, directory };
}
async function sessionList(port, query, opts) {
  const client2 = getClient(port, opts?.directory);
  const params = withDirectory({ ...query ?? {} }, opts?.directory);
  return client2.session.list(params, buildOptions(opts));
}
async function sessionCreate(port, body, opts) {
  const client2 = getClient(port, opts?.directory);
  const params = withDirectory({ ...body ?? {} }, opts?.directory);
  return client2.session.create(params, buildOptions(opts));
}
async function sessionStatus(port, opts) {
  const client2 = getClient(port, opts?.directory);
  const params = withDirectory({}, opts?.directory);
  return client2.session.status(params, buildOptions(opts));
}
async function sessionGet(port, sessionID, opts) {
  const client2 = getClient(port, opts?.directory);
  const params = withDirectory({ sessionID }, opts?.directory);
  return client2.session.get(params, buildOptions(opts));
}
async function sessionTodo(port, sessionID, opts) {
  const client2 = getClient(port, opts?.directory);
  const params = withDirectory({ sessionID }, opts?.directory);
  return client2.session.todo(params, buildOptions(opts));
}
async function sessionAbort(port, sessionID, opts) {
  const client2 = getClient(port, opts?.directory);
  const params = withDirectory({ sessionID }, opts?.directory);
  return client2.session.abort(params, buildOptions(opts));
}
async function sessionSummarize(port, sessionID, body, opts) {
  const client2 = getClient(port, opts?.directory);
  const params = withDirectory({ sessionID, ...body ?? {} }, opts?.directory);
  return client2.session.summarize(params, buildOptions(opts));
}
async function sessionMessages(port, sessionID, query, opts) {
  const client2 = getClient(port, opts?.directory);
  const params = withDirectory(
    { sessionID, ...query ?? {} },
    opts?.directory
  );
  return client2.session.messages(params, buildOptions(opts));
}
async function sessionPromptAsync(port, sessionID, body, opts) {
  const client2 = getClient(port, opts?.directory);
  const params = withDirectory({ sessionID, ...body }, opts?.directory);
  return client2.session.promptAsync(params, buildOptions(opts));
}
async function sessionCommand(port, sessionID, body, opts) {
  const client2 = getClient(port, opts?.directory);
  const params = withDirectory({ sessionID, ...body }, opts?.directory);
  return client2.session.command(params, buildOptions(opts));
}
async function fetchSessions(openCodePort, directory, options) {
  try {
    const response = await sessionList(
      openCodePort,
      { roots: options?.roots },
      { directory, signal: AbortSignal.timeout(2e3) }
    );
    if (response.error) return null;
    const data = response.data;
    if (!Array.isArray(data)) return null;
    return data;
  } catch {
    return null;
  }
}
async function fetchOpenCodeSession(openCodePort, sessionID, directory) {
  try {
    const response = await sessionGet(openCodePort, sessionID, {
      directory,
      signal: AbortSignal.timeout(2e3)
    });
    if (response.error) return null;
    const data = response.data;
    if (!data || typeof data !== "object") return null;
    return data;
  } catch {
    return null;
  }
}
async function fetchSessionsForDirectory(openCodePort, baseDirectory) {
  const trimmed = baseDirectory.trim();
  const directory = trimmed.length > 0 ? trimmed : void 0;
  const sessions = await fetchSessions(openCodePort, directory);
  if (!sessions) return null;
  return [...sessions].sort(
    (a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0)
  );
}
async function autoDetectOpenCodeSession(openCodePort, baseDirectory) {
  let sessions = baseDirectory ? await fetchSessions(openCodePort, baseDirectory) : null;
  if (!sessions || sessions.length === 0) {
    sessions = await fetchSessions(openCodePort);
  }
  if (!sessions || sessions.length === 0) return null;
  const roots = sessions.filter((s) => !s.parentID);
  const candidates = roots.length > 0 ? roots : sessions;
  const sorted = [...candidates].sort(
    (a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0)
  );
  const best = sorted[0];
  return {
    id: best.id,
    parentId: best.parentID ?? null
  };
}
async function autoDetectOpenCodeSessionId(openCodePort, baseDirectory) {
  const result = await autoDetectOpenCodeSession(openCodePort, baseDirectory);
  return result?.id ?? null;
}
const CREATE_SESSION_TIMEOUT_MS = 1e4;
const SESSION_MESSAGE_TIMEOUT_MS = 12e4;
function buildInitialPromptBody(input) {
  const body = {
    parts: [{ type: "text", text: input.initialMessage }]
  };
  const trimmedAgent = input.agent?.trim();
  if (trimmedAgent && trimmedAgent.length > 0) {
    body.agent = trimmedAgent;
  }
  return body;
}
async function createOpenCodeSession(openCodePort, options = {}) {
  try {
    const createResponse = await sessionCreate(
      openCodePort,
      {
        title: options.title,
        parentID: options.parentID
      },
      {
        directory: options.directory,
        signal: AbortSignal.timeout(CREATE_SESSION_TIMEOUT_MS)
      }
    );
    if (createResponse.error) {
      const rawError = createResponse.error;
      const errorMessage2 = typeof rawError === "string" ? rawError : "OpenCode API returned error";
      return { ok: false, error: errorMessage2 };
    }
    const session2 = createResponse.data;
    if (options.initialMessage && session2.id) {
      try {
        const messageResponse = await sessionPromptAsync(
          openCodePort,
          session2.id,
          buildInitialPromptBody({
            initialMessage: options.initialMessage,
            agent: options.agent
          }),
          {
            directory: options.directory,
            signal: AbortSignal.timeout(SESSION_MESSAGE_TIMEOUT_MS)
          }
        );
        if (messageResponse.error) {
          console.warn(
            `[createOpenCodeSession] Session created but initial message failed`
          );
        }
      } catch {
        console.warn(
          `[createOpenCodeSession] Session created but initial message failed`
        );
      }
    }
    return { ok: true, session: session2 };
  } catch (err) {
    const msg = errorMessage(err);
    return { ok: false, error: msg };
  }
}
function extractVcsInfo(session2) {
  const { version, summary } = session2;
  let branch = null;
  if (version) {
    const match = version.match(/^\d+\.\d+\.\d+-(.+)$/);
    if (match) {
      branch = match[1];
    }
  }
  if (!branch && !summary) {
    return null;
  }
  return {
    branch,
    additions: summary?.additions ?? 0,
    deletions: summary?.deletions ?? 0,
    files: summary?.files ?? 0
  };
}
let _activeLogFilePath = null;
const MAX_LOG_AGE_DAYS = 7;
const LOG_FILE_PATTERN = /^app-(\d{4}-\d{2}-\d{2})\.log$/;
const MAX_QUEUE_LEN = 1e3;
const _pendingLines = [];
let _writeChain = Promise.resolve();
let _droppedSinceLastDrainWarned = false;
let _flushing = false;
function todayDateString() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function buildLogFilePath(logDir) {
  return join(logDir, `app-${todayDateString()}.log`);
}
function formatLine(level, category, message) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  return `[${timestamp}] [${level}] [${category}] ${message}
`;
}
function scheduleDrain() {
  if (_flushing) return;
  _flushing = true;
  _writeChain = _writeChain.then(async () => {
    if (_pendingLines.length === 0 || !_activeLogFilePath) {
      _flushing = false;
      return;
    }
    const batch = _pendingLines.splice(0, _pendingLines.length).join("");
    const target = _activeLogFilePath;
    _flushing = false;
    try {
      await promises.appendFile(target, batch);
    } catch {
    }
  });
  void _writeChain.then(() => {
    if (_pendingLines.length > 0 && _activeLogFilePath) {
      scheduleDrain();
    }
  });
}
function enqueueLine(line) {
  if (_pendingLines.length >= MAX_QUEUE_LEN) {
    _pendingLines.shift();
    if (!_droppedSinceLastDrainWarned) {
      _droppedSinceLastDrainWarned = true;
      console.warn(
        `[logger] queue exceeded ${MAX_QUEUE_LEN} pending lines — dropping oldest`
      );
    }
  } else if (_pendingLines.length === 0) {
    _droppedSinceLastDrainWarned = false;
  }
  _pendingLines.push(line);
  scheduleDrain();
}
function writeLine(level, category, message) {
  if (!_activeLogFilePath) return;
  enqueueLine(formatLine(level, category, message));
}
function rotateOldLogs(logDir) {
  try {
    const cutoff = /* @__PURE__ */ new Date();
    cutoff.setDate(cutoff.getDate() - MAX_LOG_AGE_DAYS);
    const cutoffTime = cutoff.getTime();
    const entries = readdirSync(logDir);
    for (const entry of entries) {
      const match = LOG_FILE_PATTERN.exec(entry);
      if (!match) continue;
      const fileDate = /* @__PURE__ */ new Date(match[1] + "T00:00:00.000Z");
      if (fileDate.getTime() < cutoffTime) {
        try {
          unlinkSync(join(logDir, entry));
        } catch {
        }
      }
    }
  } catch {
  }
}
function initLogger(logDir) {
  try {
    mkdirSync(logDir, { recursive: true });
  } catch {
    return;
  }
  rotateOldLogs(logDir);
  const filePath = buildLogFilePath(logDir);
  try {
    const fd = openSync(filePath, "a");
    closeSync(fd);
  } catch {
    return;
  }
  _activeLogFilePath = filePath;
}
async function flushLogger() {
  const chain = _writeChain;
  await chain;
  if (_pendingLines.length > 0 && _activeLogFilePath) {
    await _writeChain;
  }
}
function createLogger(category) {
  return {
    debug: (message) => writeLine("DEBUG", category, message),
    info: (message) => writeLine("INFO", category, message),
    warn: (message) => writeLine("WARN", category, message),
    error: (message) => writeLine("ERROR", category, message)
  };
}
const state$1 = {
  getWindow: null,
  getOpenCodePort: null,
  selectedFolder: null,
  tombstones: /* @__PURE__ */ new Set(),
  invalidateTimer: null
};
const INVALIDATE_COALESCE_MS = 50;
function startSessionTreeService(getWindow, getOpenCodePort) {
  state$1.getWindow = getWindow;
  state$1.getOpenCodePort = getOpenCodePort;
}
function stopSessionTreeService() {
  if (state$1.invalidateTimer !== null) {
    clearTimeout(state$1.invalidateTimer);
    state$1.invalidateTimer = null;
  }
  state$1.getWindow = null;
  state$1.getOpenCodePort = null;
}
function getSelectedFolder() {
  return state$1.selectedFolder;
}
function setSelectedFolder(folder) {
  if (state$1.selectedFolder === folder) return;
  state$1.selectedFolder = folder;
  invalidateSessionTree();
}
function tombstoneOpenCodeSession(openCodeSessionId) {
  state$1.tombstones.add(openCodeSessionId);
  invalidateSessionTree();
}
function invalidateSessionTree() {
  if (state$1.invalidateTimer !== null) return;
  state$1.invalidateTimer = setTimeout(() => {
    state$1.invalidateTimer = null;
    const win = state$1.getWindow?.();
    if (!win || win.isDestroyed()) return;
    win.webContents.send("session-tree-invalidated");
  }, INVALIDATE_COALESCE_MS);
}
async function fetchSessionTree() {
  const folder = state$1.selectedFolder;
  if (!folder) return [];
  const port = state$1.getOpenCodePort?.() ?? 4096;
  const sessions = await fetchSessionsForDirectory(port, folder);
  if (!sessions) return [];
  const registeredConnections = getAllRegisteredConnections();
  const byOpenCodeId = new Map(
    registeredConnections.filter((rc) => rc.providerSessionId !== null).map((rc) => [rc.providerSessionId, rc])
  );
  const sessionById = /* @__PURE__ */ new Map();
  for (const s of sessions) {
    if (!state$1.tombstones.has(s.id)) sessionById.set(s.id, s);
  }
  const depthCache = /* @__PURE__ */ new Map();
  const result = [];
  for (const [id, session2] of sessionById) {
    if (hasTombstonedAncestor(id, sessionById)) continue;
    result.push(
      buildSessionNodeData(
        id,
        session2,
        byOpenCodeId.get(id) ?? null,
        sessionById,
        depthCache
      )
    );
  }
  return result;
}
function hasTombstonedAncestor(sessionId, sessionById, visited = /* @__PURE__ */ new Set()) {
  if (visited.has(sessionId)) return false;
  visited.add(sessionId);
  const session2 = sessionById.get(sessionId);
  if (!session2?.parentID) return false;
  if (state$1.tombstones.has(session2.parentID)) return true;
  return hasTombstonedAncestor(session2.parentID, sessionById, visited);
}
function computeDepth(sessionId, sessionById, cache, visited = /* @__PURE__ */ new Set()) {
  const cached = cache.get(sessionId);
  if (cached !== void 0) return cached;
  if (visited.has(sessionId)) return 0;
  visited.add(sessionId);
  const session2 = sessionById.get(sessionId);
  if (!session2?.parentID) {
    cache.set(sessionId, 0);
    return 0;
  }
  const depth = computeDepth(session2.parentID, sessionById, cache, visited) + 1;
  cache.set(sessionId, depth);
  return depth;
}
function buildSessionNodeData(sessionId, session2, rc, sessionById, depthCache) {
  const info = {
    parentID: session2.parentID ?? null,
    title: session2.title,
    directory: session2.directory,
    time: session2.time,
    version: session2.version,
    summary: session2.summary
  };
  return {
    providerSessionId: sessionId,
    openCodeParentId: session2.parentID ?? null,
    title: session2.title ?? `Session ${sessionId.slice(0, 8)}`,
    directory: session2.directory ?? "",
    createdAt: session2.time?.created ?? 0,
    updatedAt: session2.time?.updated ?? 0,
    depth: computeDepth(sessionId, sessionById, depthCache),
    connectionId: rc?.connectionId ?? null,
    channelName: rc?.channelName ?? null,
    hasMcpChannel: rc !== null,
    baseDirectory: rc?.baseDirectory ?? null,
    registeredParentSessionId: rc?.parentSessionId ?? null,
    providerType: rc?.providerType ?? null,
    vcsInfo: extractVcsInfo(info)
  };
}
async function removePersistedSession(sessionId, deps) {
  const rc = deps.getRegisteredConnection(sessionId);
  const providerSessionId = rc?.providerSessionId ?? sessionId;
  deps.forceTerminateChat(sessionId);
  let closeOk;
  try {
    closeOk = await deps.closeSessionByConnectionId(sessionId);
  } catch (err) {
    console.error(
      "[removePersistedSession] closeSessionByConnectionId failed:",
      err
    );
    closeOk = false;
  }
  deps.deleteSessionChannel(sessionId);
  deps.deleteRegisteredConnection(providerSessionId);
  deps.markSessionDeleted(providerSessionId);
  clearSessionAttachments(providerSessionId);
  if (sessionId !== providerSessionId) {
    clearSessionAttachments(sessionId);
  }
  deps.tombstoneOpenCodeSession(providerSessionId);
  void deps.invalidate();
  deps.getWindow()?.webContents.send("connection-closed", {
    connectionId: sessionId
  });
  deps.getWindow()?.webContents.send("session-channel-deleted", { sessionId });
  return closeOk;
}
function createApiRouter(deps) {
  const router = Router();
  router.post("/api/reconnect", async (_req, res) => {
    if (!deps.clearAllSessions) {
      res.json({ ok: false, cleared: 0, message: "Server not initialized." });
      return;
    }
    try {
      const cleared = await deps.clearAllSessions();
      res.json({
        ok: true,
        cleared,
        message: `Cleared ${cleared} session(s). Clients will reinitialize on next request.`
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        cleared: 0,
        message: `Reconnect failed: ${errorMessage(err)}`
      });
    }
  });
  router.post("/api/sessions", (req, res) => {
    const { sessionId, label } = req.body;
    if (!sessionId) {
      res.status(400).json({ error: "sessionId required" });
      return;
    }
    createSessionChannel(sessionId, label);
    deps.getWindow()?.webContents.send("session-channel-created", {
      sessionId,
      label
    });
    res.json({ ok: true, sessionId });
  });
  router.get("/api/sessions/:sessionId/messages/count", (req, res) => {
    const { sessionId } = req.params;
    const count = getUnsentCount(sessionId);
    res.json({ count });
  });
  router.get("/api/sessions/:sessionId/messages", (req, res) => {
    const { sessionId } = req.params;
    const messages = getUnsentMessages(sessionId);
    if (messages.length > 0) {
      markMessagesSent(messages.map((m) => m.id));
    }
    res.json({ messages });
  });
  router.delete("/api/sessions/:sessionId", (req, res) => {
    const { sessionId } = req.params;
    removePersistedSession(sessionId, {
      getWindow: deps.getWindow,
      getOpenCodePort: deps.getOpenCodePort,
      forceTerminateChat,
      closeSessionByConnectionId,
      deleteSessionChannel,
      deleteRegisteredConnection,
      markSessionDeleted,
      invalidate: invalidateSessionTree,
      getRegisteredConnection,
      tombstoneOpenCodeSession
    });
    res.json({ ok: true });
  });
  router.get("/attachments/:sessionKey/:filename", (req, res) => {
    const { sessionKey, filename } = req.params;
    const filePath = resolveAttachmentPath(sessionKey, filename);
    if (!filePath) {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const mimeMap = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
      bmp: "image/bmp"
    };
    res.setHeader("Content-Type", mimeMap[ext] || "application/octet-stream");
    res.sendFile(filePath);
  });
  return router;
}
function parseProviderString(value) {
  const normalized = value?.toLowerCase()?.trim();
  switch (normalized) {
    case "opencode":
      return "opencode";
    case "copilot-cli":
    case "copilot":
      return "copilot-cli";
    case "claude-sdk":
    case "claude":
      return "claude-sdk";
    case "standalone":
      return "standalone";
    default:
      return null;
  }
}
function detectProviderFromHeaders(headers) {
  const headerValue = headers["x-imcp-provider"] ?? headers["X-IMCP-Provider"] ?? headers["X-Imcp-Provider"];
  if (typeof headerValue === "string") {
    return parseProviderString(headerValue);
  }
  if (Array.isArray(headerValue) && headerValue.length > 0) {
    return parseProviderString(headerValue[0]);
  }
  return null;
}
function getEffectiveProvider(globalBackend, requestHeaders) {
  if (requestHeaders) {
    const headerProvider = detectProviderFromHeaders(requestHeaders);
    if (headerProvider) {
      return headerProvider;
    }
  }
  switch (globalBackend) {
    case "opencode":
      return "opencode";
    case "claude_sdk":
      return "claude-sdk";
    default:
      return "standalone";
  }
}
const sessionLog = createLogger("session");
async function resolveSession(opts) {
  const { connectionId, backend } = opts;
  sessionLog.debug(
    `resolveSession: connectionId=${connectionId} backend=${backend}`
  );
  if (backend === "standalone") {
    return {
      providerSessionId: null,
      parentSessionId: null,
      resolvedVia: "none",
      message: "Standalone mode — no provider session available."
    };
  }
  const record = getRegisteredConnection(connectionId);
  if (!record) {
    return {
      providerSessionId: null,
      parentSessionId: null,
      resolvedVia: "none",
      message: `No registered connection found for connectionId "${connectionId}".`
    };
  }
  if (backend === "opencode") {
    return resolveOpenCode(record, opts);
  }
  if (backend === "claude_sdk") {
    return resolveClaude(record);
  }
  return {
    providerSessionId: null,
    parentSessionId: null,
    resolvedVia: "none",
    message: `Unsupported backend "${backend}".`
  };
}
async function resolveOpenCode(record, opts) {
  if (record.providerSessionId) {
    sessionLog.info(
      `Resolved via cache: connectionId=${record.connectionId} sessionId=${record.providerSessionId}`
    );
    return {
      providerSessionId: record.providerSessionId,
      parentSessionId: record.parentSessionId,
      resolvedVia: "cached"
    };
  }
  const openCodePort = opts.openCodePort;
  if (!openCodePort) {
    return {
      providerSessionId: null,
      parentSessionId: record.parentSessionId,
      resolvedVia: "none",
      message: "No OpenCode port configured — cannot re-resolve session."
    };
  }
  const baseDir = opts.baseDirectory ?? record.baseDirectory ?? void 0;
  const detected = await autoDetectOpenCodeSession(openCodePort, baseDir);
  if (!detected) {
    sessionLog.warn(
      `Re-resolve failed: connectionId=${record.connectionId} — no sessions detected`
    );
    return {
      providerSessionId: null,
      parentSessionId: record.parentSessionId,
      resolvedVia: "none",
      message: "OpenCode API unreachable or returned no sessions during re-resolve."
    };
  }
  upsertRegisteredConnection({
    providerSessionId: detected.id,
    channelName: record.channelName,
    projectName: record.projectName,
    baseDirectory: record.baseDirectory ?? void 0,
    connectionId: record.connectionId,
    parentSessionId: detected.parentId ?? void 0,
    providerType: "opencode"
  });
  sessionLog.info(
    `Re-resolved: connectionId=${record.connectionId} sessionId=${detected.id}`
  );
  return {
    providerSessionId: detected.id,
    parentSessionId: detected.parentId,
    resolvedVia: "re-resolved"
  };
}
function resolveClaude(record) {
  return {
    providerSessionId: record.connectionId,
    parentSessionId: null,
    resolvedVia: "cached"
  };
}
async function reResolveStaleSession(opts) {
  return resolveSession(opts);
}
function resolveProviderSessionId(connectionId, explicitSessionId, providerType) {
  if (explicitSessionId) {
    sessionLog.debug(
      `resolveProviderSessionId: explicit=${explicitSessionId} connectionId=${connectionId}`
    );
    return explicitSessionId;
  }
  const candidates = getRegisteredConnectionsByConnectionId(connectionId);
  if (candidates.length === 0) {
    sessionLog.warn(
      `resolveProviderSessionId: fallback FAILED no rows for connectionId=${connectionId}`
    );
    return null;
  }
  if (candidates.length > 1) {
    sessionLog.warn(
      `resolveProviderSessionId: AMBIGUOUS fallback connectionId=${connectionId} candidates=${candidates.length} picked=${candidates[0].providerSessionId} (oldest by created_at) others=[${candidates.slice(1).map((c) => c.providerSessionId).join(",")}] — agent should pass openCodeSessionId explicitly`
    );
  }
  const picked = candidates[0];
  if (picked.providerSessionId) {
    sessionLog.debug(
      `resolveProviderSessionId: fallback connectionId=${connectionId} resolved=${picked.providerSessionId} (oldest of ${candidates.length})`
    );
    return picked.providerSessionId;
  }
  return null;
}
const log$8 = createLogger("request-user-input");
function registerRequestUserInput(server, getWindow, promptFn, connectionId, connectionName, requireSessionId = false) {
  server.registerTool(
    "request_user_input",
    {
      description: `<description>
Send a question to the user via an interactive prompt surface. **Crucial for clarifying requirements, confirming plans, or resolving ambiguity.**
You should call this tool whenever it has **any** uncertainty or needs clarification or confirmation, even for trivial or silly questions.
Feel free to ask anything! **Proactive questioning is preferred over making assumptions.**
</description>

<importantNotes>
- (!important!) **Use this tool FREQUENTLY** for any question that requires user input or confirmation.
- (!important!) Continue to generate existing messages after user answers.
- (!important!) Provide predefined options for quick selection if applicable.
- (!important!) **Essential for validating assumptions before proceeding with significant actions (e.g., code edits, running commands).**
- (!important!) **Do not exit the prompt loop** until the user explicitly says one of: "Stop prompting", "End session", or "Don't ask anymore".
- (!important!) Immediately before final/closing handoff, ask exactly: "Are you satisfied with this result, or would you like any changes?"
- (!important!) If a required prompt times out or response is empty, re-prompt indefinitely and do not proceed with assumptions.
- (!important!) If the user skips a requested command/script, ask why it was skipped and whether to continue with alternatives or stop.
- (!important!) **NEVER use plain-text replies when a prompt trigger applies — always use this tool instead.**
- (!important!) After any task completion, you MUST call this tool to run the mandatory satisfaction check before closing the session.
- (!important!) **Concrete enforcement on timeout**: When this tool returns a timeout (e.g. "User did not reply: Timeout occurred."), the ONLY valid next action is to call this tool again immediately — in the very next tool call of the same response or the next response. Emitting a plain-text-only turn after a timeout is a policy violation. There is no exception for "the tool is unavailable" — keep calling until the user replies.
- (!important!) You MUST pass your openCodeSessionId (format: ses_<alphanumeric>) with every call. It was injected into your context at session start.
</importantNotes>

<whenToUseThisTool>
- Before starting any task, even if requirements appear clear
- After completing any task, to run the mandatory satisfaction check
- When you need clarification on user requirements or preferences
- When multiple implementation approaches are possible and user input is needed
- **Before making potentially impactful changes (code edits, file operations, complex commands)**
- When you need to confirm assumptions before proceeding
- When you need additional information not available in the current context
- When validating potential solutions before implementation
- When facing ambiguous instructions that require clarification
- When seeking feedback on generated code or solutions
- When needing permission to modify critical files or functionality
- When user instructions are conflicting or unclear
- When the user asks to be prompted, asks a direct question, or asks a reply question
- When the user skips a command you requested
- Immediately before any final/closing handoff
- When replying after system notifications and presenting task output/handoff to the user
- **Whenever you feel even slightly unsure about the user's intent or the correct next step.**
</whenToUseThisTool>

<features>
- Interactive prompt UI with markdown rendering (including code/diff blocks)
- Preserves markdown links, including VS Code file links (for example: "vscode://file/<abs-path>:<line>:<column>") when provided in the prompt text
- Supports option mode + free-text input mode when predefinedOptions are provided
- Returns user response or timeout notification (timeout defaults to ${getPromptTimeoutSeconds()} seconds)
- Backend-agnostic contract: same request/response behavior regardless of the active UI backend
- Maintains context across user interactions
- Handles empty responses gracefully
- Shows project context in the prompt header/title
- baseDirectory is required, must be the current repository root, and controls file autocomplete/search scope explicitly
</features>

<bestPractices>
- Keep questions concise and specific
- Provide clear options when applicable
- Use markdown for richer context (multiline structure, code fences, unified diff snippets)
- When referencing repository files, prefer VS Code-compatible file links in markdown where helpful
- Do not ask the question if you have another tool that can answer the question
  - e.g. when you searching file in the current repository, do not ask the question "Do you want to search for a file in the current repository?"
  - e.g. prefer to use other tools to find the answer (Cursor tools or other MCP Server tools)
- Limit questions to only what's necessary **to resolve the uncertainty**
- Format complex questions into simple choices
- Reference specific code or files when relevant
- Indicate why the information is needed
- Use appropriate urgency based on importance
</bestPractices>

<parameters>
- projectName: Identifies the context/project making the request (shown in prompt header/title context)
- message: The specific question for the user (prompt body text)
- predefinedOptions: Predefined options for the user to choose from (optional)
- baseDirectory: Required absolute path to the current repository root (must be a git repo root)
</parameters>

<examples>
- "Should I implement the authentication using JWT or OAuth?"
- "Do you want to use TypeScript interfaces or type aliases for this component?"
- "I found three potential bugs. Should I fix them all or focus on the critical one first?"
- "Can I refactor the database connection code to use connection pooling?"
- "Is it acceptable to add React Router as a dependency?"
- "I plan to modify function X in file Y. Is that correct?"
- { "projectName": "web-app", "message": "Which file should I edit?", "baseDirectory": "/workspace/web-app" }
</examples>`,
      title: "Request user input via an interactive prompt",
      inputSchema: {
        projectName: z.string().describe(
          "Identifies the context/project making the request (shown in prompt header/title context)"
        ),
        message: z.string().describe("The specific question for the user (prompt body text)"),
        predefinedOptions: z.array(z.string()).optional().describe(
          "Predefined options for the user to choose from (optional)"
        ),
        baseDirectory: z.string().describe(
          "Required absolute path to the current repository root (must be a git repo root; used as file autocomplete/search scope)"
        ),
        openCodeSessionId: z.string().optional().describe(
          "Your OpenCode session ID (format: ses_<alphanumeric>). Required for correct message routing in multi-agent scenarios."
        )
      }
    },
    async ({
      projectName,
      message,
      predefinedOptions,
      baseDirectory,
      openCodeSessionId
    }, extra) => {
      const t0 = Date.now();
      const providerSessionId = resolveProviderSessionId(
        connectionId,
        openCodeSessionId
      );
      log$8.info(
        `request_user_input invoked ts=${t0} connectionId=${connectionId} openCodeSessionIdParam=${openCodeSessionId ?? "null"} resolvedProviderSessionId=${providerSessionId ?? "null"} wasFallback=${!openCodeSessionId} requireSessionId=${requireSessionId}`
      );
      const staleErr = providerSessionId ? staleSessionError(providerSessionId) : null;
      if (staleErr) return staleErr;
      const missingParamErr = requireProviderSessionId(
        providerSessionId,
        requireSessionId
      );
      if (missingParamErr) return missingParamErr;
      const promptId = randomUUID();
      const timeoutSeconds = getPromptTimeoutSeconds();
      const expiresAt = timeoutSeconds > 0 ? Date.now() + timeoutSeconds * 1e3 : 0;
      const { answer, attachments } = await promptFn(
        getWindow(),
        {
          id: promptId,
          message,
          projectName,
          predefinedOptions,
          baseDirectory,
          connectionId,
          connectionName,
          timeoutSeconds,
          expiresAt,
          providerSessionId
        },
        extra.signal
      );
      if (answer === null || answer === void 0) {
        return {
          content: [
            {
              type: "text",
              text: "User did not reply: Timeout occurred."
            }
          ]
        };
      }
      if (answer === "") {
        return {
          content: [
            { type: "text", text: "User replied with empty input." }
          ]
        };
      }
      const content = [];
      if (providerSessionId) {
        const providerType = requireSessionId ? "opencode" : "standalone";
        const injections = claimContextInjections(
          providerSessionId,
          providerType
        );
        for (const injection of injections) {
          content.push({
            type: "text",
            text: `<system_notification>
${injection.payload}
</system_notification>`
          });
        }
      }
      content.push({ type: "text", text: `User replied: ${answer}` });
      if (attachments?.length) {
        const attachmentSessionKey = providerSessionId ?? connectionId;
        for (const att of attachments) {
          if (att.mimeType.startsWith("image/")) {
            const filename = saveAttachment(
              attachmentSessionKey,
              att.data,
              att.mimeType
            );
            const absPath = filename ? resolveAttachmentPath(attachmentSessionKey, filename) : null;
            if (absPath) {
              content.push({
                type: "text",
                text: `[Image file: ${absPath}]`
              });
            } else {
              content.push({
                type: "image",
                data: att.data,
                mimeType: att.mimeType
              });
            }
          } else {
            content.push({
              type: "text",
              text: `--- File: ${att.name} ---
${att.data}`
            });
          }
        }
      }
      return { content };
    }
  );
}
function sendToRenderer(win, channel, providerSessionId, payload) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, {
    providerSessionId,
    ...payload
  });
}
function sendSessionStatus(win, providerSessionId, status, type) {
  sendToRenderer(win, "session-status-update", providerSessionId, {
    status,
    type
  });
}
function sendAgentMessage(win, providerSessionId, message) {
  sendToRenderer(win, "agent-message", providerSessionId, {
    message
  });
}
function sendIntensiveChatStart(win, providerSessionId, sessionId, title) {
  sendToRenderer(win, "intensive-chat-start", providerSessionId, {
    sessionId,
    title
  });
}
function sendIntensiveChatStop(win, providerSessionId, sessionId) {
  sendToRenderer(win, "intensive-chat-stop", providerSessionId, {
    sessionId
  });
}
const activeChatSessions = /* @__PURE__ */ new Map();
function registerIntensiveChatTools(server, getWindow, promptFn, connectionId, connectionName, requireSessionId = false) {
  server.registerTool(
    "start_intensive_chat",
    {
      description: `<description>
Start an intensive chat session for gathering multiple answers quickly from the user.
**Highly recommended** for scenarios requiring a sequence of related inputs or confirmations.
Very useful for gathering multiple answers from the user in a short period of time.
Especially useful for brainstorming ideas or discussing complex topics with the user.
</description>

<importantNotes>
- (!important!) Opens a persistent interaction session that stays active for multiple questions.
- (!important!) Returns a session ID that **must** be used for subsequent questions via 'ask_intensive_chat'.
- (!important!) **Must** be closed with 'stop_intensive_chat' when finished gathering all inputs.
- (!important!) After starting a session, **immediately** continue asking all necessary questions using 'ask_intensive_chat' within the **same response message**. Do not end the response until the chat is closed with 'stop_intensive_chat'. This creates a seamless conversational flow for the user.
- (!important!) Continue the prompt loop until the user explicitly says one of: "Stop prompting", "End session", or "Don't ask anymore".
- (!important!) **NEVER use plain-text replies when a prompt trigger applies — use ask_intensive_chat to continue the session.**
- (!important!) After all questions in the session are asked, close with stop_intensive_chat and then run the mandatory satisfaction check via request_user_input.
- (!important!) You MUST pass your openCodeSessionId (format: ses_<alphanumeric>) with every call. It was injected into your context at session start.
</importantNotes>

<whenToUseThisTool>
- When you need to collect a series of quick answers from the user (more than 2-3 questions)
- When setting up a project with multiple configuration options
- When guiding a user through a multi-step process requiring input at each stage
- When gathering sequential user preferences
- When you want to maintain context between multiple related questions efficiently
- When brainstorming ideas with the user interactively
</whenToUseThisTool>

<features>
- Opens a persistent interactive prompt surface for continuous interaction
- Renders markdown prompts, including code/diff snippets, for richer question context
- Preserves markdown links, including VS Code file links (for example: "vscode://file/<abs-path>:<line>:<column>") in prompt content
- Supports option mode + free-text mode while asking follow-up questions
- Configurable timeout for each question (set via -t/--timeout, defaults to ${getPromptTimeoutSeconds()} seconds)
- Returns a session ID for subsequent interactions
- Keeps full chat history visible to the user
- Maintains state between questions
- Backend-agnostic contract: start/ask/stop behavior is consistent across available UI backends
- Requires baseDirectory and pins autocomplete/search scope to the repository root
</features>

<bestPractices>
- Use a descriptive session title related to the task
- Start with a clear initial question when possible
- Use markdown for longer/multiline prompts, code fences, and diff context
- Do not ask the question if you have another tool that can answer the question
  - e.g. when you searching file in the current repository, do not ask the question "Do you want to search for a file in the current repository?"
  - e.g. prefer to use other tools to find the answer (Cursor tools or other MCP Server tools)
- Always store the returned session ID for later use
- Always close the session when you're done with stop_intensive_chat
</bestPractices>

<parameters>
- sessionTitle: Title for the intensive chat session (appears at the top of the console)
- baseDirectory: Required absolute path to the current repository root (must be a git repo root)
</parameters>

<examples>
- Start session for project setup: { "sessionTitle": "Project Configuration", "baseDirectory": "/workspace/project" }
- Start session with repository root scope: { "sessionTitle": "Project Configuration", "baseDirectory": "/workspace/project" }
</examples>`,
      inputSchema: {
        sessionTitle: z.string().describe("Title for the intensive chat session"),
        baseDirectory: z.string().describe(
          "Required absolute path to the current repository root (must be a git repo root; default autocomplete/search scope for this session)"
        ),
        openCodeSessionId: z.string().optional().describe(
          "Your OpenCode session ID (format: ses_<alphanumeric>). Required for correct routing."
        )
      }
    },
    async ({
      sessionTitle,
      baseDirectory,
      openCodeSessionId
    }) => {
      const providerSessionId = resolveProviderSessionId(
        connectionId,
        openCodeSessionId
      );
      const staleErr = providerSessionId ? staleSessionError(providerSessionId) : null;
      if (staleErr) return staleErr;
      const missingParamErr = requireProviderSessionId(
        providerSessionId,
        requireSessionId
      );
      if (missingParamErr) return missingParamErr;
      const sessionId = randomUUID();
      activeChatSessions.set(sessionId, { title: sessionTitle, baseDirectory });
      sendIntensiveChatStart(
        getWindow(),
        providerSessionId,
        sessionId,
        sessionTitle
      );
      return {
        content: [
          {
            type: "text",
            text: `Intensive chat session started successfully. Session ID: ${sessionId}`
          }
        ]
      };
    }
  );
  server.registerTool(
    "ask_intensive_chat",
    {
      description: `<description>
Ask a new question in an active intensive chat session previously started with 'start_intensive_chat'.
</description>

<importantNotes>
- (!important!) Requires a valid session ID from 'start_intensive_chat'.
- (!important!) Supports predefined options for quick selection.
- (!important!) Returns the user's answer or indicates if they didn't respond.
- (!important!) **Use this repeatedly within the same response message** after 'start_intensive_chat' until all questions are asked.
- (!important!) If response is empty or times out for required input, re-prompt and do not proceed with assumptions.
- (!important!) Keep the loop active until the user explicitly says one of: "Stop prompting", "End session", or "Don't ask anymore".
- (!important!) **Concrete enforcement on timeout**: When this tool returns a timeout (e.g. "User did not reply to question in intensive chat: Timeout occurred."), the ONLY valid next action is to call this tool again immediately. Emitting a plain-text-only turn after a timeout is a policy violation — keep calling until the user replies.
- (!important!) You MUST pass your openCodeSessionId (format: ses_<alphanumeric>) with every call. It was injected into your context at session start.
</importantNotes>

<whenToUseThisTool>
- When continuing a series of questions in an intensive chat session.
- When you need the next piece of information in a multi-step process initiated via 'start_intensive_chat'.
- When offering multiple choice options to the user within the session.
- When gathering sequential information from the user within the session.
</whenToUseThisTool>

<features>
- Adds a new question to an existing chat session
- Supports markdown-friendly prompts (including multiline text, code fences, and diff snippets)
- Preserves markdown links, including VS Code file links (for example: "vscode://file/<abs-path>:<line>:<column>") in question text
- Supports predefined options for quick selection
- Returns the user's response
- Maintains the chat history in the console
- Requires baseDirectory for each question and scopes autocomplete/search to the repository root
</features>

<bestPractices>
- Ask one clear question at a time
- Provide predefined options when applicable
- Don't ask overly complex questions
- Keep questions focused on a single piece of information
</bestPractices>

<parameters>
- sessionId: ID of the intensive chat session (from start_intensive_chat)
- question: The question text to display to the user
- predefinedOptions: Array of predefined options for the user to choose from (optional)
- baseDirectory: Required absolute path to the current repository root (must be a git repo root)
</parameters>

<examples>
- Simple question: { "sessionId": "abcd1234", "question": "What is your project named?", "baseDirectory": "/workspace/project" }
- With predefined options: { "sessionId": "abcd1234", "question": "Would you like to use TypeScript?", "predefinedOptions": ["Yes", "No"], "baseDirectory": "/workspace/project" }
- Ask another repo-scoped question: { "sessionId": "abcd1234", "question": "Pick a file", "baseDirectory": "/workspace/project" }
</examples>`,
      title: "Ask a question in an intensive chat session",
      inputSchema: {
        sessionId: z.string().describe("ID of the intensive chat session"),
        question: z.string().describe("Question to ask the user"),
        predefinedOptions: z.array(z.string()).optional().describe(
          "Predefined options for the user to choose from (optional)"
        ),
        baseDirectory: z.string().describe(
          "Required absolute path to the current repository root (must be a git repo root; autocomplete/search scope for this question)"
        ),
        openCodeSessionId: z.string().optional().describe(
          "Your OpenCode session ID (format: ses_<alphanumeric>). Required for correct routing."
        )
      }
    },
    async ({
      sessionId,
      question,
      predefinedOptions,
      baseDirectory,
      openCodeSessionId
    }, extra) => {
      const providerSessionId = resolveProviderSessionId(
        connectionId,
        openCodeSessionId
      );
      const staleErr = providerSessionId ? staleSessionError(providerSessionId) : null;
      if (staleErr) return staleErr;
      const missingParamErr = requireProviderSessionId(
        providerSessionId,
        requireSessionId
      );
      if (missingParamErr) return missingParamErr;
      const session2 = activeChatSessions.get(sessionId);
      if (!session2) {
        return {
          content: [
            {
              type: "text",
              text: "Error: Invalid or expired session ID."
            }
          ]
        };
      }
      const promptId = randomUUID();
      const timeoutSeconds = getPromptTimeoutSeconds();
      const expiresAt = timeoutSeconds > 0 ? Date.now() + timeoutSeconds * 1e3 : 0;
      const result = await promptFn(
        getWindow(),
        {
          id: promptId,
          message: question,
          projectName: session2.title,
          predefinedOptions,
          baseDirectory: baseDirectory || session2.baseDirectory,
          sessionId,
          connectionId,
          connectionName,
          timeoutSeconds,
          expiresAt,
          providerSessionId
        },
        extra.signal
      );
      const { answer, attachments } = result;
      if (answer === null || answer === void 0) {
        return {
          content: [
            {
              type: "text",
              text: "User did not reply to question in intensive chat: Timeout occurred."
            }
          ]
        };
      }
      if (answer === "") {
        return {
          content: [
            {
              type: "text",
              text: "User replied with empty input in intensive chat."
            }
          ]
        };
      }
      const content = [
        { type: "text", text: `User replied: ${answer}` }
      ];
      if (attachments?.length) {
        const attachmentSessionKey = providerSessionId ?? connectionId;
        for (const att of attachments) {
          if (att.mimeType.startsWith("image/")) {
            const filename = saveAttachment(
              attachmentSessionKey,
              att.data,
              att.mimeType
            );
            const absPath = filename ? resolveAttachmentPath(attachmentSessionKey, filename) : null;
            if (absPath) {
              content.push({
                type: "text",
                text: `[Image file: ${absPath}]`
              });
            } else {
              content.push({
                type: "image",
                data: att.data,
                mimeType: att.mimeType
              });
            }
          } else {
            content.push({
              type: "text",
              text: `--- File: ${att.name} ---
${att.data}`
            });
          }
        }
      }
      return { content };
    }
  );
  server.registerTool(
    "stop_intensive_chat",
    {
      description: `<description>
  Stop and close an active intensive chat session. **Must be called** after all questions have been asked using 'ask_intensive_chat'.
</description>

<importantNotes>
- (!important!) Closes the active intensive chat session.
- (!important!) Frees up system resources.
- (!important!) **Should always be called** as the final step when finished with an intensive chat session, typically at the end of the response message where 'start_intensive_chat' was called.
- (!important!) Only stop the session when the user explicitly wants to end prompting, such as with "Stop prompting", "End session", or "Don't ask anymore".
- (!important!) You MUST pass your openCodeSessionId (format: ses_<alphanumeric>) with every call. It was injected into your context at session start.
</importantNotes>

<whenToUseThisTool>
- When you've completed gathering all needed information via 'ask_intensive_chat'.
- When the multi-step process requiring intensive chat is complete.
- When you're ready to move on to processing the collected information.
- When the user indicates they want to end the session (if applicable).
- As the final action related to the intensive chat flow within a single response message.
</whenToUseThisTool>

<features>
- Gracefully closes the active session in the current backend
- Cleans up system resources
- Marks the session as complete
</features>

<bestPractices>
- Always stop sessions when you're done to free resources
- Provide a summary of the information collected before stopping
</bestPractices>

<parameters>
- sessionId: ID of the intensive chat session to stop
</parameters>

<examples>
- { "sessionId": "abcd1234" }
</examples>`,
      inputSchema: {
        sessionId: z.string().describe("ID of the intensive chat session to stop"),
        openCodeSessionId: z.string().optional().describe(
          "Your OpenCode session ID (format: ses_<alphanumeric>). Required for correct routing."
        )
      }
    },
    async ({ sessionId, openCodeSessionId }) => {
      const providerSessionId = resolveProviderSessionId(
        connectionId,
        openCodeSessionId
      );
      const staleErr = providerSessionId ? staleSessionError(providerSessionId) : null;
      if (staleErr) return staleErr;
      const missingParamErr = requireProviderSessionId(
        providerSessionId,
        requireSessionId
      );
      if (missingParamErr) return missingParamErr;
      const session2 = activeChatSessions.get(sessionId);
      if (!session2) {
        return {
          content: [
            {
              type: "text",
              text: "Error: Invalid or expired session ID."
            }
          ]
        };
      }
      activeChatSessions.delete(sessionId);
      sendIntensiveChatStop(getWindow(), providerSessionId, sessionId);
      return {
        content: [
          { type: "text", text: "Session stopped successfully." }
        ]
      };
    }
  );
}
function unregisteredConnectionError(connectionId) {
  if (getRegisteredConnection(connectionId) !== null) return null;
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error: "NOT_REGISTERED",
          message: "You must call register_connection before using send_message. Without registration there is no channel to send to and the message will be lost.",
          action: "Call the register_connection tool with your channelName, projectName, and baseDirectory first."
        })
      }
    ]
  };
}
function registerSessionChannelTools(server, getWindow, connectionId, requireSessionId = false) {
  server.registerTool(
    "push_session_status",
    {
      description: `<description>
Push a non-blocking status update to the UI. Returns immediately. Use to keep the user informed about what the agent is currently doing.
</description>

<importantNotes>
- (!important!) Non-blocking — returns immediately without waiting for user input.
- (!important!) Use frequently to keep the user informed of progress on long-running tasks.
- (!important!) Do NOT use as a substitute for request_user_input when user input is needed.
- (!important!) This is a one-way status push; it does not collect a response from the user.
- (!important!) You MUST pass your openCodeSessionId (format: ses_<alphanumeric>) with every call. It was injected into your context at session start.
</importantNotes>

<whenToUseThisTool>
- When starting a long-running operation (e.g. "Running tests...", "Building project...")
- When completing a major step in a multi-step task
- When switching between different phases of work
- To show progress indicators without blocking the agent workflow
- Anytime the agent is about to do something that may take a while
</whenToUseThisTool>

<features>
- Sends a status message instantly to the UI status bar
- Supports visual type indicators: info, working, success, error
- Non-blocking: agent continues immediately after the call
- Scoped to the current connection/session
</features>

<bestPractices>
- Use "working" type while actively processing
- Use "success" type when a step completes successfully
- Use "error" type when an error occurs
- Keep status messages short and action-oriented (e.g. "Running tests...", "Fixing type errors")
- Do not use for questions — use request_user_input instead
</bestPractices>

<parameters>
- status: Status message to display (short, action-oriented text)
- type: Visual indicator type — "info" | "working" | "success" | "error" (optional, defaults to "info")
</parameters>

<examples>
- { "status": "Running tests...", "type": "working" }
- { "status": "Build succeeded", "type": "success" }
- { "status": "TypeScript error found in database.ts", "type": "error" }
- { "status": "Analyzing codebase structure", "type": "info" }
</examples>`,
      title: "Push a status update to the session channel UI",
      inputSchema: {
        status: z.string().describe("Status message to display"),
        type: z.enum(["info", "working", "success", "error"]).optional().describe("Visual type for the status indicator"),
        openCodeSessionId: z.string().optional().describe(
          "Your OpenCode session ID (format: ses_<alphanumeric>). Required for correct routing."
        )
      }
    },
    async ({
      status,
      type = "info",
      openCodeSessionId
    }) => {
      const providerSessionId = resolveProviderSessionId(
        connectionId,
        openCodeSessionId
      );
      const staleErr = providerSessionId ? staleSessionError(providerSessionId) : null;
      if (staleErr) return staleErr;
      const missingParamErr = requireProviderSessionId(
        providerSessionId,
        requireSessionId
      );
      if (missingParamErr) return missingParamErr;
      sendSessionStatus(getWindow(), providerSessionId, status, type);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true })
          }
        ]
      };
    }
  );
}
function registerSendMessageTool(server, getWindow, connectionId, requireSessionId = false) {
  server.registerTool(
    "send_message",
    {
      description: `<description>
Send a visible, persistent message directly into the desktop app channel history. Non-blocking — returns immediately. Use to communicate information to the user without requiring a response.
</description>

<importantNotes>
- (!important!) Non-blocking — returns immediately without waiting for user input.
- (!important!) The message is persisted in channel history and survives app restarts.
- (!important!) Use this for informational updates that the user should see but doesn't need to reply to.
- (!important!) For status badges (transient, not persisted), use push_session_status instead.
- (!important!) You MUST pass your openCodeSessionId (format: ses_<alphanumeric>) with every call. It was injected into your context at session start.
</importantNotes>

<whenToUseThisTool>
- When you want to share a result, summary, or update that the user should read but doesn't need to answer
- When completing a task and want to send a final summary message
- When you need to communicate something important mid-task without interrupting the workflow
</whenToUseThisTool>

<features>
- Persisted in channel history with a distinct teal/informational visual style
- Markdown supported
- Non-blocking: agent continues immediately after the call
- Scoped to the current connection/session
</features>

<parameters>
- message: The message text to display. Markdown is supported.
</parameters>

<examples>
- { "message": "Build completed successfully. 3 files changed." }
- { "message": "## Summary\\n- Fixed 2 bugs\\n- Updated tests" }
</examples>`,
      title: "Send a persistent message to the channel",
      inputSchema: {
        message: z.string().describe("The message text to display. Markdown is supported."),
        openCodeSessionId: z.string().optional().describe(
          "Your OpenCode session ID (format: ses_<alphanumeric>). Required for correct routing."
        )
      }
    },
    async ({ message, openCodeSessionId }) => {
      const providerSessionId = resolveProviderSessionId(
        connectionId,
        openCodeSessionId
      );
      const staleErr = providerSessionId ? staleSessionError(providerSessionId) : null;
      if (staleErr) return staleErr;
      const missingParamErr = requireProviderSessionId(
        providerSessionId,
        requireSessionId
      );
      if (missingParamErr) return missingParamErr;
      const unregisteredErr = unregisteredConnectionError(connectionId);
      if (unregisteredErr) return unregisteredErr;
      const resolvedSessionId = providerSessionId ?? connectionId;
      appendSessionChannelMessage({
        sessionId: resolvedSessionId,
        messageType: "agent_message",
        messageText: message
      });
      sendAgentMessage(getWindow(), providerSessionId, message);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true })
          }
        ]
      };
    }
  );
}
const claudeSessionByProviderSessionId = /* @__PURE__ */ new Map();
function isModuleNotInstalledError(error) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("cannot find module") || message.includes("failed to resolve module") || message.includes("module not found");
}
async function detectClaudeSdkRuntime() {
  try {
    await import("@anthropic-ai/claude-agent-sdk");
  } catch (error) {
    if (isModuleNotInstalledError(error)) {
      return {
        available: false,
        reason: "module_not_installed",
        message: "Claude SDK package is not installed. Running in standalone compatibility mode."
      };
    }
    return {
      available: false,
      reason: "init_failed",
      message: "Claude SDK failed to initialize. Running in standalone compatibility mode."
    };
  }
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
  if (!hasApiKey) {
    return {
      available: false,
      reason: "missing_api_key",
      message: "Claude SDK is installed but ANTHROPIC_API_KEY is missing. Running in standalone compatibility mode."
    };
  }
  return {
    available: true,
    message: "Claude SDK backend is available."
  };
}
function buildClaudePromptWithAttachments(message, attachments) {
  let full = message;
  for (const attachment of attachments ?? []) {
    if (attachment.mimeType.startsWith("image/")) {
      full += `

[Image attached: ${attachment.name}]`;
      continue;
    }
    full += `

--- File: ${attachment.name} ---
${attachment.data}`;
  }
  return full;
}
function extractAssistantText(chunk) {
  const typed = chunk;
  if (typed.type !== "assistant") return "";
  const content = typed.message?.content ?? [];
  const textParts = content.filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text);
  return textParts.join("");
}
function extractSessionId(chunk) {
  const candidate = chunk.session_id;
  if (typeof candidate !== "string" || candidate.length === 0) return null;
  return candidate;
}
async function injectClaudeMessageForConnection(params) {
  const runtime = await detectClaudeSdkRuntime();
  if (!runtime.available) {
    return { ok: false, error: runtime.message };
  }
  try {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    const previousSessionId = claudeSessionByProviderSessionId.get(
      params.providerSessionId
    );
    const fullPrompt = buildClaudePromptWithAttachments(
      params.message,
      params.attachments
    );
    const options = {
      persistSession: true
    };
    if (previousSessionId) {
      options.resume = previousSessionId;
    }
    if (params.baseDirectory) {
      options.cwd = params.baseDirectory;
    }
    const stream = sdk.query({
      prompt: fullPrompt,
      options
    });
    let sessionId = previousSessionId ?? null;
    const responses = [];
    for await (const chunk of stream) {
      const discoveredSessionId = extractSessionId(chunk);
      if (discoveredSessionId) {
        sessionId = discoveredSessionId;
      }
      const assistantText = extractAssistantText(chunk);
      if (assistantText.length > 0) {
        responses.push(assistantText);
      }
    }
    if (sessionId) {
      claudeSessionByProviderSessionId.set(params.providerSessionId, sessionId);
    }
    return {
      ok: true,
      sessionId: sessionId ?? void 0,
      responseText: responses.join("\n").trim() || void 0
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
async function getBackendAdapter(backend) {
  if (backend === "opencode") {
    return {
      backend,
      supportsSessionHierarchy: true,
      supportsProviderInjection: true,
      runtime: null
    };
  }
  if (backend === "claude_sdk") {
    const runtime = await detectClaudeSdkRuntime();
    return {
      backend,
      supportsSessionHierarchy: false,
      supportsProviderInjection: runtime.available,
      runtime
    };
  }
  return {
    backend: "standalone",
    supportsSessionHierarchy: false,
    supportsProviderInjection: false,
    runtime: null
  };
}
const TO_CANONICAL_VARIANT = {
  max: "xhigh",
  "x-high": "xhigh"
};
const TO_PROVIDER_VARIANT = {
  xhigh: "max",
  "x-high": "max"
};
function normalizeReasoningVariant(variant) {
  if (!variant) return void 0;
  const normalized = variant.trim().toLowerCase();
  if (!normalized) return void 0;
  return TO_CANONICAL_VARIANT[normalized] ?? normalized;
}
function normalizeReasoningVariants(variants) {
  if (!variants || variants.length === 0) return void 0;
  const deduped = /* @__PURE__ */ new Set();
  for (const variant of variants) {
    const normalized = normalizeReasoningVariant(variant);
    if (normalized) deduped.add(normalized);
  }
  return deduped.size > 0 ? Array.from(deduped) : void 0;
}
function toProviderReasoningVariant(variant) {
  const normalized = normalizeReasoningVariant(variant);
  if (!normalized) return void 0;
  return TO_PROVIDER_VARIANT[normalized] ?? normalized;
}
const normalizeText = (value) => value.replace(/\s+/g, " ").trim();
const matchesUserPayload = (candidate, fullText, message) => {
  const normalizedCandidate = normalizeText(candidate);
  const normalizedFullText = normalizeText(fullText);
  const normalizedUserMessage = normalizeText(message);
  if (normalizedCandidate === normalizedFullText) return true;
  if (!normalizedUserMessage) return false;
  return normalizedCandidate.includes(normalizedUserMessage);
};
async function isSessionBusy(port, openCodeSessionId, reconcileTimeoutMs) {
  try {
    const response = await sessionStatus(port, {
      signal: AbortSignal.timeout(reconcileTimeoutMs)
    });
    if (response.error) return false;
    const status = response.data;
    return status?.[openCodeSessionId]?.type === "busy";
  } catch {
    return false;
  }
}
async function hasDeliveredMessage(port, openCodeSessionId, reconcileTimeoutMs, reconcileMessageLimit, fullText, message) {
  try {
    const response = await sessionMessages(
      port,
      openCodeSessionId,
      { limit: reconcileMessageLimit },
      { signal: AbortSignal.timeout(reconcileTimeoutMs) }
    );
    if (response.error) return false;
    const messages = response.data;
    if (!messages) return false;
    return messages.some((msg) => {
      if (msg.info?.role !== "user") return false;
      const userText = (msg.parts ?? []).filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join("");
      return matchesUserPayload(userText, fullText, message);
    });
  } catch {
    return false;
  }
}
async function reconcileDeliveryAfterTimeout(options) {
  const {
    noReply,
    openCodePort,
    openCodeSessionId,
    fullText,
    message,
    reconcileTimeoutMs,
    reconcileMessageLimit,
    reconcileAttempts,
    log: log2
  } = options;
  if (noReply) return false;
  for (let attempt = 0; attempt < reconcileAttempts; attempt++) {
    try {
      const delivered = await hasDeliveredMessage(
        openCodePort,
        openCodeSessionId,
        reconcileTimeoutMs,
        reconcileMessageLimit,
        fullText,
        message
      );
      if (delivered) {
        log2.warn(
          `[injectOpenCodeMessage] POST timed out, but user message was confirmed in session ${openCodeSessionId}. Returning success to avoid duplicate resend.`
        );
        return true;
      }
    } catch (err) {
      const msg = errorMessage(err);
      log2.warn(
        `[injectOpenCodeMessage] Delivery reconciliation error for session ${openCodeSessionId}: ${msg}`
      );
    }
    const busy = await isSessionBusy(
      openCodePort,
      openCodeSessionId,
      reconcileTimeoutMs
    );
    if (busy) {
      log2.warn(
        `[injectOpenCodeMessage] POST timed out and session ${openCodeSessionId} is busy. Treating as accepted to avoid duplicate resend.`
      );
      return true;
    }
    if (attempt < reconcileAttempts - 1) {
      const backoffMs = (attempt + 1) * 1e3;
      await new Promise((resolve2) => setTimeout(resolve2, backoffMs));
    }
  }
  return false;
}
const log$7 = createLogger("injector");
const SUPPORTED_FILE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "txt",
  "md",
  "json",
  "ts",
  "tsx",
  "js",
  "jsx",
  "css",
  "html",
  "yml",
  "yaml",
  "toml",
  "xml",
  "csv",
  "log",
  "sh",
  "bash",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "c",
  "cpp",
  "h"
];
async function injectOpenCodeMessage(openCodeSessionId, message, attachments, openCodePort, mcpServerPort, noReply = true, modelOverride, systemMessage, agent) {
  log$7.info(
    `[injectOpenCodeMessage] Starting injection to session ${openCodeSessionId}`
  );
  log$7.info(
    `[injectOpenCodeMessage] Message: "${message.slice(0, 100)}${message.length > 100 ? "..." : ""}"`
  );
  log$7.info(`[injectOpenCodeMessage] noReply: ${noReply}`);
  log$7.info(`[injectOpenCodeMessage] attachments: ${attachments?.length ?? 0}`);
  log$7.info(
    `[injectOpenCodeMessage] modelOverride: ${JSON.stringify(modelOverride)}`
  );
  log$7.info(
    `[injectOpenCodeMessage] systemMessage: ${systemMessage ? `${systemMessage.length} chars` : "none"}`
  );
  const trimmedAgent = agent?.trim();
  log$7.info(
    `[injectOpenCodeMessage] agent: ${trimmedAgent && trimmedAgent.length > 0 ? trimmedAgent : "(none)"}`
  );
  if (modelOverride) {
    log$7.info(
      `[injectOpenCodeMessage] modelOverride fields providerId=${modelOverride.providerId ?? "(none)"} modelId=${modelOverride.modelId ?? "(none)"} variant=${modelOverride.variant ?? "(none)"}`
    );
  }
  let fullText = message;
  for (const att of attachments ?? []) {
    if (att.mimeType.startsWith("image/")) {
      const filename = saveAttachment(
        openCodeSessionId,
        att.data,
        att.mimeType
      );
      const absPath = filename ? resolveAttachmentPath(openCodeSessionId, filename) : null;
      if (absPath) {
        fullText += `

[Image file: ${absPath}]`;
      } else if (filename) {
        fullText += `

[Image attached: ${att.name}]`;
      }
    } else {
      const isTextLike = att.mimeType.startsWith("text/") || /\b(json|xml|yaml|yml|toml|javascript|typescript)\b/i.test(
        att.mimeType
      );
      const filename = saveNamedAttachment(
        openCodeSessionId,
        att.name,
        att.data,
        isTextLike ? "utf8" : "base64"
      );
      const absPath = filename ? resolveAttachmentPath(openCodeSessionId, filename) : null;
      if (absPath) {
        const label = isTextLike ? "Text file" : "Binary file";
        fullText += `

[${label}: ${absPath}]`;
      } else {
        fullText += isTextLike ? `

--- File: ${att.name} ---
${att.data}` : `

[Binary file attached: ${att.name}]`;
      }
    }
  }
  const parts = [
    { type: "text", text: fullText }
  ];
  let model;
  let variant;
  if (modelOverride) {
    const providerId = modelOverride.providerId?.trim();
    const modelId = modelOverride.modelId?.trim();
    if (!providerId || !modelId) {
      log$7.warn(
        "[injectOpenCodeMessage] Skipping model override because providerId or modelId is empty"
      );
    } else {
      model = {
        providerID: providerId,
        modelID: modelId
      };
      const providerVariant = toProviderReasoningVariant(modelOverride.variant);
      if (providerVariant) {
        variant = providerVariant;
      }
    }
  }
  const timeoutMs = 12e4;
  const maxRetries = noReply ? 1 : 0;
  const retryDelayMs = 5e3;
  const reconcileTimeoutMs = 5e3;
  const reconcileMessageLimit = 20;
  const reconcileAttempts = 3;
  const isTimeoutError = (err) => {
    if (!(err instanceof Error)) return false;
    const msg = err.message.toLowerCase();
    return msg.includes("aborted") || msg.includes("timeout") || err.name === "TimeoutError";
  };
  const confirmDeliveredAfterTimeout = async () => {
    return reconcileDeliveryAfterTimeout({
      noReply,
      openCodePort,
      openCodeSessionId,
      fullText,
      message,
      reconcileTimeoutMs,
      reconcileMessageLimit,
      reconcileAttempts,
      log: log$7
    });
  };
  const attemptInject = async (attempt) => {
    const startTime = Date.now();
    log$7.info(
      `[injectOpenCodeMessage] Attempt ${attempt + 1}/${maxRetries + 1} - Sending promptAsync request via SDK`
    );
    try {
      const registered = getRegisteredConnectionBySessionId(
        openCodeSessionId,
        "opencode"
      );
      const requestBody = {
        noReply,
        parts
      };
      if (model) {
        requestBody.model = model;
      }
      if (variant) {
        requestBody.variant = variant;
      }
      if (systemMessage) {
        requestBody.system = systemMessage;
      }
      if (trimmedAgent && trimmedAgent.length > 0) {
        requestBody.agent = trimmedAgent;
      }
      log$7.info(
        `[injectOpenCodeMessage] SDK request body: ${JSON.stringify(requestBody)} directory=${registered?.baseDirectory ?? "(none)"}`
      );
      const response = await sessionPromptAsync(
        openCodePort,
        openCodeSessionId,
        requestBody,
        {
          directory: registered?.baseDirectory ?? void 0,
          signal: AbortSignal.timeout(timeoutMs)
        }
      );
      const elapsedMs = Date.now() - startTime;
      if (response.error) {
        const errorMsg = `OpenCode SDK error: ${JSON.stringify(response.error)}`;
        log$7.error(
          `inject failed for session ${openCodeSessionId}: ${errorMsg}`
        );
        console.error(
          `[Inject Error] ${errorMsg} (session: ${openCodeSessionId})`
        );
        return { ok: false, error: errorMsg, noReply };
      }
      log$7.info(
        `[injectOpenCodeMessage] SDK injection successful for session ${openCodeSessionId} (took ${elapsedMs}ms)`
      );
      return { ok: true, noReply };
    } catch (err) {
      const rawMsg = errorMessage(err);
      const isTimeout = isTimeoutError(err);
      if (isTimeout && !noReply) {
        const delivered = await confirmDeliveredAfterTimeout();
        if (delivered) {
          return { ok: true, noReply };
        }
      }
      const errorContext = {
        session: openCodeSessionId,
        timeout: `${timeoutMs}ms`,
        attempt: attempt + 1,
        maxAttempts: maxRetries + 1,
        error: rawMsg,
        errorName: err instanceof Error ? err.name : "Unknown",
        isTimeout,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      };
      log$7.error(
        `inject attempt ${attempt + 1} failed for session ${openCodeSessionId}: ${rawMsg}${isTimeout ? ` (timeout after ${timeoutMs / 1e3}s)` : ""} | Context: ${JSON.stringify(errorContext)}`
      );
      console.error(
        `[Inject Error] ${isTimeout ? `TIMEOUT after ${timeoutMs / 1e3}s` : "FAILED"} for session ${openCodeSessionId} (attempt ${attempt + 1}/${maxRetries + 1}):`,
        errorContext
      );
      return {
        ok: false,
        error: rawMsg,
        noReply,
        // @ts-expect-error - internal flag for retry logic
        _isTimeout: isTimeout
      };
    }
  };
  log$7.info(`[injectOpenCodeMessage] Starting injection with SDK promptAsync`);
  let result = await attemptInject(0);
  if (result.ok) return result;
  if (result._isTimeout && maxRetries > 0) {
    log$7.info(
      `[injectOpenCodeMessage] Timeout detected, retrying in ${retryDelayMs / 1e3}s...`
    );
    console.log(
      `[Inject] Timeout during injection, retrying in ${retryDelayMs / 1e3}s (OpenCode may be compacting)...`
    );
    await new Promise((resolve2) => setTimeout(resolve2, retryDelayMs));
    result = await attemptInject(1);
    if (result.ok) return result;
  }
  const userMsg = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result._isTimeout ? "Request timed out — OpenCode may be busy with compaction. Try again in a moment." : result.error ?? "Unknown error"
  );
  return { ok: false, error: userMsg, noReply };
}
const DOC_MAX_FILE_SIZE = 512 * 1024;
function extractTitle(content) {
  const match = content.match(/^#\s+(.+)/m);
  return match ? match[1].trim() : null;
}
const SKIP_DIRS = /* @__PURE__ */ new Set([
  ".git",
  ".nx",
  ".vscode",
  "coverage",
  "dist",
  "evidence",
  "evidence-tmp",
  "node_modules",
  "Pods",
  "tmp",
  "build",
  "out",
  "release",
  ".next",
  "__pycache__",
  ".cache",
  ".turbo",
  ".parcel-cache"
]);
const STOP_WORDS$1 = /* @__PURE__ */ new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "can",
  "shall",
  "to",
  "of",
  "in",
  "for",
  "on",
  "with",
  "at",
  "by",
  "from",
  "as",
  "into",
  "through",
  "during",
  "before",
  "after",
  "between",
  "out",
  "off",
  "over",
  "under",
  "then",
  "here",
  "there",
  "when",
  "where",
  "why",
  "how",
  "all",
  "each",
  "every",
  "both",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "nor",
  "not",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  "just",
  "because",
  "but",
  "and",
  "or",
  "if",
  "while",
  "that",
  "this",
  "it",
  "its"
]);
function walkDirectory(dirPath, visitor) {
  let entries;
  try {
    entries = readdirSync$1(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join$1(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        walkDirectory(fullPath, visitor);
      }
      continue;
    }
    if (entry.isFile()) {
      visitor(fullPath);
    }
  }
}
function discoverDocs(baseDirectory) {
  const files = [];
  const docsRoot = join$1(baseDirectory, "docs");
  if (existsSync$1(docsRoot)) {
    walkDirectory(docsRoot, (filePath) => {
      if (filePath.endsWith(".md") || filePath.endsWith(".mdx")) {
        files.push(filePath);
      }
    });
  }
  const rootReadme = join$1(baseDirectory, "README.md");
  if (existsSync$1(rootReadme)) {
    files.push(rootReadme);
  }
  for (const topDir of ["apps", "libs", "tools"]) {
    const targetDir = join$1(baseDirectory, topDir);
    if (!existsSync$1(targetDir)) continue;
    walkDirectory(targetDir, (filePath) => {
      if (filePath.toLowerCase().endsWith("/readme.md")) {
        files.push(filePath);
      }
    });
  }
  const instructionsDir = join$1(baseDirectory, ".github", "instructions");
  if (existsSync$1(instructionsDir)) {
    walkDirectory(instructionsDir, (filePath) => {
      if (filePath.endsWith(".md")) {
        files.push(filePath);
      }
    });
  }
  const skillsDir = join$1(baseDirectory, ".github", "skills");
  if (existsSync$1(skillsDir)) {
    walkDirectory(skillsDir, (filePath) => {
      if (filePath.toLowerCase().endsWith("/skill.md")) {
        files.push(filePath);
      }
    });
  }
  const agentSkillsDir = join$1(baseDirectory, ".agents", "skills");
  if (existsSync$1(agentSkillsDir)) {
    walkDirectory(agentSkillsDir, (filePath) => {
      if (filePath.toLowerCase().endsWith("/skill.md")) {
        files.push(filePath);
      }
    });
  }
  const unique = Array.from(new Set(files));
  return unique.map((absPath) => ({
    absPath,
    relPath: relative(baseDirectory, absPath)
  }));
}
function buildManifest(docFiles) {
  return docFiles.map(({ absPath, relPath }) => {
    let title = null;
    try {
      const content = readFileSync(absPath, "utf8");
      title = extractTitle(content);
    } catch {
    }
    return { relPath, title };
  });
}
function formatManifest(entries, baseDirectory) {
  const groups = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    const parts = entry.relPath.split("/");
    const group = parts.length > 1 ? parts[0] : entry.relPath === "README.md" ? "Root" : parts[0];
    const groupKey = group.charAt(0).toUpperCase() + group.slice(1);
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey).push(entry);
  }
  const lines = [
    `<system-reminder>`,
    `Repository documentation index for ${baseDirectory}:`,
    ``
  ];
  for (const [groupName, groupEntries] of groups) {
    lines.push(`${groupName}:`);
    for (const entry of groupEntries) {
      const titleSuffix = entry.title ? ` — ${entry.title}` : "";
      lines.push(`  - ${entry.relPath}${titleSuffix}`);
    }
    lines.push("");
  }
  lines.push("Use the Read tool to access any of these files when needed.");
  lines.push("Use the find_repo_docs tool to search docs by query.");
  lines.push("</system-reminder>");
  return lines.join("\n");
}
function tokenize(input) {
  const raw = String(input || "").toLowerCase().split(/[^a-z0-9@._/-]+/g).filter(Boolean);
  const filtered = raw.filter((t) => !STOP_WORDS$1.has(t));
  return filtered.length > 0 ? filtered : raw;
}
function countMatches(text, token, cap = 3) {
  let idx = 0;
  let count = 0;
  while (count < cap) {
    idx = text.indexOf(token, idx);
    if (idx === -1) break;
    count += 1;
    idx += token.length || 1;
  }
  return count;
}
const DIR_TOKEN_MAP = [
  {
    dir: "/standards/",
    weight: 4,
    related: [
      "best",
      "practices",
      "practice",
      "standard",
      "standards",
      "convention",
      "rule",
      "policy",
      "guideline",
      "guidelines"
    ]
  },
  {
    dir: "/guides/",
    weight: 2,
    related: [
      "best",
      "practices",
      "practice",
      "guide",
      "guides",
      "tutorial",
      "setup",
      "walkthrough"
    ]
  },
  {
    dir: "/instructions/",
    weight: 3,
    related: [
      "instruction",
      "instructions",
      "rule",
      "rules",
      "policy",
      "agent",
      "behavior"
    ]
  },
  {
    dir: "/skills/",
    weight: 3,
    related: ["skill", "skills", "workflow", "pattern", "automation"]
  },
  {
    dir: "/patterns/",
    weight: 3,
    related: ["pattern", "patterns", "architecture", "component", "design"]
  }
];
async function searchDocs(query, baseDirectory, limit = 8) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];
  const tokens = tokenize(trimmedQuery);
  if (tokens.length === 0) return [];
  const docFiles = discoverDocs(baseDirectory);
  const results = [];
  for (const { absPath, relPath } of docFiles) {
    let fileStat;
    try {
      fileStat = statSync$1(absPath);
    } catch {
      continue;
    }
    if (!fileStat.isFile() || fileStat.size > DOC_MAX_FILE_SIZE) continue;
    let content;
    try {
      content = readFileSync(absPath, "utf8");
    } catch {
      continue;
    }
    const lowerContent = content.toLowerCase();
    const lowerPath = relPath.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (lowerPath.includes(token)) {
        score += 4;
      }
      score += Math.min(countMatches(lowerContent, token, 3), 3);
    }
    if (score <= 0) continue;
    const lines = content.split(/\r?\n/g);
    const titleLine = lines.find((l) => /^#\s/.test(l));
    if (titleLine) {
      const lowerTitle = titleLine.toLowerCase();
      for (const token of tokens) {
        if (lowerTitle.includes(token)) score += 3;
      }
    }
    for (const { dir, weight, related } of DIR_TOKEN_MAP) {
      if (lowerPath.includes(dir)) {
        for (const token of tokens) {
          if (related.includes(token)) score += weight;
        }
        break;
      }
    }
    let snippet = "";
    let lineNumber = 0;
    for (let i = 0; i < lines.length; i++) {
      const lowerLine = lines[i].toLowerCase();
      if (tokens.some((token) => lowerLine.includes(token))) {
        lineNumber = i + 1;
        snippet = lines[i].trim();
        break;
      }
    }
    results.push({ path: relPath, score, lineNumber, snippet });
  }
  results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return results.slice(0, limit);
}
const MAX_QUERY_DISPLAY_CHARS = 80;
function truncateQueryDisplay(query) {
  const firstLine = query.split("\n")[0].trim();
  if (firstLine.length <= MAX_QUERY_DISPLAY_CHARS) return firstLine;
  return `${firstLine.slice(0, MAX_QUERY_DISPLAY_CHARS)}…`;
}
function formatSearchResults(results, query) {
  const displayQuery = truncateQueryDisplay(query);
  if (results.length === 0) {
    return `No doc matches found for "${displayQuery}".`;
  }
  const lines = [`Top doc matches for "${displayQuery}":`];
  results.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.path} (score: ${item.score})`);
    if (item.snippet) {
      const prefix = item.lineNumber > 0 ? `   L${item.lineNumber}: ` : "   ";
      lines.push(`${prefix}${item.snippet}`);
    }
  });
  return lines.join("\n");
}
async function initDocContext(baseDirectory, openCodeSessionId, openCodePort, connectionId, getWindow) {
  const sendStatus = (status, type = "info") => {
    if (connectionId && getWindow) {
      getWindow()?.webContents.send("session-status-update", {
        connectionId,
        status,
        type,
        providerSessionId: openCodeSessionId ?? null
      });
    }
  };
  try {
    const docFiles = discoverDocs(baseDirectory);
    if (docFiles.length === 0) {
      console.log(
        `[doc-context] no docs found in ${baseDirectory}, skipping injection`
      );
      sendStatus("No repo docs found", "info");
      return;
    }
    const manifest = buildManifest(docFiles);
    const manifestText = formatManifest(manifest, baseDirectory);
    console.log(
      `[doc-context] found ${docFiles.length} docs in ${baseDirectory}, injecting manifest`
    );
    sendStatus(
      `Indexed ${docFiles.length} docs, injecting manifest…`,
      "working"
    );
    const result = await injectOpenCodeMessage(
      openCodeSessionId,
      manifestText,
      void 0,
      openCodePort
    );
    if (!result.ok) {
      console.error(`[doc-context] manifest injection failed: ${result.error}`);
      sendStatus(`Doc manifest injection failed: ${result.error}`, "error");
    } else {
      sendStatus(
        `${docFiles.length} docs indexed and manifest injected`,
        "success"
      );
    }
  } catch (err) {
    console.error(
      "[doc-context] initDocContext failed:",
      err instanceof Error ? err.message : err
    );
    sendStatus("Doc indexing failed", "error");
  }
}
function stripJsonComments(text) {
  let result = "";
  let inString = false;
  let escaped = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (escaped) {
      result += ch;
      escaped = false;
      i++;
      continue;
    }
    if (ch === "\\" && inString) {
      result += ch;
      escaped = true;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
      i++;
      continue;
    }
    if (!inString) {
      if (ch === "/" && next === "/") {
        while (i < text.length && text[i] !== "\n") i++;
        continue;
      }
      if (ch === "/" && next === "*") {
        i += 2;
        while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
          i++;
        }
        i += 2;
        continue;
      }
    }
    result += ch;
    i++;
  }
  return result;
}
const GLOBAL_OPENCODE_SEGMENTS = [".config", "opencode"];
const PROJECT_OPENCODE_SEGMENT = ".opencode";
const AGENT_SEGMENT = "agent";
const CONFIG_FILE = "opencode.json";
const CONFIG_FILE_JSONC = "opencode.jsonc";
function getGlobalOpencodeDir() {
  return join(homedir(), ...GLOBAL_OPENCODE_SEGMENTS);
}
function getProjectOpencodeDir(baseDirectory) {
  return join(baseDirectory, PROJECT_OPENCODE_SEGMENT);
}
function getGlobalAgentDir() {
  return join(getGlobalOpencodeDir(), AGENT_SEGMENT);
}
function getProjectAgentDir(baseDirectory) {
  return join(getProjectOpencodeDir(baseDirectory), AGENT_SEGMENT);
}
function getGlobalOpencodeConfigPath() {
  return join(getGlobalOpencodeDir(), CONFIG_FILE);
}
function getProjectOpencodeConfigPath(baseDirectory, variant = "jsonc") {
  return join(
    getProjectOpencodeDir(baseDirectory),
    variant === "jsonc" ? CONFIG_FILE_JSONC : CONFIG_FILE
  );
}
async function updateSessionTreeAfterRegistration(options) {
  if (!options.supportsSessionHierarchy) {
    return;
  }
  invalidateSessionTree();
}
function startStartupContextInjection(options) {
  if (options.supportsProviderInjection && options.openCodeSessionId) {
    sendSessionStatus(
      options.getWindow(),
      options.openCodeSessionId,
      "Injecting startup context into OpenCode session…",
      "working"
    );
    void (async () => {
      const injectionResult = await injectOpenCodeMessage(
        options.openCodeSessionId,
        options.startupContextMessage,
        // user message body — `<system-reminder>` block
        void 0,
        options.getOpenCodePort(),
        void 0,
        // mcpServerPort
        true,
        // noReply — context drop, don't trigger an agent reply
        void 0,
        // modelOverride
        void 0
        // systemMessage — intentionally unused; see comment above
      );
      if (injectionResult.ok) {
        sendSessionStatus(
          options.getWindow(),
          options.openCodeSessionId,
          "Startup context injected into OpenCode session",
          "success"
        );
        return;
      }
      sendSessionStatus(
        options.getWindow(),
        options.openCodeSessionId,
        `Startup context injection failed: ${injectionResult.error ?? "unknown error"}`,
        "error"
      );
    })();
    return;
  }
  sendSessionStatus(
    options.getWindow(),
    options.openCodeSessionId,
    `Startup context prepared (${options.backendName} mode)`,
    "info"
  );
  if (!options.runtime || options.runtime.available) {
    return;
  }
  sendSessionStatus(
    options.getWindow(),
    options.openCodeSessionId,
    options.runtime.message,
    "error"
  );
}
const REGISTER_CONNECTION_TIMEOUT_MS = 15e3;
const REGISTER_CONNECTION_TIMEOUT_MESSAGE = "register_connection timed out after 15s";
function ensureRegisterConnectionTimeRemaining(startedAt) {
  const elapsed = Date.now() - startedAt;
  const remaining = REGISTER_CONNECTION_TIMEOUT_MS - elapsed;
  if (remaining <= 0) {
    throw new Error(REGISTER_CONNECTION_TIMEOUT_MESSAGE);
  }
  return remaining;
}
async function withRegisterConnectionDeadline(promise, startedAt) {
  const remaining = ensureRegisterConnectionTimeRemaining(startedAt);
  return await new Promise((resolve2, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(REGISTER_CONNECTION_TIMEOUT_MESSAGE));
    }, remaining);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve2(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
function isRegisterConnectionTimeoutError(error) {
  return error instanceof Error && error.message === REGISTER_CONNECTION_TIMEOUT_MESSAGE;
}
const REGISTER_CONNECTION_TOOL_DESCRIPTION = `<description>
Register this agent as a named connection in the Interactive MCP Desktop app.
Call this tool once at the start of every session to establish a persistent, human-readable channel.
After registration, your channel will appear in the app's sidebar with the given name.
</description>

<importantNotes>
- (!important!) Call this tool at the start of each session before using other tools.
- (!important!) If a user deletes your session from the app, call this tool again to re-establish the connection.
- (!important!) Other tools will return an error with instructions to call register_connection if your session has been removed.
- (!important!) The connectionId returned by this tool is automatically used by all other tools.
- (!important!) Use clear, human-readable channelName values so channels are easy to distinguish in the sidebar.
- (!important!) For spawned/parallel subagents, use a unique task label (for example "Research Agent A", "Research Agent B") to avoid duplicate names.
- (!important!) If you pass baseDirectory and omit openCodeSessionId, the desktop app will auto-detect your active session for context injection — this is the correct path for the main agent.
- (!important!) If you are a subagent spawned via the Task tool, your openCodeSessionId was automatically injected into your context via a <system-reminder> message before your first tool call. Use that value as openCodeSessionId here.
- (!important!) SESSION_ALREADY_CLAIMED errors no longer occur. If you see one in old context, ignore it — call register_connection with your openCodeSessionId directly.
- (!important!) This tool has a hard 15-second deadline; if registration does not complete in time, it fails so callers can retry cleanly.
</importantNotes>

<whenToUseThisTool>
- At the very start of each agent session (first tool call)
- After receiving an error message instructing you to re-register
- When resuming work after a long pause and you're unsure if the session is still active
</whenToUseThisTool>

<parameters>
- channelName: Human-readable name for this agent shown in the channel sidebar. Prefer unique names per active agent/session (especially for spawned subagents) to avoid channel-name collisions.
- projectName: Name of the project or workspace this agent is working in.
- baseDirectory: Absolute path to the working directory / repository root (optional but recommended for file autocomplete).
- openCodeSessionId: Your own OpenCode session ID (optional). Pass this explicitly when you know it (e.g. as a subagent). Takes precedence over auto-detection. Enables the desktop app to inject context directly into your session.
</parameters>

<examples>
- { "channelName": "<Task name>", "projectName": "my-project", "baseDirectory": "/Users/me/projects/my-project", "openCodeSessionId": "ses_abc123" }
- { "channelName": "Agent <Task name>", "projectName": "my-project", "baseDirectory": "/Users/me/projects/my-project" }
- { "channelName": "Research <Task name> Agent", "projectName": "literature-review" }
- { "channelName": "Research <Task name> Agent A", "projectName": "my-project", "baseDirectory": "/Users/me/projects/my-project", "openCodeSessionId": "ses_abc123" }
- { "channelName": "Research <Task name> Agent B", "projectName": "my-project", "baseDirectory": "/Users/me/projects/my-project", "openCodeSessionId": "ses_def456" }
</examples>`;
function buildStartupContextMessage(params) {
  const {
    channelName,
    projectName,
    baseDirectory,
    openCodeSessionId,
    entries,
    sessionOptInNames,
    sessionMutedNames
  } = params;
  const optIn = new Set(sessionOptInNames ?? []);
  const muted = new Set(sessionMutedNames ?? []);
  const locationLine = baseDirectory ? `- Base directory: ${baseDirectory}` : "- Base directory: not provided";
  const lines = [];
  lines.push("<system-reminder>");
  lines.push("Interactive MCP Desktop session bootstrap:");
  lines.push(`- Registered agent: ${channelName}`);
  lines.push(`- Project: ${projectName}`);
  lines.push(locationLine);
  if (openCodeSessionId) {
    lines.push(`- OpenCode session ID: ${openCodeSessionId}`);
    lines.push(
      "- Pass this as openCodeSessionId when calling any interactive-desktop MCP tool."
    );
  }
  lines.push(
    "- Prompting policy: use interactive prompt tools for user questions.",
    "- Timeout policy: if a prompt times out or returns a timeout error (including -32001), re-prompt immediately.",
    `- Stop phrases (exact match): "Stop prompting", "End session", "Don't ask anymore", "Close conversation".`,
    "- Parallel subagents should use unique agent names to avoid sidebar name collisions."
  );
  const enabled = entries.filter(
    (e) => e.enabled && (e.scope === "global" && !muted.has(e.name) || e.scope === "session-scoped" && optIn.has(e.name))
  );
  const skills = enabled.filter((e) => e.type === "skill");
  const instructions = enabled.filter((e) => e.type === "instruction");
  if (skills.length > 0) {
    lines.push("");
    lines.push('<available_skills source="db">');
    for (const skill of skills) {
      lines.push("  <skill>");
      lines.push(`    <name>${skill.name}</name>`);
      lines.push(`    <description>${skill.description}</description>`);
      lines.push("    <source>db</source>");
      lines.push("  </skill>");
    }
    lines.push("</available_skills>");
  }
  if (instructions.length > 0) {
    lines.push("");
    lines.push('<instructions source="db">');
    for (const instruction of instructions) {
      lines.push("  <instruction>");
      lines.push(`    <name>${instruction.name}</name>`);
      lines.push(`    <description>${instruction.description}</description>`);
      lines.push("    <content>");
      lines.push(instruction.content);
      lines.push("    </content>");
      lines.push("  </instruction>");
    }
    lines.push("</instructions>");
  }
  if (skills.length > 0) {
    lines.push("");
    lines.push(
      'Use the manage_skills_and_instructions tool with action "get" to retrieve the full content of any skill by name.'
    );
  }
  lines.push("</system-reminder>");
  return lines.join("\n");
}
function buildSkillsChangedReminder(params) {
  const { action, type, name } = params;
  return [
    "<system-reminder>",
    `A DB-stored ${type} was ${action}: ${name}.`,
    'The latest list is available via the manage_skills_and_instructions tool with action "list".',
    type === "skill" ? 'Use action "get" with the skill name to fetch its full content on demand.' : "Updated instruction content will be re-injected on the next session bootstrap.",
    "</system-reminder>"
  ].join("\n");
}
function buildSessionScopeChangedReminder(params) {
  const { added, removed } = params;
  const lines = ["<system-reminder>"];
  lines.push(
    "Session-scoped skills/instructions selection changed for this session."
  );
  if (added.length > 0) {
    lines.push("Added (now active for this session):");
    for (const e of added) {
      lines.push(`- ${e.type}: ${e.name}`);
    }
  }
  if (removed.length > 0) {
    lines.push("Removed (no longer active for this session):");
    for (const e of removed) {
      lines.push(`- ${e.type}: ${e.name}`);
    }
  }
  lines.push(
    'The full current list is available via the manage_skills_and_instructions tool with action "list".',
    'Use action "get" with a skill name to fetch its full content on demand.',
    "</system-reminder>"
  );
  return lines.join("\n");
}
function registerConnectionTool(server, getWindow, connectionId, getOpenCodePort, getDocIndexingEnabled, getAgentBackend, getDetectedProvider, onRegistered) {
  server.registerTool(
    "register_connection",
    {
      description: REGISTER_CONNECTION_TOOL_DESCRIPTION,
      title: "Register this agent as a named connection",
      inputSchema: {
        channelName: z.string().describe(
          "Human-readable name for this agent shown in the channel sidebar"
        ),
        projectName: z.string().describe(
          "Name of the project or workspace this agent is working in"
        ),
        baseDirectory: z.string().optional().describe(
          "Absolute path to the working directory / repository root (optional)"
        ),
        openCodeSessionId: z.string().optional().describe(
          "Your own OpenCode session ID (optional). Pass explicitly as a subagent to ensure correct session targeting."
        )
      }
    },
    async ({
      channelName,
      projectName,
      baseDirectory,
      openCodeSessionId: explicitSessionId
    }) => {
      const startedAt = Date.now();
      const backend = await getBackendAdapter(getAgentBackend());
      const detectedProvider = getDetectedProvider();
      let openCodeSessionId = explicitSessionId ?? null;
      let parentSessionId = null;
      if (!backend.supportsProviderInjection) {
        openCodeSessionId = null;
      }
      if (backend.backend === "claude_sdk" && backend.runtime?.available) {
        sendSessionStatus(
          getWindow(),
          openCodeSessionId,
          "Claude SDK backend active (session injection adapter scaffolded)",
          "info"
        );
      }
      if (backend.supportsProviderInjection && !openCodeSessionId && baseDirectory) {
        const detected = await withRegisterConnectionDeadline(
          autoDetectOpenCodeSession(getOpenCodePort(), baseDirectory),
          startedAt
        );
        if (detected) {
          openCodeSessionId = detected.id;
          parentSessionId = detected.parentId;
        }
      } else if (backend.supportsProviderInjection && openCodeSessionId) {
        try {
          const session2 = await withRegisterConnectionDeadline(
            fetchOpenCodeSession(
              getOpenCodePort(),
              openCodeSessionId,
              baseDirectory
            ),
            startedAt
          );
          if (session2) {
            parentSessionId = session2.parentID ?? null;
          }
        } catch (error) {
          if (isRegisterConnectionTimeoutError(error)) {
            throw error;
          }
        }
      }
      ensureRegisterConnectionTimeRemaining(startedAt);
      const effectiveSessionId = openCodeSessionId ?? connectionId;
      const effectiveProviderType = openCodeSessionId ? "opencode" : detectedProvider;
      const idFilePath = upsertRegisteredConnection({
        providerSessionId: effectiveSessionId,
        providerType: effectiveProviderType,
        connectionId,
        channelName,
        projectName,
        baseDirectory,
        parentSessionId: parentSessionId ?? void 0
      });
      createSessionChannel(connectionId, channelName);
      void onRegistered?.({
        connectionId,
        channelName,
        openCodeSessionId
      });
      void updateSessionTreeAfterRegistration({
        supportsProviderInjection: backend.supportsProviderInjection,
        supportsSessionHierarchy: backend.supportsSessionHierarchy
      });
      if (backend.supportsProviderInjection && baseDirectory && openCodeSessionId && getDocIndexingEnabled()) {
        void initDocContext(
          baseDirectory,
          openCodeSessionId,
          getOpenCodePort(),
          connectionId,
          getWindow
        );
      }
      if (backend.supportsProviderInjection && baseDirectory) {
        sendSessionStatus(
          getWindow(),
          openCodeSessionId,
          "Using OpenCode workspace MCP config for this session",
          "info"
        );
      }
      const sessionOptInNames = openCodeSessionId ? listSessionScopedEntryNames("opencode", openCodeSessionId) : [];
      const startupContextMessage = buildStartupContextMessage({
        channelName,
        projectName,
        baseDirectory,
        openCodeSessionId: openCodeSessionId ?? void 0,
        entries: listSkillsAndInstructions(),
        sessionOptInNames
      });
      startStartupContextInjection({
        getWindow,
        connectionId,
        openCodeSessionId,
        startupContextMessage,
        getOpenCodePort,
        backendName: backend.backend,
        runtime: backend.runtime,
        supportsProviderInjection: backend.supportsProviderInjection
      });
      const toolResultContent = [
        {
          type: "text",
          text: JSON.stringify({
            ok: true,
            connectionId,
            channelName,
            projectName,
            baseDirectory: baseDirectory ?? null,
            openCodeSessionId: openCodeSessionId ?? null,
            parentSessionId: parentSessionId ?? null,
            idFilePath,
            message: `Connection registered successfully. Your channel "${channelName}" is now visible in the Interactive MCP Desktop app. Use your connectionId (${connectionId}) with other tools. Your connection ID is also saved to ${idFilePath} for recovery after restarts.` + (openCodeSessionId ? ` OpenCode session "${openCodeSessionId}" detected — context messages from the desktop app will be injected directly into your session.` : "") + (parentSessionId ? ` Parent session: "${parentSessionId}".` : "")
          })
        }
      ];
      if (!openCodeSessionId) {
        toolResultContent.push({
          type: "text",
          text: startupContextMessage
        });
      }
      return { content: toolResultContent };
    }
  );
}
function registerFindRepoDocsTool(server, connectionId, requireSessionId = false) {
  server.registerTool(
    "find_repo_docs",
    {
      description: `Search repository documentation files by query. Uses keyword search to find the most relevant docs. Returns file paths, scores, and snippet previews. Use the Read tool to access the full content of any returned file.

This tool is only available when the agent registered with a baseDirectory via register_connection. If no baseDirectory was provided, the tool returns an error.

The search matches on path, content, title, and directory context, and ranks results by combined score.

IMPORTANT: You MUST pass your openCodeSessionId (format: ses_<alphanumeric>) with every call for correct routing.`,
      title: "Search repository documentation",
      inputSchema: {
        query: z.string().describe("Search query for repository docs and markdown files."),
        limit: z.number().int().min(1).max(20).optional().default(8).describe("Maximum number of matches to return (1-20, default 8)."),
        openCodeSessionId: z.string().optional().describe(
          "Your OpenCode session ID (format: ses_<alphanumeric>). Required for correct routing in multi-agent scenarios."
        )
      }
    },
    async ({ query, limit, openCodeSessionId }) => {
      const providerSessionId = resolveProviderSessionId(
        connectionId,
        openCodeSessionId
      );
      const staleError = providerSessionId ? staleSessionError(providerSessionId) : null;
      if (staleError) return staleError;
      const missingParamErr = requireProviderSessionId(
        providerSessionId,
        requireSessionId
      );
      if (missingParamErr) return missingParamErr;
      const connection = providerSessionId ? getRegisteredConnectionBySessionId(providerSessionId) : getRegisteredConnection(connectionId);
      if (!connection?.baseDirectory) {
        return {
          content: [
            {
              type: "text",
              text: "Error: No baseDirectory registered for this connection. Call register_connection with a baseDirectory first."
            }
          ]
        };
      }
      const results = await searchDocs(
        query,
        connection.baseDirectory,
        limit ?? 8
      );
      const text = formatSearchResults(results, query);
      return {
        content: [{ type: "text", text }]
      };
    }
  );
}
const broadcastLog = createLogger("skills-broadcast");
function pickReminderTargets(connections) {
  const seen = /* @__PURE__ */ new Set();
  const targets = [];
  for (const c of connections) {
    if (c.providerType !== "opencode") continue;
    if (!c.providerSessionId) continue;
    if (seen.has(c.providerSessionId)) continue;
    seen.add(c.providerSessionId);
    targets.push({ providerSessionId: c.providerSessionId });
  }
  return targets;
}
function broadcastSkillsChanged(action, type, name, port) {
  try {
    const connections = getRegisteredConnectionsByProvider("opencode");
    const targets = pickReminderTargets(connections);
    if (targets.length === 0) return;
    const reminder = buildSkillsChangedReminder({ action, type, name });
    for (const target of targets) {
      void injectOpenCodeMessage(
        target.providerSessionId,
        reminder,
        void 0,
        port,
        void 0,
        true,
        // noReply
        void 0,
        void 0
      ).catch((err) => {
        broadcastLog.warn(
          `failed to inject skills-changed reminder into session ${target.providerSessionId}: ${err instanceof Error ? err.message : String(err)}`
        );
      });
    }
  } catch (err) {
    broadcastLog.warn(
      `broadcastSkillsChanged failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
function broadcastSessionScopeChanged(providerType, providerSessionId, diff, port) {
  if (providerType !== "opencode") return;
  if (!providerSessionId) return;
  if (diff.added.length === 0 && diff.removed.length === 0) return;
  try {
    const reminder = buildSessionScopeChangedReminder(diff);
    void injectOpenCodeMessage(
      providerSessionId,
      reminder,
      void 0,
      port,
      void 0,
      true,
      // noReply
      void 0,
      void 0
    ).catch((err) => {
      broadcastLog.warn(
        `failed to inject session-scope-changed reminder into session ${providerSessionId}: ${err instanceof Error ? err.message : String(err)}`
      );
    });
  } catch (err) {
    broadcastLog.warn(
      `broadcastSessionScopeChanged failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
function registerManageSkillsAndInstructionsTool(server, getWindow, connectionId, getOpenCodePort) {
  server.registerTool(
    "manage_skills_and_instructions",
    {
      description: `<description>
Manage skills and instructions stored in the Interactive MCP Desktop app.
Skills and instructions are persistent knowledge entries that are automatically injected into every new agent session on registration, making the MCP server self-documenting.
Use this tool to register, list, retrieve, or delete skills and instructions.
</description>

<importantNotes>
- (!important!) Skills and instructions are persisted across app restarts — they are stored in the local database.
- (!important!) ALL registered skills and instructions are automatically injected into agent sessions when they call register_connection, so agents always have access to them.
- (!important!) Use "skill" type for reusable workflows, patterns, or automation recipes.
- (!important!) Use "instruction" type for behavioral rules, policies, or guidelines that agents should follow.
- (!important!) Names must be unique. Registering with an existing name will update that entry.
- (!important!) Content supports full Markdown formatting.
</importantNotes>

<whenToUseThisTool>
- When you want to store reusable knowledge that should be available to all agent sessions
- When you want to register the MCP server's own usage instructions as a plugin
- When you need to embed workflow recipes, coding standards, or project-specific instructions
- When you want to list or retrieve previously registered skills and instructions
- When you want to remove outdated skills or instructions
</whenToUseThisTool>

<actions>
- "register": Create or update a skill/instruction. Requires: name, type, description, content.
- "list": List all registered skills and instructions (optionally filtered by type). Returns names, types, and descriptions.
- "get": Retrieve the full content of a specific skill or instruction by name. Requires: name.
- "delete": Remove a skill or instruction by name. Requires: name.
</actions>

<parameters>
- action: The operation to perform — "register", "list", "get", or "delete"
- name: Name/identifier for the skill or instruction (required for register, get, delete)
- type: Either "skill" or "instruction" (required for register)
- description: Short summary of what the skill/instruction does (required for register)
- content: Full Markdown content body (required for register)
- filterType: Optional filter for list action — "skill" or "instruction"
</parameters>

<examples>
- Register a skill: { "action": "register", "name": "code-review", "type": "skill", "description": "Step-by-step code review workflow", "content": "# Code Review\\n\\n1. Check for..." }
- Register an instruction: { "action": "register", "name": "typescript-rules", "type": "instruction", "description": "TypeScript coding standards", "content": "# TypeScript Rules\\n\\n- No any types..." }
- List all: { "action": "list" }
- List only skills: { "action": "list", "filterType": "skill" }
- Get one: { "action": "get", "name": "code-review" }
- Delete one: { "action": "delete", "name": "code-review" }
</examples>`,
      title: "Manage persistent skills and instructions",
      inputSchema: {
        action: z.enum(["register", "list", "get", "delete"]).describe("The operation to perform: register, list, get, or delete"),
        name: z.string().optional().describe(
          "Name/identifier for the skill or instruction (required for register, get, delete)"
        ),
        type: z.enum(["skill", "instruction"]).optional().describe(
          'Type of entry — "skill" or "instruction" (required for register)'
        ),
        description: z.string().optional().describe(
          "Short summary of what the skill/instruction does (required for register)"
        ),
        content: z.string().optional().describe("Full Markdown content body (required for register)"),
        category: z.string().optional().describe(
          'Category for organizing skills/instructions (e.g., "Code Review", "Testing", "Documentation")'
        ),
        tags: z.array(z.string()).optional().describe(
          'Tags for categorizing the entry (e.g., ["typescript", "react"])'
        ),
        filterType: z.enum(["skill", "instruction"]).optional().describe(
          'Optional filter for list action — show only "skill" or "instruction" entries'
        ),
        filterCategory: z.string().optional().describe("Optional category filter for list action")
      }
    },
    async ({
      action,
      name,
      type,
      description,
      content,
      category,
      tags,
      filterType,
      filterCategory
    }) => {
      const providerSessionId = resolveProviderSessionId(connectionId);
      const staleErr = providerSessionId ? staleSessionError(providerSessionId) : null;
      if (staleErr) return staleErr;
      switch (action) {
        case "register": {
          if (!name || !type || !description || !content) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    error: "MISSING_FIELDS",
                    message: 'The "register" action requires: name, type, description, and content.'
                  })
                }
              ]
            };
          }
          const preExisting = getSkillOrInstructionByName(name);
          const record = upsertSkillOrInstruction({
            name,
            type,
            description,
            content,
            category,
            tags
          });
          if (!record) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    error: "DB_ERROR",
                    message: "Failed to save the skill/instruction. Database may not be initialized."
                  })
                }
              ]
            };
          }
          getWindow()?.webContents.send("skills-updated");
          broadcastSkillsChanged(
            preExisting ? "updated" : "registered",
            record.type,
            record.name,
            getOpenCodePort()
          );
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: true,
                  action: preExisting ? "updated" : "registered",
                  entry: {
                    name: record.name,
                    type: record.type,
                    description: record.description,
                    category: record.category,
                    tags: record.tags,
                    createdAt: record.createdAt,
                    updatedAt: record.updatedAt
                  },
                  message: `Successfully registered ${record.type} "${record.name}". It will be automatically injected into all new agent sessions.`
                })
              }
            ]
          };
        }
        case "list": {
          const entries = listSkillsAndInstructions(filterType, filterCategory);
          const summary = entries.map((e) => ({
            name: e.name,
            type: e.type,
            description: e.description,
            category: e.category,
            tags: e.tags,
            updatedAt: e.updatedAt
          }));
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: true,
                  action: "list",
                  count: entries.length,
                  entries: summary,
                  filter: filterType ?? null
                })
              }
            ]
          };
        }
        case "get": {
          if (!name) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    error: "MISSING_NAME",
                    message: 'The "get" action requires a "name" parameter.'
                  })
                }
              ]
            };
          }
          const entry = getSkillOrInstructionByName(name);
          if (!entry) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    error: "NOT_FOUND",
                    message: `No skill or instruction found with name "${name}".`
                  })
                }
              ]
            };
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: true,
                  action: "get",
                  entry: {
                    name: entry.name,
                    type: entry.type,
                    description: entry.description,
                    createdAt: entry.createdAt,
                    updatedAt: entry.updatedAt
                  }
                })
              },
              {
                type: "text",
                text: entry.content
              }
            ]
          };
        }
        case "delete": {
          if (!name) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    error: "MISSING_NAME",
                    message: 'The "delete" action requires a "name" parameter.'
                  })
                }
              ]
            };
          }
          const existing = getSkillOrInstructionByName(name);
          const deleted = deleteSkillOrInstruction(name);
          if (deleted) {
            getWindow()?.webContents.send("skills-updated");
            if (existing) {
              broadcastSkillsChanged(
                "deleted",
                existing.type,
                name,
                getOpenCodePort()
              );
            }
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: true,
                  action: "delete",
                  name,
                  deleted,
                  message: deleted ? `Successfully deleted "${name}".` : `No entry found with name "${name}" — nothing was deleted.`
                })
              }
            ]
          };
        }
        default: {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "INVALID_ACTION",
                  message: `Unknown action "${String(action)}". Use one of: register, list, get, delete.`
                })
              }
            ]
          };
        }
      }
    }
  );
}
function registerPollContextInjectionsTool(server, connectionId, requireSessionId = false) {
  server.registerTool(
    "poll_context_injections",
    {
      description: `<description>
Check for pending context messages injected by the desktop app into this agent session.
Returns any queued system notifications (e.g. relevant repo docs, instructions) that the
desktop has prepared for you. Each injection is delivered exactly once and cleared on receipt.
</description>

<importantNotes>
- (!important!) Call this tool at the **start of every new user task** before acting on the request.
- (!important!) If any injections are returned, process them as system notifications before proceeding.
- (!important!) Injections are also auto-prepended to request_user_input responses — calling this
  tool explicitly ensures you have context before performing tool calls or producing output.
- (!important!) Returns an empty result immediately when no injections are pending — always safe to call.
- (!important!) You MUST pass your openCodeSessionId (format: ses_<alphanumeric>) with every call. It was injected into your context at session start.
</importantNotes>

<whenToUseThisTool>
- At the start of each new user task or request
- Before making decisions that may depend on repository-specific context
- After calling register_connection, to receive any startup context that was queued
</whenToUseThisTool>`,
      inputSchema: {
        openCodeSessionId: z.string().optional().describe(
          "Your OpenCode session ID (format: ses_<alphanumeric>). Required for correct routing in multi-agent scenarios."
        )
      }
    },
    ({ openCodeSessionId }) => {
      const providerSessionId = resolveProviderSessionId(
        connectionId,
        openCodeSessionId
      );
      const staleErr = providerSessionId ? staleSessionError(providerSessionId) : null;
      if (staleErr) return staleErr;
      const missingParamErr = requireProviderSessionId(
        providerSessionId,
        requireSessionId
      );
      if (missingParamErr) return missingParamErr;
      const injectionKey = providerSessionId ?? connectionId;
      const providerType = requireSessionId ? "opencode" : "standalone";
      const items = claimContextInjections(injectionKey, providerType);
      if (items.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                injections: [],
                message: "No pending context injections."
              })
            }
          ]
        };
      }
      const notifications = items.map(
        (item) => `<system_notification>
${item.payload}
</system_notification>`
      ).join("\n\n");
      return {
        content: [
          {
            type: "text",
            text: notifications
          }
        ]
      };
    }
  );
}
function isDefaultAgentName(name) {
  return /^Agent \d+$/.test(name);
}
function pickUnregisteredConnectionsForCleanup(entries, justRegistered) {
  return entries.filter((entry) => entry.connectionId !== justRegistered.connectionId).filter(
    (entry) => !entry.isRegistered && (isDefaultAgentName(entry.connectionName) || entry.connectionName === justRegistered.channelName)
  ).map((entry) => entry.connectionId);
}
const HIDDEN_TOOL_NAMES = /* @__PURE__ */ new Set([
  "register_connection",
  "poll_context_injections"
]);
function applyHiddenToolListFilter(server) {
  const rawServer = server.server;
  if (!rawServer?.setRequestHandler) {
    return;
  }
  server.server.setRequestHandler(ListToolsRequestSchema, async () => {
    const internalServer = server;
    const registeredTools = internalServer._registeredTools ?? {};
    const tools = Object.entries(registeredTools).filter(
      ([name, tool]) => tool.enabled !== false && !HIDDEN_TOOL_NAMES.has(name)
    ).map(([name, tool]) => ({
      name,
      title: tool.title,
      description: tool.description,
      inputSchema: { type: "object" },
      annotations: tool.annotations,
      execution: tool.execution,
      _meta: tool._meta
    }));
    return { tools };
  });
}
function createMcpServerWithTools(getWindow, connectionId, connectionName, getOpenCodePort, getDocIndexingEnabled, getAgentBackend, getSessionEntries, cleanupConnection, requestHeaders) {
  const server = new McpServer(
    { name: "Interactive MCP Desktop", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );
  const requireSessionId = getAgentBackend() === "opencode";
  const detectedProvider = getEffectiveProvider(
    getAgentBackend(),
    requestHeaders
  );
  const getDetectedProvider = () => detectedProvider;
  registerRequestUserInput(
    server,
    getWindow,
    promptUser,
    connectionId,
    connectionName,
    requireSessionId
  );
  registerIntensiveChatTools(
    server,
    getWindow,
    promptUser,
    connectionId,
    connectionName,
    requireSessionId
  );
  registerSessionChannelTools(
    server,
    getWindow,
    connectionId,
    requireSessionId
  );
  registerSendMessageTool(server, getWindow, connectionId, requireSessionId);
  registerConnectionTool(
    server,
    getWindow,
    connectionId,
    getOpenCodePort,
    getDocIndexingEnabled,
    getAgentBackend,
    getDetectedProvider,
    async ({
      connectionId: registeredConnectionId,
      channelName,
      openCodeSessionId
    }) => {
      const toCleanup = pickUnregisteredConnectionsForCleanup(
        getSessionEntries(),
        { connectionId: registeredConnectionId, channelName }
      );
      for (const staleConnectionId of toCleanup) {
        await cleanupConnection(staleConnectionId);
      }
      getWindow()?.webContents.send("channel-label-updated", {
        connectionId: registeredConnectionId,
        name: channelName,
        providerSessionId: openCodeSessionId ?? null
      });
    }
  );
  registerFindRepoDocsTool(server, connectionId, requireSessionId);
  registerManageSkillsAndInstructionsTool(
    server,
    getWindow,
    connectionId,
    getOpenCodePort
  );
  registerPollContextInjectionsTool(server, connectionId, requireSessionId);
  applyHiddenToolListFilter(server);
  return server;
}
function createNoopResponse() {
  const obj = {
    setHeader() {
      return obj;
    },
    getHeader() {
      return void 0;
    },
    getHeaders() {
      return {};
    },
    removeHeader() {
    },
    writeHead() {
      return obj;
    },
    flushHeaders() {
    },
    status() {
      return obj;
    },
    json() {
    },
    end() {
      return obj;
    },
    write() {
      return true;
    },
    destroy() {
    },
    on() {
      return obj;
    },
    once() {
      return obj;
    },
    off() {
      return obj;
    },
    emit() {
      return true;
    },
    headersSent: false,
    writableEnded: false,
    writableFinished: false
  };
  return obj;
}
const log$6 = createLogger("db-context-injection");
const injectedSessionIds = /* @__PURE__ */ new Set();
function decideShouldInjectDbContext(params) {
  const { openCodeSessionId, alreadyInjected, enabledEntryCount } = params;
  if (!openCodeSessionId) {
    return { shouldInject: false, reason: "no-session-id" };
  }
  if (alreadyInjected.has(openCodeSessionId)) {
    return { shouldInject: false, reason: "already-injected-this-process" };
  }
  if (enabledEntryCount === 0) {
    return { shouldInject: false, reason: "no-enabled-entries" };
  }
  return { shouldInject: true, reason: "inject" };
}
function maybeInjectDbContextOnConnect(options) {
  const list = options._listEntries ?? listSkillsAndInstructions;
  const listOptIns = options._listSessionOptIns ?? listSessionScopedEntryNames;
  const listMutes = options._listSessionMutes ?? listSessionMutedEntryNames;
  const build = options._buildMessage ?? buildStartupContextMessage;
  const start = options._startInjection ?? startStartupContextInjection;
  let enabled;
  try {
    enabled = list().filter((e) => e.enabled);
  } catch (err) {
    log$6.warn(
      `failed to list DB skills/instructions for session ${options.openCodeSessionId ?? "(none)"}: ${err instanceof Error ? err.message : String(err)}`
    );
    return;
  }
  let sessionOptInNames = [];
  let sessionMutedNames = [];
  if (options.openCodeSessionId) {
    try {
      sessionOptInNames = listOptIns("opencode", options.openCodeSessionId);
    } catch (err) {
      log$6.warn(
        `failed to list session-scoped opt-ins for session ${options.openCodeSessionId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    try {
      sessionMutedNames = listMutes("opencode", options.openCodeSessionId);
    } catch (err) {
      log$6.warn(
        `failed to list session-muted globals for session ${options.openCodeSessionId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  const optInSet = new Set(sessionOptInNames);
  const mutedSet = new Set(sessionMutedNames);
  const effective = enabled.filter(
    (e) => e.scope === "global" && !mutedSet.has(e.name) || e.scope === "session-scoped" && optInSet.has(e.name)
  );
  const decision = decideShouldInjectDbContext({
    openCodeSessionId: options.openCodeSessionId,
    alreadyInjected: injectedSessionIds,
    enabledEntryCount: effective.length
  });
  if (!decision.shouldInject) {
    log$6.info(
      `skipping DB context injection for session ${options.openCodeSessionId ?? "(none)"}: ${decision.reason}`
    );
    return;
  }
  const sessionId = options.openCodeSessionId;
  injectedSessionIds.add(sessionId);
  log$6.info(
    `injecting DB context (${effective.length} of ${enabled.length} entries; ${sessionOptInNames.length} opt-ins, ${sessionMutedNames.length} mutes) into session ${sessionId} on auto-register`
  );
  let message;
  try {
    message = build({
      channelName: options.channelName,
      projectName: options.projectName,
      baseDirectory: options.baseDirectory ?? void 0,
      openCodeSessionId: sessionId,
      entries: enabled,
      sessionOptInNames,
      sessionMutedNames
    });
  } catch (err) {
    injectedSessionIds.delete(sessionId);
    log$6.warn(
      `failed to build startup-context message for session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`
    );
    return;
  }
  try {
    start({
      getWindow: options.getWindow,
      connectionId: options.connectionId,
      openCodeSessionId: sessionId,
      startupContextMessage: message,
      getOpenCodePort: options.getOpenCodePort,
      backendName: "opencode",
      runtime: void 0,
      supportsProviderInjection: true
    });
  } catch (err) {
    injectedSessionIds.delete(sessionId);
    log$6.warn(
      `failed to start DB context injection for session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
function markDbContextInjected(openCodeSessionId) {
  if (!openCodeSessionId) {
    return;
  }
  injectedSessionIds.add(openCodeSessionId);
}
const log$5 = createLogger("mcp-auto-register");
const DEFAULT_MAIN_CHANNEL_NAME = "OpenCode - Main Channel";
async function autoRegisterDefaultConnection({
  connectionId,
  channelName,
  providerType,
  getWindow,
  getOpenCodePort,
  getAgentBackend,
  getSessionEntries,
  cleanupConnection
}) {
  const rawCwd = process.cwd();
  const baseDirectory = rawCwd === "/" || rawCwd === "" ? process.env.HOME ?? process.env.USERPROFILE ?? rawCwd : rawCwd;
  const projectName = basename(baseDirectory) || "project";
  const backend = getAgentBackend();
  const openCodeEnabled = backend === "opencode";
  const isMainChannel = channelName === DEFAULT_MAIN_CHANNEL_NAME;
  let detected = null;
  if (openCodeEnabled && isMainChannel) {
    try {
      detected = await autoDetectOpenCodeSession(
        getOpenCodePort(),
        baseDirectory
      );
    } catch {
    }
  }
  if (detected) {
    const existing = getRegisteredConnectionBySessionId(
      detected.id,
      "opencode"
    );
    log$5.info(
      `[bug2-trace] auto-register-mcp providerSessionId=${detected.id} connectionId=${connectionId} existing=${existing ? "yes" : "no"} parentId=${detected.parentId ?? "null"} ts=${Date.now()}`
    );
    if (existing) {
      updateConnectionId(detected.id, connectionId, "opencode");
      createSessionChannel(connectionId, channelName);
      invalidateSessionTree();
      maybeInjectDbContextOnConnect({
        openCodeSessionId: detected.id,
        channelName: existing.channelName ?? channelName,
        projectName: existing.projectName ?? projectName,
        baseDirectory: existing.baseDirectory ?? baseDirectory,
        connectionId,
        getWindow,
        getOpenCodePort
      });
      return;
    }
    upsertRegisteredConnection({
      providerSessionId: detected.id,
      providerType: "opencode",
      connectionId,
      channelName,
      projectName,
      baseDirectory,
      parentSessionId: detected.parentId ?? void 0
    });
    maybeInjectDbContextOnConnect({
      openCodeSessionId: detected.id,
      channelName,
      projectName,
      baseDirectory,
      connectionId,
      getWindow,
      getOpenCodePort
    });
  } else {
    upsertRegisteredConnection({
      providerSessionId: connectionId,
      providerType,
      connectionId,
      channelName,
      projectName,
      baseDirectory
    });
  }
  createSessionChannel(connectionId, channelName);
  const toCleanup = pickUnregisteredConnectionsForCleanup(getSessionEntries(), {
    connectionId,
    channelName
  });
  for (const staleConnectionId of toCleanup) {
    await cleanupConnection(staleConnectionId);
  }
  if (openCodeEnabled && detected) {
    invalidateSessionTree();
  } else {
    getWindow()?.webContents.send("connection-opened", {
      connectionId,
      name: channelName,
      sessionId: connectionId,
      label: channelName,
      providerType
    });
    if (openCodeEnabled) {
      invalidateSessionTree();
    }
  }
}
const mcpLog = createLogger("mcp");
let httpServer = null;
let _sessionCleanup = null;
let _clearAllSessions = null;
let _attachmentCleanupInterval = null;
let _startParams = null;
async function startMcpServer(port, getWindow, getSoundEnabled = () => true, getPromptTimeoutMs = () => 2e5, getOpenCodePort = () => 4096, getDocIndexingEnabled = () => true, getAgentBackend = () => "standalone") {
  _startParams = {
    port,
    getWindow,
    getSoundEnabled,
    getPromptTimeoutMs,
    getOpenCodePort,
    getDocIndexingEnabled,
    getAgentBackend
  };
  setSoundEnabled(getSoundEnabled);
  setPromptTimeout(getPromptTimeoutMs);
  const app2 = express();
  app2.use(express.json());
  const sessions = {};
  const findSessionByConnectionId = (connectionId) => {
    for (const [sid, entry] of Object.entries(sessions)) {
      if (entry.connectionId === connectionId) return sid;
    }
    return null;
  };
  const getSessionEntries = () => {
    const registeredConnections = getAllRegisteredConnections();
    const registeredByConnectionId = new Map(
      registeredConnections.filter(
        (rc) => rc.connectionId !== null
      ).map((rc) => [rc.connectionId, rc])
    );
    return Object.values(sessions).map((entry) => ({
      connectionId: entry.connectionId,
      connectionName: registeredByConnectionId.get(entry.connectionId)?.channelName ?? entry.connectionName,
      isRegistered: registeredByConnectionId.has(entry.connectionId)
    }));
  };
  _sessionCleanup = async (connectionId) => {
    const sid = findSessionByConnectionId(connectionId);
    if (!sid) return false;
    mcpLog.info(
      `Session cleanup: connectionId=${connectionId} sessionId=${sid}`
    );
    const session2 = sessions[sid];
    delete sessions[sid];
    try {
      await session2.server.close();
    } catch {
    }
    try {
      await session2.transport.close();
    } catch {
    }
    return true;
  };
  let connectionCounter = 0;
  let mainChannelAssignedInRuntime = false;
  _clearAllSessions = async () => {
    const entries = Object.entries(sessions);
    mcpLog.info(`Clearing all sessions: count=${entries.length}`);
    let cleared = 0;
    for (const [sid, entry] of entries) {
      delete sessions[sid];
      cancelActivePrompt(entry.connectionId);
      deleteSessionChannel(entry.connectionId);
      const entryConn = getRegisteredConnection(entry.connectionId);
      if (entryConn?.providerSessionId) {
        deleteContextInjectionsForSession(
          entryConn.providerSessionId,
          entry.providerType
        );
      }
      try {
        await entry.server.close();
      } catch {
      }
      try {
        await entry.transport.close();
      } catch {
      }
      getWindow()?.webContents.send("connection-closed", {
        connectionId: entry.connectionId
      });
      getWindow()?.webContents.send("session-channel-deleted", {
        sessionId: entry.connectionId
      });
      cleared++;
    }
    clearSessionFile();
    connectionCounter = 0;
    mainChannelAssignedInRuntime = false;
    return cleared;
  };
  const resolveConnectionName = () => {
    if (!mainChannelAssignedInRuntime) {
      mainChannelAssignedInRuntime = true;
      return DEFAULT_MAIN_CHANNEL_NAME;
    }
    return `Agent ${connectionCounter}`;
  };
  const buildAutoRegisterDeps = (connectionId, connectionName, providerType) => ({
    connectionId,
    channelName: connectionName,
    providerType,
    getWindow,
    getOpenCodePort,
    getAgentBackend,
    getSessionEntries,
    cleanupConnection: async (connId) => await _sessionCleanup?.(connId) ?? false
  });
  const buildServer = (connectionId, connectionName, requestHeaders) => createMcpServerWithTools(
    getWindow,
    connectionId,
    connectionName,
    getOpenCodePort,
    getDocIndexingEnabled,
    getAgentBackend,
    getSessionEntries,
    async (connId) => await _sessionCleanup?.(connId) ?? false,
    requestHeaders
  );
  const handleTransportClose = (sessionId) => {
    if (!sessionId || !sessions[sessionId]) return;
    const { connectionId: connId, providerType: pt } = sessions[sessionId];
    delete sessions[sessionId];
    deleteSessionChannel(connId);
    const closedConn = getRegisteredConnection(connId);
    if (closedConn?.providerSessionId) {
      deleteContextInjectionsForSession(closedConn.providerSessionId, pt);
    }
    clearSessionFile();
    getWindow()?.webContents.send("connection-closed", {
      connectionId: connId
    });
    getWindow()?.webContents.send("session-channel-deleted", {
      sessionId: connId
    });
  };
  async function handleTransparentReinit(req, res) {
    connectionCounter++;
    const connectionId = randomUUID();
    const connectionName = resolveConnectionName();
    const providerType = getEffectiveProvider(getAgentBackend(), req.headers);
    const server = buildServer(connectionId, connectionName, req.headers);
    let newSessionId;
    const transport = await new Promise(
      (resolve2) => {
        const t = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (id) => {
            newSessionId = id;
            sessions[id] = {
              transport: t,
              server,
              connectionId,
              connectionName,
              providerType
            };
            void autoRegisterDefaultConnection(
              buildAutoRegisterDeps(connectionId, connectionName, providerType)
            );
            writeSessionFile(connectionId, port, getPromptTimeoutMs());
            resolve2(t);
          }
        });
        t.onclose = () => {
          handleTransportClose(t.sessionId);
          server.close().catch(() => {
          });
        };
        const noopRes = createNoopResponse();
        const initBody = {
          jsonrpc: "2.0",
          id: 0,
          method: "initialize",
          params: {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "cli-reconnect", version: "1.0.0" }
          }
        };
        const fakeReq = {
          method: "POST",
          url: "/mcp",
          headers: { "content-type": "application/json" },
          rawHeaders: ["content-type", "application/json"],
          socket: { encrypted: false, remoteAddress: "127.0.0.1" },
          body: initBody,
          on() {
            return fakeReq;
          },
          once() {
            return fakeReq;
          },
          off() {
            return fakeReq;
          },
          resume() {
          }
        };
        server.connect(t).then(
          () => t.handleRequest(
            fakeReq,
            noopRes,
            initBody
          )
        );
      }
    );
    const noopRes2 = createNoopResponse();
    const initializedNotification = {
      jsonrpc: "2.0",
      method: "notifications/initialized"
    };
    const fakeNotifReq = {
      method: "POST",
      url: "/mcp",
      headers: {
        "content-type": "application/json",
        "mcp-session-id": newSessionId
      },
      rawHeaders: [
        "content-type",
        "application/json",
        "mcp-session-id",
        newSessionId ?? ""
      ],
      socket: { encrypted: false, remoteAddress: "127.0.0.1" },
      body: initializedNotification,
      on() {
        return fakeNotifReq;
      },
      once() {
        return fakeNotifReq;
      },
      off() {
        return fakeNotifReq;
      },
      resume() {
      }
    };
    await transport.handleRequest(
      fakeNotifReq,
      noopRes2,
      initializedNotification
    );
    res.setHeader("Mcp-Session-Id", newSessionId);
    req.headers["mcp-session-id"] = newSessionId;
    await transport.handleRequest(req, res, req.body);
  }
  app2.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    if (sessionId && sessions[sessionId]) {
      await sessions[sessionId].transport.handleRequest(req, res, req.body);
      return;
    }
    if (isInitializeRequest(req.body)) {
      connectionCounter++;
      const connectionId = randomUUID();
      const connectionName = resolveConnectionName();
      const providerType = getEffectiveProvider(getAgentBackend(), req.headers);
      mcpLog.info(
        `New session: connectionId=${connectionId} name="${connectionName}" provider=${providerType}`
      );
      const server = buildServer(connectionId, connectionName, req.headers);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (id) => {
          sessions[id] = {
            transport,
            server,
            connectionId,
            connectionName,
            providerType
          };
          void autoRegisterDefaultConnection(
            buildAutoRegisterDeps(connectionId, connectionName, providerType)
          );
          writeSessionFile(connectionId, port, getPromptTimeoutMs());
        }
      });
      transport.onclose = () => {
        handleTransportClose(transport.sessionId);
        server.close().catch(() => {
        });
      };
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }
    if (sessionId) {
      mcpLog.info(`Transparent reinit for stale sessionId=${sessionId}`);
      try {
        await handleTransparentReinit(req, res);
        return;
      } catch (err) {
        mcpLog.error(
          `Transparent reinit failed for sessionId=${sessionId}: ${errorMessage(err)}`
        );
        console.error(
          "[mcp] transparent reinit failed, falling back to 404:",
          err
        );
      }
    }
    res.status(404).json({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message: "Session not found or expired. Please reinitialize."
      },
      id: null
    });
  });
  app2.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    if (!sessionId || !sessions[sessionId]) {
      res.status(404).json({ error: "Session not found or expired" });
      return;
    }
    await sessions[sessionId].transport.handleRequest(req, res);
    const keepaliveInterval = setInterval(() => {
      if (res.writableEnded) {
        clearInterval(keepaliveInterval);
        return;
      }
      try {
        res.write(": keepalive\n\n");
      } catch {
        clearInterval(keepaliveInterval);
      }
    }, 15e3);
    const onSocketGone = () => {
      clearInterval(keepaliveInterval);
    };
    res.socket?.once("close", onSocketGone);
    res.socket?.once("error", onSocketGone);
    res.once("close", () => {
      clearInterval(keepaliveInterval);
      res.socket?.removeListener("close", onSocketGone);
      res.socket?.removeListener("error", onSocketGone);
    });
  });
  app2.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    if (sessionId && sessions[sessionId]) {
      const { connectionId } = sessions[sessionId];
      mcpLog.info(
        `Session teardown: connectionId=${connectionId} sessionId=${sessionId}`
      );
      await sessions[sessionId].transport.handleRequest(req, res);
      delete sessions[sessionId];
      cancelActivePrompt(connectionId);
      getWindow()?.webContents.send("connection-closed", { connectionId });
    } else {
      res.status(404).json({ error: "Session not found or expired" });
    }
  });
  app2.use(
    createApiRouter({
      getWindow,
      clearAllSessions: _clearAllSessions,
      getOpenCodePort
    })
  );
  app2.get("/health", (_req, res) => {
    const activeClients = Object.keys(sessions).length;
    res.json({
      status: "ok",
      activeClients,
      mcpConfigFile: MCP_CONFIG_FILE,
      tools: [
        "register_connection",
        "request_user_input",
        "start_intensive_chat",
        "ask_intensive_chat",
        "stop_intensive_chat",
        "push_session_status",
        "send_message",
        "find_repo_docs",
        "manage_skills_and_instructions"
      ]
    });
  });
  httpServer = app2.listen(port, () => {
    mcpLog.info(
      `MCP Streamable HTTP server listening on http://localhost:${port}/mcp`
    );
    console.log(
      `MCP Streamable HTTP server listening on http://localhost:${port}/mcp`
    );
    writeSessionFile("server", port, getPromptTimeoutMs());
    writeMcpConfigHint(port);
  });
  const MAX_SAFE_TIMEOUT_MS2 = 2147483647;
  httpServer.keepAliveTimeout = MAX_SAFE_TIMEOUT_MS2 - 1e3;
  httpServer.headersTimeout = MAX_SAFE_TIMEOUT_MS2;
  cleanupOldAttachments();
  _attachmentCleanupInterval = setInterval(
    () => cleanupOldAttachments(),
    6 * 60 * 60 * 1e3
  );
}
function stopMcpServer() {
  if (_attachmentCleanupInterval) {
    clearInterval(_attachmentCleanupInterval);
    _attachmentCleanupInterval = null;
  }
  if (httpServer) {
    httpServer.closeAllConnections();
    httpServer.close();
    httpServer = null;
  }
  _sessionCleanup = null;
  _clearAllSessions = null;
}
async function restartMcpServer() {
  if (!_startParams) return;
  stopMcpServer();
  clearSessionFile();
  await startMcpServer(
    _startParams.port,
    _startParams.getWindow,
    _startParams.getSoundEnabled,
    _startParams.getPromptTimeoutMs,
    _startParams.getOpenCodePort,
    _startParams.getDocIndexingEnabled,
    _startParams.getAgentBackend
  );
}
async function softRestartMcpServer() {
  if (!_clearAllSessions) return 0;
  return _clearAllSessions();
}
async function closeSessionByConnectionId(connectionId) {
  if (!_sessionCleanup) return false;
  return _sessionCleanup(connectionId);
}
const defaultSettings = {
  port: 3100,
  soundEnabled: true,
  launchAtLogin: false,
  promptTimeoutSeconds: 1200,
  autoRestoreSessions: false,
  openCodePort: 4096,
  docIndexingEnabled: true,
  autoStartOpenCode: true,
  autoSyncOpencode: true,
  docContextDebug: false,
  agentBackend: "opencode",
  autoRegisterSubagents: true,
  compactMode: false,
  toolAutoExpandExclusions: [],
  discoveredTools: [],
  defaultNoReply: true,
  defaultExpandAllTools: false,
  defaultShowThinking: false,
  allowedReadFolders: [],
  allowedPermissions: [],
  defaultModelId: "",
  defaultProviderId: "",
  defaultReasoningVariant: "",
  hideSystemReminders: false,
  hideDocInjections: false,
  chatTextSize: "md"
};
function getSettingsPath() {
  return join(app.getPath("userData"), "settings.json");
}
function migrateSettings(settings) {
  if (settings.promptTimeoutSeconds === 200) {
    return { ...settings, promptTimeoutSeconds: 1200 };
  }
  return settings;
}
function loadSettings() {
  const path = getSettingsPath();
  if (!existsSync(path)) return { ...defaultSettings };
  try {
    const merged = {
      ...defaultSettings,
      ...JSON.parse(readFileSync$1(path, "utf-8"))
    };
    const migrated = migrateSettings(merged);
    if (migrated !== merged) {
      writeFileSync(path, JSON.stringify(migrated, null, 2));
    }
    return migrated;
  } catch {
    return { ...defaultSettings };
  }
}
function saveSettings(settings) {
  writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
}
function createWindow(isQuitting2, options) {
  const iconPath = join(__dirname, "../../resources/icon.png");
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
  } catch {
  }
  const window = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 600,
    minHeight: 500,
    show: false,
    icon,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 15, y: 15 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  });
  window.on("ready-to-show", () => {
    if (!options?.startHidden) {
      window.show();
    }
  });
  window.on("close", (event) => {
    if (isQuitting2()) return;
    event.preventDefault();
    window.hide();
  });
  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const currentUrl = window.webContents.getURL();
    if (url === currentUrl) return;
    try {
      const target = new URL(url);
      const current = new URL(currentUrl);
      if (target.origin === current.origin) return;
    } catch {
    }
    event.preventDefault();
    shell.openExternal(url);
  });
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    window.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    window.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return window;
}
function createTray(getMainWindow, quit) {
  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAbwAAAG8B8aLcQwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAEFSURBVDiNpZMxTgMxEEX/2N4VEg0VR+AYXIBrcBIuwBE4BiWioUOiQuwm9gyFd7NJdpE/ybI8M/6eGdtARHCMmKNYAGjxL/MflnWYiKJZ0nOSrpl9S2J7rMjsGxFNqhpE0TfmvTGz7wFcoHxYYpBUALhA+bDE4BKDSwYZ1uQfAGfgK0mbuRVjHZK0VdI5gFdmPZVkp74G8AjgpW3/RJ+AvJM0V2YBYFPSMwU+UOQo6ZWBewC2JLaSrgBcmA3VGBwCuATQkNhIugZwTqK1mQP4APAB4MnMvnZrVSLiLin0bkqb74bz+1Gq+f+bZub+8SqJJcp2oFfUhqMGcHUvzBwEfYjEK8aN0g9cAAAAASUVORK5CYII="
  );
  if (process.platform === "darwin") {
    icon.setTemplateImage(true);
  }
  const tray = new Tray(icon);
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show Window",
      click: () => getMainWindow()?.show()
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => quit()
    }
  ]);
  tray.setToolTip("Eden");
  tray.setContextMenu(contextMenu);
  tray.on("click", () => getMainWindow()?.show());
  return tray;
}
const defaultDirs = {
  globalAgentDir: () => getGlobalAgentDir(),
  projectAgentDir: (baseDirectory) => getProjectAgentDir(baseDirectory)
};
let activeDirs = defaultDirs;
function globalAgentDir() {
  return activeDirs.globalAgentDir();
}
function projectAgentDir(baseDirectory) {
  return activeDirs.projectAgentDir(baseDirectory);
}
const VALID_NAME_RE = /^[a-zA-Z0-9_-]+$/;
function assertValidName(name) {
  if (!VALID_NAME_RE.test(name)) {
    throw new Error(`Invalid agent name "${name}" — must match [a-zA-Z0-9_-]+`);
  }
}
function parseAgentFile(raw) {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
    return { frontmatter: {}, body: raw };
  }
  const lines = raw.split(/\r?\n/);
  let closingIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      closingIdx = i;
      break;
    }
  }
  if (closingIdx === -1) {
    throw new Error("Malformed frontmatter: missing closing `---` delimiter");
  }
  const fmLines = lines.slice(1, closingIdx);
  const bodyLines = lines.slice(closingIdx + 1);
  const body = bodyLines.join("\n");
  const frontmatter = parseFrontmatterLines(fmLines);
  return { frontmatter, body };
}
function parseFrontmatterLines(lines) {
  const result = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "" || line.trim().startsWith("#")) {
      i++;
      continue;
    }
    if (line.startsWith("  ")) {
      throw new Error(`Unexpected indented line at top level: "${line}"`);
    }
    if (line.startsWith(" ")) {
      throw new Error(`Unexpected single-space indent: "${line}"`);
    }
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!match) {
      throw new Error(`Cannot parse frontmatter line: "${line}"`);
    }
    const key = match[1];
    const rawValue = match[2];
    if (rawValue === "") {
      const nested = {};
      i++;
      while (i < lines.length) {
        const nested_line = lines[i];
        if (nested_line.trim() === "" || nested_line.trim().startsWith("#")) {
          i++;
          continue;
        }
        if (!nested_line.startsWith("  ")) break;
        if (nested_line.startsWith("   ") && !nested_line.startsWith("    ")) {
          throw new Error(
            `Invalid nested indent (expected 2 spaces): "${nested_line}"`
          );
        }
        if (nested_line.startsWith("    ")) {
          throw new Error(
            `Nested map deeper than one level is not supported: "${nested_line}"`
          );
        }
        const inner = nested_line.slice(2);
        if (inner.startsWith(" ")) {
          throw new Error(
            `Invalid nested indent (mixed spaces): "${nested_line}"`
          );
        }
        const nmatch = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(inner);
        if (!nmatch) {
          throw new Error(`Cannot parse nested line: "${nested_line}"`);
        }
        const nkey = nmatch[1];
        const nval = nmatch[2];
        if (nval === "") {
          throw new Error(
            `Nested map deeper than one level is not supported at "${nkey}"`
          );
        }
        nested[nkey] = parseScalar(nval);
        i++;
      }
      result[key] = nested;
      continue;
    }
    result[key] = parseScalar(rawValue);
    i++;
  }
  return result;
}
function parseScalar(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2 || trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);
  return trimmed;
}
function serializeAgent(input) {
  const keys = [];
  const values = {};
  values.description = formatScalar(input.description);
  keys.push("description");
  values.mode = formatScalar(input.mode);
  keys.push("mode");
  if (input.model !== void 0) {
    values.model = formatScalar(input.model);
    keys.push("model");
  }
  const toolKeys = Object.keys(input.tools).sort();
  let toolsBlock = null;
  if (toolKeys.length > 0) {
    toolsBlock = toolKeys.map((k) => `  ${k}: ${input.tools[k]}`).join("\n");
    keys.push("tools");
  }
  const alphabetized = keys.slice().sort();
  const lines = ["---"];
  for (const k of alphabetized) {
    if (k === "tools" && toolsBlock !== null) {
      lines.push("tools:");
      lines.push(toolsBlock);
    } else {
      lines.push(`${k}: ${values[k]}`);
    }
  }
  lines.push("---");
  lines.push("");
  return lines.join("\n") + input.body;
}
function formatScalar(value) {
  if (value === "" || /[:#'"]/.test(value) || /^\s|\s$/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}
function readAgentFromDisk(filePath, scope, baseDirectory) {
  let raw;
  try {
    raw = readFileSync$1(filePath, "utf8");
  } catch {
    return null;
  }
  const { frontmatter, body } = parseAgentFile(raw);
  const name = filePath.split(sep).pop().replace(/\.md$/, "");
  const rawTools = frontmatter.tools;
  const tools = {};
  if (rawTools && typeof rawTools === "object" && !Array.isArray(rawTools)) {
    for (const [k, v] of Object.entries(rawTools)) {
      if (typeof v === "boolean") tools[k] = v;
    }
  }
  const description = typeof frontmatter.description === "string" ? frontmatter.description : "";
  const mode = typeof frontmatter.mode === "string" ? frontmatter.mode : "subagent";
  const model = typeof frontmatter.model === "string" ? frontmatter.model : void 0;
  const agent = {
    name,
    filePath,
    scope,
    description,
    mode,
    tools,
    body,
    rawContents: raw
  };
  if (model !== void 0) agent.model = model;
  if (scope === "project" && baseDirectory) agent.baseDirectory = baseDirectory;
  return agent;
}
function scanDir(dir, scope, baseDirectory) {
  if (!existsSync(dir)) return [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const agents = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".md")) continue;
    const full = join(dir, entry);
    try {
      if (!statSync(full).isFile()) continue;
    } catch {
      continue;
    }
    try {
      const agent = readAgentFromDisk(full, scope, baseDirectory);
      if (agent) agents.push(agent);
    } catch (err) {
      console.warn(
        `[agents] skipping malformed agent file ${full}:`,
        err.message
      );
    }
  }
  return agents;
}
async function listAgents(baseDirectory) {
  const globals = scanDir(globalAgentDir(), "global");
  const projects = baseDirectory ? scanDir(projectAgentDir(baseDirectory), "project", baseDirectory) : [];
  const projectNames = new Set(projects.map((a) => a.name));
  for (const g of globals) {
    if (projectNames.has(g.name)) g.overridden = true;
  }
  return [...projects, ...globals];
}
async function readAgent(filePath) {
  if (!existsSync(filePath)) return null;
  const abs = resolve(filePath);
  const global = resolve(globalAgentDir());
  if (abs.startsWith(global + sep) || abs === global) {
    return readAgentFromDisk(abs, "global");
  }
  const projSegment = `${sep}.opencode${sep}agent${sep}`;
  const idx = abs.indexOf(projSegment);
  if (idx !== -1) {
    const base = abs.slice(0, idx);
    return readAgentFromDisk(abs, "project", base);
  }
  try {
    return readAgentFromDisk(abs, "global");
  } catch {
    return null;
  }
}
async function writeAgent(params) {
  assertValidName(params.name);
  let dir;
  if (params.scope === "project") {
    if (!params.baseDirectory) {
      throw new Error("baseDirectory is required when scope=project");
    }
    dir = projectAgentDir(params.baseDirectory);
  } else {
    dir = globalAgentDir();
  }
  await promises.mkdir(dir, { recursive: true });
  const filePath = join(dir, `${params.name}.md`);
  const serialized = serializeAgent({
    description: params.description,
    mode: params.mode,
    tools: params.tools,
    model: params.model,
    body: params.body
  });
  await promises.writeFile(filePath, serialized, "utf8");
  return { filePath };
}
async function deleteAgent(filePath) {
  const abs = resolve(filePath);
  const global = resolve(globalAgentDir());
  const isInGlobal = abs.startsWith(global + sep);
  const projSegment = `${sep}.opencode${sep}agent${sep}`;
  const isInProject = abs.includes(projSegment);
  if (!isInGlobal && !isInProject) {
    throw new Error(
      `Refusing to delete file outside known agent directories: ${abs}`
    );
  }
  if (abs.split(sep).includes("..")) {
    throw new Error(`Path contains traversal segments: ${abs}`);
  }
  if (!abs.endsWith(".md")) {
    throw new Error(`Refusing to delete non-.md file: ${abs}`);
  }
  await promises.rm(abs, { force: false });
}
const STOP_WORDS = /* @__PURE__ */ new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "as",
  "is",
  "it",
  "its",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "can",
  "that",
  "this",
  "these",
  "those",
  "i",
  "me",
  "my",
  "we",
  "you",
  "your",
  "he",
  "she",
  "they",
  "them",
  "their",
  "not",
  "no",
  "use",
  "using",
  "also",
  "if",
  "so",
  "up",
  "out",
  "how",
  "what",
  "when",
  "where",
  "who",
  "which",
  "all",
  "any",
  "more",
  "some",
  "into",
  "about",
  "than",
  "then",
  "there",
  "here"
]);
const MIN_TOKEN_LEN = 3;
function tokenise(text) {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= MIN_TOKEN_LEN && !STOP_WORDS.has(t));
}
function matchSkillsForMessage(userMessage, skills) {
  if (skills.length === 0) return [];
  const queryTokens = tokenise(userMessage);
  if (queryTokens.length === 0) return [];
  return skills.filter((skill) => {
    const skillTokens = tokenise(`${skill.name} ${skill.description}`);
    return queryTokens.some(
      (qt) => skillTokens.some((st) => st.includes(qt) || qt.includes(st))
    );
  });
}
function buildSkillSuggestionText(matchedSkills) {
  if (matchedSkills.length === 0) return "";
  const suggestions = matchedSkills.map(
    (s) => `[Skill suggestion: The user's message may relate to skill "${s.name}" — consider loading it with the skill tool.]`
  ).join("\n");
  return `<system-reminder>
${suggestions}
</system-reminder>`;
}
const ipcLog$3 = createLogger("ipc");
const rendererLog = createLogger("renderer");
function registerRendererLogChannel() {
  ipcMain.on(
    "renderer-log",
    (_event, data) => {
      const logFn = rendererLog[data.level] ?? rendererLog.info;
      logFn(`[${data.category}] ${data.message}`);
    }
  );
}
function withSkillSuggestion(message) {
  const skills = listSkillsAndInstructions("skill");
  const matched = matchSkillsForMessage(message, skills);
  const suggestion = buildSkillSuggestionText(matched);
  if (!suggestion) {
    return message;
  }
  return `${suggestion}

${message}`;
}
function logIpcInfo(message) {
  ipcLog$3.info(message);
}
function registerAgentsHandlers() {
  ipcMain.handle(
    "list-agents",
    async (_event, baseDirectory) => {
      try {
        logIpcInfo(`list-agents: baseDirectory=${baseDirectory ?? "<none>"}`);
        const data = await listAgents(baseDirectory);
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    }
  );
  ipcMain.handle(
    "read-agent",
    async (_event, filePath) => {
      try {
        const data = await readAgent(filePath);
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    }
  );
  ipcMain.handle(
    "write-agent",
    async (_event, params) => {
      try {
        logIpcInfo(`write-agent: scope=${params.scope} name=${params.name}`);
        const data = await writeAgent(params);
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    }
  );
  ipcMain.handle(
    "delete-agent",
    async (_event, filePath) => {
      try {
        logIpcInfo(`delete-agent: ${filePath}`);
        await deleteAgent(filePath);
        return { ok: true, data: null };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    }
  );
}
const COMPACTION_BUFFER = 2e4;
const OUTPUT_TOKEN_MAX = 32e3;
const DEFAULT_CONTEXT_WINDOW = 128e3;
const _sessionUsage = /* @__PURE__ */ new Map();
const _modelLimits = /* @__PURE__ */ new Map();
function getModelLimitsKey(modelId, providerId) {
  if (!modelId) {
    return null;
  }
  return providerId ? `${providerId}:${modelId}` : modelId;
}
function setModelContextLimit(modelId, limit, providerId) {
  const key = getModelLimitsKey(modelId, providerId);
  if (!key) {
    return;
  }
  if (typeof limit === "number") {
    _modelLimits.set(key, { contextWindow: limit });
    return;
  }
  _modelLimits.set(key, limit);
}
function getModelLimits(modelId, providerId) {
  if (!modelId) {
    return { contextWindow: DEFAULT_CONTEXT_WINDOW };
  }
  const providerKey = getModelLimitsKey(modelId, providerId);
  if (providerKey && _modelLimits.has(providerKey)) {
    return _modelLimits.get(providerKey) ?? {
      contextWindow: DEFAULT_CONTEXT_WINDOW
    };
  }
  return _modelLimits.get(modelId) ?? { contextWindow: DEFAULT_CONTEXT_WINDOW };
}
function getMaxOutputTokens(modelId, providerId) {
  const outputLimit = getModelLimits(modelId, providerId).outputLimit;
  if (!outputLimit || outputLimit <= 0) {
    return OUTPUT_TOKEN_MAX;
  }
  return Math.min(outputLimit, OUTPUT_TOKEN_MAX) || OUTPUT_TOKEN_MAX;
}
function getTokenCount(tokens) {
  if (!tokens) {
    return 0;
  }
  return tokens.total ?? (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.reasoning ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0);
}
function computeUsage(sessionId, totalTokens, modelId, providerId) {
  const limits = getModelLimits(modelId, providerId);
  const contextLimit = limits.contextWindow;
  const maxOutputTokens = getMaxOutputTokens(modelId, providerId);
  const reserved = Math.min(COMPACTION_BUFFER, maxOutputTokens);
  const usableLimit = Math.max(
    0,
    limits.inputLimit ? limits.inputLimit - reserved : contextLimit - maxOutputTokens
  );
  const usagePercent = contextLimit > 0 ? Math.round(totalTokens / contextLimit * 100) : 0;
  const overflowPercent = usableLimit > 0 ? Math.round(totalTokens / usableLimit * 100) : 0;
  return {
    sessionId,
    totalTokens,
    contextLimit,
    usableLimit,
    usagePercent,
    // Near overflow at 80% usage
    isNearOverflow: overflowPercent >= 80 && overflowPercent < 100,
    // Overflow at 100%+ usage
    isOverflow: overflowPercent >= 100,
    updatedAt: Date.now()
  };
}
function setSessionTotalTokens(sessionId, totalTokens, modelId, providerId) {
  const usage = computeUsage(sessionId, totalTokens, modelId, providerId);
  _sessionUsage.set(sessionId, usage);
  return usage;
}
function getSessionContextUsage(sessionId) {
  return _sessionUsage.get(sessionId) ?? null;
}
async function triggerCompaction(sessionId, openCodePort, options = {}) {
  try {
    const response = await sessionSummarize(
      openCodePort,
      sessionId,
      {
        providerID: options.providerId,
        modelID: options.modelId,
        auto: options.auto ?? false
      },
      { signal: AbortSignal.timeout(6e4) }
      // Compaction can take a while
    );
    if (response.error) {
      return {
        ok: false,
        error: `Compaction failed: ${JSON.stringify(response.error)}`
      };
    }
    return { ok: true };
  } catch (err) {
    const msg = errorMessage(err);
    return { ok: false, error: msg };
  }
}
function getMessageTokenTotal(tokens) {
  const total = getTokenCount(tokens);
  return total > 0 ? total : void 0;
}
async function fetchLatestAssistantMessageTokens(sessionId, openCodePort) {
  try {
    const response = await sessionMessages(
      openCodePort,
      sessionId,
      { limit: 20 },
      { signal: AbortSignal.timeout(5e3) }
    );
    if (response.error) {
      return {};
    }
    const messages = response.data;
    if (!messages) {
      return {};
    }
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const info = messages[index]?.info;
      if (info?.role !== "assistant") {
        continue;
      }
      const total = getMessageTokenTotal(info.tokens);
      if (!total) {
        continue;
      }
      return {
        tokens: total,
        modelId: info.modelID,
        providerId: info.providerID
      };
    }
    return {};
  } catch {
    return {};
  }
}
async function fetchSessionTokens(sessionId, openCodePort) {
  try {
    const response = await sessionGet(openCodePort, sessionId, {
      signal: AbortSignal.timeout(5e3)
    });
    if (response.error) return null;
    const data = response.data;
    if (!data) return null;
    const fallback = data.tokens === void 0 ? await fetchLatestAssistantMessageTokens(sessionId, openCodePort) : null;
    return {
      id: data.id,
      tokens: data.tokens ?? fallback?.tokens,
      modelId: data.model?.id ?? fallback?.modelId,
      providerId: data.provider?.id ?? fallback?.providerId
    };
  } catch {
    return null;
  }
}
function computeContextUsage(message, _port) {
  if (!message.sessionID) return null;
  if (message.role !== "assistant") return null;
  const total = getTokenCount(message.tokens);
  if (total <= 0) return null;
  return setSessionTotalTokens(
    message.sessionID,
    total,
    message.modelID,
    message.providerID ?? null
  );
}
let _cachedProviders = null;
let _cachedProvidersAt = 0;
let _cachedProvidersInfo = null;
const PROVIDERS_CACHE_TTL_MS = 3e4;
const _providersInfoListeners = /* @__PURE__ */ new Set();
let _pushDebounceTimer = null;
let _pendingPushPayload = null;
const PUSH_DEBOUNCE_MS = 50;
function subscribeToProvidersInfo(listener2) {
  _providersInfoListeners.add(listener2);
  return () => {
    _providersInfoListeners.delete(listener2);
  };
}
function emitProvidersInfo(info) {
  _pendingPushPayload = info;
  if (_pushDebounceTimer) return;
  _pushDebounceTimer = setTimeout(() => {
    _pushDebounceTimer = null;
    const payload = _pendingPushPayload;
    _pendingPushPayload = null;
    if (!payload) return;
    for (const listener2 of _providersInfoListeners) {
      try {
        listener2(payload);
      } catch {
      }
    }
  }, PUSH_DEBOUNCE_MS);
}
function inferDefaultVariant(modelId, providerId, variants) {
  if (!variants || variants.length === 0) return void 0;
  const normalizedVariants = normalizeReasoningVariants(variants);
  if (!normalizedVariants || normalizedVariants.length === 0) return void 0;
  const id = modelId.toLowerCase();
  if (id.includes("gpt-5") && !id.includes("gpt-5-chat") && !id.includes("gpt-5-pro")) {
    if (normalizedVariants.includes("medium")) return "medium";
  }
  if (id.includes("gemini-3") || id.includes("gemini3")) {
    if (normalizedVariants.includes("high")) return "high";
  }
  if (id.includes("claude")) {
    if (normalizedVariants.includes("high")) return "high";
  }
  if (/\bo[1-3]/.test(id) && !id.includes("o1-mini")) {
    if (normalizedVariants.includes("medium")) return "medium";
  }
  if (providerId?.toLowerCase().includes("openrouter") && id.includes("gemini-3")) {
    if (normalizedVariants.includes("high")) return "high";
  }
  if (normalizedVariants.includes("medium")) return "medium";
  if (normalizedVariants.includes("high")) return "high";
  if (normalizedVariants.includes("xhigh")) return "xhigh";
  return normalizedVariants[0];
}
function transformModel(raw, providerId) {
  const variants = raw.variants && Object.keys(raw.variants).length > 0 ? normalizeReasoningVariants(Object.keys(raw.variants)) : void 0;
  const model = {
    id: raw.id,
    name: raw.name,
    contextWindow: raw.limit?.context,
    inputLimit: raw.limit?.input,
    outputLimit: raw.limit?.output,
    reasoning: raw.capabilities?.reasoning ?? false,
    variants,
    defaultVariant: normalizeReasoningVariant(
      inferDefaultVariant(raw.id, providerId ?? raw.providerID, variants)
    )
  };
  if (raw.limit?.context) {
    setModelContextLimit(
      raw.id,
      {
        contextWindow: raw.limit.context,
        inputLimit: raw.limit.input,
        outputLimit: raw.limit.output
      },
      providerId ?? raw.providerID
    );
  }
  return model;
}
function transformProvider(raw) {
  return {
    id: raw.id,
    name: raw.name,
    models: Object.values(raw.models).map((m) => transformModel(m, raw.id))
  };
}
async function fetchProviders(openCodePort) {
  try {
    const client2 = getClient(openCodePort);
    const response = await client2.provider.list(void 0, {
      signal: AbortSignal.timeout(5e3)
    });
    if (response.error) return null;
    const data = response.data;
    if (!data?.all) return null;
    const providers = data.all.map(transformProvider);
    _cachedProviders = providers;
    return providers;
  } catch {
    return null;
  }
}
async function fetchProvidersInfo(openCodePort) {
  if (_cachedProvidersInfo !== null && Date.now() - _cachedProvidersAt < PROVIDERS_CACHE_TTL_MS) {
    return _cachedProvidersInfo;
  }
  try {
    const client2 = getClient(openCodePort);
    const response = await client2.provider.list(void 0, {
      signal: AbortSignal.timeout(5e3)
    });
    if (response.error) return null;
    const data = response.data;
    if (!data?.all || data.all.length === 0) {
      return null;
    }
    const providers = data.all.map(transformProvider);
    _cachedProviders = providers;
    const info = {
      providers,
      connectedProviderIds: data.connected,
      defaults: data.default
    };
    _cachedProvidersInfo = info;
    _cachedProvidersAt = Date.now();
    emitProvidersInfo(info);
    return info;
  } catch {
    return null;
  }
}
async function refreshProvidersInfo(openCodePort) {
  _cachedProvidersAt = 0;
  return fetchProvidersInfo(openCodePort);
}
function clearProviderCache() {
  _cachedProviders = null;
  _cachedProvidersInfo = null;
  _cachedProvidersAt = 0;
}
async function fetchProviderAuthMethods(openCodePort) {
  try {
    const client2 = getClient(openCodePort);
    const response = await client2.provider.auth(void 0, {
      signal: AbortSignal.timeout(5e3)
    });
    if (response.error) return null;
    return response.data ?? null;
  } catch {
    return null;
  }
}
async function authorizeProvider(openCodePort, providerId, method, inputs) {
  try {
    const client2 = getClient(openCodePort);
    const response = await client2.provider.oauth.authorize(
      {
        providerID: providerId,
        method,
        inputs
      },
      { signal: AbortSignal.timeout(1e4) }
    );
    if (response.error) {
      return { ok: false, error: String(response.error) };
    }
    const data = response.data ?? void 0;
    if (!data) {
      return { ok: false, error: "Provider returned no authorization data" };
    }
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: errorMessage(err)
    };
  }
}
async function callbackProvider(openCodePort, providerId, method, code) {
  try {
    const client2 = getClient(openCodePort);
    const response = await client2.provider.oauth.callback(
      {
        providerID: providerId,
        method,
        code
      },
      { signal: AbortSignal.timeout(1e4) }
    );
    if (response.error) {
      return { ok: false, error: String(response.error) };
    }
    if (response.data !== true) {
      return { ok: false, error: "Provider callback did not complete" };
    }
    clearProviderCache();
    void fetchProvidersInfo(openCodePort).catch(() => {
    });
    return { ok: true, data: true };
  } catch (err) {
    return {
      ok: false,
      error: errorMessage(err)
    };
  }
}
async function setProviderApiKey(openCodePort, providerId, apiKey) {
  try {
    const client2 = getClient(openCodePort);
    const response = await client2.auth.set(
      {
        providerID: providerId,
        auth: { type: "api", key: apiKey }
      },
      { signal: AbortSignal.timeout(5e3) }
    );
    if (response.error) return false;
    clearProviderCache();
    void fetchProvidersInfo(openCodePort).catch(() => {
    });
    return true;
  } catch {
    return false;
  }
}
const ipcLog$2 = createLogger("ipc");
function registerContextTrackingHandlers(deps) {
  ipcMain.handle("get-context-usage", async (_event, sessionId) => {
    const settings = deps.getSettings();
    if (settings.agentBackend !== "opencode") return null;
    const sessionInfo = await fetchSessionTokens(
      sessionId,
      settings.openCodePort
    );
    if (!sessionInfo) return null;
    return setSessionTotalTokens(
      sessionId,
      sessionInfo.tokens ?? 0,
      sessionInfo.modelId,
      sessionInfo.providerId
    );
  });
  ipcMain.handle(
    "trigger-compaction",
    async (_event, {
      sessionId,
      providerId,
      modelId
    }) => {
      const settings = deps.getSettings();
      ipcLog$2.info(`trigger-compaction: sessionId=${sessionId}`);
      console.log(
        "[trigger-compaction] Starting compaction for session:",
        sessionId
      );
      let finalProviderId = providerId;
      let finalModelId = modelId;
      if (!finalProviderId || !finalModelId) {
        const providersInfo = await fetchProvidersInfo(settings.openCodePort);
        if (providersInfo) {
          const connectedProvider = providersInfo.connectedProviderIds[0];
          if (connectedProvider) {
            finalProviderId = finalProviderId ?? connectedProvider;
            finalModelId = finalModelId ?? providersInfo.defaults[finalProviderId];
          }
        }
      }
      if (!finalProviderId || !finalModelId) {
        return {
          ok: false,
          error: "No connected provider or model available for compaction"
        };
      }
      const result = await triggerCompaction(sessionId, settings.openCodePort, {
        providerId: finalProviderId,
        modelId: finalModelId
      });
      return result;
    }
  );
  ipcMain.handle("fetch-session-tokens", async (_event, sessionId) => {
    const settings = deps.getSettings();
    return fetchSessionTokens(sessionId, settings.openCodePort);
  });
}
const SKIP_PART_TYPES = /* @__PURE__ */ new Set([
  "step-start",
  "step-finish",
  "patch",
  "snapshot",
  "agent",
  "retry"
]);
function mapPart(part) {
  if (SKIP_PART_TYPES.has(part.type)) return null;
  switch (part.type) {
    case "text": {
      return {
        id: part.id,
        type: "text",
        text: part.text ?? ""
      };
    }
    case "reasoning": {
      return {
        id: part.id,
        type: "reasoning",
        text: part.text ?? ""
      };
    }
    case "file": {
      return {
        id: part.id,
        type: "file",
        mediaType: part.mime,
        filename: part.filename,
        fileUrl: part.url
      };
    }
    case "tool": {
      const state2 = part.state;
      let toolStatus;
      let toolInput;
      let toolOutput;
      let stateMetadata;
      let toolStartedAt;
      let toolCompletedAt;
      switch (state2.status) {
        case "pending":
          toolStatus = "pending";
          toolInput = state2.input;
          break;
        case "running":
          toolStatus = "running";
          toolInput = state2.input;
          stateMetadata = state2.metadata;
          toolStartedAt = state2.time?.start;
          break;
        case "completed":
          toolStatus = "completed";
          toolInput = state2.input;
          toolOutput = state2.output;
          stateMetadata = state2.metadata;
          toolStartedAt = state2.time?.start;
          toolCompletedAt = state2.time?.end;
          break;
        case "error":
          toolStatus = "error";
          toolInput = state2.input;
          toolOutput = state2.error;
          stateMetadata = state2.metadata;
          toolStartedAt = state2.time?.start;
          toolCompletedAt = state2.time?.end;
          break;
      }
      const mergedMetadata = {
        ...stateMetadata ?? {},
        ...part.metadata ?? {}
      };
      return {
        id: part.id,
        type: "tool-call",
        toolName: part.tool,
        toolCallId: part.callID,
        toolInput,
        toolOutput,
        toolStatus,
        toolMetadata: mergedMetadata,
        toolStartedAt,
        toolCompletedAt
      };
    }
    case "subtask": {
      const sub = part;
      return {
        id: sub.id,
        type: "subtask",
        subtaskSessionId: sub.sessionID,
        subtaskPrompt: sub.prompt ?? "",
        subtaskDescription: sub.description ?? "",
        subtaskAgent: sub.agent ?? ""
      };
    }
    case "compaction": {
      return {
        id: part.id,
        type: "compaction"
      };
    }
    default:
      return {
        id: part.id ?? "unknown",
        type: "unknown"
      };
  }
}
function mapRole(message) {
  return message.role === "assistant" ? "assistant" : "user";
}
function mapMessage(message) {
  const isAssistant = message.role === "assistant";
  const asAssistant = isAssistant ? message : null;
  const asUser = !isAssistant ? message : null;
  return {
    id: message.id,
    sessionId: message.sessionID,
    parentId: asAssistant?.parentID ?? null,
    role: mapRole(message),
    parts: [],
    // parts arrive via message.part.updated
    modelId: asAssistant?.modelID ?? asUser?.model?.modelID,
    providerId: asAssistant?.providerID ?? asUser?.model?.providerID,
    agent: asAssistant?.agent ?? asUser?.agent,
    mode: asAssistant?.mode,
    variant: asUser?.model?.variant,
    createdAt: message.time.created,
    completedAt: asAssistant?.time.completed,
    path: asAssistant?.path ? { cwd: asAssistant.path.cwd, root: asAssistant.path.cwd } : void 0
  };
}
const pendingCompactions = /* @__PURE__ */ new Map();
function bridgeEvent(payload, envelope) {
  switch (payload.type) {
    case "message.updated": {
      const events = [
        {
          type: "message.updated",
          sessionId: payload.properties.sessionID,
          message: mapMessage(payload.properties.info)
        }
      ];
      const info = payload.properties.info;
      const usage = computeContextUsage(
        {
          id: info.id,
          sessionID: info.sessionID,
          role: info.role,
          modelID: info.role === "assistant" ? info.modelID : info.model?.modelID,
          providerID: info.role === "assistant" ? info.providerID : info.model?.providerID,
          tokens: info.role === "assistant" ? info.tokens : void 0
        }
      );
      if (usage) {
        events.push({
          type: "context.usage",
          sessionId: usage.sessionId,
          totalTokens: usage.totalTokens,
          contextLimit: usage.contextLimit,
          usableLimit: usage.usableLimit,
          usagePercent: usage.usagePercent,
          isNearOverflow: usage.isNearOverflow,
          isOverflow: usage.isOverflow
        });
        const pending = pendingCompactions.get(usage.sessionId);
        if (pending) {
          pendingCompactions.delete(usage.sessionId);
          events.push({
            type: "session.compaction-done",
            sessionId: usage.sessionId,
            beforeTokens: pending.beforeTokens,
            afterTokens: usage.totalTokens
          });
        }
      }
      return events;
    }
    case "message.removed": {
      return [
        {
          type: "message.removed",
          sessionId: payload.properties.sessionID,
          messageId: payload.properties.messageID
        }
      ];
    }
    case "message.part.updated": {
      const mapped = mapPart(payload.properties.part);
      if (!mapped) return [];
      return [
        {
          type: "message.part.updated",
          sessionId: payload.properties.sessionID,
          messageId: payload.properties.part.messageID,
          part: mapped
        }
      ];
    }
    case "message.part.delta": {
      const { field } = payload.properties;
      if (field !== "text" && field !== "reasoning") return [];
      return [
        {
          type: "message.part.delta",
          sessionId: payload.properties.sessionID,
          messageId: payload.properties.messageID,
          partId: payload.properties.partID,
          field,
          delta: payload.properties.delta
        }
      ];
    }
    case "message.part.removed": {
      return [
        {
          type: "message.part.removed",
          sessionId: payload.properties.sessionID,
          messageId: payload.properties.messageID,
          partId: payload.properties.partID
        }
      ];
    }
    case "session.status": {
      const kind = payload.properties.status?.type;
      let status;
      if (kind === "busy" || kind === "retry") {
        status = "streaming";
      } else {
        status = "idle";
      }
      return [
        {
          type: "session.status",
          sessionId: payload.properties.sessionID,
          status
        }
      ];
    }
    case "session.idle": {
      return [
        {
          type: "session.status",
          sessionId: payload.properties.sessionID,
          status: "idle"
        }
      ];
    }
    case "session.error": {
      const sessionID = payload.properties.sessionID;
      if (!sessionID) return [];
      const err = payload.properties.error;
      const errorMsg = (err && "message" in err && typeof err.message === "string" ? err.message : void 0) ?? (err && "name" in err && typeof err.name === "string" ? err.name : void 0) ?? "Unknown error";
      return [
        {
          type: "session.status",
          sessionId: sessionID,
          status: "error",
          error: errorMsg
        }
      ];
    }
    case "session.compacted": {
      const sessionID = payload.properties.sessionID;
      const existing = getSessionContextUsage(sessionID);
      pendingCompactions.set(sessionID, {
        beforeTokens: existing?.totalTokens ?? 0
      });
      return [
        {
          type: "session.compacted",
          sessionId: sessionID,
          // compacted doesn't carry messageId in current SDK; use sessionId
          // placeholder. Renderer uses this to clear/trim message list.
          messageId: sessionID
        }
      ];
    }
    case "todo.updated": {
      return [
        {
          type: "todo.updated",
          sessionId: payload.properties.sessionID,
          // SDK `Todo` has no `id` field — synthesise one from index so
          // the reducer keys stay stable within a single update.
          todos: payload.properties.todos.map((t, i) => ({
            id: `todo-${i}`,
            content: t.content,
            status: t.status,
            priority: t.priority
          }))
        }
      ];
    }
    case "vcs.branch.updated": {
      return [
        {
          type: "vcs.updated",
          branch: payload.properties.branch ?? null
        }
      ];
    }
    case "file.edited": {
      return [
        {
          type: "file.edited",
          directory: envelope?.directory ?? null,
          file: payload.properties.file
        }
      ];
    }
    // ── Permission prompts ────────────────────────────────────────────
    // Note: auto-approve short-circuit runs out-of-band in
    // `event-stream.ts` before `bridgeEvent` is called, so any
    // `permission.asked` payload that reaches here is a request the
    // user must resolve interactively.
    case "permission.asked": {
      const p = payload.properties;
      return [
        {
          type: "permission.asked",
          sessionId: p.sessionID,
          requestId: p.id,
          permission: p.permission,
          patterns: p.patterns,
          always: p.always,
          tool: p.tool,
          metadata: p.metadata
        }
      ];
    }
    case "permission.replied": {
      const p = payload.properties;
      return [
        {
          type: "permission.replied",
          sessionId: p.sessionID,
          requestId: p.requestID,
          reply: p.reply
        }
      ];
    }
    // ── Question prompts ──────────────────────────────────────────────
    case "question.asked": {
      const p = payload.properties;
      return [
        {
          type: "question.asked",
          sessionId: p.sessionID,
          requestId: p.id,
          questions: p.questions,
          tool: p.tool
        }
      ];
    }
    case "question.replied": {
      const p = payload.properties;
      return [
        {
          type: "question.cleared",
          sessionId: p.sessionID,
          requestId: p.requestID,
          outcome: "replied"
        }
      ];
    }
    case "question.rejected": {
      const p = payload.properties;
      return [
        {
          type: "question.cleared",
          sessionId: p.sessionID,
          requestId: p.requestID,
          outcome: "rejected"
        }
      ];
    }
    // ── Low-risk additions: surface SDK signals for future consumers ──
    case "session.diff": {
      return [
        {
          type: "session.diff",
          sessionId: payload.properties.sessionID,
          diff: payload.properties.diff
        }
      ];
    }
    case "mcp.tools.changed": {
      return [
        {
          type: "mcp.tools.changed",
          server: payload.properties.server
        }
      ];
    }
    case "mcp.browser.open.failed": {
      return [
        {
          type: "mcp.browser.open.failed",
          mcpName: payload.properties.mcpName,
          url: payload.properties.url
        }
      ];
    }
    case "installation.update-available": {
      return [
        {
          type: "installation.update-available",
          version: payload.properties.version
        }
      ];
    }
    default:
      return [];
  }
}
const DEFAULT_TIMEOUT_MS = 5e3;
async function checkOpenCodeHealth(openCodePort, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let healthUrl;
  try {
    healthUrl = new URL(`http://127.0.0.1:${openCodePort}/global/health`);
  } catch (err) {
    return {
      available: false,
      healthy: false,
      version: null,
      error: err instanceof Error ? err.message : "Invalid health URL"
    };
  }
  try {
    const res = await fetch(healthUrl, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) {
      return {
        available: false,
        healthy: false,
        version: null,
        error: `Health check failed: HTTP ${res.status}`
      };
    }
    let version = null;
    try {
      const body = await res.json();
      if (typeof body.version === "string") {
        version = body.version;
      }
    } catch {
    }
    return {
      available: true,
      healthy: true,
      version
    };
  } catch (err) {
    return {
      available: false,
      healthy: false,
      version: null,
      error: err instanceof Error ? `Health check failed: ${err.message}` : "Connection failed"
    };
  }
}
const log$4 = createLogger("conversation-ipc");
function registerConversationHandlers(deps) {
  ipcMain.handle(
    "fetch-conversation-messages",
    async (_event, payload) => {
      const settings = deps.getSettings();
      if (settings.agentBackend !== "opencode") return [];
      try {
        const hasQuery = payload.limit !== void 0 || payload.before !== void 0;
        const response = await sessionMessages(
          settings.openCodePort,
          payload.sessionId,
          hasQuery ? { limit: payload.limit, before: payload.before } : void 0
        );
        const data = response.data;
        if (!Array.isArray(data)) return [];
        const out = [];
        for (const row of data) {
          const msg = mapMessage(row.info);
          msg.parts = row.parts.map((p) => mapPart(p)).filter(
            (p) => p !== null
          );
          out.push(msg);
        }
        return out;
      } catch (err) {
        log$4.warn(
          `fetch-conversation-messages failed for ${payload.sessionId}: ${String(err)}`
        );
        return [];
      }
    }
  );
  ipcMain.handle(
    "is-conversation-available",
    async (_event, _providerId) => {
      const settings = deps.getSettings();
      if (settings.agentBackend !== "opencode") return false;
      try {
        const health = await checkOpenCodeHealth(settings.openCodePort);
        return health.available === true;
      } catch {
        return false;
      }
    }
  );
}
const log$3 = createLogger("mcp-status");
const MCP_STATUS_REQUEST_TIMEOUT_MS = 1e4;
const MCP_OPERATION_TIMEOUT_MS = 1e4;
function mapSdkStatus(sdkStatus) {
  switch (sdkStatus.status) {
    case "connected":
      return "connected";
    case "connecting":
      return "connecting";
    case "disconnected":
      return "disconnected";
    case "error":
      return "error";
    case "disabled":
      return "disconnected";
    case "failed":
      return "error";
    case "needs_auth":
      return "needs_auth";
    case "needs_client_registration":
      return "needs_client_registration";
    default:
      return "disconnected";
  }
}
function extractError(sdkStatus) {
  if (sdkStatus.status === "error") {
    return sdkStatus.error;
  }
  if (sdkStatus.status === "failed") {
    return sdkStatus.error;
  }
  if (sdkStatus.status === "needs_client_registration") {
    return sdkStatus.error;
  }
  return void 0;
}
function getConfiguredMcp(config, name) {
  const value = config?.mcp?.[name];
  if (!value || typeof value !== "object" || !("type" in value)) {
    return void 0;
  }
  return value;
}
function getServerType(config, status) {
  if (config?.type === "remote" || config?.type === "local") {
    return config.type;
  }
  if (status === "needs_auth" || status === "needs_client_registration") {
    return "remote";
  }
  return "local";
}
function getEnvironmentKeys(config) {
  if (!config || config.type !== "local" || !config.environment) {
    return void 0;
  }
  const keys = Object.keys(config.environment);
  return keys.length > 0 ? keys : void 0;
}
async function fetchMcpStatus(openCodePort, directory) {
  log$3.info(`Fetching MCP status from port ${openCodePort}`);
  try {
    const client2 = getClient(openCodePort, directory);
    const [statusResponse, configResponse] = await Promise.all([
      client2.mcp.status(
        {},
        { signal: AbortSignal.timeout(MCP_STATUS_REQUEST_TIMEOUT_MS) }
      ),
      client2.config?.get?.(
        {},
        { signal: AbortSignal.timeout(MCP_STATUS_REQUEST_TIMEOUT_MS) }
      ) ?? Promise.resolve({ data: void 0, error: void 0 })
    ]);
    if (statusResponse.error) {
      const error = typeof statusResponse.error === "string" ? statusResponse.error : "Failed to fetch MCP status";
      log$3.error(`Failed to fetch MCP status: ${error}`);
      return { ok: false, error };
    }
    if (configResponse.error) {
      log$3.warn(
        `Failed to fetch MCP config metadata: ${String(configResponse.error)}`
      );
    }
    const data = statusResponse.data ?? {};
    const config = configResponse.error ? void 0 : configResponse.data;
    const servers = Object.entries(data).map(
      ([name, serverStatus]) => {
        const status = mapSdkStatus(serverStatus);
        const mcpConfig = getConfiguredMcp(config, name);
        return {
          name,
          type: getServerType(
            mcpConfig,
            status === "disabled" ? "disconnected" : status
          ),
          status: status === "disabled" ? "disconnected" : status,
          error: extractError(serverStatus),
          url: mcpConfig?.type === "remote" ? mcpConfig.url : void 0,
          command: mcpConfig?.type === "local" ? mcpConfig.command : void 0,
          environmentKeys: getEnvironmentKeys(mcpConfig),
          tools: void 0,
          resources: void 0,
          prompts: void 0
        };
      }
    );
    log$3.info(`Fetched ${servers.length} MCP servers`);
    return { ok: true, servers };
  } catch (err) {
    const error = errorMessage(err);
    log$3.error(`Failed to fetch MCP status: ${error}`);
    return { ok: false, error };
  }
}
async function connectMcp(openCodePort, mcpName, directory) {
  log$3.info(`Connecting MCP: ${mcpName}`);
  try {
    const client2 = getClient(openCodePort, directory);
    const response = await client2.mcp.connect(
      { name: mcpName },
      { signal: AbortSignal.timeout(MCP_OPERATION_TIMEOUT_MS) }
    );
    if (response.error) {
      const error = typeof response.error === "string" ? response.error : `Failed to connect MCP: ${mcpName}`;
      log$3.error(`Failed to connect MCP ${mcpName}: ${error}`);
      return { ok: false, error };
    }
    log$3.info(`Successfully connected MCP: ${mcpName}`);
    return { ok: true };
  } catch (err) {
    const error = errorMessage(err);
    log$3.error(`Failed to connect MCP ${mcpName}: ${error}`);
    return { ok: false, error };
  }
}
async function disconnectMcp(openCodePort, mcpName, directory) {
  log$3.info(`Disconnecting MCP: ${mcpName}`);
  try {
    const client2 = getClient(openCodePort, directory);
    const response = await client2.mcp.disconnect(
      { name: mcpName },
      { signal: AbortSignal.timeout(MCP_OPERATION_TIMEOUT_MS) }
    );
    if (response.error) {
      const error = typeof response.error === "string" ? response.error : `Failed to disconnect MCP: ${mcpName}`;
      log$3.error(`Failed to disconnect MCP ${mcpName}: ${error}`);
      return { ok: false, error };
    }
    log$3.info(`Successfully disconnected MCP: ${mcpName}`);
    return { ok: true };
  } catch (err) {
    const error = errorMessage(err);
    log$3.error(`Failed to disconnect MCP ${mcpName}: ${error}`);
    return { ok: false, error };
  }
}
async function registerMcp(openCodePort, name, config, directory) {
  log$3.info(`Registering MCP: ${name} (type: ${config.type})`);
  try {
    const client2 = getClient(openCodePort, directory);
    const sdkConfig = config.type === "local" ? {
      type: "local",
      command: config.command ?? [],
      environment: config.environment,
      timeout: config.timeout
    } : {
      type: "remote",
      url: config.url ?? "",
      timeout: config.timeout
    };
    const response = await client2.mcp.add(
      { name, config: sdkConfig },
      { signal: AbortSignal.timeout(MCP_OPERATION_TIMEOUT_MS) }
    );
    if (response.error) {
      const rawError = response.error;
      const error = typeof rawError === "string" ? rawError : `Failed to register MCP: ${name}`;
      log$3.error(`Failed to register MCP ${name}: ${error}`);
      return { ok: false, error };
    }
    log$3.info(`Successfully registered MCP: ${name}`);
    return { ok: true };
  } catch (err) {
    const error = errorMessage(err);
    log$3.error(`Failed to register MCP ${name}: ${error}`);
    return { ok: false, error };
  }
}
async function startMcpAuth(openCodePort, mcpName, directory) {
  log$3.info(`Starting MCP auth: ${mcpName}`);
  try {
    const client2 = getClient(openCodePort, directory);
    const response = await client2.mcp.auth.start(
      { name: mcpName },
      { signal: AbortSignal.timeout(MCP_OPERATION_TIMEOUT_MS) }
    );
    if (response.error) {
      const rawError = response.error;
      const error = typeof rawError === "string" ? rawError : `Failed to start MCP auth: ${mcpName}`;
      log$3.error(`Failed to start MCP auth ${mcpName}: ${error}`);
      return { ok: false, error };
    }
    if (!response.data?.authorizationUrl) {
      const error = `Missing authorization URL for MCP auth: ${mcpName}`;
      log$3.error(error);
      return { ok: false, error };
    }
    return { ok: true, authorizationUrl: response.data.authorizationUrl };
  } catch (err) {
    const error = errorMessage(err);
    log$3.error(`Failed to start MCP auth ${mcpName}: ${error}`);
    return { ok: false, error };
  }
}
async function callbackMcpAuth(openCodePort, mcpName, code, directory) {
  log$3.info(`Completing MCP auth callback: ${mcpName}`);
  try {
    const client2 = getClient(openCodePort, directory);
    const response = await client2.mcp.auth.callback(
      { name: mcpName, code },
      { signal: AbortSignal.timeout(MCP_OPERATION_TIMEOUT_MS) }
    );
    if (response.error) {
      const rawError = response.error;
      const error = typeof rawError === "string" ? rawError : `Failed to complete MCP auth callback: ${mcpName}`;
      log$3.error(`Failed to complete MCP auth callback ${mcpName}: ${error}`);
      return { ok: false, error };
    }
    if (!response.data) {
      const error = `Missing status from MCP auth callback: ${mcpName}`;
      log$3.error(error);
      return { ok: false, error };
    }
    const mapped = mapSdkStatus(response.data);
    return {
      ok: true,
      status: mapped === "disabled" ? "disconnected" : mapped
    };
  } catch (err) {
    const error = errorMessage(err);
    log$3.error(`Failed to complete MCP auth callback ${mcpName}: ${error}`);
    return { ok: false, error };
  }
}
async function authenticateMcp(openCodePort, mcpName, directory) {
  log$3.info(`Authenticating MCP: ${mcpName}`);
  try {
    const client2 = getClient(openCodePort, directory);
    const response = await client2.mcp.auth.authenticate(
      { name: mcpName },
      { signal: AbortSignal.timeout(MCP_OPERATION_TIMEOUT_MS) }
    );
    if (response.error) {
      const rawError = response.error;
      const error = typeof rawError === "string" ? rawError : `Failed to authenticate MCP: ${mcpName}`;
      log$3.error(`Failed to authenticate MCP ${mcpName}: ${error}`);
      return { ok: false, error };
    }
    if (!response.data) {
      const error = `Missing status from MCP authenticate: ${mcpName}`;
      log$3.error(error);
      return { ok: false, error };
    }
    const mapped = mapSdkStatus(response.data);
    return {
      ok: true,
      status: mapped === "disabled" ? "disconnected" : mapped
    };
  } catch (err) {
    const error = errorMessage(err);
    log$3.error(`Failed to authenticate MCP ${mcpName}: ${error}`);
    return { ok: false, error };
  }
}
async function removeMcpAuth(openCodePort, mcpName, directory) {
  log$3.info(`Removing MCP auth: ${mcpName}`);
  try {
    const client2 = getClient(openCodePort, directory);
    const response = await client2.mcp.auth.remove(
      { name: mcpName },
      { signal: AbortSignal.timeout(MCP_OPERATION_TIMEOUT_MS) }
    );
    if (response.error) {
      const rawError = response.error;
      const error = typeof rawError === "string" ? rawError : `Failed to remove MCP auth: ${mcpName}`;
      log$3.error(`Failed to remove MCP auth ${mcpName}: ${error}`);
      return { ok: false, error };
    }
    return { ok: true };
  } catch (err) {
    const error = errorMessage(err);
    log$3.error(`Failed to remove MCP auth ${mcpName}: ${error}`);
    return { ok: false, error };
  }
}
const ipcLog$1 = createLogger("ipc");
function registerMcpStatusHandlers(deps) {
  ipcMain.handle(
    "fetch-mcp-status",
    async (_event, { directory } = {}) => {
      const settings = deps.getSettings();
      if (settings.agentBackend !== "opencode") {
        return { ok: false, error: "Not in OpenCode mode" };
      }
      return fetchMcpStatus(settings.openCodePort, directory);
    }
  );
  ipcMain.handle(
    "connect-mcp",
    async (_event, { name, directory }) => {
      ipcLog$1.info(
        `connect-mcp: name=${name} directory=${directory ?? "(none)"}`
      );
      const settings = deps.getSettings();
      if (settings.agentBackend !== "opencode") {
        return { ok: false, error: "Not in OpenCode mode" };
      }
      return connectMcp(settings.openCodePort, name, directory);
    }
  );
  ipcMain.handle(
    "disconnect-mcp",
    async (_event, { name, directory }) => {
      ipcLog$1.info(
        `disconnect-mcp: name=${name} directory=${directory ?? "(none)"}`
      );
      const settings = deps.getSettings();
      if (settings.agentBackend !== "opencode") {
        return { ok: false, error: "Not in OpenCode mode" };
      }
      return disconnectMcp(settings.openCodePort, name, directory);
    }
  );
  ipcMain.handle(
    "register-mcp",
    async (_event, {
      name,
      config,
      directory
    }) => {
      ipcLog$1.info(
        `register-mcp: name=${name} type=${config.type} directory=${directory ?? "(none)"}`
      );
      const settings = deps.getSettings();
      if (settings.agentBackend !== "opencode") {
        return { ok: false, error: "Not in OpenCode mode" };
      }
      return registerMcp(settings.openCodePort, name, config, directory);
    }
  );
  ipcMain.handle(
    "start-mcp-auth",
    async (_event, { name, directory }) => {
      ipcLog$1.info(
        `start-mcp-auth: name=${name} directory=${directory ?? "(none)"}`
      );
      const settings = deps.getSettings();
      if (settings.agentBackend !== "opencode") {
        return { ok: false, error: "Not in OpenCode mode" };
      }
      return startMcpAuth(settings.openCodePort, name, directory);
    }
  );
  ipcMain.handle(
    "callback-mcp-auth",
    async (_event, {
      name,
      code,
      directory
    }) => {
      ipcLog$1.info(
        `callback-mcp-auth: name=${name} directory=${directory ?? "(none)"}`
      );
      const settings = deps.getSettings();
      if (settings.agentBackend !== "opencode") {
        return { ok: false, error: "Not in OpenCode mode" };
      }
      return callbackMcpAuth(settings.openCodePort, name, code, directory);
    }
  );
  ipcMain.handle(
    "authenticate-mcp",
    async (_event, { name, directory }) => {
      ipcLog$1.info(
        `authenticate-mcp: name=${name} directory=${directory ?? "(none)"}`
      );
      const settings = deps.getSettings();
      if (settings.agentBackend !== "opencode") {
        return { ok: false, error: "Not in OpenCode mode" };
      }
      return authenticateMcp(settings.openCodePort, name, directory);
    }
  );
  ipcMain.handle(
    "remove-mcp-auth",
    async (_event, { name, directory }) => {
      ipcLog$1.info(
        `remove-mcp-auth: name=${name} directory=${directory ?? "(none)"}`
      );
      const settings = deps.getSettings();
      if (settings.agentBackend !== "opencode") {
        return { ok: false, error: "Not in OpenCode mode" };
      }
      return removeMcpAuth(settings.openCodePort, name, directory);
    }
  );
}
const DEFAULT_MCP_NAME = "interactive-desktop";
const MCP_REGISTER_REQUEST_TIMEOUT_MS = 1e4;
const MCP_TIMEOUT_BUFFER_MS$1 = 6e4;
function computeRemoteMcpTimeout(promptTimeoutSeconds = 1200) {
  return promptTimeoutSeconds * 1e3 + MCP_TIMEOUT_BUFFER_MS$1;
}
async function registerMcpWithRetry(options, _register = registerMcpWithOpenCode) {
  const {
    maxRetries = 5,
    initialDelayMs = 2e3,
    maxDelayMs = 3e4,
    signal,
    ...registrationOptions
  } = options;
  let lastResult = await _register(registrationOptions);
  if (lastResult.status !== "unreachable") {
    return lastResult;
  }
  let delay = initialDelayMs;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      return lastResult;
    }
    console.log(
      `[mcp-register] retry ${attempt}/${maxRetries} in ${delay}ms...`
    );
    await new Promise((resolve2) => setTimeout(resolve2, delay));
    if (signal?.aborted) {
      return lastResult;
    }
    lastResult = await _register(registrationOptions);
    if (lastResult.status !== "unreachable") {
      return lastResult;
    }
    delay = Math.min(delay * 2, maxDelayMs);
  }
  return lastResult;
}
async function registerMcpWithOpenCode(options) {
  const {
    appPort,
    openCodePort,
    mcpName = DEFAULT_MCP_NAME,
    promptTimeoutSeconds,
    baseDirectory
  } = options;
  try {
    const client2 = getClient(openCodePort, baseDirectory);
    const response = await client2.mcp.add(
      {
        name: mcpName,
        config: {
          type: "remote",
          url: `http://localhost:${appPort}/mcp`,
          timeout: computeRemoteMcpTimeout(promptTimeoutSeconds)
        }
      },
      { signal: AbortSignal.timeout(MCP_REGISTER_REQUEST_TIMEOUT_MS) }
    );
    if (response.error) {
      const errorValue = response.error;
      const errorMessage2 = typeof errorValue === "string" ? errorValue : errorValue && typeof errorValue === "object" && "message" in errorValue ? String(errorValue.message) : `OpenCode returned error`;
      return {
        status: "error",
        error: errorMessage2
      };
    }
    return { status: "registered" };
  } catch (err) {
    const message = errorMessage(err);
    const isConnectionError = message.includes("ECONNREFUSED") || message.includes("fetch failed") || message.includes("network") || message.includes("timeout");
    return {
      status: isConnectionError ? "unreachable" : "error",
      error: message
    };
  }
}
async function registerMcpAcrossReachablePorts(options) {
  return registerMcpWithOpenCode(options);
}
const OPENCODE_CONFIG_FILE = getGlobalOpencodeConfigPath();
const DEFAULT_PROMPT_TIMEOUT_S = 800;
const MCP_TIMEOUT_BUFFER_MS = 6e4;
function computeMcpTimeout(promptTimeoutSeconds) {
  return promptTimeoutSeconds * 1e3 + MCP_TIMEOUT_BUFFER_MS;
}
function syncRemoteConfig(appPort, promptTimeoutSeconds) {
  const mcpTimeout = computeMcpTimeout(
    promptTimeoutSeconds ?? DEFAULT_PROMPT_TIMEOUT_S
  );
  const desiredUrl = `http://localhost:${appPort}/mcp`;
  if (!existsSync(OPENCODE_CONFIG_FILE)) {
    return "opencode-config-missing";
  }
  let raw;
  try {
    raw = readFileSync$1(OPENCODE_CONFIG_FILE, "utf-8");
  } catch {
    return "read-error";
  }
  const stripped = stripJsonComments(raw);
  let config;
  try {
    config = JSON.parse(stripped);
  } catch {
    return "parse-error";
  }
  if (!config.mcp || typeof config.mcp !== "object") {
    config.mcp = {};
  }
  const mcp = config.mcp;
  const existing = mcp["interactive-desktop"];
  let needsWrite = false;
  for (const staleKey of ["interactive-bridge"]) {
    if (staleKey in mcp) {
      delete mcp[staleKey];
      needsWrite = true;
    }
  }
  const alreadyCurrent = existing && existing.type === "remote" && existing.url === desiredUrl && existing.timeout === mcpTimeout && !existing.command;
  if (alreadyCurrent && !needsWrite) {
    return "already-current";
  }
  if (!alreadyCurrent) {
    mcp["interactive-desktop"] = {
      type: "remote",
      url: desiredUrl,
      timeout: mcpTimeout
    };
  }
  try {
    writeFileSync(
      OPENCODE_CONFIG_FILE,
      JSON.stringify(config, null, 2) + "\n",
      "utf-8"
    );
  } catch {
    return "write-error";
  }
  return "updated";
}
getGlobalOpencodeDir();
const OPENCODE_GLOBAL_CONFIG_FILE = getGlobalOpencodeConfigPath();
const MANAGED_KEYS = [["mcp", "interactive-desktop"]];
function getPath(obj, path) {
  let cur = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== "object") return void 0;
    cur = cur[key];
  }
  return cur;
}
function setPath(target, path, value) {
  let cur = target;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const existing = cur[key];
    if (existing == null || typeof existing !== "object") {
      cur[key] = {};
    } else {
      cur[key] = { ...existing };
    }
    cur = cur[key];
  }
  cur[path[path.length - 1]] = value;
}
function mergePreservingManagedKeys(onDisk, incoming) {
  const toPreserve = [];
  for (const path of MANAGED_KEYS) {
    const val = getPath(onDisk ?? {}, path);
    if (val !== void 0) {
      toPreserve.push({ path, value: val });
    }
  }
  if (toPreserve.length === 0) {
    return incoming;
  }
  const merged = { ...incoming };
  for (const { path, value } of toPreserve) {
    setPath(merged, path, value);
  }
  return merged;
}
function assertSafeBaseDirectory(baseDirectory) {
  if (!baseDirectory || baseDirectory.trim() === "") {
    throw new Error("baseDirectory must be a non-empty string");
  }
  if (baseDirectory.includes("..")) {
    throw new Error(`baseDirectory must not contain '..': ${baseDirectory}`);
  }
}
function readConfigFile(filePath) {
  if (!existsSync(filePath)) {
    return { exists: false, config: null, filePath };
  }
  let raw;
  try {
    raw = readFileSync$1(filePath, "utf-8");
  } catch (err) {
    throw errWithCause(`Failed to read ${filePath}: ${errorMessage(err)}`, err);
  }
  const stripped = stripJsonComments(raw);
  try {
    const parsed = JSON.parse(stripped);
    return { exists: true, config: parsed, filePath };
  } catch (err) {
    throw errWithCause(
      `Failed to parse ${filePath}: ${errorMessage(err)}`,
      err
    );
  }
}
function writeConfigFile(filePath, config) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const serialized = JSON.stringify(config, null, 2) + "\n";
  try {
    writeFileSync(filePath, serialized, "utf-8");
  } catch (err) {
    throw errWithCause(
      `Failed to write ${filePath}: ${errorMessage(err)}`,
      err
    );
  }
  return { filePath };
}
function readGlobalConfig() {
  return readConfigFile(OPENCODE_GLOBAL_CONFIG_FILE);
}
function writeGlobalConfig(config) {
  const existing = existsSync(OPENCODE_GLOBAL_CONFIG_FILE) ? readConfigFile(OPENCODE_GLOBAL_CONFIG_FILE).config : null;
  const merged = mergePreservingManagedKeys(existing, config);
  return writeConfigFile(OPENCODE_GLOBAL_CONFIG_FILE, merged);
}
function projectJsoncPath(baseDirectory) {
  return getProjectOpencodeConfigPath(baseDirectory, "jsonc");
}
function projectJsonPath(baseDirectory) {
  return getProjectOpencodeConfigPath(baseDirectory, "json");
}
function readProjectConfig(baseDirectory) {
  assertSafeBaseDirectory(baseDirectory);
  const jsoncPath = projectJsoncPath(baseDirectory);
  if (existsSync(jsoncPath)) {
    return readConfigFile(jsoncPath);
  }
  const jsonPath = projectJsonPath(baseDirectory);
  if (existsSync(jsonPath)) {
    return readConfigFile(jsonPath);
  }
  return { exists: false, config: null, filePath: jsoncPath };
}
function writeProjectConfig(baseDirectory, config) {
  assertSafeBaseDirectory(baseDirectory);
  const jsoncPath = projectJsoncPath(baseDirectory);
  const jsonPath = projectJsonPath(baseDirectory);
  let existing = null;
  if (existsSync(jsoncPath)) {
    existing = readConfigFile(jsoncPath).config;
  } else if (existsSync(jsonPath)) {
    existing = readConfigFile(jsonPath).config;
  }
  const merged = mergePreservingManagedKeys(existing, config);
  return writeConfigFile(jsoncPath, merged);
}
function registerOpenCodeCoreHandlers(deps) {
  ipcMain.handle(
    "sync-opencode-config",
    async (_event, baseDirectory) => {
      const settings = deps.getSettings();
      logIpcInfo(
        `sync-opencode-config: backend=${settings.agentBackend} baseDirectory=${baseDirectory ?? "<none>"}`
      );
      if (settings.agentBackend !== "opencode") {
        return "skipped: agentBackend is not opencode";
      }
      const regResult = await registerMcpAcrossReachablePorts({
        appPort: settings.port,
        openCodePort: settings.openCodePort,
        promptTimeoutSeconds: settings.promptTimeoutSeconds,
        baseDirectory
      });
      const syncResult = syncRemoteConfig(
        settings.port,
        settings.promptTimeoutSeconds
      );
      return `register=${regResult.status}, config=${syncResult}`;
    }
  );
  ipcMain.handle("read-opencode-global-config", async () => {
    try {
      return readGlobalConfig();
    } catch (err) {
      const message = errorMessage(err);
      logIpcInfo(`read-opencode-global-config failed: ${message}`);
      throw new Error(message, { cause: err });
    }
  });
  ipcMain.handle(
    "read-opencode-project-config",
    async (_event, baseDirectory) => {
      try {
        return readProjectConfig(baseDirectory);
      } catch (err) {
        const message = errorMessage(err);
        logIpcInfo(`read-opencode-project-config failed: ${message}`);
        throw new Error(message, { cause: err });
      }
    }
  );
  ipcMain.handle(
    "write-opencode-global-config",
    async (_event, config) => {
      try {
        return writeGlobalConfig(config);
      } catch (err) {
        const message = errorMessage(err);
        logIpcInfo(`write-opencode-global-config failed: ${message}`);
        throw new Error(message, { cause: err });
      }
    }
  );
  ipcMain.handle(
    "write-opencode-project-config",
    async (_event, data) => {
      try {
        return writeProjectConfig(data.baseDirectory, data.config);
      } catch (err) {
        const message = errorMessage(err);
        logIpcInfo(`write-opencode-project-config failed: ${message}`);
        throw new Error(message, { cause: err });
      }
    }
  );
  ipcMain.handle(
    "detect-opencode-session",
    async (_event, baseDirectory) => {
      return autoDetectOpenCodeSessionId(
        deps.getSettings().openCodePort,
        baseDirectory
      );
    }
  );
  ipcMain.handle(
    "resolve-session",
    async (_event, data) => {
      logIpcInfo(`resolve-session: connectionId=${data.connectionId}`);
      const settings = deps.getSettings();
      return resolveSession({
        connectionId: data.connectionId,
        backend: settings.agentBackend,
        openCodePort: settings.openCodePort,
        baseDirectory: data.baseDirectory
      });
    }
  );
  ipcMain.handle(
    "re-resolve-session",
    async (_event, data) => {
      const settings = deps.getSettings();
      return reResolveStaleSession({
        connectionId: data.connectionId,
        backend: settings.agentBackend,
        openCodePort: settings.openCodePort,
        baseDirectory: data.baseDirectory
      });
    }
  );
  ipcMain.handle("reconnect-mcp-server", async () => {
    logIpcInfo("reconnect-mcp-server: soft restart requested");
    const cleared = await softRestartMcpServer();
    return { ok: true, cleared };
  });
  ipcMain.handle("restart-mcp-server", async () => {
    await restartMcpServer();
    return true;
  });
}
async function fetchVcsInfo(openCodePort, baseDirectory) {
  try {
    const client2 = getClient(openCodePort, baseDirectory);
    const response = await client2.vcs.get(
      {},
      { signal: AbortSignal.timeout(3e3) }
    );
    if (response.error) return null;
    const data = response.data;
    if (!data) return null;
    return {
      branch: typeof data.branch === "string" ? data.branch : null,
      defaultBranch: typeof data.default_branch === "string" ? data.default_branch : null
    };
  } catch {
    return null;
  }
}
async function fetchSessionStatus(openCodePort) {
  try {
    const response = await sessionStatus(openCodePort, {
      signal: AbortSignal.timeout(3e3)
    });
    if (response.error) return null;
    const data = response.data;
    if (!data || typeof data !== "object") return null;
    const result = {};
    for (const [sessionId, status] of Object.entries(
      data
    )) {
      if (status && typeof status.type === "string") {
        result[sessionId] = {
          type: normalizeStatusType(status.type)
        };
      }
    }
    return result;
  } catch {
    return null;
  }
}
function normalizeStatusType(type) {
  switch (type.toLowerCase()) {
    case "busy":
      return "busy";
    case "idle":
      return "idle";
    case "error":
      return "error";
    default:
      return "unknown";
  }
}
async function fetchPendingPermissions(openCodePort, baseDirectory) {
  try {
    const client2 = getClient(openCodePort, baseDirectory);
    const result = await client2.permission.list();
    const permissions = result.data ?? [];
    return permissions.filter((item) => item?.id && item?.sessionID && item?.permission).map((item) => ({
      requestId: item.id,
      sessionID: item.sessionID,
      permission: item.permission,
      patterns: item.patterns,
      always: item.always,
      tool: item.tool,
      metadata: item.metadata && typeof item.metadata === "object" ? item.metadata : void 0
    }));
  } catch {
    return [];
  }
}
const questionLog = createLogger("question");
let _questionClientFactory = (openCodePort, directory) => createOpencodeClient({
  baseUrl: `http://localhost:${openCodePort}`,
  directory
});
async function fetchPendingQuestions(openCodePort) {
  try {
    const client2 = _questionClientFactory(openCodePort);
    const result = await client2.question.list();
    const questions = result.data ?? [];
    return questions.filter((item) => item?.id && item?.sessionID).map((item) => ({
      requestId: item.id,
      sessionID: item.sessionID,
      questions: item.questions ?? [],
      tool: item.tool
    }));
  } catch (err) {
    questionLog.error(`fetchPendingQuestions error: ${errorMessage(err)}`);
    return [];
  }
}
async function replyToOpenCodeQuestion(openCodePort, requestID, answers, sessionID) {
  try {
    const registered = getRegisteredConnectionBySessionId(
      sessionID,
      "opencode"
    );
    const effectiveDirectory = registered?.baseDirectory ?? void 0;
    const client2 = _questionClientFactory(openCodePort, effectiveDirectory);
    questionLog.info(
      `reply start session=${sessionID} request=${requestID} answers=${JSON.stringify(answers)} directory=${effectiveDirectory ?? "(none)"} baseDirectory=${registered?.baseDirectory ?? "(none)"}`
    );
    const result = await client2.question.reply({
      requestID,
      answers,
      directory: effectiveDirectory
    });
    if (result.error) {
      questionLog.error(
        `reply error session=${sessionID} request=${requestID} error=${String(result.error)}`
      );
      return { ok: false, error: String(result.error) };
    }
    try {
      const listResult = await client2.question.list({
        directory: effectiveDirectory
      });
      const stillPending = (listResult.data ?? []).some(
        (item) => item?.id === requestID
      );
      if (stillPending) {
        questionLog.error(
          `reply not delivered session=${sessionID} request=${requestID} directory=${effectiveDirectory ?? "(none)"} — request still present after reply`
        );
        return { ok: false, error: "reply not delivered" };
      }
    } catch (listErr) {
      questionLog.warn(
        `reply verification list failed session=${sessionID} request=${requestID} error=${listErr instanceof Error ? listErr.message : String(listErr)}`
      );
    }
    questionLog.info(`reply success session=${sessionID} request=${requestID}`);
    return { ok: true };
  } catch (err) {
    const message = errorMessage(err);
    questionLog.error(
      `reply exception session=${sessionID} request=${requestID} error=${message}`
    );
    return { ok: false, error: message };
  }
}
async function rejectOpenCodeQuestion(openCodePort, requestID, sessionID) {
  try {
    const registered = getRegisteredConnectionBySessionId(
      sessionID,
      "opencode"
    );
    const effectiveDirectory = registered?.baseDirectory ?? void 0;
    const client2 = _questionClientFactory(openCodePort, effectiveDirectory);
    questionLog.info(
      `reject start session=${sessionID} request=${requestID} directory=${effectiveDirectory ?? "(none)"} baseDirectory=${registered?.baseDirectory ?? "(none)"}`
    );
    const result = await client2.question.reject({
      requestID,
      directory: effectiveDirectory
    });
    if (result.error) {
      questionLog.error(
        `reject error session=${sessionID} request=${requestID} error=${String(result.error)}`
      );
      return { ok: false, error: String(result.error) };
    }
    questionLog.info(
      `reject success session=${sessionID} request=${requestID}`
    );
    return { ok: true };
  } catch (err) {
    const message = errorMessage(err);
    questionLog.error(
      `reject exception session=${sessionID} request=${requestID} error=${message}`
    );
    return { ok: false, error: message };
  }
}
function createSnippet(text, query) {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIndex = lowerText.indexOf(lowerQuery);
  if (matchIndex === -1) {
    return text.length > 150 ? text.slice(0, 147) + "..." : text;
  }
  const snippetLength = 150;
  const contextBefore = 50;
  let start = Math.max(0, matchIndex - contextBefore);
  const end = Math.min(text.length, start + snippetLength);
  if (end === text.length && end - start < snippetLength) {
    start = Math.max(0, end - snippetLength);
  }
  let snippet = text.slice(start, end);
  if (start > 0) {
    snippet = "..." + snippet;
  }
  if (end < text.length) {
    snippet = snippet + "...";
  }
  return snippet;
}
function searchGlobal(query, options = {}) {
  const { sessionLimit = 20, messageLimit = 20 } = options;
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return { sessions: [], messages: [] };
  }
  const db2 = getDbInstance();
  if (!db2) {
    return { sessions: [], messages: [] };
  }
  const sessions = searchSessions(db2, trimmedQuery, sessionLimit);
  const messages = searchMessages(db2, trimmedQuery, messageLimit);
  return { sessions, messages };
}
function searchSessions(db2, query, limit) {
  if (!db2) return [];
  const searchPattern = `%${query}%`;
  const rows = db2.prepare(
    `SELECT 
         sc.session_id,
         COALESCE(rc.agent_name, sc.label, sc.session_id) as channel_name,
         COALESCE(rc.project_name, '') as project_name,
         sc.created_at,
         COALESCE(rc.updated_at, sc.created_at) as updated_at
       FROM session_channels sc
       LEFT JOIN registered_connections rc ON rc.provider_session_id = sc.session_id
       WHERE (
         sc.label LIKE ? COLLATE NOCASE
         OR sc.session_id LIKE ? COLLATE NOCASE
         OR rc.agent_name LIKE ? COLLATE NOCASE
         OR rc.project_name LIKE ? COLLATE NOCASE
       )
       ORDER BY COALESCE(rc.updated_at, sc.created_at) DESC
       LIMIT ?`
  ).all(
    searchPattern,
    searchPattern,
    searchPattern,
    searchPattern,
    limit
  );
  return rows.map((row) => ({
    sessionId: row.session_id,
    channelName: row.channel_name,
    projectName: row.project_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}
function searchMessages(db2, query, limit) {
  if (!db2) return [];
  const searchPattern = `%${query}%`;
  const rows = db2.prepare(
    `SELECT 
         sch.id,
         sch.session_id,
         COALESCE(rc.agent_name, sc.label, sch.session_id) as session_name,
         sch.message_type,
         sch.message_text,
         sch.created_at
       FROM session_channel_history sch
       LEFT JOIN session_channels sc ON sc.session_id = sch.session_id
       LEFT JOIN registered_connections rc ON rc.provider_session_id = sch.session_id
       WHERE sch.message_text LIKE ? COLLATE NOCASE
       ORDER BY sch.created_at DESC
       LIMIT ?`
  ).all(searchPattern, limit);
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    sessionName: row.session_name || row.session_id,
    messageType: row.message_type,
    messageText: row.message_text,
    snippet: createSnippet(row.message_text, query),
    createdAt: row.created_at
  }));
}
function registerOpenCodeStatusHandlers(deps) {
  ipcMain.handle(
    "get-pending-permissions",
    async (_event, baseDirectory) => {
      const { openCodePort, agentBackend } = deps.getSettings();
      if (agentBackend !== "opencode") {
        return [];
      }
      return fetchPendingPermissions(openCodePort, baseDirectory);
    }
  );
  ipcMain.handle("get-pending-questions", async () => {
    const { openCodePort, agentBackend } = deps.getSettings();
    if (agentBackend !== "opencode") {
      return [];
    }
    return fetchPendingQuestions(openCodePort);
  });
  ipcMain.handle(
    "check-opencode-health",
    async () => {
      const { openCodePort, agentBackend } = deps.getSettings();
      console.log(
        `[health-check] agentBackend=${agentBackend} openCodePort=${openCodePort}`
      );
      if (agentBackend !== "opencode") {
        console.log(
          `[health-check] Backend is not opencode, returning unavailable`
        );
        return {
          available: false,
          healthy: false,
          version: null,
          error: `OpenCode backend not enabled (current: ${agentBackend})`
        };
      }
      const result = await checkOpenCodeHealth(openCodePort);
      console.log(
        `[health-check] Result: available=${result.available} healthy=${result.healthy} error=${result.error ?? "none"}`
      );
      return result;
    }
  );
  ipcMain.handle(
    "fetch-vcs-info",
    async (_event, baseDirectory) => {
      const { openCodePort, agentBackend } = deps.getSettings();
      if (agentBackend !== "opencode") {
        return null;
      }
      return fetchVcsInfo(openCodePort, baseDirectory);
    }
  );
  ipcMain.handle(
    "fetch-session-status",
    async () => {
      const { openCodePort, agentBackend } = deps.getSettings();
      if (agentBackend !== "opencode") {
        return null;
      }
      return fetchSessionStatus(openCodePort);
    }
  );
  ipcMain.handle(
    "search-global",
    (_event, data) => {
      return searchGlobal(data.query, {
        sessionLimit: data.sessionLimit,
        messageLimit: data.messageLimit
      });
    }
  );
}
let _cachedCommands = null;
async function fetchCommands(openCodePort, baseDirectory) {
  try {
    const client2 = getClient(openCodePort, baseDirectory);
    const response = await client2.command.list(void 0, {
      signal: AbortSignal.timeout(5e3)
    });
    if (response.error) return null;
    const data = response.data;
    if (!data?.commands) return null;
    _cachedCommands = data.commands;
    return data.commands;
  } catch {
    return null;
  }
}
async function executeCommand(openCodePort, sessionId, commandName, args, baseDirectory) {
  const argsString = args && Object.keys(args).length > 0 ? Object.entries(args).map(([k, v]) => `${k}=${v}`).join(" ") : void 0;
  try {
    const response = await sessionCommand(
      openCodePort,
      sessionId,
      {
        command: commandName,
        arguments: argsString
      },
      { signal: AbortSignal.timeout(3e4), directory: baseDirectory }
    );
    if (response.error) {
      return { ok: false, error: "Command execution failed" };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Command failed"
    };
  }
}
const ipcLog = createLogger("ipc");
function registerProviderHandlers(deps) {
  ipcMain.handle("fetch-providers", async () => {
    const settings = deps.getSettings();
    if (settings.agentBackend !== "opencode") {
      return null;
    }
    return fetchProviders(settings.openCodePort);
  });
  ipcMain.handle("fetch-providers-info", async () => {
    const settings = deps.getSettings();
    if (settings.agentBackend !== "opencode") {
      return null;
    }
    return fetchProvidersInfo(settings.openCodePort);
  });
  ipcMain.handle("fetch-commands", async (_event, baseDirectory) => {
    const settings = deps.getSettings();
    if (settings.agentBackend !== "opencode") {
      return [];
    }
    return fetchCommands(settings.openCodePort, baseDirectory);
  });
  ipcMain.handle(
    "execute-command",
    async (_event, {
      sessionId,
      commandName,
      args,
      baseDirectory
    }) => {
      const settings = deps.getSettings();
      if (settings.agentBackend !== "opencode") {
        return { ok: false, error: "Not in OpenCode mode" };
      }
      return executeCommand(
        settings.openCodePort,
        sessionId,
        commandName,
        args,
        baseDirectory
      );
    }
  );
  ipcMain.handle("fetch-provider-auth-methods", async () => {
    const settings = deps.getSettings();
    if (settings.agentBackend !== "opencode") {
      return null;
    }
    return fetchProviderAuthMethods(settings.openCodePort);
  });
  ipcMain.handle(
    "authorize-provider",
    async (_event, {
      providerId,
      method,
      inputs
    }) => {
      ipcLog.info(
        `authorize-provider: providerId=${providerId} method=${method}`
      );
      const settings = deps.getSettings();
      if (settings.agentBackend !== "opencode") {
        return null;
      }
      return authorizeProvider(
        settings.openCodePort,
        providerId,
        method,
        inputs
      );
    }
  );
  ipcMain.handle(
    "callback-provider",
    async (_event, {
      providerId,
      method,
      code
    }) => {
      const settings = deps.getSettings();
      if (settings.agentBackend !== "opencode") {
        return false;
      }
      return callbackProvider(settings.openCodePort, providerId, method, code);
    }
  );
  ipcMain.handle(
    "set-provider-api-key",
    async (_event, {
      providerId,
      apiKey
    }) => {
      const settings = deps.getSettings();
      if (settings.agentBackend !== "opencode") {
        return false;
      }
      return setProviderApiKey(settings.openCodePort, providerId, apiKey);
    }
  );
}
async function handleInjectDocContext(input, deps) {
  const { connectionId, openCodeSessionId, message, debug = false } = input;
  let baseDirectory = input.baseDirectory ?? null;
  const conn = deps.getRegisteredConnection(connectionId);
  if (!baseDirectory) {
    baseDirectory = conn?.baseDirectory ?? null;
  }
  if (!baseDirectory) {
    return { ok: true, injectedCount: 0 };
  }
  const sessionConn = openCodeSessionId && deps.getRegisteredConnectionBySessionId ? deps.getRegisteredConnectionBySessionId(openCodeSessionId) : null;
  const effectiveConn = sessionConn ?? conn;
  if (effectiveConn?.parentSessionId) {
    return { ok: true, injectedCount: 0 };
  }
  let results;
  try {
    results = await deps.searchDocs(message, baseDirectory, 5);
  } catch (err) {
    const msg = errorMessage(err);
    return { ok: false, injectedCount: 0, error: `searchDocs failed: ${msg}` };
  }
  if (results.length === 0) {
    return { ok: true, injectedCount: 0 };
  }
  const innerText = [
    `Relevant repository documentation for this message:`,
    "",
    formatSearchResults(results, message),
    "",
    "Use the Read tool or find_repo_docs tool to access full content of any listed file."
  ].join("\n");
  const summaryText = debug ? innerText : `<system-reminder>
${innerText}
</system-reminder>`;
  if (!openCodeSessionId) {
    const standaloneProviderSessionId = effectiveConn?.providerSessionId;
    if (!standaloneProviderSessionId) {
      return {
        ok: false,
        injectedCount: 0,
        error: `No provider session found for connectionId=${connectionId}`
      };
    }
    deps.upsertContextInjection(
      standaloneProviderSessionId,
      "standalone",
      summaryText,
      "doc-context",
      "doc-context"
    );
    const visibleSummary2 = [
      `**Context queued for agent (${results.length} docs):**`,
      ...results.map((r, i) => `${i + 1}. \`${r.path}\``)
    ].join("\n");
    deps.sendAgentMessage(standaloneProviderSessionId, visibleSummary2);
    return { ok: true, injectedCount: results.length };
  }
  const injectResult = await deps.injectOpenCodeMessage(
    openCodeSessionId,
    summaryText,
    void 0,
    deps.openCodePort
  );
  if (!injectResult.ok) {
    return {
      ok: false,
      injectedCount: 0,
      error: `doc context inject failed: ${injectResult.error}`
    };
  }
  const visibleSummary = [
    `**Context injected (${results.length} docs):**`,
    ...results.map((r, i) => `${i + 1}. \`${r.path}\``)
  ].join("\n");
  deps.sendAgentMessage(openCodeSessionId, visibleSummary);
  return { ok: true, injectedCount: results.length };
}
function registerSessionChannelHandlers(deps) {
  ipcMain.handle(
    "save-clipboard-attachment",
    (_event, payload) => {
      if (!payload || typeof payload.data !== "string" || typeof payload.sessionKey !== "string" || !payload.sessionKey) {
        return null;
      }
      const filename = saveAttachment(
        payload.sessionKey,
        payload.data,
        payload.mimeType || "image/png"
      );
      if (!filename) return null;
      const dir = getAttachmentsDir(payload.sessionKey);
      const absolutePath = dir ? join(dir, filename) : null;
      const { port: mcpServerPort } = deps.getSettings();
      const url = typeof mcpServerPort === "number" && mcpServerPort > 0 ? attachmentUrl(payload.sessionKey, filename, mcpServerPort) : null;
      return { filename, absolutePath, url };
    }
  );
  ipcMain.handle(
    "get-persisted-session-channels",
    () => getActiveSessionChannels()
  );
  ipcMain.handle(
    "get-session-channel-history",
    (_event, sessionId) => getSessionChannelHistory(sessionId)
  );
  ipcMain.handle(
    "clear-session-channel-messages",
    (_event, sessionId) => {
      clearSessionChannelMessages(sessionId);
      deps.getMainWindow()?.webContents.send("session-channel-messages-cleared", { sessionId });
      return true;
    }
  );
  ipcMain.handle("remove-session-channel", (_event, sessionId) => {
    return removePersistedSession(sessionId, {
      getWindow: deps.getMainWindow,
      getOpenCodePort: () => deps.getSettings().openCodePort,
      forceTerminateChat,
      closeSessionByConnectionId,
      deleteSessionChannel,
      deleteRegisteredConnection,
      markSessionDeleted,
      invalidate: invalidateSessionTree,
      getRegisteredConnection,
      tombstoneOpenCodeSession
    });
  });
  ipcMain.on(
    "queue-session-message",
    (_event, data) => {
      logIpcInfo(
        `[queue-session-message] sessionId=${data.sessionId} messageLength=${data.message.length}`
      );
      const outbound = withSkillSuggestion(data.message);
      queueSessionMessage(data.sessionId, outbound);
      logIpcInfo(
        `[queue-session-message] queued to sessionId=${data.sessionId}`
      );
    }
  );
  ipcMain.handle(
    "inject-opencode-message",
    async (_event, data) => {
      logIpcInfo(
        `[inject-opencode-message] openCodeSessionId=${data.openCodeSessionId} noReply=${data.noReply ?? true} messageLength=${data.message.length} attachments=${data.attachments?.length ?? 0} agent=${data.agent ?? "(none)"}`
      );
      const outbound = withSkillSuggestion(data.message);
      const result = await injectOpenCodeMessage(
        data.openCodeSessionId,
        outbound,
        data.attachments,
        deps.getSettings().openCodePort,
        deps.getSettings().port,
        data.noReply ?? true,
        data.modelOverride,
        void 0,
        data.agent
      );
      logIpcInfo(
        `[inject-opencode-message] result ok=${result.ok} error=${result.error ?? "none"} openCodeSessionId=${data.openCodeSessionId}`
      );
      return result;
    }
  );
  ipcMain.handle(
    "inject-claude-message",
    async (_event, data) => {
      const conn = getRegisteredConnection(data.connectionId);
      const providerSessionId = conn?.providerSessionId;
      if (!providerSessionId) {
        return {
          ok: false,
          error: `No provider session found for connectionId=${data.connectionId}`
        };
      }
      return injectClaudeMessageForConnection({
        providerSessionId,
        message: data.message,
        baseDirectory: data.baseDirectory,
        attachments: data.attachments
      });
    }
  );
  ipcMain.handle(
    "inject-doc-context",
    async (_event, data) => {
      const settings = deps.getSettings();
      return handleInjectDocContext(
        { ...data, debug: settings.docContextDebug },
        {
          openCodePort: settings.openCodePort,
          getRegisteredConnection,
          searchDocs,
          injectOpenCodeMessage,
          upsertContextInjection,
          sendAgentMessage: (providerSessionId, message) => {
            sendAgentMessage(deps.getMainWindow(), providerSessionId, message);
          }
        }
      );
    }
  );
}
const permissionLog = createLogger("permission");
let _permissionClientFactory = (openCodePort, directory) => createOpencodeClient({
  baseUrl: `http://localhost:${openCodePort}`,
  directory
});
async function replyToOpenCodePermission(openCodePort, sessionID, requestID, reply, directory) {
  try {
    const registered = getRegisteredConnectionBySessionId(sessionID, "opencode");
    const effectiveDirectory = directory ?? registered?.baseDirectory ?? void 0;
    const client2 = _permissionClientFactory(
      openCodePort,
      effectiveDirectory
    );
    permissionLog.info(
      `reply start session=${sessionID} request=${requestID} reply=${reply} directory=${effectiveDirectory ?? "(none)"} baseDirectory=${registered?.baseDirectory ?? "(none)"}`
    );
    const result = await client2.permission.reply({
      requestID,
      reply,
      directory: effectiveDirectory
    });
    if (result.error) {
      permissionLog.error(
        `reply error session=${sessionID} request=${requestID} reply=${reply} error=${String(result.error)}`
      );
      return { ok: false, error: String(result.error) };
    }
    permissionLog.info(
      `reply success session=${sessionID} request=${requestID} reply=${reply}`
    );
    return { ok: true };
  } catch (err) {
    const message = errorMessage(err);
    permissionLog.error(
      `reply exception session=${sessionID} request=${requestID} reply=${reply} error=${message}`
    );
    return { ok: false, error: message };
  }
}
async function fetchTodosForSession(openCodePort, sessionId) {
  try {
    const response = await sessionTodo(openCodePort, sessionId, {
      signal: AbortSignal.timeout(3e3)
    });
    if (response.error) {
      console.warn(
        `[opencode-todo] SDK error for session ${sessionId}:`,
        response.error
      );
      return null;
    }
    const httpResponse = response.response;
    if (httpResponse && !httpResponse.ok) {
      console.warn(
        `[opencode-todo] HTTP error ${httpResponse.status} for session ${sessionId}`
      );
      return null;
    }
    const data = response.data;
    if (!Array.isArray(data)) {
      console.warn(
        `[opencode-todo] Invalid response format for session ${sessionId}`
      );
      return null;
    }
    return data.map((item) => ({
      content: typeof item.content === "string" ? item.content : "",
      status: isValidStatus(item.status) ? item.status : "pending",
      priority: isValidPriority(item.priority) ? item.priority : "medium"
    }));
  } catch (err) {
    if (err.name !== "AbortError") {
      console.warn(`[opencode-todo] Error fetching todos:`, err);
    }
    return null;
  }
}
function isValidStatus(value) {
  return value === "pending" || value === "in_progress" || value === "completed" || value === "cancelled";
}
function isValidPriority(value) {
  return value === "high" || value === "medium" || value === "low";
}
const abortLog = createLogger("abort");
async function abortOpenCodeSession(openCodePort, sessionId) {
  const registered = getRegisteredConnectionBySessionId(sessionId, "opencode");
  const effectiveDirectory = registered?.baseDirectory ?? void 0;
  try {
    abortLog.info(
      `start session=${sessionId} directory=${effectiveDirectory ?? "(none)"} baseDirectory=${registered?.baseDirectory ?? "(none)"}`
    );
    const response = await sessionAbort(openCodePort, sessionId, {
      directory: effectiveDirectory,
      signal: AbortSignal.timeout(5e3)
    });
    abortLog.info(
      `response session=${sessionId} data=${JSON.stringify(response.data)} error=${JSON.stringify(response.error)}`
    );
    if (response.error) {
      abortLog.warn(
        `error session=${sessionId} directory=${effectiveDirectory ?? "(none)"} error=${JSON.stringify(response.error)}`
      );
      return false;
    }
    const data = response.data;
    if (typeof data === "boolean") {
      if (!data) {
        abortLog.warn(
          `abort returned false session=${sessionId} directory=${effectiveDirectory ?? "(none)"} — opencode WorkspaceRouterMiddleware may have routed to the wrong Instance`
        );
      }
      return data;
    }
    abortLog.warn(
      `unexpected response format session=${sessionId} data=${JSON.stringify(data)}`
    );
    return false;
  } catch (err) {
    if (err.name !== "AbortError") {
      abortLog.warn(
        `exception session=${sessionId} directory=${effectiveDirectory ?? "(none)"} error=${errorMessage(err)}`
      );
    }
    return false;
  }
}
async function reconcileSessionConnections(openCodePort, baseDirectory) {
  const registeredConnections = getAllRegisteredConnections();
  const total = registeredConnections.length;
  if (!baseDirectory) {
    return { matched: 0, cleaned: 0, total };
  }
  const trimmedDirectory = baseDirectory.trim();
  if (trimmedDirectory.length === 0) {
    return { matched: 0, cleaned: 0, total };
  }
  const scopedConnections = registeredConnections.filter(
    (conn) => conn.baseDirectory?.trim() === trimmedDirectory
  );
  const allSessions = await fetchSessionsForDirectory(
    openCodePort,
    trimmedDirectory
  );
  if (!allSessions) {
    return { matched: 0, cleaned: 0, total };
  }
  const liveSessionIds = new Set(allSessions.map((s) => s.id));
  let matched = 0;
  let cleaned = 0;
  for (const conn of scopedConnections) {
    if (!conn.providerSessionId) continue;
    if (liveSessionIds.has(conn.providerSessionId)) {
      matched++;
      console.log(
        `[session-reconnect] matched connection "${conn.channelName}" (${conn.connectionId}) → session ${conn.providerSessionId}`
      );
    } else {
      deleteRegisteredConnection(conn.providerSessionId, conn.providerType);
      cleaned++;
      console.log(
        `[session-reconnect] cleaned stale connection "${conn.channelName}" (${conn.connectionId}) — session ${conn.providerSessionId} no longer exists`
      );
    }
  }
  return { matched, cleaned, total };
}
function registerSessionTreeHandlers(deps) {
  ipcMain.handle("get-session-tree", async () => {
    return fetchSessionTree();
  });
  ipcMain.handle("invalidate-session-tree", async () => {
    invalidateSessionTree();
  });
  ipcMain.handle(
    "set-selected-folder",
    async (_event, baseDirectory) => {
      const trimmed = baseDirectory?.trim() ?? "";
      const nextFolder = trimmed.length > 0 ? trimmed : null;
      if (getSelectedFolder() === nextFolder) {
        return;
      }
      logIpcInfo(
        `set-selected-folder: ${nextFolder ?? "(none)"} (was ${getSelectedFolder() ?? "(none)"})`
      );
      setSelectedFolder(nextFolder);
      if (nextFolder) {
        const { openCodePort } = deps.getSettings();
        await reconcileSessionConnections(openCodePort, nextFolder);
        invalidateSessionTree();
      }
    }
  );
  ipcMain.handle(
    "reply-permission",
    async (_event, data) => {
      const { openCodePort } = deps.getSettings();
      logIpcInfo(
        `reply-permission session=${data.sessionID} request=${data.requestID} reply=${data.reply}`
      );
      return replyToOpenCodePermission(
        openCodePort,
        data.sessionID,
        data.requestID,
        data.reply,
        data.directory
      );
    }
  );
  ipcMain.handle(
    "reply-question",
    async (_event, data) => {
      const { openCodePort } = deps.getSettings();
      logIpcInfo(
        `reply-question: requestID=${data.requestID} sessionID=${data.sessionID} answers=${JSON.stringify(data.answers)}`
      );
      const result = await replyToOpenCodeQuestion(
        openCodePort,
        data.requestID,
        data.answers,
        data.sessionID
      );
      logIpcInfo(`reply-question result: ${JSON.stringify(result)}`);
      return result;
    }
  );
  ipcMain.handle(
    "reject-question",
    async (_event, data) => {
      const { openCodePort } = deps.getSettings();
      logIpcInfo(
        `reject-question: requestID=${data.requestID} sessionID=${data.sessionID}`
      );
      const result = await rejectOpenCodeQuestion(
        openCodePort,
        data.requestID,
        data.sessionID
      );
      logIpcInfo(`reject-question result: ${JSON.stringify(result)}`);
      return result;
    }
  );
  ipcMain.handle(
    "fetch-session-todos",
    async (_event, sessionId) => {
      const { openCodePort } = deps.getSettings();
      const todos = await fetchTodosForSession(openCodePort, sessionId);
      if (todos === null) {
        return { todos: null, error: "Failed to fetch todos" };
      }
      return { todos };
    }
  );
  ipcMain.handle(
    "abort-session",
    async (_event, sessionId) => {
      const { openCodePort } = deps.getSettings();
      const success = await abortOpenCodeSession(openCodePort, sessionId);
      if (!success) {
        return { success: false, error: "Failed to abort session" };
      }
      return { success: true };
    }
  );
  ipcMain.handle(
    "create-opencode-session",
    async (_event, data) => {
      logIpcInfo(
        `create-opencode-session: title=${data.title ?? "(none)"} parentID=${data.parentID ?? "(none)"} baseDirectory=${data.baseDirectory ?? "(none)"} agent=${data.agent ?? "(none)"}`
      );
      const {
        openCodePort,
        agentBackend,
        port: mcpServerPort
      } = deps.getSettings();
      if (agentBackend !== "opencode") {
        return {
          ok: false,
          error: `OpenCode backend not enabled (current: ${agentBackend})`
        };
      }
      const hasAttachments = (data.attachments?.length ?? 0) > 0;
      const hasInitialMessage = (data.initialMessage?.trim().length ?? 0) > 0;
      const hasModelSelection = Boolean(data.modelSelection);
      const needsInject = (hasAttachments || hasModelSelection) && (hasAttachments || hasInitialMessage);
      logIpcInfo(
        `create-opencode-session flags: hasInitialMessage=${hasInitialMessage} hasAttachments=${hasAttachments} hasModelSelection=${hasModelSelection} needsInject=${needsInject}`
      );
      if (hasModelSelection) {
        logIpcInfo(
          `create-opencode-session modelSelection: providerId=${data.modelSelection?.providerId ?? "(none)"} modelId=${data.modelSelection?.modelId ?? "(none)"} variant=${data.modelSelection?.variant ?? "(none)"}`
        );
      }
      const result = await createOpenCodeSession(openCodePort, {
        title: data.title,
        parentID: data.parentID,
        initialMessage: !needsInject && hasInitialMessage ? data.initialMessage : void 0,
        directory: data.baseDirectory,
        agent: data.agent
      });
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      if (needsInject && result.session?.id) {
        const modelOverride = data.modelSelection ? {
          providerId: data.modelSelection.providerId,
          modelId: data.modelSelection.modelId,
          variant: data.modelSelection.variant
        } : void 0;
        const injectResult = await injectOpenCodeMessage(
          result.session.id,
          data.initialMessage ?? "",
          data.attachments,
          openCodePort,
          mcpServerPort,
          false,
          modelOverride,
          void 0,
          data.agent
        );
        if (!injectResult.ok) {
          console.warn(
            `[create-opencode-session] Session created but initial message injection failed: ${injectResult.error}`
          );
        }
      }
      if (data.baseDirectory && result.session?.id) {
        const existing = getRegisteredConnectionBySessionId(
          result.session.id,
          "opencode"
        );
        upsertRegisteredConnection({
          providerType: "opencode",
          providerSessionId: result.session.id,
          connectionId: existing?.connectionId ?? null,
          channelName: existing?.channelName ?? data.title ?? "New Session",
          projectName: existing?.projectName ?? basename(data.baseDirectory),
          baseDirectory: data.baseDirectory,
          parentSessionId: existing?.parentSessionId ?? data.parentID ?? null
        });
        const corrected = getRegisteredConnectionBySessionId(
          result.session.id,
          "opencode"
        );
        logIpcInfo(
          `[create-opencode-session] pre-refresh claim sessionId=${result.session.id} selectedBaseDirectory=${data.baseDirectory} finalBaseDirectory=${corrected?.baseDirectory ?? "(none)"} finalConnectionId=${corrected?.connectionId ?? "(none)"}`
        );
      }
      invalidateSessionTree();
      if (result.session?.id) {
        const refreshed = getRegisteredConnectionBySessionId(
          result.session.id,
          "opencode"
        );
        logIpcInfo(
          `[create-opencode-session] post-refresh sessionId=${result.session.id} selectedBaseDirectory=${data.baseDirectory ?? "(none)"} refreshedBaseDirectory=${refreshed?.baseDirectory ?? "(none)"} refreshedConnectionId=${refreshed?.connectionId ?? "(none)"}`
        );
      }
      if (data.baseDirectory && result.session?.id) {
        invalidateSessionTree();
      }
      return { ok: true, sessionId: result.session?.id };
    }
  );
}
const TIMEOUT_MS = 5e3;
function getUserShell() {
  return process.env.SHELL || "/bin/sh";
}
function parseShellEnv(out) {
  const env = {};
  for (const line of out.toString("utf8").split("\0")) {
    if (!line) continue;
    const ix = line.indexOf("=");
    if (ix <= 0) continue;
    env[line.slice(0, ix)] = line.slice(ix + 1);
  }
  return env;
}
function probe(shell2, mode) {
  const result = spawnSync(shell2, [mode, "-c", "env -0"], {
    stdio: ["ignore", "pipe", "ignore"],
    timeout: TIMEOUT_MS,
    windowsHide: true
  });
  const err = result.error;
  if (err) {
    if (err.code === "ETIMEDOUT") return { type: "Timeout" };
    console.log(
      `[shell-env] Probe failed for ${shell2} ${mode}: ${err.message}`
    );
    return { type: "Unavailable" };
  }
  if (result.status !== 0) {
    console.log(
      `[shell-env] Probe exited with non-zero status for ${shell2} ${mode}`
    );
    return { type: "Unavailable" };
  }
  const env = parseShellEnv(result.stdout);
  if (Object.keys(env).length === 0) {
    console.log(`[shell-env] Probe returned empty env for ${shell2} ${mode}`);
    return { type: "Unavailable" };
  }
  return { type: "Loaded", value: env };
}
function isNushell(shell2) {
  const name = basename$1(shell2).toLowerCase();
  const raw = shell2.toLowerCase();
  return name === "nu" || name === "nu.exe" || raw.endsWith("\\nu.exe");
}
function loadShellEnv(shell2 = getUserShell()) {
  if (isNushell(shell2)) {
    console.log(`[shell-env] Skipping probe for nushell: ${shell2}`);
    return null;
  }
  const interactive = probe(shell2, "-il");
  if (interactive.type === "Loaded") {
    console.log(
      `[shell-env] Loaded environment with -il (${Object.keys(interactive.value).length} vars)`
    );
    return interactive.value;
  }
  if (interactive.type === "Timeout") {
    console.warn(`[shell-env] Interactive shell probe timed out: ${shell2}`);
    return null;
  }
  const login = probe(shell2, "-l");
  if (login.type === "Loaded") {
    console.log(
      `[shell-env] Loaded environment with -l (${Object.keys(login.value).length} vars)`
    );
    return login.value;
  }
  console.warn(`[shell-env] Falling back to app environment: ${shell2}`);
  return null;
}
let listener = null;
let managedPort = null;
let startingPromise = null;
async function startOpenCodeServer(port) {
  if (listener && managedPort === port) {
    return;
  }
  if (startingPromise) {
    await startingPromise;
    if (listener && managedPort === port) return;
  }
  if (listener) {
    await stopOpenCodeServer();
  }
  startingPromise = (async () => {
    prepareServerEnv();
    const mod = await import("./node-Ckjy7vYG.mjs");
    try {
      await mod.Log.init({ level: "WARN" });
    } catch (err) {
      console.warn(
        `[opencode-server] Log.init failed (continuing): ${err instanceof Error ? err.message : String(err)}`
      );
    }
    console.log(
      `[opencode-server] Starting in-process Server.listen on 127.0.0.1:${port}`
    );
    listener = await mod.Server.listen({
      port,
      hostname: "127.0.0.1"
    });
    managedPort = port;
    console.log(`[opencode-server] Ready at ${listener.url}`);
  })();
  try {
    await startingPromise;
  } finally {
    startingPromise = null;
  }
}
async function stopOpenCodeServer() {
  if (!listener) return;
  console.log("[opencode-server] Stopping in-process listener...");
  const dying = listener;
  listener = null;
  managedPort = null;
  try {
    await dying.stop();
  } catch (err) {
    console.warn(
      `[opencode-server] listener.stop() threw (ignored): ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
function prepareServerEnv() {
  process.env.XDG_STATE_HOME = app.getPath("userData");
  process.env.OPENCODE_CLIENT = "desktop";
  if (process.platform !== "darwin" && process.platform !== "linux") {
    return;
  }
  const shell2 = getUserShell();
  const shellEnv = loadShellEnv(shell2);
  if (shellEnv) {
    const preserved = {
      XDG_STATE_HOME: process.env.XDG_STATE_HOME,
      OPENCODE_CLIENT: process.env.OPENCODE_CLIENT
    };
    for (const [key, value] of Object.entries(shellEnv)) {
      if (!(key in preserved)) {
        process.env[key] = value;
      }
    }
    Object.assign(process.env, preserved);
    console.log(
      `[opencode-server] Loaded shell environment from ${shell2} (${Object.keys(shellEnv).length} vars)`
    );
    return;
  }
  console.log(
    "[opencode-server] Shell probing failed, falling back to PATH augmentation"
  );
  augmentPathFallback();
}
function augmentPathFallback() {
  const home = process.env.HOME ?? "";
  const extraPaths = [
    // Homebrew (Apple Silicon)
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    // Homebrew (Intel)
    "/usr/local/bin",
    "/usr/local/sbin",
    // nvm (common default location)
    `${home}/.nvm/current/bin`,
    // volta
    `${home}/.volta/bin`,
    // nodenv
    `${home}/.nodenv/shims`,
    // fnm
    `${home}/.fnm/current/bin`,
    `${home}/Library/Application Support/fnm/current/bin`,
    // asdf
    `${home}/.asdf/shims`,
    // pnpm
    `${home}/.pnpm`,
    `${home}/Library/pnpm`,
    // npm global
    `${home}/.npm-global/bin`,
    // System paths
    "/usr/bin",
    "/bin"
  ].filter((p) => p.length > 0);
  const currentPath = process.env.PATH ?? "";
  const pathSet = new Set(currentPath.split(":").filter(Boolean));
  const newPaths = extraPaths.filter((p) => !pathSet.has(p));
  if (newPaths.length > 0) {
    process.env.PATH = [...newPaths, currentPath].filter(Boolean).join(":");
    console.log(
      `[opencode-server] Augmented PATH with ${newPaths.length} additional paths for MCP server spawning`
    );
  }
}
function registerSettingsHandlers(deps) {
  ipcMain.handle("get-settings", () => deps.getSettings());
  ipcMain.handle("save-settings", (_event, settings) => {
    const prev = deps.getSettings();
    const portChanged = settings.port !== prev.port;
    deps.setSettings(settings);
    saveSettings(settings);
    const mainWindow2 = deps.getMainWindow();
    if (mainWindow2) {
      mainWindow2.webContents.send("settings-changed");
    }
    if (app.isPackaged) {
      try {
        app.setLoginItemSettings({
          openAtLogin: settings.launchAtLogin,
          openAsHidden: settings.launchAtLogin
        });
      } catch {
      }
    }
    if (portChanged) {
      stopMcpServer();
      startMcpServer(
        settings.port,
        deps.getMainWindow,
        () => deps.getSettings().soundEnabled,
        () => deps.getSettings().promptTimeoutSeconds * 1e3,
        () => deps.getSettings().openCodePort,
        () => deps.getSettings().docIndexingEnabled,
        () => deps.getSettings().agentBackend
      );
    }
    const openCodeEnabled = settings.agentBackend === "opencode";
    const logOpenCodeError = (action) => (err) => {
      console.error(
        `[settings-handlers] OpenCode ${action} failed: ${err instanceof Error ? err.message : String(err)}`
      );
    };
    if (openCodeEnabled && settings.autoStartOpenCode) {
      if (!prev.autoStartOpenCode || settings.openCodePort !== prev.openCodePort) {
        void startOpenCodeServer(settings.openCodePort).catch(
          logOpenCodeError("start")
        );
      }
    } else if (prev.autoStartOpenCode) {
      void stopOpenCodeServer().catch(logOpenCodeError("stop"));
    }
    if (!openCodeEnabled) {
      void stopOpenCodeServer().catch(logOpenCodeError("stop"));
    }
    if (openCodeEnabled && settings.autoSyncOpencode) {
      const timeoutChanged = settings.promptTimeoutSeconds !== prev.promptTimeoutSeconds;
      const justEnabled = !prev.autoSyncOpencode;
      if (timeoutChanged || justEnabled || portChanged) {
        syncRemoteConfig(settings.port, settings.promptTimeoutSeconds);
      }
    }
    return true;
  });
}
const BUILTIN_TEMPLATES = [
  {
    name: "agent-orchestration",
    type: "skill",
    category: "Workflow",
    description: "Route tasks to specialized agents based on task type and scope. Main agent acts as orchestrator and prompting loop owner throughout.",
    content: `# agent-orchestration

Use this skill to decide when and how to delegate to specialized agents.

## Core principles

1. The main agent MUST remain the orchestrator and prompt-loop owner; sub-agents never talk to the user directly.
2. For mapped domains, the main agent MUST delegate unless the change is truly trivial (~30 seconds or less).
3. Delegation prompts MUST include a full context pack in one message: objective, scope, constraints, validation commands, and handoff format.
4. After empty/partial output, follow up with the same agent first before launching a new one.
5. If no meaningful progress after allowed attempts, stop delegating, execute directly, and report why.

## When to delegate

Delegate when a task clearly maps to a specialized domain:

- **Frontend implementation** → frontend specialist
- **Test creation/refactoring** → testing specialist  
- **Documentation sync** → docs maintainer
- **Accessibility audits** → a11y specialist
- **Infrastructure/DevOps** → infrastructure specialist
- **API/Backend changes** → backend specialist

**Exception**: trivial single-line fixes may be done directly. State why no specialist was used.

## Execution rules

1. **Single domain**: delegate to one matching specialist.
2. **Mixed domains**: split into independent subtasks and delegate each. Parallelize only when tasks have no shared state or output dependencies.
3. **No match**: fall back to main-agent workflow and explain why.
4. **Anti-recursion**: do not recursively re-delegate the same unresolved objective more than once.
5. **Anti-stall fallback**: if delegation stalls (timeouts, no progress), execute directly and report why.
6. **Large tasks**: decompose into smaller bounded subtasks with explicit completion criteria before delegation.

## Delegation prompt template

Every delegation MUST include:

\`\`\`
**Objective**: [one-sentence goal]

**Scope**: [files, projects, or directories in scope]

**Constraints**: 
- [files to avoid]
- [prior decisions to honor]
- [ordering requirements]

**Validation expected**: [what the agent must run/verify]

**Handoff format**: [structured output expected]
\`\`\`

## After delegation

1. Read the agent's full output.
2. Run any verifications the agent did not cover.
3. If output reveals new ambiguity, surface it to the user before proceeding.
4. If agent reports failure, retry once with refined prompt. If it fails again, execute directly.
5. Present a concise summary to the user and run the mandatory satisfaction check.`
  },
  {
    name: "agent-orchestration-policy",
    type: "instruction",
    category: "Workflow",
    description: "Policy for delegating work to specialized agents. Main agent is the orchestrator and user-interaction loop owner throughout.",
    content: `# Agent Orchestration Policy

## Main agent role

The main agent is the **orchestrator and user-interaction loop owner**. Specialized agents never interact with the user directly.

### Responsibilities at all times

- Use \`request_user_input\` to communicate with the user before, during, and after delegation.
- Confirm scope or approach with the user before delegating if there is **any ambiguity**.
- After delegation completes, review all outputs, run additional verifications if needed, and present a concise result to the user.
- Run the mandatory satisfaction check before closing any task — even trivial ones.

## When to delegate

When a task clearly maps to a specialized domain, the main agent MUST delegate instead of doing it itself.

### Common delegation domains

| Domain | Specialist Type |
|--------|-----------------|
| Frontend UI/components | Frontend specialist |
| Unit/integration tests | Testing specialist |
| Documentation updates | Docs maintainer |
| Accessibility (WCAG) | A11y specialist |
| Infrastructure/Docker | DevOps specialist |
| API/database changes | Backend specialist |
| Security hardening | Security specialist |

**Exception**: trivial changes (single-line fix, ~30 seconds) may be done directly. State why no specialist was used.

## Execution rules

1. **Single domain**: delegate to the one matching specialist.
2. **Mixed domains**: split into independent subtasks and delegate each to its agent. Parallelize only when tasks have no shared state, no output dependencies, and no overlapping file changes.
3. **No match**: fall back to normal main-agent workflow and explain why no specialist was used.
4. **Anti-recursion**: do not recursively re-delegate the same unresolved objective more than one retry cycle.
5. **Anti-stall fallback**: if delegation stalls (timeouts, no meaningful file/output progress, or repeated partial output), stop delegating, execute directly, and report why.
6. **Bounded delegation for large tasks**: decompose large requests into smaller bounded subtasks with explicit completion criteria before delegation.

## What every delegation prompt MUST include

- **Objective**: one-sentence goal.
- **Scope**: files, projects, or directories in scope.
- **Constraints**: files to avoid, prior decisions to honor, ordering requirements.
- **Validation expected**: what the agent must run/verify (e.g., lint, build, tests).
- **Handoff format**: the structured output the agent must return (e.g., findings table, diff summary).

## After delegation

1. Read the agent's full output.
2. Run any verifications the agent did not cover.
3. If the output reveals a new ambiguity or a blocking decision, surface it to the user via \`request_user_input\` **before** proceeding.
4. If the agent reports failure, retry once with a refined prompt. If it fails again, execute directly and note why.
5. If the retried handoff still lacks meaningful progress, do not delegate again for the same objective; execute directly.
6. Present a concise summary to the user and run the mandatory satisfaction check.`
  },
  {
    name: "prompt-user",
    type: "skill",
    category: "Workflow",
    description: "Run user-facing prompt loops with request_user_input for scope confirmation, decision collection, and mandatory post-delivery satisfaction checks.",
    content: `# prompt-user

Use this skill for any user-facing prompt workflow.

## Required behavior

1. Use \`request_user_input\` for prompts.
2. Do not use built-in \`askQuestions\`.
3. Before starting each newly requested task in an active session, ask at least one scope/confirmation prompt.
4. After any task output/delivery, ask exactly:
   \`Are you satisfied with this result, or would you like any changes?\`
5. Prompting MUST stop only on these exact phrases:
   - \`Stop prompting\`
   - \`End session\`
   - \`Don't ask anymore\`
   - \`Close conversation\`
6. Any non-stop outcome MUST continue the active loop and trigger re-prompting:
   - non-stop user replies (including acknowledgements and new task requests)
   - prompt timeout or empty response
   - prompt decline/cancel/dismiss
   - prompt tool failure
7. Tool-failure fallback: retry \`request_user_input\` indefinitely; MUST NOT fall back to plain text or any non-interactive-MCP tool.
8. Interactive timeout hardening: when interactive MCP calls fail with timeout signals (for example \`request timed out\`, \`-32001\`, or equivalent), you MUST keep prompting indefinitely with interactive prompt tools and MUST NOT complete via plain text.
9. Plain-text completion fallback is forbidden for interactive timeout/tool failures.
10. Plain-text prompts are never an acceptable fallback.
11. If implementation is still pending (report/diff checkpoint only), ask whether to implement next and keep prompting.
12. After system-notification-driven outputs, include the mandatory satisfaction prompt again.
13. Maintain one persistent prompt-loop todo titled \`Interactively Prompt user after [current task]\`; keep it active across task cycles and only complete it on an exact stop phrase.

## Trigger cases

- Task start, ambiguity, competing options, conflicts, skipped commands, and post-notification outputs.

## Prompt quality

- Keep prompts concise and action-oriented.
- Include predefined options whenever practical.
- Never ask for secrets or unnecessary personal data.

## Prompt-loop todo pattern

- At task start: create/keep \`Interactively Prompt user after [current task]\` as \`pending\`.
- After sending the satisfaction prompt: set it to \`in_progress\`.
- On any non-stop user reply: reset it to \`pending\` for the next task.
- On exact stop phrase only: mark it \`completed\`.`
  },
  {
    name: "interactive-prompt-loop",
    type: "instruction",
    category: "Workflow",
    description: "Deterministic interactive prompt-loop policy with stop phrases and timeout handling.",
    content: `# Interactive Prompt-Loop Policy

This is a concise summary of the prompt-loop policy.

## Stop phrases (exact match only)

- \`Stop prompting\`
- \`End session\`
- \`Don't ask anymore\`
- \`Close conversation\`

## Required rules

1. Before starting each newly requested task in an active session, you MUST ask a scope/confirmation prompt via interactive MCP.
2. After each task delivery, you MUST ask exactly:
   \`Are you satisfied with this result, or would you like any changes?\`
3. You MUST maintain one active todo titled \`Interactively Prompt user after [current task]\`.
4. You MUST keep the todo active across cycles (\`pending\` -> \`in_progress\` -> \`pending\`) until an exact stop phrase.
5. You MUST mark the todo completed only when an exact stop phrase is received.
6. If a prompt times out or response is empty, you MUST re-prompt.
7. If interactive MCP prompting returns timeout failures (for example \`request timed out\`, \`-32001\`, or equivalent timeout errors), you MUST keep prompting indefinitely with interactive prompt tools and MUST NOT fall back to plain-text completion.
8. You MUST NOT use plain-text prompting when an interactive prompt trigger applies.`
  },
  {
    name: "user-interaction",
    type: "instruction",
    category: "Workflow",
    description: "Instructions for interacting, prompting, and asking questions using interactive MCP tools.",
    content: `# User Interaction Instructions

Use this file as a strict policy. Do not interpret these rules loosely.

## Mandatory tool usage

- You MUST NOT use the built-in \`askQuestions\` tool.
- You MUST use \`interactive\` MCP server prompts (for example \`request_user_input\`) for interactive communication with the user.
- You MUST NOT exit the prompt loop until the user explicitly indicates they want to stop being prompted, even if they are unresponsive or keep giving empty responses.
- You MUST NOT send plain-text-only user-facing replies when a prompt trigger applies; use an \`interactive\` prompt in that same response.

## System-notification clarification

- System notifications (for example command completion/background updates) are **not** a valid reason to skip prompting.
- If you send a user-facing reply after processing a system notification, all normal prompt-trigger rules still apply.
- If that reply is a completion/handoff, you MUST run the mandatory satisfaction prompt via \`interactive\` in the same response.

## Required prompt triggers

You MUST call \`interactive\` mcp tools in all of the following situations:

1. Before any task, even when requirements look clear.
2. After any task, to run the satisfaction check.
3. When any requirement is ambiguous, even slightly.
4. When multiple implementation approaches are possible.
5. When you need the user to choose or confirm a design/behavior decision.
6. When the user asks to be prompted, asked, asks questions, or provides suggestions.
7. When the user asks a direct question, including reply questions.
8. If the user skips a command you asked them to run.
9. If user instructions are conflicting or unclear at any point during implementation.
10. Immediately before any final/closing handoff.
11. When any unexpected situation arises that requires user input.
12. When satisfactory check is done but the user has not USED a stop phrase.
13. When replying after system notifications and presenting task output/handoff to the user.

## Mandatory satisfaction check

You MUST ask exactly:

\`Are you satisfied with this result, or would you like any changes?\`

You MUST NOT skip this step, including for simple or obvious tasks. And you MUST NOT infer satisfaction as a session stopping condition. Always ask for explicit confirmation, and continue prompting until the user explicitly indicates they want to stop being prompted.

## Session stop phrases

You MUST continue the prompt loop until the user explicitly uses one of these exact phrases:

1. \`Stop prompting\`
2. \`End session\`
3. \`Don't ask anymore\`
4. \`Close conversation\`

Do not infer session end from similar wording.
Do not treat satisfaction confirmations (for example \`Satisfied\`, \`Looks good\`, \`LGTM\`, \`Thanks\`) as stop phrases.
After a user confirms satisfaction, continue prompting until one of the exact stop phrases is used.

## Empty response and timeout policy

- If a required prompt times out or the user response is empty, you MUST re-prompt indefinitely.
- If interactive MCP prompting returns timeout failures (for example \`request timed out\`, \`-32001\`, or equivalent timeout errors), you MUST keep prompting indefinitely with interactive prompt tools and MUST NOT fall back to plain-text completion.
- Re-prompts SHOULD be shorter and include predefined options when practical.
- You MUST NOT proceed with assumptions while required user input is still missing.`
  },
  {
    name: "llm-coding-guidelines",
    type: "instruction",
    category: "Workflow",
    description: "Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.",
    content: `Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" -> "Write tests for invalid inputs, then make them pass"
- "Fix the bug" -> "Write a test that reproduces it, then make it pass"
- "Refactor X" -> "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

\`\`\`
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
\`\`\`

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.`
  }
];
function getBuiltinTemplateNames() {
  return BUILTIN_TEMPLATES.map((t) => t.name);
}
function registerSkillsHandlers(deps) {
  ipcMain.handle(
    "upsert-skill-or-instruction",
    (_event, data) => {
      const existing = getSkillOrInstructionByName(data.name);
      const result = upsertSkillOrInstruction(data);
      if (result) {
        deps.getMainWindow()?.webContents.send("skills-updated");
        broadcastSkillsChanged(
          existing ? "updated" : "registered",
          data.type,
          data.name,
          deps.getSettings().openCodePort
        );
      }
      return result;
    }
  );
  ipcMain.handle(
    "list-skills-and-instructions",
    (_event, params) => {
      return listSkillsAndInstructions(
        params?.filterType,
        params?.filterCategory
      );
    }
  );
  ipcMain.handle("get-skill-or-instruction", (_event, name) => {
    return getSkillOrInstructionByName(name);
  });
  ipcMain.handle("delete-skill-or-instruction", (_event, name) => {
    const existing = getSkillOrInstructionByName(name);
    const deleted = deleteSkillOrInstruction(name);
    if (deleted) {
      deps.getMainWindow()?.webContents.send("skills-updated");
      if (existing) {
        broadcastSkillsChanged(
          "deleted",
          existing.type,
          existing.name,
          deps.getSettings().openCodePort
        );
      }
    }
    return deleted;
  });
  ipcMain.handle(
    "toggle-skill-or-instruction-enabled",
    (_event, data) => {
      const result = toggleSkillOrInstructionEnabled(data.name, data.enabled);
      if (result) {
        deps.getMainWindow()?.webContents.send("skills-updated");
        broadcastSkillsChanged(
          "updated",
          result.type,
          result.name,
          deps.getSettings().openCodePort
        );
      }
      return result;
    }
  );
  ipcMain.handle("duplicate-skill-or-instruction", (_event, name) => {
    const result = duplicateSkillOrInstruction(name);
    if (result) {
      deps.getMainWindow()?.webContents.send("skills-updated");
    }
    return result;
  });
  ipcMain.handle(
    "reset-builtin-templates",
    () => {
      const resetCount = resetBuiltinTemplates(BUILTIN_TEMPLATES);
      if (resetCount > 0) {
        deps.getMainWindow()?.webContents.send("skills-updated");
      }
      return {
        resetCount,
        templateNames: getBuiltinTemplateNames()
      };
    }
  );
  ipcMain.handle(
    "get-missing-builtin-count",
    () => {
      const templateNames = getBuiltinTemplateNames();
      const missingCount = getMissingBuiltinCount(templateNames);
      return {
        missingCount,
        totalBuiltins: templateNames.length
      };
    }
  );
  ipcMain.handle(
    "export-skills-markdown",
    async () => {
      const win = deps.getMainWindow();
      if (!win) return { saved: false };
      const result = await dialog.showSaveDialog(win, {
        title: "Export Skills & Instructions",
        defaultPath: "skills-and-instructions.zip",
        filters: [{ name: "ZIP Archive", extensions: ["zip"] }]
      });
      if (result.canceled || !result.filePath) return { saved: false };
      const entries = listSkillsAndInstructions();
      const skills = entries.filter((e) => e.type === "skill");
      const instructions = entries.filter((e) => e.type === "instruction");
      const zip = new JSZip();
      const skillsFolder = zip.folder("skills");
      for (const entry of skills) {
        skillsFolder?.file(`${entry.name}.md`, entry.content);
      }
      const instructionsFolder = zip.folder("instructions");
      for (const entry of instructions) {
        instructionsFolder?.file(`${entry.name}.md`, entry.content);
      }
      const readmeLines = [
        "# Skills & Instructions",
        "",
        `Exported on ${(/* @__PURE__ */ new Date()).toISOString()}`,
        ""
      ];
      if (skills.length > 0) {
        readmeLines.push("## Skills", "");
        for (const e of skills) {
          readmeLines.push(`- **${e.name}** — ${e.description}`);
        }
        readmeLines.push("");
      }
      if (instructions.length > 0) {
        readmeLines.push("## Instructions", "");
        for (const e of instructions) {
          readmeLines.push(`- **${e.name}** — ${e.description}`);
        }
        readmeLines.push("");
      }
      zip.file("README.md", readmeLines.join("\n"));
      const buffer = await zip.generateAsync({ type: "nodebuffer" });
      writeFileSync(result.filePath, buffer);
      return { saved: true, filePath: result.filePath };
    }
  );
  ipcMain.handle(
    "export-single-skill",
    async (_event, name) => {
      const win = deps.getMainWindow();
      if (!win) return { saved: false };
      const entry = getSkillOrInstructionByName(name);
      if (!entry) return { saved: false };
      const result = await dialog.showSaveDialog(win, {
        title: `Export ${entry.name}`,
        defaultPath: `${entry.name}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }]
      });
      if (result.canceled || !result.filePath) return { saved: false };
      writeFileSync(result.filePath, entry.content, "utf-8");
      return { saved: true, filePath: result.filePath };
    }
  );
  ipcMain.handle("list-folders", () => {
    return listFolders();
  });
  ipcMain.handle("create-folder", (_event, name) => {
    const folder = createFolder(name);
    if (folder) {
      deps.getMainWindow()?.webContents.send("skills-updated");
    }
    return folder;
  });
  ipcMain.handle(
    "rename-folder",
    (_event, data) => {
      const folder = renameFolder(data.id, data.name);
      if (folder) {
        deps.getMainWindow()?.webContents.send("skills-updated");
      }
      return folder;
    }
  );
  ipcMain.handle("delete-folder", (_event, id) => {
    const deleted = deleteFolder(id);
    if (deleted) {
      deps.getMainWindow()?.webContents.send("skills-updated");
    }
    return deleted;
  });
  ipcMain.handle(
    "set-entry-folder",
    (_event, data) => {
      const result = setEntryFolder(data.name, data.folderId);
      if (result) {
        deps.getMainWindow()?.webContents.send("skills-updated");
      }
      return result;
    }
  );
  ipcMain.handle(
    "set-entry-scope",
    (_event, data) => {
      const result = setEntryScope(data.name, data.scope);
      if (result) {
        deps.getMainWindow()?.webContents.send("skills-updated");
        const entry = getSkillOrInstructionByName(data.name);
        if (entry) {
          broadcastSkillsChanged(
            "updated",
            entry.type,
            entry.name,
            deps.getSettings().openCodePort
          );
        }
      }
      return result;
    }
  );
  ipcMain.handle(
    "list-session-scoped-entries",
    (_event, data) => {
      return listSessionScopedEntryNames(
        data.providerType,
        data.providerSessionId
      );
    }
  );
  ipcMain.handle(
    "set-session-scoped-entries",
    (_event, data) => {
      const providerType = data.providerType;
      const prev = new Set(
        listSessionScopedEntryNames(providerType, data.providerSessionId)
      );
      const next = new Set(data.entryNames);
      setSessionScopedEntries(
        providerType,
        data.providerSessionId,
        data.entryNames
      );
      const addedNames = [...next].filter((n) => !prev.has(n));
      const removedNames = [...prev].filter((n) => !next.has(n));
      if (addedNames.length > 0 || removedNames.length > 0) {
        const added = addedNames.map((name) => getSkillOrInstructionByName(name)).filter((e) => e != null).map((e) => ({ name: e.name, type: e.type }));
        const removed = removedNames.map((name) => getSkillOrInstructionByName(name)).filter((e) => e != null).map((e) => ({ name: e.name, type: e.type }));
        broadcastSessionScopeChanged(
          providerType,
          data.providerSessionId,
          { added, removed },
          deps.getSettings().openCodePort
        );
      }
      return true;
    }
  );
  ipcMain.handle(
    "list-session-muted-entries",
    (_event, data) => {
      return listSessionMutedEntryNames(
        data.providerType,
        data.providerSessionId
      );
    }
  );
  ipcMain.handle(
    "set-session-muted-entries",
    (_event, data) => {
      const providerType = data.providerType;
      setSessionMutedEntries(
        providerType,
        data.providerSessionId,
        data.entryNames
      );
      return true;
    }
  );
}
const IGNORED_DIRS = /* @__PURE__ */ new Set([
  ".git",
  "node_modules",
  "dist",
  ".next",
  ".venv",
  "build",
  ".pnpm",
  "__pycache__",
  ".cache",
  ".turbo",
  ".nx",
  ".expo",
  ".output",
  "coverage",
  ".parcel-cache"
]);
const MAX_FILES = 5e4;
const indexCache = /* @__PURE__ */ new Map();
const CACHE_TTL_MS = 3e4;
async function indexFiles(baseDirectory) {
  const cached = indexCache.get(baseDirectory);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.files;
  }
  const files = [];
  async function walk(dir) {
    if (files.length >= MAX_FILES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".DS_Store")) {
          continue;
        }
        await walk(join(dir, entry.name));
      } else {
        const rel = relative$1(baseDirectory, join(dir, entry.name));
        files.push(rel.split("\\").join(posix.sep));
      }
    }
  }
  await walk(baseDirectory);
  files.sort();
  indexCache.set(baseDirectory, { files, timestamp: Date.now() });
  return files;
}
function rankFileSuggestions(files, query, limit) {
  if (!query) return files.slice(0, limit);
  const lowerQuery = query.toLowerCase();
  const scored = [];
  for (const filePath of files) {
    const lowerPath = filePath.toLowerCase();
    const substringIdx = lowerPath.indexOf(lowerQuery);
    if (substringIdx !== -1) {
      let score = 1e3;
      if (substringIdx === 0) score += 500;
      if (substringIdx === 0 || lowerPath[substringIdx - 1] === "/")
        score += 300;
      score -= filePath.length;
      scored.push({ path: filePath, score });
      continue;
    }
    const fuzzyScore = fuzzyMatch(lowerPath, lowerQuery);
    if (fuzzyScore > 0) {
      scored.push({ path: filePath, score: fuzzyScore });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.path);
}
function fuzzyMatch(text, query) {
  let qi = 0;
  let score = 0;
  let consecutive = 0;
  let lastMatchIdx = -2;
  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (text[ti] === query[qi]) {
      qi++;
      score += 10;
      if (ti === lastMatchIdx + 1) {
        consecutive++;
        score += consecutive * 5;
      } else {
        consecutive = 0;
      }
      if (ti === 0 || text[ti - 1] === "/") {
        score += 15;
      }
      lastMatchIdx = ti;
    }
  }
  if (qi < query.length) return 0;
  score -= text.length;
  return Math.max(score, 1);
}
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];
const IMAGE_MIME_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp"
};
function registerSystemHandlers(deps) {
  ipcMain.handle("get-history", () => getConversationHistory());
  ipcMain.handle("clear-history", () => {
    clearHistory();
    return true;
  });
  ipcMain.handle("reset-database", async () => {
    const result = resetDatabase();
    const win = deps.getMainWindow();
    win?.webContents.send("database-reset", result);
    return result;
  });
  ipcMain.handle("get-server-status", () => {
    return { running: true, port: deps.getSettings().port };
  });
  ipcMain.handle("get-app-version", () => app.getVersion());
  ipcMain.handle("get-provider-status", async () => {
    const settings = deps.getSettings();
    const adapter = await getBackendAdapter(settings.agentBackend);
    const effectiveMode = settings.agentBackend === "claude_sdk" && !adapter.supportsProviderInjection ? "standalone_compat" : settings.agentBackend;
    return {
      backend: settings.agentBackend,
      effectiveMode,
      supportsSessionHierarchy: adapter.supportsSessionHierarchy,
      supportsProviderInjection: adapter.supportsProviderInjection,
      runtime: adapter.runtime
    };
  });
  ipcMain.handle(
    "search-files",
    async (_event, baseDirectory, query) => {
      const files = await indexFiles(baseDirectory);
      return rankFileSuggestions(files, query, 50);
    }
  );
  ipcMain.handle("open-file-dialog", async () => {
    const win = deps.getMainWindow();
    if (!win) return [];
    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Images & Text",
          extensions: SUPPORTED_FILE_EXTENSIONS
        }
      ]
    });
    if (result.canceled) return [];
    return result.filePaths;
  });
  ipcMain.handle("open-folder-dialog", async () => {
    const win = deps.getMainWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
      title: "Select Project Folder"
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  ipcMain.handle("read-file-for-attachment", (_event, filePath) => {
    try {
      const buffer = readFileSync$1(filePath);
      const name = basename(filePath);
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      const isImage = IMAGE_EXTENSIONS.includes(ext);
      if (isImage) {
        return {
          type: "image",
          data: buffer.toString("base64"),
          mimeType: IMAGE_MIME_TYPES[ext] || "application/octet-stream",
          name,
          size: buffer.length
        };
      }
      return {
        type: "text",
        data: buffer.toString("utf-8"),
        mimeType: "text/plain",
        name,
        size: buffer.length
      };
    } catch {
      return null;
    }
  });
  ipcMain.handle("force-terminate-chat", (_event, connectionId) => {
    forceTerminateChat(connectionId);
  });
  ipcMain.handle("get-pinned-projects", () => getPinnedProjects());
  ipcMain.handle(
    "add-pinned-project",
    (_event, data) => {
      return addPinnedProject(data.path, data.name);
    }
  );
  ipcMain.handle("remove-pinned-project", (_event, path) => {
    return removePinnedProject(path);
  });
  ipcMain.handle("get-active-prompts", () => getActivePromptData());
  ipcMain.handle("dismiss-session", (_event, connectionId) => {
    forceTerminateChat(connectionId);
    const win = deps.getMainWindow();
    win?.webContents.send("connection-closed", { connectionId });
  });
  ipcMain.handle("add-allowed-read-folder", (_event, folderPath) => {
    const currentSettings2 = deps.getSettings();
    const folders = currentSettings2.allowedReadFolders ?? [];
    if (!folders.includes(folderPath)) {
      const updatedSettings = {
        ...currentSettings2,
        allowedReadFolders: [...folders, folderPath]
      };
      deps.setSettings(updatedSettings);
      saveSettings(updatedSettings);
    }
    return { ok: true };
  });
  ipcMain.handle("remove-allowed-read-folder", (_event, folderPath) => {
    const currentSettings2 = deps.getSettings();
    const folders = currentSettings2.allowedReadFolders ?? [];
    const updatedSettings = {
      ...currentSettings2,
      allowedReadFolders: folders.filter((f) => f !== folderPath)
    };
    deps.setSettings(updatedSettings);
    saveSettings(updatedSettings);
    return { ok: true };
  });
  ipcMain.handle("get-allowed-read-folders", () => {
    const currentSettings2 = deps.getSettings();
    return currentSettings2.allowedReadFolders ?? [];
  });
  ipcMain.handle("add-allowed-permission", (_event, permission) => {
    const currentSettings2 = deps.getSettings();
    const permissions = currentSettings2.allowedPermissions ?? [];
    const normalizedPermission = permission.toLowerCase();
    if (!permissions.some((p) => p.toLowerCase() === normalizedPermission)) {
      const updatedSettings = {
        ...currentSettings2,
        allowedPermissions: [...permissions, permission]
      };
      deps.setSettings(updatedSettings);
      saveSettings(updatedSettings);
    }
    return { ok: true };
  });
  ipcMain.handle("remove-allowed-permission", (_event, permission) => {
    const currentSettings2 = deps.getSettings();
    const permissions = currentSettings2.allowedPermissions ?? [];
    const normalizedPermission = permission.toLowerCase();
    const updatedSettings = {
      ...currentSettings2,
      allowedPermissions: permissions.filter(
        (p) => p.toLowerCase() !== normalizedPermission
      )
    };
    deps.setSettings(updatedSettings);
    saveSettings(updatedSettings);
    return { ok: true };
  });
  ipcMain.handle("get-allowed-permissions", () => {
    const currentSettings2 = deps.getSettings();
    return currentSettings2.allowedPermissions ?? [];
  });
  ipcMain.handle("select-folder-dialog", async () => {
    const win = deps.getMainWindow();
    if (!win) return { canceled: true };
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
      title: "Select Folder to Allow"
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    return { canceled: false, folderPath: result.filePaths[0] };
  });
}
function registerIpcHandlers(deps) {
  registerRendererLogChannel();
  registerSystemHandlers(deps);
  registerSettingsHandlers(deps);
  registerOpenCodeCoreHandlers(deps);
  registerSessionChannelHandlers(deps);
  registerSkillsHandlers(deps);
  registerSessionTreeHandlers(deps);
  registerOpenCodeStatusHandlers(deps);
  registerContextTrackingHandlers(deps);
  registerConversationHandlers(deps);
  registerProviderHandlers(deps);
  registerMcpStatusHandlers(deps);
  registerAgentsHandlers();
}
const PERF_LOG_ENABLED = typeof process !== "undefined" && process.env?.OPENCODE_PERF_LOG === "1";
function createCoalesceState() {
  return {
    queue: [],
    coalesceIdx: /* @__PURE__ */ new Map(),
    staleDeltas: /* @__PURE__ */ new Set()
  };
}
function semanticKey(event) {
  switch (event.type) {
    case "message.updated":
      return `msg:${event.message.id}`;
    case "message.part.updated":
      return `part:${event.part.id}`;
    case "session.status":
      return `status:${event.sessionId}`;
    case "message.removed":
      return `rm:${event.messageId}`;
    case "session.compacted":
      return `compact:${event.sessionId}:${event.messageId}`;
    case "todo.updated":
      return `todo:${event.sessionId}`;
    case "vcs.updated":
      return `vcs:global`;
    case "context.usage":
      return `ctx:${event.sessionId}`;
    case "session.compaction-done":
      return `cdone:${event.sessionId}`;
    case "file.edited":
      return `file:${event.directory ?? ""}:${event.file}`;
    case "message.part.removed":
      return `partrm:${event.partId}`;
    case "permission.asked":
      return `perm.ask:${event.requestId}`;
    case "permission.replied":
      return `perm.reply:${event.requestId}`;
    case "question.asked":
      return `q.ask:${event.requestId}`;
    case "question.cleared":
      return `q.clear:${event.requestId}`;
    case "session.diff":
      return `diff:${event.sessionId}`;
    case "mcp.tools.changed":
      return `mcp.tools:${event.server}`;
    case "mcp.browser.open.failed":
      return `mcp.browser.fail:${event.mcpName}:${event.url}`;
    case "installation.update-available":
      return `install.upd:${event.version}`;
    case "message.part.delta":
      return null;
    // deltas accumulate, they don't coalesce
    default:
      return null;
  }
}
function enqueueEvent(state2, event) {
  const key = semanticKey(event);
  if (key !== null) {
    const existingIdx = state2.coalesceIdx.get(key);
    if (existingIdx !== void 0 && existingIdx < state2.queue.length) {
      state2.queue[existingIdx] = event;
      if (event.type === "message.part.updated") {
        state2.staleDeltas.add(event.part.id);
      }
      return;
    }
    state2.coalesceIdx.set(key, state2.queue.length);
  }
  state2.queue.push(event);
}
function drainFlush(state2) {
  if (state2.staleDeltas.size === 0) return state2.queue;
  return state2.queue.filter(
    (e) => e.type !== "message.part.delta" || !state2.staleDeltas.has(e.partId)
  );
}
const log$2 = createLogger("session-auto-register");
function buildSessionBootstrapMessage(sessionId, parentId) {
  return `<system-reminder>
Your OpenCode session ID is: ${sessionId}
Parent session ID: ${parentId}
Pass this as openCodeSessionId when calling register_connection.
</system-reminder>`;
}
function autoRegisterSession(info, options) {
  const alreadyClaimed = isProviderSessionClaimed(info.id, "opencode");
  const existing = alreadyClaimed ? getRegisteredConnectionBySessionId(info.id, "opencode") : null;
  log$2.info(
    `autoRegisterSession: sessionId=${info.id}, parentID=${info.parentID ?? "null"}, alreadyClaimed=${alreadyClaimed}, openCodeDirectory=${info.directory ?? "(none)"}, existingBaseDirectory=${existing?.baseDirectory ?? "(none)"}`
  );
  if (alreadyClaimed) {
    log$2.info(`session ${info.id} already claimed — skipping auto-register`);
    return;
  }
  let effectiveBaseDirectory = info.directory;
  if (info.parentID) {
    const home = process.env["HOME"];
    const looksLikeFallback = !info.directory || info.directory === home || info.directory === "/Users" || info.directory === "/home";
    if (looksLikeFallback) {
      const parentConn = getRegisteredConnectionBySessionId(
        info.parentID,
        "opencode"
      );
      if (parentConn?.baseDirectory) {
        log$2.info(
          `inheriting parent baseDirectory for session ${info.id}: parent=${info.parentID}, parentBaseDirectory=${parentConn.baseDirectory} (child reported=${info.directory ?? "(none)"})`
        );
        effectiveBaseDirectory = parentConn.baseDirectory;
      }
    }
  }
  log$2.info(
    `upserting registered connection for session ${info.id} with baseDirectory=${effectiveBaseDirectory ?? "(none)"}`
  );
  log$2.info(
    `[bug2-trace] auto-register-sse providerSessionId=${info.id} connectionId=null parentSessionId=${info.parentID ?? "null"} ts=${Date.now()}`
  );
  upsertRegisteredConnection({
    providerSessionId: info.id,
    providerType: "opencode",
    connectionId: null,
    channelName: info.title ?? `Session ${info.id.slice(0, 8)}`,
    projectName: "OpenCode",
    baseDirectory: effectiveBaseDirectory,
    parentSessionId: info.parentID ?? void 0
  });
  log$2.info(`registered connection upserted for session ${info.id}`);
  if (info.parentID) {
    const port = options.getOpenCodePort();
    log$2.info(
      `injecting session bootstrap message for child session ${info.id}, parentID=${info.parentID}`
    );
    void injectOpenCodeMessage(
      info.id,
      buildSessionBootstrapMessage(info.id, info.parentID),
      void 0,
      port
    );
    try {
      const entries = listSkillsAndInstructions().filter((e) => e.enabled);
      const sessionOptInNames = listSessionScopedEntryNames(
        "opencode",
        info.id
      );
      const optInSet = new Set(sessionOptInNames);
      const effective = entries.filter(
        (e) => e.scope === "global" || optInSet.has(e.name)
      );
      if (effective.length > 0) {
        const dbContext = buildStartupContextMessage({
          channelName: info.title ?? `Session ${info.id.slice(0, 8)}`,
          projectName: "OpenCode",
          baseDirectory: effectiveBaseDirectory,
          openCodeSessionId: info.id,
          entries,
          sessionOptInNames
        });
        log$2.info(
          `injecting DB skills/instructions context (${effective.length} of ${entries.length} entries; ${sessionOptInNames.length} session opt-ins) into child session ${info.id}`
        );
        void injectOpenCodeMessage(
          info.id,
          dbContext,
          // user message body — `<system-reminder>` block
          void 0,
          port,
          void 0,
          true,
          // noReply
          void 0,
          void 0
          // systemMessage — intentionally unused, see comment above
        );
        markDbContextInjected(info.id);
      }
    } catch (err) {
      log$2.warn(
        `failed to inject DB skills/instructions for child session ${info.id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  if (options.invalidate !== false) {
    invalidateSessionTree();
  }
}
function toSessionInfo(info) {
  return {
    id: info.id,
    parentID: info.parentID ?? null,
    title: info.title,
    directory: info.directory,
    time: info.time,
    version: info.version,
    summary: info.summary ? {
      additions: info.summary.additions,
      deletions: info.summary.deletions,
      files: info.summary.files
    } : void 0
  };
}
function handleSessionCreated(props, options) {
  const { info } = props;
  if (!info || typeof info.id !== "string") return;
  const next = toSessionInfo(info);
  if (options.getAutoRegisterSubagents()) {
    autoRegisterSession(next, {
      getOpenCodePort: options.getOpenCodePort,
      invalidate: false
    });
  }
  invalidateSessionTree();
}
function handleSessionUpdated(props) {
  const { info } = props;
  if (!info || typeof info.id !== "string") return;
  invalidateSessionTree();
}
function handleSessionDeleted(props) {
  const { sessionID, info } = props;
  const id = sessionID ?? info?.id;
  if (typeof id !== "string" || id.length === 0) return;
  tombstoneOpenCodeSession(id);
  invalidateSessionTree();
}
function isFileReadPermission(permission) {
  const lower = permission.toLowerCase();
  return lower.includes("read") || lower.includes("file_read") || lower.startsWith("read ");
}
function shouldAutoApprovePermission(permission, allowedPermissions) {
  const normalizedPermission = permission.toLowerCase();
  return allowedPermissions.some(
    (item) => item.toLowerCase() === normalizedPermission
  );
}
function shouldAutoApproveReadPermission(patterns, allowedFolders) {
  if (!patterns || patterns.length === 0 || allowedFolders.length === 0) {
    return false;
  }
  for (const pattern of patterns) {
    if (!pattern.startsWith("/")) continue;
    for (const folder of allowedFolders) {
      const normalizedFolder = folder.endsWith("/") ? folder : `${folder}/`;
      if (pattern.startsWith(normalizedFolder) || pattern === folder) {
        return true;
      }
    }
  }
  return false;
}
const log$1 = createLogger("prompt-event-forwarder");
function buildPermissionAskedFrame(payload, connectionId) {
  const sessionID = payload.sessionID;
  const requestId = payload.id;
  const permission = payload.permission;
  if (!sessionID || !requestId || !permission) return null;
  return {
    connectionId,
    providerSessionId: sessionID,
    requestId,
    sessionID,
    permission,
    patterns: payload.patterns,
    always: payload.always,
    tool: payload.tool,
    metadata: payload.metadata,
    directory: payload.directory
  };
}
function buildPermissionRepliedFrame(payload, connectionId) {
  const sessionID = payload.sessionID;
  const requestID = payload.requestID;
  const reply = payload.reply;
  if (!sessionID || !requestID || !reply) return null;
  return {
    connectionId,
    providerSessionId: sessionID,
    sessionID,
    requestID,
    reply
  };
}
function buildQuestionAskedFrame(payload, connectionId) {
  const sessionID = payload.sessionID;
  const requestId = payload.id;
  const questions = payload.questions;
  if (!sessionID || !requestId || !questions || questions.length === 0) {
    return null;
  }
  return {
    connectionId,
    providerSessionId: sessionID,
    requestId,
    sessionID,
    questions,
    tool: payload.tool
  };
}
function buildQuestionClearedFrame(payload, connectionId) {
  const sessionID = payload.sessionID;
  const requestId = payload.requestID;
  if (!sessionID || !requestId) return null;
  return {
    connectionId,
    providerSessionId: sessionID,
    requestId,
    sessionID,
    answer: payload.answer,
    rejected: payload.rejected
  };
}
function send(ctx, channel, frame) {
  const win = ctx.getWindow();
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send(channel, frame);
  } catch (err) {
    log$1.warn(`Failed to send ${channel}: ${String(err)}`);
  }
}
async function forwardPermissionAsked(payload, ctx) {
  const sessionID = payload.sessionID;
  const requestId = payload.id;
  const permission = payload.permission;
  if (!sessionID || !requestId || !permission) return false;
  const allowedFolders = ctx.getAllowedReadFolders?.() ?? [];
  const allowedPermissions = ctx.getAllowedPermissions?.() ?? [];
  let autoApprove = false;
  if (isFileReadPermission(permission) && shouldAutoApproveReadPermission(payload.patterns, allowedFolders)) {
    autoApprove = true;
    log$1.info(
      `auto-approving read permission request=${requestId} session=${sessionID} from allowed folders`
    );
  } else if (shouldAutoApprovePermission(permission, allowedPermissions)) {
    autoApprove = true;
    log$1.info(
      `auto-approving permission request=${requestId} session=${sessionID} permission=${permission} from allowed permissions`
    );
  }
  if (autoApprove) {
    const port = ctx.getOpenCodePort?.() ?? 4096;
    try {
      await replyToOpenCodePermission(
        port,
        sessionID,
        requestId,
        "always",
        payload.directory
      );
    } catch {
    }
    return true;
  }
  const { connectionId } = ctx.resolveConnection(sessionID);
  const frame = buildPermissionAskedFrame(payload, connectionId);
  if (!frame) return false;
  log$1.info(
    `permission.asked session=${sessionID} request=${requestId} permission=${permission} connection=${connectionId ?? "null"}`
  );
  send(ctx, "permission-asked", frame);
  return false;
}
function forwardPermissionReplied(payload, ctx) {
  const sessionID = payload.sessionID;
  if (!sessionID) return;
  const { connectionId } = ctx.resolveConnection(sessionID);
  const frame = buildPermissionRepliedFrame(payload, connectionId);
  if (!frame) return;
  log$1.info(
    `permission.replied session=${sessionID} request=${frame.requestID} reply=${frame.reply}`
  );
  send(ctx, "permission-replied", frame);
}
function forwardQuestionAsked(payload, ctx) {
  const sessionID = payload.sessionID;
  if (!sessionID) return;
  const { connectionId } = ctx.resolveConnection(sessionID);
  const frame = buildQuestionAskedFrame(payload, connectionId);
  if (!frame) return;
  log$1.info(
    `question.asked session=${sessionID} request=${frame.requestId} connection=${connectionId ?? "null"} questions=${frame.questions.length}`
  );
  send(ctx, "question-asked", frame);
}
function forwardQuestionReplied(payload, ctx) {
  const sessionID = payload.sessionID;
  if (!sessionID) return;
  const { connectionId } = ctx.resolveConnection(sessionID);
  const frame = buildQuestionClearedFrame(payload, connectionId);
  if (!frame) return;
  log$1.info(
    `question.cleared session=${sessionID} request=${frame.requestId} rejected=${String(frame.rejected ?? false)}`
  );
  send(ctx, "question-cleared", frame);
}
const log = createLogger("event-stream");
const PERF_ENABLED = PERF_LOG_ENABLED;
const PERF_CPU_SAMPLE_MS = 5e3;
const PERF_HEAP_SAMPLE_MS = 3e4;
const STREAM_FLUSH_MS = 16;
const HEARTBEAT_TIMEOUT_MS = 15e3;
const RECONNECT_DELAY_MS = 250;
const CHANNEL = "conversation-batch";
let state = null;
function buildPromptForwarderContext(port) {
  return {
    getWindow: () => state?.getWindow() ?? null,
    resolveConnection: (sessionId) => {
      const rc = getRegisteredConnectionBySessionId(sessionId);
      return { connectionId: rc?.connectionId ?? null };
    },
    getAllowedPermissions: () => loadSettings().allowedPermissions ?? [],
    getAllowedReadFolders: () => loadSettings().allowedReadFolders ?? [],
    getOpenCodePort: () => port
  };
}
function enqueue(event) {
  if (!state) return;
  enqueueEvent(state.coalesce, event);
  scheduleFlush();
}
function scheduleFlush() {
  if (!state || state.flushTimer !== null) return;
  state.flushTimer = setTimeout(flush, STREAM_FLUSH_MS);
}
function flush() {
  if (!state) return;
  state.flushTimer = null;
  if (state.coalesce.queue.length === 0) return;
  const events = drainFlush(state.coalesce);
  const batch = {
    seq: ++state.seq,
    events,
    flushedAt: Date.now()
  };
  state.coalesce = createCoalesceState();
  const win = state.getWindow();
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send(CHANNEL, batch);
    if (PERF_ENABLED) {
      log.info(
        `[perf.flush] seq=${batch.seq} count=${events.length} flushedAt=${batch.flushedAt}`
      );
    }
  } catch (err) {
    log.warn(`Failed to send batch seq=${batch.seq}: ${String(err)}`);
  }
}
function resetHeartbeat() {
  if (!state) return;
  if (state.heartbeat !== null) clearTimeout(state.heartbeat);
  state.heartbeat = setTimeout(() => {
    log.warn(
      `Heartbeat timeout (${HEARTBEAT_TIMEOUT_MS}ms) — aborting attempt`
    );
    state?.attemptAbort?.abort();
  }, HEARTBEAT_TIMEOUT_MS);
}
function clearHeartbeat() {
  if (!state) return;
  if (state.heartbeat !== null) {
    clearTimeout(state.heartbeat);
    state.heartbeat = null;
  }
}
function startPerfSamplers() {
  if (!PERF_ENABLED || !state) return;
  state.perfLastCpu = process.cpuUsage();
  state.perfLastCpuAt = Date.now();
  state.perfCpuTimer = setInterval(() => {
    if (!state) return;
    const now = Date.now();
    const elapsedMs = now - state.perfLastCpuAt;
    if (elapsedMs <= 0) return;
    const delta = process.cpuUsage(state.perfLastCpu ?? void 0);
    state.perfLastCpu = process.cpuUsage();
    state.perfLastCpuAt = now;
    const totalMicros = delta.user + delta.system;
    const pct = (totalMicros / (elapsedMs * 1e3) * 100).toFixed(1);
    log.info(
      `[perf.cpu] user=${delta.user}µs system=${delta.system}µs window=${elapsedMs}ms pct=${pct}%`
    );
  }, PERF_CPU_SAMPLE_MS);
  state.perfHeapTimer = setInterval(() => {
    const mem = process.memoryUsage();
    const heapMb = (mem.heapUsed / 1024 / 1024).toFixed(1);
    const rssMb = (mem.rss / 1024 / 1024).toFixed(1);
    log.info(`[perf.heap] heapUsed=${heapMb}MB rss=${rssMb}MB`);
  }, PERF_HEAP_SAMPLE_MS);
}
function stopPerfSamplers() {
  if (!state) return;
  if (state.perfCpuTimer !== null) {
    clearInterval(state.perfCpuTimer);
    state.perfCpuTimer = null;
  }
  if (state.perfHeapTimer !== null) {
    clearInterval(state.perfHeapTimer);
    state.perfHeapTimer = null;
  }
  state.perfLastCpu = null;
}
function wait(ms, signal) {
  return new Promise((resolve2) => {
    if (signal.aborted) {
      resolve2();
      return;
    }
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve2();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve2();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
function isAbortError(err) {
  if (!err) return false;
  if (err instanceof Error) {
    if (err.name === "AbortError") return true;
    if (err.message.toLowerCase().includes("abort")) return true;
  }
  return false;
}
function getSessionLifecycleType(payloadType) {
  if (!payloadType) return null;
  if (payloadType === "session.created" || payloadType === "session.created.1") {
    return "session.created";
  }
  if (payloadType === "session.updated" || payloadType === "session.updated.1") {
    return "session.updated";
  }
  if (payloadType === "session.deleted" || payloadType === "session.deleted.1") {
    return "session.deleted";
  }
  return null;
}
async function runLoop() {
  if (!state) return;
  const outer = state.outerAbort;
  if (!outer) return;
  while (!outer.signal.aborted && state?.running) {
    const attempt = new AbortController();
    if (state) state.attemptAbort = attempt;
    const onOuterAbort = () => attempt.abort();
    outer.signal.addEventListener("abort", onOuterAbort, { once: true });
    try {
      const port = state.getPort();
      const client2 = getClient(port);
      log.info(`Opening SSE stream on port=${port}`);
      const result = await client2.global.event({
        signal: attempt.signal,
        onSseError: (err) => {
          if (isAbortError(err)) return;
          log.warn(`SSE transport error: ${String(err)}`);
        }
      });
      resetHeartbeat();
      for await (const envelope of result.stream) {
        resetHeartbeat();
        const typedEnvelope = envelope;
        const payload = typedEnvelope?.payload;
        if (!payload || payload.type === "sync") continue;
        const lifecycleType = getSessionLifecycleType(payload.type);
        if (lifecycleType) {
          const props = payload.properties;
          if (props && props.info) {
            if (lifecycleType === "session.created")
              handleSessionCreated(props, {
                getOpenCodePort: state.getPort,
                getAutoRegisterSubagents: () => loadSettings().autoRegisterSubagents ?? true
              });
            else if (lifecycleType === "session.updated")
              handleSessionUpdated(props);
            else handleSessionDeleted(props);
          }
          continue;
        }
        if (payload.type === "permission.asked") {
          const promptCtx = buildPromptForwarderContext(port);
          void forwardPermissionAsked(
            {
              ...payload.properties,
              directory: typedEnvelope.directory ?? void 0
            },
            promptCtx
          );
          continue;
        }
        if (payload.type === "permission.replied") {
          const promptCtx = buildPromptForwarderContext(port);
          forwardPermissionReplied(
            payload.properties,
            promptCtx
          );
          continue;
        }
        if (payload.type === "question.asked") {
          const promptCtx = buildPromptForwarderContext(port);
          forwardQuestionAsked(
            payload.properties,
            promptCtx
          );
          continue;
        }
        if (payload.type === "question.replied" || payload.type === "question.rejected") {
          const promptCtx = buildPromptForwarderContext(port);
          const props = payload.properties;
          forwardQuestionReplied(
            {
              ...props,
              rejected: payload.type === "question.rejected"
            },
            promptCtx
          );
          continue;
        }
        const mapped = bridgeEvent(
          payload,
          {
            directory: typedEnvelope.directory ?? null,
            port
          }
        );
        for (const ev of mapped) enqueue(ev);
      }
      log.info("SSE stream ended normally — reconnecting");
    } catch (err) {
      if (!isAbortError(err)) {
        log.warn(`SSE attempt failed: ${String(err)}`);
      }
    } finally {
      outer.signal.removeEventListener("abort", onOuterAbort);
      clearHeartbeat();
      if (state) state.attemptAbort = null;
    }
    if (outer.signal.aborted || !state?.running) return;
    await wait(RECONNECT_DELAY_MS, outer.signal);
  }
}
function startEventStream(options) {
  if (state?.running) {
    log.warn("startEventStream called twice; ignoring second call.");
    return;
  }
  state = {
    getWindow: options.getWindow,
    getPort: options.getPort,
    coalesce: createCoalesceState(),
    flushTimer: null,
    seq: 0,
    running: true,
    outerAbort: new AbortController(),
    attemptAbort: null,
    heartbeat: null,
    loopPromise: null,
    perfCpuTimer: null,
    perfHeapTimer: null,
    perfLastCpu: null,
    perfLastCpuAt: 0
  };
  log.info("Event stream started");
  startPerfSamplers();
  state.loopPromise = runLoop().catch((err) => {
    log.warn(`runLoop crashed: ${String(err)}`);
  });
}
function stopEventStream() {
  if (!state) return;
  state.running = false;
  if (state.flushTimer !== null) {
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }
  clearHeartbeat();
  stopPerfSamplers();
  state.outerAbort?.abort();
  state.attemptAbort?.abort();
  state = null;
  log.info("Event stream stopped");
}
if (!app.isPackaged) {
  app.commandLine.appendSwitch("remote-debugging-port", "9222");
}
let mainWindow = null;
let isQuitting = false;
let currentSettings = defaultSettings;
const PROVIDERS_REFRESH_INTERVAL_MS = 5 * 6e4;
let providersRefreshTimer = null;
let providersUnsubscribe = null;
const OPENCODE_SUPERVISOR_INTERVAL_MS = 15e3;
const OPENCODE_SUPERVISOR_MAX_FAILURES = 3;
let openCodeRestartInFlight = false;
let openCodeConsecutiveFailures = 0;
let openCodeSupervisorTimer = null;
async function waitForOpenCodeHealthy(getPort, opts = {}) {
  const intervalMs = opts.intervalMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 3e4;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const perAttempt = Math.min(1e4, Math.max(1e3, deadline - Date.now()));
    const health = await checkOpenCodeHealth(getPort(), perAttempt);
    if (health.healthy) return true;
    await new Promise((resolve2) => setTimeout(resolve2, intervalMs));
  }
  return false;
}
function startOpenCodeSupervisor(getPort, shouldRun, appLog) {
  if (openCodeSupervisorTimer) return;
  openCodeSupervisorTimer = setInterval(() => {
    if (isQuitting) return;
    if (!shouldRun()) return;
    if (openCodeRestartInFlight) return;
    void (async () => {
      const health = await checkOpenCodeHealth(getPort(), 5e3);
      if (health.healthy) {
        if (openCodeConsecutiveFailures > 0) {
          appLog.info(
            `[supervisor] OpenCode recovered after ${openCodeConsecutiveFailures} failure(s)`
          );
        }
        openCodeConsecutiveFailures = 0;
        return;
      }
      openCodeConsecutiveFailures += 1;
      appLog.warn(
        `[supervisor] OpenCode health probe failed (${openCodeConsecutiveFailures}/${OPENCODE_SUPERVISOR_MAX_FAILURES}): ${health.error ?? "unknown error"}`
      );
      if (openCodeConsecutiveFailures < OPENCODE_SUPERVISOR_MAX_FAILURES) {
        return;
      }
      openCodeRestartInFlight = true;
      try {
        appLog.error(
          `[supervisor] OpenCode unresponsive — restarting in-process server`
        );
        try {
          await stopOpenCodeServer();
        } catch (err) {
          appLog.warn(
            `[supervisor] stopOpenCodeServer during restart: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        try {
          await startOpenCodeServer(getPort());
        } catch (err) {
          appLog.error(
            `[supervisor] startOpenCodeServer during restart failed: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        openCodeConsecutiveFailures = 0;
      } finally {
        openCodeRestartInFlight = false;
      }
    })();
  }, OPENCODE_SUPERVISOR_INTERVAL_MS);
}
function stopOpenCodeSupervisor() {
  if (openCodeSupervisorTimer) {
    clearInterval(openCodeSupervisorTimer);
    openCodeSupervisorTimer = null;
  }
}
app.whenReady().then(async () => {
  electronApp.setAppUserModelId("com.interactive-mcp.desktop");
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });
  initLogger(app.getPath("logs"));
  const appLog = createLogger("app");
  appLog.info(`Application started, version=${app.getVersion()}`);
  await initDatabase();
  currentSettings = loadSettings();
  registerIpcHandlers({
    getMainWindow: () => mainWindow,
    getSettings: () => currentSettings,
    setSettings: (settings) => {
      currentSettings = settings;
    }
  });
  const openedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin;
  mainWindow = createWindow(() => isQuitting, {
    startHidden: openedAtLogin
  });
  providersUnsubscribe?.();
  providersUnsubscribe = subscribeToProvidersInfo((info) => {
    mainWindow?.webContents.send("providers-info:updated", info);
  });
  createTray(
    () => mainWindow,
    () => {
      isQuitting = true;
      stopMcpServer();
      app.quit();
    }
  );
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow(() => isQuitting);
    } else {
      mainWindow?.show();
    }
  });
  const runDeferredInit = async () => {
    if (app.isPackaged) {
      try {
        app.setLoginItemSettings({
          openAtLogin: currentSettings.launchAtLogin,
          openAsHidden: currentSettings.launchAtLogin
        });
      } catch {
      }
    }
    const seededCount = seedBuiltinTemplates(BUILTIN_TEMPLATES);
    if (seededCount > 0) {
      console.log(
        `[builtin-templates] Seeded ${seededCount} built-in templates`
      );
    }
    await startMcpServer(
      currentSettings.port,
      () => mainWindow,
      () => currentSettings.soundEnabled,
      () => currentSettings.promptTimeoutSeconds * 1e3,
      () => currentSettings.openCodePort,
      () => currentSettings.docIndexingEnabled,
      () => currentSettings.agentBackend
    );
    const isOpenCodeBackend = currentSettings.agentBackend === "opencode";
    if (isOpenCodeBackend) {
      if (currentSettings.autoSyncOpencode) {
        const syncResult = syncRemoteConfig(
          currentSettings.port,
          currentSettings.promptTimeoutSeconds
        );
        console.log(`[config-sync] ${syncResult}`);
      }
      if (currentSettings.autoStartOpenCode) {
        void startOpenCodeServer(currentSettings.openCodePort).catch(
          (err) => {
            appLog.error(
              `[startup] OpenCode in-process start failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        );
      }
      startSessionTreeService(
        () => mainWindow,
        () => currentSettings.openCodePort
      );
      void waitForOpenCodeHealthy(() => currentSettings.openCodePort).then(
        async (healthy) => {
          if (!healthy) {
            appLog.warn(
              "[startup] OpenCode did not become healthy within 30s — skipping cold-start warmup"
            );
            return;
          }
          await fetchProvidersInfo(currentSettings.openCodePort).catch(
            (err) => {
              appLog.warn(
                `[startup] providers warmup failed: ${err instanceof Error ? err.message : String(err)}`
              );
            }
          );
          if (providersRefreshTimer) clearInterval(providersRefreshTimer);
          providersRefreshTimer = setInterval(() => {
            void refreshProvidersInfo(currentSettings.openCodePort).catch(
              (err) => {
                appLog.warn(
                  `[providers-refresh] periodic refresh failed: ${err instanceof Error ? err.message : String(err)}`
                );
              }
            );
          }, PROVIDERS_REFRESH_INTERVAL_MS);
          startOpenCodeSupervisor(
            () => currentSettings.openCodePort,
            () => currentSettings.autoStartOpenCode,
            appLog
          );
        }
      );
      startEventStream({
        getWindow: () => mainWindow,
        getPort: () => currentSettings.openCodePort
      });
      const reconResult = await reconcileSessionConnections(
        currentSettings.openCodePort,
        null
      );
      console.log(
        `[session-reconnect] matched=${reconResult.matched} cleaned=${reconResult.cleaned} total=${reconResult.total}`
      );
      void registerMcpWithRetry({
        appPort: currentSettings.port,
        openCodePort: currentSettings.openCodePort,
        promptTimeoutSeconds: currentSettings.promptTimeoutSeconds
      }).then((result) => {
        console.log(
          `[startup-register] status=${result.status}${result.error ? ` error=${result.error}` : ""}`
        );
      });
    } else if (currentSettings.agentBackend === "claude_sdk") {
      const claudeRuntime = await detectClaudeSdkRuntime();
      console.log(`[claude-sdk] ${claudeRuntime.message}`);
    }
  };
  let deferredStarted = false;
  const startDeferredOnce = () => {
    if (deferredStarted) return;
    deferredStarted = true;
    setImmediate(() => {
      void runDeferredInit().catch((err) => {
        appLog.error(`Deferred init failed: ${String(err)}`);
      });
    });
  };
  if (mainWindow) {
    mainWindow.once("ready-to-show", startDeferredOnce);
    setTimeout(startDeferredOnce, 3e3);
  } else {
    setImmediate(startDeferredOnce);
  }
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
let quitCleanupStarted = false;
app.on("before-quit", (event) => {
  isQuitting = true;
  stopSessionTreeService();
  stopEventStream();
  stopOpenCodeSupervisor();
  void stopOpenCodeServer().catch((err) => {
    console.warn(
      `[before-quit] stopOpenCodeServer failed: ${err instanceof Error ? err.message : String(err)}`
    );
  });
  if (providersRefreshTimer) {
    clearInterval(providersRefreshTimer);
    providersRefreshTimer = null;
  }
  providersUnsubscribe?.();
  providersUnsubscribe = null;
  void softRestartMcpServer().catch((err) => {
    console.error("[main] softRestartMcpServer on before-quit failed:", err);
  });
  stopMcpServer();
  if (quitCleanupStarted) return;
  quitCleanupStarted = true;
  event.preventDefault();
  void flushLogger().finally(() => {
    app.quit();
  });
});
export {
  mainWindow
};
