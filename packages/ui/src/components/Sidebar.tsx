import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Cloud,
  Copy,
  Download,
  FilePlus2,
  Folder as FolderIcon,
  FolderPlus,
  History,
  Library,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import type { Collection, Folder, HistoryEntry, SavedRequest, Workflow } from '@crafillio/core';
import { useStore } from '../state/store';
import { askChoice, askConfirm, askName } from '../state/dialogs';
import { formatDate } from '../lib/format';
import { uid } from '../lib/defaults';
import { useT } from '../i18n';

type Section = 'collections' | 'workflows' | 'history' | 's3';

interface Props {
  onEditConnection: (id: string | null) => void;
}

export function Sidebar({ onEditConnection }: Props) {
  const t = useT();
  const [section, setSection] = useState<Section>('collections');

  return (
    <aside className="sidebar">
      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${section === 'collections' ? 'active' : ''}`}
          onClick={() => setSection('collections')}
          title={t.sidebar.collections}
        >
          <Library size={14} />
        </button>
        <button
          className={`sidebar-tab ${section === 'workflows' ? 'active' : ''}`}
          onClick={() => setSection('workflows')}
          title={t.sidebar.workflows}
        >
          <WorkflowIcon size={14} />
        </button>
        <button
          className={`sidebar-tab ${section === 'history' ? 'active' : ''}`}
          onClick={() => setSection('history')}
          title={t.sidebar.history}
        >
          <History size={14} />
        </button>
        <button
          className={`sidebar-tab ${section === 's3' ? 'active' : ''}`}
          onClick={() => setSection('s3')}
          title={t.sidebar.s3}
        >
          <Cloud size={14} />
        </button>
      </div>

      {section === 'collections' && <Collections />}
      {section === 'workflows' && <Workflows />}
      {section === 'history' && <HistoryList />}
      {section === 's3' && <Connections onEdit={onEditConnection} />}
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Collections                                                         */
/* ------------------------------------------------------------------ */

function Collections() {
  const t = useT();
  const collections = useStore((s) => s.collections);
  const refresh = useStore((s) => s.refreshCollections);
  const toast = useStore((s) => s.toast);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');

  const toggle = (id: string): void =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const create = async (): Promise<void> => {
    const name = await askName({
      title: 'New collection',
      label: 'Collection name',
      placeholder: 'Payments API',
      defaultValue: 'New collection',
    });
    if (!name) return;
    await window.crafillio.collections.create(name);
    await refresh();
    toast('success', `Created "${name}"`);
  };

  const importCollection = async (): Promise<void> => {
    const choice = await askChoice({
      title: 'Import',
      label: 'Format',
      confirmLabel: 'Choose file',
      options: [
        { value: 'postman', label: 'Postman collection', hint: 'v2.1 export' },
        { value: 'openapi', label: 'OpenAPI / Swagger', hint: 'JSON or YAML' },
        { value: 'bruno', label: 'Bruno collection', hint: 'folder of .bru files' },
        { value: 'hoppscotch', label: 'Hoppscotch collection', hint: 'JSON export' },
        { value: 'native', label: 'API Devkit collection', hint: '.json export' },
      ],
    });
    if (!choice) return;

    // Each external format has its own picker and parser; the native one is a
    // plain round trip of our own export.
    const importers: Record<string, { label: string; run: () => Promise<
      { requestCount: number; skipped: string[] } | null > }> = {
      postman: { label: 'Postman', run: () => window.crafillio.interop.importPostman() },
      openapi: { label: 'OpenAPI', run: () => window.crafillio.interop.importOpenApi() },
      bruno: { label: 'Bruno', run: () => window.crafillio.interop.importBruno() },
      hoppscotch: { label: 'Hoppscotch', run: () => window.crafillio.interop.importHoppscotch() },
    };

    try {
      const importer = importers[choice];
      if (importer) {
        const result = await importer.run();
        if (!result) return;
        await refresh();
        toast(
          'success',
          `Imported ${result.requestCount} request${result.requestCount === 1 ? '' : 's'} from ${importer.label}` +
            (result.skipped.length ? ` (${result.skipped.length} skipped)` : ''),
        );
      } else {
        const imported = await window.crafillio.collections.importFromFile();
        if (!imported) return;
        await refresh();
        toast('success', `Imported "${imported.name}"`);
      }
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };

  const query = filter.trim().toLowerCase();

  return (
    <>
      <div className="sidebar-actions">
        <button className="btn btn-sm" onClick={create} style={{ flex: 1 }}>
          <FolderPlus size={13} /> {t.common.add}
        </button>
        <button className="btn btn-sm btn-icon" onClick={importCollection} title="Import collection">
          <Upload size={13} />
        </button>
      </div>

      <div className="sidebar-search">
        <Search size={12} />
        <input
          value={filter}
          placeholder={t.sidebar.filterRequests}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="sidebar-scroll">
        {collections.length === 0 && (
          <div className="empty-note">
            No collections yet.
            <br />
            Create one, or import from Postman.
          </div>
        )}

        {collections.map((collection) => (
          <CollectionTree
            key={collection.id}
            collection={collection}
            filter={query}
            collapsed={collapsed}
            onToggle={toggle}
            onChanged={refresh}
          />
        ))}
      </div>
    </>
  );
}

/** A collection rendered as a real folder tree, matching the saved structure. */
function CollectionTree({
  collection,
  filter,
  collapsed,
  onToggle,
  onChanged,
}: {
  collection: Collection;
  filter: string;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onChanged: () => Promise<void>;
}) {
  const openSaved = useStore((s) => s.openSaved);
  const toast = useStore((s) => s.toast);

  const matches = useCallback(
    (request: SavedRequest): boolean => {
      if (!filter) return true;
      const url = request.rest?.url ?? request.grpc?.service ?? '';
      return (
        request.name.toLowerCase().includes(filter) || url.toLowerCase().includes(filter)
      );
    },
    [filter],
  );

  const visibleRequests = useMemo(
    () => collection.requests.filter(matches),
    [collection.requests, matches],
  );

  // While filtering, hide branches with no surviving requests so the tree
  // collapses down to what actually matched.
  const folderHasMatch = useCallback(
    (folderId: string): boolean => {
      if (!filter) return true;
      const descendants = new Set<string>([folderId]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const folder of collection.folders) {
          if (folder.parentId && descendants.has(folder.parentId) && !descendants.has(folder.id)) {
            descendants.add(folder.id);
            grew = true;
          }
        }
      }
      return visibleRequests.some((r) => r.folderId && descendants.has(r.folderId));
    },
    [collection.folders, filter, visibleRequests],
  );

  const isCollapsed = collapsed.has(collection.id) && !filter;

  const addFolder = async (parentId: string | null): Promise<void> => {
    const name = await askName({
      title: 'New folder',
      label: 'Folder name',
      placeholder: 'Users',
      defaultValue: 'New folder',
    });
    if (!name) return;
    await window.crafillio.collections.createFolder(collection.id, name, parentId);
    await onChanged();
  };

  const rename = async (): Promise<void> => {
    const name = await askName({
      title: 'Rename collection',
      label: 'Collection name',
      defaultValue: collection.name,
      confirmLabel: 'Rename',
    });
    if (!name) return;
    await window.crafillio.collections.rename(collection.id, name);
    await onChanged();
  };

  const remove = async (): Promise<void> => {
    const ok = await askConfirm({
      title: 'Delete collection',
      message: `Delete "${collection.name}" and all ${collection.requests.length} request(s) inside it?\n\nThis cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await window.crafillio.collections.remove(collection.id);
    await onChanged();
    toast('success', 'Collection deleted');
  };

  const exportCollection = async (): Promise<void> => {
    const path = await window.crafillio.collections.exportToFile(collection.id);
    if (path) toast('success', `Exported to ${path}`);
  };

  const renderFolder = (folder: Folder, depth: number): JSX.Element | null => {
    if (!folderHasMatch(folder.id)) return null;
    const folderCollapsed = collapsed.has(folder.id) && !filter;

    return (
      <div key={folder.id}>
        <div
          className="tree-row"
          style={{ paddingLeft: 10 + depth * 12 }}
          onClick={() => onToggle(folder.id)}
        >
          {folderCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          <FolderIcon size={13} style={{ color: 'var(--amber)', flexShrink: 0 }} />
          <span className="row-label">{folder.name}</span>
          <button
            className="row-action"
            title="New folder inside"
            onClick={(e) => {
              e.stopPropagation();
              void addFolder(folder.id);
            }}
          >
            <Plus size={12} />
          </button>
          <button
            className="row-action"
            title="Delete folder"
            onClick={async (e) => {
              e.stopPropagation();
              const ok = await askConfirm({
                title: 'Delete folder',
                message: `Delete "${folder.name}" and everything inside it?`,
                confirmLabel: 'Delete',
                danger: true,
              });
              if (!ok) return;
              await window.crafillio.collections.removeFolder(collection.id, folder.id);
              await onChanged();
            }}
          >
            <Trash2 size={12} />
          </button>
        </div>

        {!folderCollapsed && (
          <>
            {collection.folders
              .filter((child) => child.parentId === folder.id)
              .map((child) => renderFolder(child, depth + 1))}
            {visibleRequests
              .filter((request) => request.folderId === folder.id)
              .map((request) => renderRequest(request, depth + 1))}
          </>
        )}
      </div>
    );
  };

  const renderRequest = (request: SavedRequest, depth: number): JSX.Element => (
    <RequestRow
      key={request.id}
      request={request}
      depth={depth}
      collection={collection}
      onOpen={() => openSaved(collection, request)}
      onChanged={onChanged}
    />
  );

  return (
    <div className="collection-block">
      <div className="collection-header" onClick={() => onToggle(collection.id)}>
        {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <span style={{ flex: 1 }}>{collection.name}</span>
        <span className="collection-count">{collection.requests.length}</span>
        <span className="collection-tools" onClick={(e) => e.stopPropagation()}>
          <button className="row-action" title="New folder" onClick={() => void addFolder(null)}>
            <FolderPlus size={12} />
          </button>
          <button className="row-action" title="Rename" onClick={rename}>
            <Pencil size={12} />
          </button>
          <button className="row-action" title="Export" onClick={exportCollection}>
            <Download size={12} />
          </button>
          <button className="row-action danger" title="Delete collection" onClick={remove}>
            <Trash2 size={12} />
          </button>
        </span>
      </div>

      {!isCollapsed && (
        <>
          {collection.folders
            .filter((folder) => folder.parentId === null)
            .map((folder) => renderFolder(folder, 0))}
          {visibleRequests
            .filter((request) => request.folderId === null)
            .map((request) => renderRequest(request, 0))}
          {collection.requests.length === 0 && (
            <div className="empty-note" style={{ padding: '10px 16px', textAlign: 'left' }}>
              Empty — save a request here with ⌘S.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RequestRow({
  request,
  depth,
  collection,
  onOpen,
  onChanged,
}: {
  request: SavedRequest;
  depth: number;
  collection: Collection;
  onOpen: () => void;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const toast = useStore((s) => s.toast);
  const [menuOpen, setMenuOpen] = useState(false);

  const chip = request.protocol === 'rest' ? (request.rest?.method ?? 'GET') : request.protocol.toUpperCase();

  const rename = async (): Promise<void> => {
    setMenuOpen(false);
    const name = await askName({
      title: 'Rename request',
      label: 'Request name',
      defaultValue: request.name,
      confirmLabel: 'Rename',
    });
    if (!name) return;
    await window.crafillio.collections.saveRequest(collection.id, { ...request, name });
    await onChanged();
  };

  const duplicate = async (): Promise<void> => {
    setMenuOpen(false);
    await window.crafillio.collections.saveRequest(collection.id, {
      ...request,
      id: uid('req'),
      name: `${request.name} copy`,
    });
    await onChanged();
    toast('success', 'Request duplicated');
  };

  const copyAsCurl = async (): Promise<void> => {
    setMenuOpen(false);
    if (!request.rest) {
      toast('error', 'Only REST requests can be copied as curl.');
      return;
    }
    const command = await window.crafillio.interop.exportCurl(request.rest);
    await navigator.clipboard.writeText(command);
    toast('success', 'Copied as curl');
  };

  const remove = async (): Promise<void> => {
    setMenuOpen(false);
    const ok = await askConfirm({
      title: 'Delete request',
      message: `Delete "${request.name}"?`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await window.crafillio.collections.removeRequest(collection.id, request.id);
    await onChanged();
  };

  return (
    <div className="tree-row request-row" style={{ paddingLeft: 10 + depth * 12 }} onClick={onOpen}>
      <span className={`method-chip m-${chip}`}>{chip}</span>
      <span className="row-label">{request.name}</span>

      <button
        className="row-action"
        title="More"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((open) => !open);
        }}
      >
        <MoreHorizontal size={12} />
      </button>

      {menuOpen && (
        <>
          {/* Click-away layer so the menu closes without a document listener. */}
          <div className="menu-scrim" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }} />
          <div className="context-menu" onClick={(e) => e.stopPropagation()}>
            <button onClick={rename}>
              <Pencil size={12} /> {t.common.rename}
            </button>
            <button onClick={duplicate}>
              <Copy size={12} /> {t.sidebar.duplicate}
            </button>
            <button onClick={copyAsCurl}>
              <FilePlus2 size={12} /> {t.sidebar.copyAsCurl}
            </button>
            <button className="danger" onClick={remove}>
              <Trash2 size={12} /> {t.common.delete}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Workflows                                                           */
/* ------------------------------------------------------------------ */

function Workflows() {
  const t = useT();
  const openWorkflow = useStore((s) => s.openWorkflow);
  const activeWorkflowId = useStore((s) => s.activeWorkflowId);
  const toast = useStore((s) => s.toast);

  const [items, setItems] = useState<Workflow[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async (): Promise<void> => {
    setItems(await window.crafillio.workflow.list());
  }, []);

  useEffect(() => {
    void load();
    // Keeps the list current while the canvas is being edited elsewhere.
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [load]);

  const create = async (): Promise<void> => {
    const name = await askName({
      title: 'New workflow',
      label: 'Workflow name',
      placeholder: 'Order pipeline',
      defaultValue: 'New workflow',
    });
    if (!name) return;
    const created = await window.crafillio.workflow.create(name);
    await load();
    openWorkflow(created.id);
    toast('success', `Created "${name}"`);
  };

  return (
    <>
      <div className="sidebar-actions">
        <button className="btn btn-sm" style={{ flex: 1 }} onClick={create} title="Create a new workflow">
          <Plus size={13} /> {t.sidebar.newWorkflow}
        </button>
        <button
          className="btn btn-sm btn-icon"
          title="Import a workflow file"
          onClick={async () => {
            try {
              const imported = await window.crafillio.workflow.import();
              if (!imported) return;
              await load();
              openWorkflow(imported.id);
              toast('success', `Imported "${imported.name}"`);
            } catch (err) {
              toast('error', (err as Error).message);
            }
          }}
        >
          <Upload size={13} />
        </button>
      </div>

      <div className="sidebar-scroll">
        {items.length === 0 && (
          <div className="empty-note">
            {t.sidebar.noWorkflows}
            <br />
            {t.sidebar.noWorkflowsHint}
          </div>
        )}

        {items.map((workflow) => {
          const open = expanded.has(workflow.id);
          return (
            <div key={workflow.id} className="collection-block">
              <div
                className={`collection-header ${activeWorkflowId === workflow.id ? 'current' : ''}`}
                onClick={() => openWorkflow(workflow.id)}
              >
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(workflow.id)) next.delete(workflow.id);
                      else next.add(workflow.id);
                      return next;
                    });
                  }}
                  style={{ display: 'flex' }}
                >
                  {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </span>
                <span style={{ flex: 1 }}>{workflow.name}</span>
                <span className="collection-count">{workflow.steps.length}</span>
                <span className="collection-tools" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="row-action"
                    title="Rename"
                    onClick={async () => {
                      const name = await askName({
                        title: 'Rename workflow',
                        label: 'Workflow name',
                        defaultValue: workflow.name,
                        confirmLabel: 'Rename',
                      });
                      if (!name) return;
                      await window.crafillio.workflow.save({ ...workflow, name });
                      await load();
                    }}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    className="row-action"
                    title="Export this workflow to a file"
                    onClick={async () => {
                      const path = await window.crafillio.workflow.export(workflow.id);
                      if (path) toast('success', `Exported to ${path}`);
                    }}
                  >
                    <Download size={12} />
                  </button>
                  <button
                    className="row-action danger"
                    title="Delete workflow"
                    onClick={async () => {
                      const ok = await askConfirm({
                        title: 'Delete workflow',
                        message: `Delete "${workflow.name}" and its ${workflow.steps.length} step(s)?`,
                        confirmLabel: 'Delete',
                        danger: true,
                      });
                      if (!ok) return;
                      await window.crafillio.workflow.remove(workflow.id);
                      await load();
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              </div>

              {open &&
                (workflow.steps.length === 0 ? (
                  <div className="empty-note" style={{ padding: '8px 16px', textAlign: 'left' }}>
                    No steps yet.
                  </div>
                ) : (
                  workflow.steps.map((step, index) => (
                    <div
                      key={step.id}
                      className="tree-row"
                      style={{ paddingLeft: 22 }}
                      onClick={() => openWorkflow(workflow.id)}
                    >
                      <span
                        className={`method-chip m-${
                          step.kind === 'grpc' ? 'GRPC' : step.request.method
                        }`}
                      >
                        {step.kind === 'grpc' ? 'GRPC' : step.request.method}
                      </span>
                      <span className="row-label">
                        {index + 1}. {step.name}
                        <div className="row-sub">
                          {step.kind === 'grpc'
                            ? `${step.grpc.service || '?'}/${step.grpc.method || '?'}`
                            : step.request.url || 'no URL yet'}
                        </div>
                      </span>
                    </div>
                  ))
                ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

function HistoryList() {
  const t = useT();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  const load = useCallback(async (): Promise<void> => {
    setEntries(await window.crafillio.history.list());
  }, []);

  useEffect(() => {
    void load();
    // Refresh when a request completes elsewhere in the app.
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <>
      <div className="sidebar-actions">
        <button className="btn btn-sm" style={{ flex: 1 }} onClick={load} title="Reload history">
          {t.common.refresh}
        </button>
        <button
          className="btn btn-sm btn-danger"
          onClick={async () => {
            const ok = await askConfirm({
              title: 'Clear history',
              message: 'Remove every entry from request history?',
              confirmLabel: 'Clear',
              danger: true,
            });
            if (!ok) return;
            await window.crafillio.history.clear();
            await load();
          }}
        >
          {t.common.clear}
        </button>
      </div>

      <div className="sidebar-scroll">
        {entries.length === 0 && <div className="empty-note">{t.sidebar.noHistory}</div>}
        {entries.map((entry) => (
          <div key={entry.id} className="tree-row" style={{ cursor: 'default' }}>
            <span className={`method-chip m-${entry.protocol.toUpperCase()}`}>
              {entry.protocol.toUpperCase()}
            </span>
            <span className="row-label" title={entry.label}>
              {entry.label}
              <div className="row-sub">
                {formatDate(entry.at)}
                {entry.status ? ` · ${entry.status}` : ''}
              </div>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* S3 connections                                                      */
/* ------------------------------------------------------------------ */

function Connections({ onEdit }: { onEdit: (id: string | null) => void }) {
  const t = useT();
  const connections = useStore((s) => s.connections);
  const refresh = useStore((s) => s.refreshConnections);
  const newTab = useStore((s) => s.newTab);

  return (
    <>
      <div className="sidebar-actions">
        <button className="btn btn-sm" style={{ flex: 1 }} onClick={() => onEdit(null)}>
          <Plus size={13} /> {t.sidebar.addConnection}
        </button>
      </div>

      <div className="sidebar-scroll">
        {connections.length === 0 && (
          <div className="empty-note">
            {t.sidebar.noConnections}
            <br />
            {t.sidebar.noConnectionsHint}
          </div>
        )}

        {connections.map((connection) => (
          <div key={connection.id} className="tree-row" onClick={() => newTab('s3')}>
            <Cloud size={13} style={{ color: 'var(--s3)', flexShrink: 0 }} />
            <span className="row-label">
              {connection.name}
              <div className="row-sub">{connection.endpoint || `AWS · ${connection.region}`}</div>
            </span>
            <button
              className="row-action"
              title="Edit"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(connection.id);
              }}
            >
              <Pencil size={12} />
            </button>
            <button
              className="row-action danger"
              title="Remove"
              onClick={async (e) => {
                e.stopPropagation();
                const ok = await askConfirm({
                  title: 'Remove connection',
                  message: `Remove "${connection.name}"? Saved credentials for it are deleted.`,
                  confirmLabel: 'Remove',
                  danger: true,
                });
                if (!ok) return;
                await window.crafillio.connections.remove(connection.id);
                await refresh();
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
